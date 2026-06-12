import json
from sqlalchemy.ext.asyncio import AsyncSession
from app.skills.base import Skill
from app.skills.parsing import parse_json_object, to_evidence, to_drilldown
from app.skills.store import get_active_skill_version
from app.llm.base import LLMClient
from app.models.questionnaire import ModuleAnswer
from app.models.result import ModuleResult
from app.data.external import fetch_industry_benchmark

# DB 无激活版本时的兜底 prompt（保证系统在空库下仍能诊断）
_SYSTEM_FALLBACK = """你是顶级管理咨询的市场与客户诊断专家。
基于给定的企业现状和行业基准，做内外对比诊断。
内部工作方法：先立假设，再用数据证实/证伪（不要在输出里暴露这套方法）。
严格输出 JSON：{signal, conclusion, evidence[], actions[], drilldown{data_points[], comparisons[]}}。
- signal: red/yellow/green
- conclusion: 结论先行，一句话讲清核心问题
- evidence: 最多3条，每条 {text, source}，用结果语言陈述事实
- actions: 2-3条按优先级
- drilldown: 只放事实数据和对比，不写方法/假设/框架"""


class MarketSkill(Skill):
    module = "market"
    method = "hypothesis"

    async def diagnose(
        self,
        answer: ModuleAnswer,
        llm: LLMClient,
        session: AsyncSession | None = None,
    ) -> tuple[ModuleResult, str]:
        # 优先用 DB 里的激活版本，无则回退代码兜底
        skill_ver = await get_active_skill_version(session, self.module)
        system_prompt = skill_ver.system_prompt if skill_ver else _SYSTEM_FALLBACK
        version_id = skill_ver.id if skill_ver else "fallback"

        benchmark = await fetch_industry_benchmark("market", answer.pains)
        prompt = json.dumps({
            "facts": answer.facts,
            "pains": answer.pains,
            "benchmark": benchmark,
        }, ensure_ascii=False)
        raw = await llm.complete(system=system_prompt, prompt=prompt)
        data = parse_json_object(raw)
        signal = data.get("signal", "yellow")
        if signal not in ("red", "yellow", "green"):
            signal = "yellow"
        result = ModuleResult(
            module=self.module,
            signal=signal,
            conclusion=data.get("conclusion", "（模型未给出结论）"),
            evidence=[to_evidence(e) for e in (data.get("evidence") or [])[:3]],
            actions=data.get("actions") or ["（模型未给出建议）"],
            drilldown=to_drilldown(data.get("drilldown")),
        )
        return result, version_id
