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
    fallback_prompt: str
    data_requirements: tuple[DataRequirement, ...] = ()
    scenarios: tuple[str, ...] = ()
    scenario_notes: dict[str, str] = None  # type: ignore[assignment]
    additional_fields: tuple[str, ...] = ()


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
        system_prompt = skill_ver.system_prompt if skill_ver else self.config.fallback_prompt
        version_id = skill_ver.id if skill_ver else "fallback"
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
        data_requests = missing_data_requests(answer, self.config.data_requirements)
        prompt = json.dumps(
            {
                "module": self.module,
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
                "similar_cases": similar_cases,
                "similar_cases_usage": (
                    "以上 similar_cases 是同行业/同场景的脱敏历史诊断先例，"
                    "仅供参考典型信号与常见缺数据，不是本企业的事实。"
                    "可借鉴判断方向，但 evidence 只能来自本企业 facts/上传数据，"
                    "禁止把先例结论当作本企业证据引用。"
                ) if similar_cases else "",
                "data_requirements": [
                    {
                        "key": req.key,
                        "label": req.label,
                        "reason": req.reason,
                        "source_hint": req.source_hint,
                        "required": req.required,
                    }
                    for req in self.config.data_requirements
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
        return (
            ModuleResult(
                module=self.module,
                signal=signal,
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
            ),
            version_id,
        )


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
