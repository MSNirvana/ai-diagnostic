import json
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.data.external import fetch_industry_benchmark
from app.cases.retriever import retrieve_similar_cases
from app.llm.base import LLMClient
from app.models.questionnaire import ModuleAnswer
from app.models.result import DataRequest, ModuleResult
from app.skills.base import Skill
from app.skills.evidence import build_evidence_package
from app.skills.method import compose_system_prompt
from app.skills.parsing import parse_json_object, to_actions, to_drilldown, to_evidence
from app.skills.scenario_catalog import detect_business_scenario, render_problem_text
from app.skills.store import get_active_skill_version


@dataclass(frozen=True)
class DataRequirement:
    key: str
    label: str
    reason: str
    source_hint: str
    keywords: tuple[str, ...]
    required: bool = True


@dataclass(frozen=True)
class ExpertConfig:
    module: str
    method: str
    label: str
    fallback_prompt: str  # 诊断域为空：判断由 diagnostic_method 脑子按 domain 数据现场生成
    data_requirements: tuple[DataRequirement, ...] = ()
    scenarios: tuple[str, ...] = ()
    scenario_notes: dict[str, str] = None  # type: ignore[assignment]
    additional_fields: tuple[str, ...] = ()
    # 域数据注册表：注入给脑子现场构建领域视角（零 prose 的来源）
    industry_kpis: tuple[str, ...] = ()
    judgment_hints: tuple[str, ...] = ()


_CARD_KEYS = ("industry_kpis", "judgment_hints", "data_requirements")


def serialize_card(config: ExpertConfig) -> dict:
    """把一张诊断卡的可治理数据（KPI/避坑提示/取数项）导出成 JSON，供后台编辑/版本化。"""
    return {
        "industry_kpis": list(config.industry_kpis),
        "judgment_hints": list(config.judgment_hints),
        "data_requirements": [
            {
                "key": req.key,
                "label": req.label,
                "reason": req.reason,
                "source_hint": req.source_hint,
                "keywords": list(req.keywords),
                "required": req.required,
            }
            for req in config.data_requirements
        ],
    }


def card_from_version(system_prompt: str | None) -> dict | None:
    """DB 版本里若存的是「卡片数据」JSON 则解析返回；否则（prose/空/坏 JSON）返回 None。"""
    text = (system_prompt or "").strip()
    if not text or text[0] != "{":
        return None
    try:
        data = json.loads(text)
    except Exception:  # noqa: BLE001
        return None
    if isinstance(data, dict) and any(k in data for k in _CARD_KEYS):
        return data
    return None


def card_requirements(card: dict) -> tuple[DataRequirement, ...]:
    out: list[DataRequirement] = []
    for req in card.get("data_requirements") or []:
        if not isinstance(req, dict) or not req.get("key") or not req.get("label"):
            continue
        out.append(
            DataRequirement(
                key=str(req["key"]),
                label=str(req["label"]),
                reason=str(req.get("reason", "")),
                source_hint=str(req.get("source_hint", "")),
                keywords=tuple(req.get("keywords", ()) or ()),
                required=bool(req.get("required", True)),
            )
        )
    return tuple(out)


class ConfiguredExpertSkill(Skill):
    """配置化专家 Skill：每个模块独立配置，诊断契约保持一致。"""

    def __init__(self, config: ExpertConfig):
        self.config = config
        self.module = config.module
        self.method = config.method

    async def diagnose(
        self,
        answer: ModuleAnswer,
        llm: LLMClient,
        session: AsyncSession | None = None,
    ) -> tuple[ModuleResult, str]:
        skill_ver = await get_active_skill_version(session, self.module)
        # 诊断卡：DB 激活版本若存「卡片数据」JSON（kpis/避坑提示/取数项），则覆盖文件默认——
        # 后台可改/留痕/回滚。卡片版本零 prose（判断仍由脑子生成）；非卡片文本走 prose 逃生通道。
        card = card_from_version(skill_ver.system_prompt) if skill_ver else None
        domain_prompt = "" if card is not None else (
            skill_ver.system_prompt if skill_ver else self.config.fallback_prompt
        )
        # 注入通用诊断方法（脑子，本身是可版本化的 DB skill）：领域切片在前，通用方法+输出契约在后。
        system_prompt = await compose_system_prompt(domain_prompt, session)
        version_id = skill_ver.id if skill_ver else "fallback"
        card_kpis = card["industry_kpis"] if card and isinstance(card.get("industry_kpis"), list) else list(self.config.industry_kpis)
        card_hints = card["judgment_hints"] if card and isinstance(card.get("judgment_hints"), list) else list(self.config.judgment_hints)
        card_reqs = card_requirements(card) if card and card.get("data_requirements") is not None else self.config.data_requirements
        evidence_skill_ver = await get_active_skill_version(session, "evidence_confidence")
        evidence_skill_version_id = evidence_skill_ver.id if evidence_skill_ver else "fallback"

        scenario = detect_business_scenario(
            industry=answer.facts.get("行业", "") or answer.context.get("industry", ""),
            main_business=answer.facts.get("主营业务", "") or answer.context.get("main_business", ""),
            business_model=answer.facts.get("商业模式", "") or answer.context.get("business_model", ""),
            extra_text=render_problem_text(answer.context) + " " + " ".join(answer.pains),
        )
        benchmark = await fetch_industry_benchmark(
            self.module,
            answer.pains,
            scenario_key=scenario.key,
            scenario_label=scenario.label,
            evidence_lens=list(scenario.evidence_lens),
            llm=llm,
            session=session,
        )
        # 相似历史案例（脱敏先例）注入——让积累的案例参与诊断（旁路，失败返回 []）
        similar_cases = await retrieve_similar_cases(
            session,
            module=self.module,
            industry=answer.context.get("industry", ""),
            scenario_key=scenario.key,
        )
        data_requests = missing_data_requests(answer, card_reqs)
        external_research = _research_for_module(
            answer.context.get("research_evidence", []),
            self.module,
        )
        prompt = json.dumps(
            {
                "module": self.module,
                # 域数据注册表：脑子据此现场构建领域诊断视角（零 prose）。卡片数据可被 DB 版本覆盖。
                "domain": {
                    "label": self.config.label,
                    "industry_kpis": list(card_kpis),
                    "judgment_hints": list(card_hints),
                },
                "scenario": {
                    "key": scenario.key,
                    "label": scenario.label,
                    "evidence_lens": list(scenario.evidence_lens),
                    "benchmark_keywords": list(scenario.benchmark_keywords),
                },
                "facts": answer.facts,
                "pains": answer.pains,
                "context": answer.context,
                "problem_map": answer.context,
                "benchmark": benchmark,
                "external_research_evidence": external_research,
                "external_research_usage": (
                    "这些 external_research_evidence 来自系统预研搜索，带 url/title/snippet/credibility。"
                    "专家结论可以引用其中证据；涉及外部事实时必须在 evidence.source 写明来源标题或 URL。"
                    "如果这些证据仍不足，请在输出 JSON 中增加 research_questions 数组，说明还要补搜什么。"
                ),
                "similar_cases": similar_cases,
                "similar_cases_usage": (
                    "以上 similar_cases 是同行业/同场景的脱敏历史诊断先例，"
                    "仅供参考典型信号与常见缺数据，不是本项目的事实。"
                    "可借鉴判断方向，但 evidence 只能来自本项目 facts/上传数据，"
                    "禁止把先例结论当作本项目证据引用。"
                ) if similar_cases else "",
                "data_requirements": [
                    {
                        "key": req.key,
                        "label": req.label,
                        "reason": req.reason,
                        "source_hint": req.source_hint,
                        "required": req.required,
                    }
                    for req in card_reqs
                ],
                "missing_data_requests": [req.model_dump() for req in data_requests],
            },
            ensure_ascii=False,
        )
        raw = await llm.complete(system=system_prompt, prompt=prompt)
        data = parse_json_object(raw)
        signal = data.get("signal", "yellow")
        if signal not in ("red", "yellow", "green"):
            signal = "yellow"
        evidence = [to_evidence(e) for e in (data.get("evidence") or [])[:3]]
        actions = to_actions(data.get("actions"))
        # 让脑子按这家公司真实情况决定「该补什么数据」（没有的业务不列）；脑子没给才退回静态死清单。
        brain_reqs = _brain_data_requests(data, card_reqs)
        if brain_reqs is not None:
            data_requests = brain_reqs
        return (
            ModuleResult(
                module=self.module,
                signal=signal,
                problem=str(data.get("problem") or "").strip(),
                conclusion=data.get("conclusion", "（模型未给出结论）"),
                evidence=evidence,
                actions=actions,
                drilldown=to_drilldown(data.get("drilldown")),
                evidence_package=build_evidence_package(
                    module=self.module,
                    answer=answer,
                    benchmark=benchmark,
                    citations=evidence,
                    actions=actions,
                    skill_version_id=version_id,
                    evidence_skill_version_id=evidence_skill_version_id,
                    data_requests=data_requests,
                ),
                data_requests=data_requests,
                research_questions=_research_questions(data.get("research_questions")),
            ),
            version_id,
        )


def _brain_data_requests(data: dict, card_reqs: tuple[DataRequirement, ...]) -> list[DataRequest] | None:
    """把脑子输出的 data_needs 转成数据请求——脑子已按这家公司真实情况筛过（没有的业务不列）。

    返回 None 表示脑子没给（data_needs 缺失/非法）→ 调用方退回静态死清单兜底；
    返回 [] 表示脑子判定「没有真正缺的关键数据」→ 就该不显示任何补数项。
    能对上静态清单 key 的复用其 source_hint（系统好跨轮追踪 + 取数指引）。
    """
    needs = data.get("data_needs")
    if not isinstance(needs, list):
        return None
    by_key = {req.key: req for req in card_reqs}
    out: list[DataRequest] = []
    seen: set[str] = set()
    for item in needs:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        if not label:
            continue
        key = str(item.get("key") or "").strip() or f"need_{len(out) + 1}"
        if key in seen:
            continue
        seen.add(key)
        base = by_key.get(key)
        out.append(
            DataRequest(
                key=key,
                label=label,
                reason=str(item.get("reason") or "").strip() or (base.reason if base else ""),
                source_hint=str(item.get("source_hint") or "").strip() or (base.source_hint if base else ""),
                required=bool(item.get("required", True)),
            )
        )
    return out


def missing_data_requests(
    answer: ModuleAnswer,
    requirements: tuple[DataRequirement, ...],
) -> list[DataRequest]:
    rendered_facts = "\n".join(
        f"{key}: {value}" for key, value in answer.facts.items() if str(value).strip()
    )
    uploaded_haystack = " ".join(answer.uploaded_files)
    haystack = f"{rendered_facts}\n{uploaded_haystack}"
    missing: list[DataRequest] = []
    for req in requirements:
        if not any(keyword in haystack for keyword in req.keywords):
            missing.append(
                DataRequest(
                    key=req.key,
                    label=req.label,
                    reason=req.reason,
                    source_hint=req.source_hint,
                    required=req.required,
                )
            )
    return missing


def _research_questions(value) -> list[str]:
    if not value:
        return []
    if isinstance(value, str):
        candidates = [value]
    elif isinstance(value, list):
        candidates = value
    else:
        return []
    out: list[str] = []
    for item in candidates:
        text = str(item).strip()
        if text and text not in out:
            out.append(text[:180])
    return out[:5]


def _research_for_module(items: object, module: str) -> list[dict]:
    if not isinstance(items, list):
        return []
    relevant: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        item_module = str(item.get("module") or "")
        if item_module and item_module != module:
            continue
        relevant.append(item)
    return relevant[:30]
