import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.data.external import fetch_industry_benchmark
from app.llm.base import LLMClient
from app.models.questionnaire import ModuleAnswer
from app.models.result import ModuleResult
from app.skills.base import Skill
from app.skills.evidence import build_evidence_package
from app.skills.parsing import parse_json_object, to_actions, to_drilldown, to_evidence
from app.skills.store import get_active_skill_version


MODULE_LABELS = {
    "product": "产品与服务",
    "sales": "销售与增长",
    "ops": "运营与供应链",
    "org": "组织与人才",
    "finance": "财务与资本",
}

MODULE_METHODS = {
    "product": "framework",
    "sales": "funnel",
    "ops": "process",
    "org": "organization",
    "finance": "metrics",
}


def fallback_prompt(module: str) -> str:
    label = MODULE_LABELS.get(module, module)
    return f"""你是顶级管理咨询的{label}诊断专家。
基于给定的企业现状、痛点和行业基准，做结论先行的管理诊断。
严格输出 JSON：{{signal, conclusion, evidence[], actions[], drilldown{{data_points[], comparisons[]}}}}。
- signal: red/yellow/green
- conclusion: 一句话讲清最关键判断，用结果语言，不暴露内部方法
- evidence: 最多3条，每条 {{text, source}}
- actions: 2-3条按优先级
- drilldown: 只放事实数据和对比，不写方法/假设/框架"""


class GenericModuleSkill(Skill):
    """薄层专家 skill：让非 market 模块先能参与会诊。

    后续每个模块可以替换为独立深度 skill；注册表和输出契约不需要变化。
    """

    def __init__(self, module: str):
        self.module = module
        self.method = MODULE_METHODS.get(module, "diagnosis")

    async def diagnose(
        self,
        answer: ModuleAnswer,
        llm: LLMClient,
        session: AsyncSession | None = None,
    ) -> tuple[ModuleResult, str]:
        skill_ver = await get_active_skill_version(session, self.module)
        system_prompt = skill_ver.system_prompt if skill_ver else fallback_prompt(self.module)
        version_id = skill_ver.id if skill_ver else "fallback"

        benchmark = await fetch_industry_benchmark(self.module, answer.pains)
        prompt = json.dumps(
            {
                "module": self.module,
                "facts": answer.facts,
                "pains": answer.pains,
                "benchmark": benchmark,
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
                ),
            ),
            version_id,
        )
