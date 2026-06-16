import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_llm_client
from app.llm.base import LLMClient
from app.models.profile import (
    BusinessProfile,
    GeneratedField,
    GeneratedModule,
    GeneratedQuestionnaire,
    QuestionnaireGenerationContext,
)
from app.models.conversation import ProblemMap, ProblemSummary
from app.skills.parsing import parse_json_object
from app.skills.store import get_active_skill_version
from app.skills.prompts import QUESTIONNAIRE_BASE, QUESTIONNAIRE_AB_A, QUESTIONNAIRE_AB_B
from app.skills.scenario_catalog import detect_business_scenario, render_problem_text
from app.skills.skill_network import (
    default_core_skill_keys,
    diagnosis_skill_definitions,
    resolve_skill_key,
    skill_definition,
    skill_label,
)
from app.auth.jwt import get_optional_user
from app.db.database import get_session
from app.db.models import User, QuestionnairePreference
from app.memory.known_facts import collect_known_facts, match_known_value

router = APIRouter(prefix="/questionnaire")

# 代码兜底（DB 无激活版本时用）
_SYSTEM = QUESTIONNAIRE_BASE
_SYSTEM_A = QUESTIONNAIRE_AB_A
_SYSTEM_B = QUESTIONNAIRE_AB_B


async def _prompt_for(session: AsyncSession | None, module: str, fallback: str) -> str:
    """优先用 DB 激活版本的 prompt，无则用代码兜底。"""
    ver = await get_active_skill_version(session, module)
    return ver.system_prompt if ver else fallback


class GenerateRequest(BaseModel):
    # profile（静态画像）和 summary（对话摘要）二选一，summary 优先
    profile: BusinessProfile | None = None
    summary: ProblemSummary | None = None
    problem_map: ProblemMap | None = None
    # 二次诊断：传 project_id → 用历史已知 facts 预填问卷，老板不必重填
    project_id: str | None = None


def _build_context(body: "GenerateRequest", mode: str) -> QuestionnaireGenerationContext:
    """构建问卷生成上下文，优先使用 problem_map，其次 summary，再次 profile。"""
    if body.problem_map is not None:
        problem_map = body.problem_map
        problem_text = render_problem_text(problem_map.model_dump())
        scenario = detect_business_scenario(
            industry=problem_map.industry,
            main_business=problem_map.main_business,
            business_model=problem_map.business_model,
            extra_text=problem_text,
        )
        skills = _skill_context(problem_text, problem_map.diagnosis_focus)
        return QuestionnaireGenerationContext(
            mode=mode,
            company_name=problem_map.company_name,
            industry=problem_map.industry,
            main_business=problem_map.main_business,
            business_model=problem_map.business_model,
            scale=problem_map.scale,
            stage=problem_map.stage,
            core_problem=problem_map.core_problem,
            sub_problems=problem_map.sub_problems,
            goal=problem_map.goal,
            constraints=problem_map.constraints,
            success_criteria=problem_map.success_criteria,
            impact=problem_map.impact,
            context=problem_map.context,
            suspected_cause=problem_map.suspected_cause,
            tried=problem_map.tried,
            data_readiness=problem_map.data_readiness,
            diagnosis_focus=problem_map.diagnosis_focus,
            scenario_key=scenario.key,
            scenario_label=scenario.label,
            benchmark_keywords=list(scenario.benchmark_keywords),
            evidence_lens=list(scenario.evidence_lens),
            available_skills=skills["available_skills"],
            recommended_skills=skills["recommended_skills"],
        )
    if body.summary is not None:
        summary = body.summary
        problem_text = json.dumps(summary.model_dump(), ensure_ascii=False)
        scenario = detect_business_scenario(
            industry=summary.industry,
            main_business=summary.main_business,
            business_model=summary.business_model,
            extra_text=problem_text,
        )
        skills = _skill_context(problem_text)
        return QuestionnaireGenerationContext(
            mode=mode,
            company_name=summary.company_name,
            industry=summary.industry,
            main_business=summary.main_business,
            business_model=summary.business_model,
            scale=summary.scale,
            stage=summary.stage,
            core_problem=summary.core_problem,
            context=summary.context,
            suspected_cause=summary.suspected_cause,
            tried=summary.tried,
            scenario_key=scenario.key,
            scenario_label=scenario.label,
            benchmark_keywords=list(scenario.benchmark_keywords),
            evidence_lens=list(scenario.evidence_lens),
            available_skills=skills["available_skills"],
            recommended_skills=skills["recommended_skills"],
        )
    if body.profile is not None:
        profile = body.profile
        problem_text = json.dumps(profile.model_dump(), ensure_ascii=False)
        scenario = detect_business_scenario(
            industry=profile.industry,
            main_business=profile.main_business,
            business_model=profile.business_model,
        )
        skills = _skill_context(problem_text)
        return QuestionnaireGenerationContext(
            mode=mode,
            company_name=profile.company_name,
            industry=profile.industry,
            main_business=profile.main_business,
            business_model=profile.business_model,
            scale=profile.scale,
            stage=profile.stage,
            scenario_key=scenario.key,
            scenario_label=scenario.label,
            benchmark_keywords=list(scenario.benchmark_keywords),
            evidence_lens=list(scenario.evidence_lens),
            available_skills=skills["available_skills"],
            recommended_skills=skills["recommended_skills"],
        )
    skills = _skill_context("")
    return QuestionnaireGenerationContext(
        mode=mode,
        available_skills=skills["available_skills"],
        recommended_skills=skills["recommended_skills"],
    )


def _build_input(body: "GenerateRequest", mode: str) -> str:
    """把 profile / summary / problem_map 转成喂给生成 prompt 的 JSON 文本。"""
    return json.dumps(_build_context(body, mode).model_dump(), ensure_ascii=False)


def _skill_context(text: str, focus: str | None = None) -> dict[str, list[dict]]:
    """问卷生成上下文里的 skill 信息。

    改1（2026-06）：砍掉关键词召回。问卷由 LLM 读问题地图直接生成，
    skill 不再当"召回框架"限制 LLM 能问什么。

    - available_skills：所有诊断 skill 的【数据契约】，作为参考清单喂给 LLM，
      帮它把字段对齐到下游能消费的口径——这是必须保留的"普通话"，
      砍了会让收上来的数据变成下游无法诊断的孤儿数据、且案例库字段不可比。
    - recommended_skills：只在用户【明确指定】诊断焦点、或【完全冷启动】
      （没有任何问题信息）时给值，作为兜底保证；不再用关键词猜。
    """
    available_skills = [
        {
            "key": definition.key,
            "label": definition.label,
            "category": definition.category,
            "category_label": definition.category_label,
            "description": definition.description,
            "required_data": [
                requirement.label for requirement in definition.data_requirements[:4]
            ],
        }
        for definition in diagnosis_skill_definitions()
    ]
    return {
        "available_skills": available_skills,
        "recommended_skills": _recommended_skills(focus, cold_start=not text),
    }


def _recommended_skills(focus: str | None, *, cold_start: bool) -> list[dict[str, object]]:
    """只保留两种"该被保证覆盖"的 skill，不做关键词召回：
    1) 用户在问题地图里明确点名的 diagnosis_focus
    2) 完全冷启动（无任何问题信息）时的核心经营基线
    其余交给 LLM 按问题自由生成。
    """
    selected: list[tuple[str, str]] = []
    focus_key = resolve_skill_key(focus)
    if focus_key:
        selected.append((focus_key, "用户明确指定优先诊断"))
    elif cold_start:
        selected = [(key, "冷启动经营全景基线") for key in default_core_skill_keys()]

    hints: list[dict[str, object]] = []
    for key, reason in selected:
        definition = skill_definition(key)
        if definition is None:
            continue
        hints.append(
            {
                "key": definition.key,
                "label": definition.label,
                "category": definition.category,
                "category_label": definition.category_label,
                "description": definition.description,
                "reason": reason,
                "required_data": [
                    requirement.label for requirement in definition.data_requirements[:4]
                ],
            }
        )
    return hints


def _parse_questionnaire(raw: str) -> GeneratedQuestionnaire:
    data = parse_json_object(raw)
    return GeneratedQuestionnaire.model_validate(data)


def _prefill_known(
    questionnaire: GeneratedQuestionnaire,
    known: dict[str, str],
    source_label: str = "上次诊断已填",
) -> GeneratedQuestionnaire:
    """用历史已知 facts 预填问卷字段。命中的字段填值 + 标来源，老板只需确认/修正。

    known 为空（首次诊断/无历史）时原样返回——行为与改动前完全一致。
    """
    if not known:
        return questionnaire
    for module in questionnaire.modules:
        for field in module.fields:
            value = match_known_value(field.label, field.key, known)
            if value:
                field.prefilled_value = value
                field.known_source = source_label
    return questionnaire


def _ensure_mode_prefix(module_key: str, index: int, mode: str) -> str:
    prefix = "cover" if mode == "coverage" else "focus"
    return f"{prefix}_{module_key}_{index + 1}"


def _normalize_questionnaire(
    questionnaire: GeneratedQuestionnaire,
    *,
    mode: str,
    context: QuestionnaireGenerationContext,
) -> GeneratedQuestionnaire:
    seen_field_keys: set[str] = set()
    seen_pains: set[str] = set()
    normalized_modules: list[GeneratedModule] = []
    for module_index, module in enumerate(questionnaire.modules):
        module_key = resolve_skill_key(module.key) or _slug_key(module.key, module_index)
        definition = skill_definition(module_key)
        label = (module.label or "").strip() or skill_label(module_key)
        if definition is not None:
            label = definition.label
        base_fields = module.fields[:]
        target_field_count = 6 if mode == "coverage" else 4
        fields: list[GeneratedField] = []
        for field_index, field in enumerate(base_fields[:target_field_count]):
            key = field.key.strip() or _ensure_mode_prefix(module_key, field_index, mode)
            if key in seen_field_keys:
                key = _ensure_mode_prefix(module_key, field_index, mode)
            seen_field_keys.add(key)
            hint = (field.hint or "").strip()
            if mode == "coverage" and field_index == 0 and context.goal:
                hint = hint or f"优先填写与目标“{context.goal}”直接相关的当前口径。"
            if mode == "painpoint" and field_index == 0 and context.core_problem:
                hint = hint or f"优先填写最能判断“{context.core_problem}”成因的数据。"
            fields.append(
                GeneratedField(
                    key=key,
                    label=field.label.strip() or f"{label}字段{field_index + 1}",
                    placeholder=field.placeholder.strip() or "请填写具体数字、口径或时间范围",
                    hint=hint or None,
                    accept_file=field.accept_file,
                )
            )
        while len(fields) < target_field_count:
            index = len(fields)
            fallback_label = (
                f"{label}关键指标{index + 1}"
                if mode == "coverage"
                else f"{label}关键验证点{index + 1}"
            )
            fallback_placeholder = (
                "例如：近90天按周趋势、渠道拆分、区域拆分"
                if mode == "coverage"
                else "例如：问题发生时间、影响范围、异常样本、最近一次波动"
            )
            fields.append(
                GeneratedField(
                    key=_ensure_mode_prefix(module_key, index, mode),
                    label=fallback_label,
                    placeholder=fallback_placeholder,
                    hint="请尽量提供真实业务口径或上传数据文件。",
                    accept_file=True if index < 2 else False,
                )
            )

        pains: list[str] = []
        for pain in module.pains:
            text = str(pain).strip()
            if not text or text in seen_pains:
                continue
            seen_pains.add(text)
            pains.append(text)
            if len(pains) >= (3 if mode == "painpoint" else 5):
                break
        if not pains:
            fallback_pains = (
                ["关键指标看不清", "渠道效率波动大", "无法定位主要卡点"]
                if mode == "coverage"
                else ["核心问题原因不清", "已尝试动作无效", "缺少关键验证数据"]
            )
            pains.extend(fallback_pains)
        subtitle = module.subtitle.strip()
        if not subtitle:
            subtitle = (
                f"围绕{context.scenario_label or '当前业务'}补齐{label}关键数据。"
                if mode == "coverage"
                else f"围绕“{context.core_problem or '当前核心问题'}”做定向深挖。"
            )
        free_text_label = module.free_text_label.strip() or (
            "补充哪些经营指标目前没有统一口径？"
            if mode == "coverage"
            else "补充你最怀疑的成因、异常样本或失败尝试。"
        )
        normalized_modules.append(
            GeneratedModule(
                key=module_key,
                label=label,
                subtitle=subtitle,
                fields=fields,
                pains=pains,
                free_text_label=free_text_label,
            )
        )
    normalized_modules = _ensure_recommended_modules(normalized_modules, mode=mode, context=context)
    return GeneratedQuestionnaire(modules=normalized_modules)


def _ensure_recommended_modules(
    modules: list[GeneratedModule],
    *,
    mode: str,
    context: QuestionnaireGenerationContext,
) -> list[GeneratedModule]:
    seen = {module.key for module in modules}
    max_module_count = 10 if mode == "coverage" else 8
    for hint in context.recommended_skills:
        if len(modules) >= max_module_count:
            break
        key = str(hint.get("key") or "").strip()
        if not key or key in seen:
            continue
        fallback = _fallback_generated_module(key, mode=mode, context=context)
        if fallback is None:
            continue
        modules.append(fallback)
        seen.add(key)
    return modules


def _fallback_generated_module(
    key: str,
    *,
    mode: str,
    context: QuestionnaireGenerationContext,
) -> GeneratedModule | None:
    definition = skill_definition(key)
    if definition is None:
        return None
    requirements = list(definition.data_requirements)
    target_field_count = 6 if mode == "coverage" else 4
    fields: list[GeneratedField] = []
    for index, requirement in enumerate(requirements[:target_field_count]):
        fields.append(
            GeneratedField(
                key=f"{key}_{requirement.key}",
                label=requirement.label,
                placeholder=requirement.source_hint or "请填写具体数字、口径或时间范围",
                hint=requirement.reason,
                accept_file=True,
            )
        )
    while len(fields) < min(target_field_count, 4):
        index = len(fields)
        fields.append(
            GeneratedField(
                key=_ensure_mode_prefix(key, index, mode),
                label=f"{definition.label}关键验证点{index + 1}",
                placeholder="例如：时间范围、影响规模、异常样本、数据来源",
                hint="请尽量提供可核验的业务事实或上传文件。",
                accept_file=index < 2,
            )
        )
    return GeneratedModule(
        key=key,
        label=definition.label,
        subtitle=(
            f"补齐{definition.label}相关的关键事实与证据。"
            if mode == "coverage"
            else f"围绕“{context.core_problem or definition.label}”核验{definition.label}风险。"
        ),
        fields=fields,
        pains=[
            f"{definition.label}信息不完整",
            f"{definition.label}风险边界不清",
            "缺少可审计数据支撑",
        ],
        free_text_label=f"补充{definition.label}相关背景、文件或特殊限制。",
    )


def _slug_key(value: str, index: int) -> str:
    raw = value.strip().lower().replace("-", "_").replace(" ", "_")
    return raw or f"custom_{index + 1}"


def _questionnaires_are_meaningfully_different(
    option_a: GeneratedQuestionnaire,
    option_b: GeneratedQuestionnaire,
) -> bool:
    a_fields = [field.label for module in option_a.modules for field in module.fields]
    b_fields = [field.label for module in option_b.modules for field in module.fields]
    if a_fields != b_fields:
        return True
    a_subtitles = [module.subtitle for module in option_a.modules]
    b_subtitles = [module.subtitle for module in option_b.modules]
    return a_subtitles != b_subtitles


@router.post("/generate", response_model=GeneratedQuestionnaire)
async def generate_questionnaire(
    body: GenerateRequest,
    llm: LLMClient = Depends(get_llm_client),
    session: AsyncSession = Depends(get_session),
) -> GeneratedQuestionnaire:
    """单份动态问卷生成 + 质量把关。

    把关 skill 保证产出"不比基础模板差"：模块数、字段数、痛点数、真实内容达标。
    不达标 → 带失败原因自动重生成一次 → 仍不达标 → 422（前端报错可重试，不降级固定问卷）。
    """
    context = _build_context(body, "coverage")
    base_prompt = _build_input(body, "coverage")
    system = await _prompt_for(session, "questionnaire_ab_a", _SYSTEM)
    known = await collect_known_facts(session, body.project_id)

    last_reasons: list[str] = []
    for attempt in range(2):  # 首次 + 把关失败后重试 1 次
        prompt = base_prompt
        if last_reasons:
            prompt = (
                base_prompt
                + "\n\n上一版问卷未达质量门，问题如下，请针对性改进后重新输出：\n- "
                + "\n- ".join(last_reasons)
            )
        raw = await llm.complete(system=system, prompt=prompt)
        try:
            data = parse_json_object(raw)
            generated = GeneratedQuestionnaire.model_validate(data)
        except (ValueError, ValidationError):
            last_reasons = ["输出不是合法问卷 JSON 结构"]
            continue
        # 把关在归一化之前跑——归一化会补齐字段/痛点，会掩盖 LLM 产出的单薄
        passed, reasons = _questionnaire_quality_gate(generated)
        if not passed:
            last_reasons = reasons
            continue
        normalized = _normalize_questionnaire(generated, mode="coverage", context=context)
        return _prefill_known(normalized, known)

    raise HTTPException(
        status_code=422,
        detail="问卷质量未达标：" + "；".join(last_reasons or ["生成失败"]),
    )


# 质量门下限（对照基础模板：6 模块 / 每模块 5-6 字段 / 带痛点）。
# 动态问卷可更聚焦，故模块数下限放宽到 4，但单模块质量不能塌。
_GATE_MIN_MODULES = 4
_GATE_MIN_FIELDS_PER_MODULE = 4
_GATE_MIN_PAINS_PER_MODULE = 2


def _questionnaire_quality_gate(
    questionnaire: GeneratedQuestionnaire,
) -> tuple[bool, list[str]]:
    """问卷质量把关：检查 LLM 产出是否达到"不比基础模板差"的下限。

    在归一化之前调用——归一化会补齐字段/痛点，跑在它之后就永远通过了，失去把关意义。
    返回 (是否通过, 不通过原因列表)。
    """
    reasons: list[str] = []
    modules = questionnaire.modules or []

    if len(modules) < _GATE_MIN_MODULES:
        reasons.append(
            f"模块数 {len(modules)} 少于下限 {_GATE_MIN_MODULES}，覆盖面不足"
        )

    for module in modules:
        label = (module.label or module.key or "未命名模块").strip()
        # 真实字段：label 非空且不是纯占位
        real_fields = [
            f for f in module.fields
            if (f.label or "").strip() and (f.key or "").strip()
        ]
        if len(real_fields) < _GATE_MIN_FIELDS_PER_MODULE:
            reasons.append(
                f"模块「{label}」有效字段仅 {len(real_fields)} 个，少于 {_GATE_MIN_FIELDS_PER_MODULE}"
            )
        real_pains = [p for p in module.pains if str(p).strip()]
        if len(real_pains) < _GATE_MIN_PAINS_PER_MODULE:
            reasons.append(
                f"模块「{label}」痛点选项仅 {len(real_pains)} 个，少于 {_GATE_MIN_PAINS_PER_MODULE}"
            )

    return (len(reasons) == 0, reasons)


class GenerateABResponse(BaseModel):
    option_a: GeneratedQuestionnaire
    option_b: GeneratedQuestionnaire


@router.post("/generate-ab", response_model=GenerateABResponse)
async def generate_ab(
    body: GenerateRequest,
    llm: LLMClient = Depends(get_llm_client),
    session: AsyncSession = Depends(get_session),
) -> GenerateABResponse:
    """并发生成两份候选问卷（A 全面型 / B 痛点型）供用户选择。

    任一份解析失败时，用成功的那份兜底两侧；两份都失败返回 422。
    """
    prompt_a = _build_input(body, "coverage")
    prompt_b = _build_input(body, "painpoint")
    context_a = _build_context(body, "coverage")
    context_b = _build_context(body, "painpoint")
    system_a = await _prompt_for(session, "questionnaire_ab_a", _SYSTEM_A)
    system_b = await _prompt_for(session, "questionnaire_ab_b", _SYSTEM_B)
    raw_a, raw_b = await asyncio.gather(
        llm.complete(system=system_a, prompt=prompt_a),
        llm.complete(system=system_b, prompt=prompt_b),
    )

    parsed_a: GeneratedQuestionnaire | None = None
    parsed_b: GeneratedQuestionnaire | None = None
    try:
        parsed_a = _normalize_questionnaire(
            _parse_questionnaire(raw_a),
            mode="coverage",
            context=context_a,
        )
    except (ValueError, ValidationError):
        parsed_a = None
    try:
        parsed_b = _normalize_questionnaire(
            _parse_questionnaire(raw_b),
            mode="painpoint",
            context=context_b,
        )
    except (ValueError, ValidationError):
        parsed_b = None

    if parsed_a is None and parsed_b is None:
        raise HTTPException(status_code=422, detail="问卷生成失败，请使用通用问卷")
    # 任一失败用另一份兜底，保证两侧都有内容
    if parsed_a is None:
        parsed_a = parsed_b
    if parsed_b is None:
        parsed_b = parsed_a
    if parsed_a is not None and parsed_b is not None and not _questionnaires_are_meaningfully_different(parsed_a, parsed_b):
        parsed_b = _normalize_questionnaire(parsed_b, mode="painpoint", context=context_b)

    # 二次诊断预填：两份候选都用历史已知 facts 填充
    known = await collect_known_facts(session, body.project_id)
    parsed_a = _prefill_known(parsed_a, known)
    parsed_b = _prefill_known(parsed_b, known)

    return GenerateABResponse(option_a=parsed_a, option_b=parsed_b)


class RecordPreferenceRequest(BaseModel):
    profile: BusinessProfile
    option_a: GeneratedQuestionnaire
    option_b: GeneratedQuestionnaire
    chosen: str  # "a" 或 "b"


@router.post("/preference", status_code=201)
async def record_preference(
    body: RecordPreferenceRequest,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, bool]:
    if body.chosen not in ("a", "b"):
        raise HTTPException(status_code=422, detail="chosen 必须是 a 或 b")
    record = QuestionnairePreference(
        user_id=user.id if user else None,
        industry=body.profile.industry,
        profile_json=body.profile.model_dump_json(),
        option_a_json=body.option_a.model_dump_json(),
        option_b_json=body.option_b.model_dump_json(),
        chosen=body.chosen,
    )
    session.add(record)
    await session.commit()
    return {"ok": True}
