import json
from app.skills.base import Skill
from app.llm.base import LLMClient
from app.models.questionnaire import ModuleAnswer
from app.models.result import ModuleResult, Evidence, DrillDown
from app.data.external import fetch_industry_benchmark

_SYSTEM = """你是顶级管理咨询的市场与客户诊断专家。
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

    async def diagnose(self, answer: ModuleAnswer, llm: LLMClient) -> ModuleResult:
        benchmark = await fetch_industry_benchmark("market", answer.pains)
        prompt = json.dumps({
            "facts": answer.facts,
            "pains": answer.pains,
            "benchmark": benchmark,
        }, ensure_ascii=False)
        raw = await llm.complete(system=_SYSTEM, prompt=prompt)
        data = json.loads(raw)
        return ModuleResult(
            module=self.module,
            signal=data["signal"],
            conclusion=data["conclusion"],
            evidence=[Evidence(**e) for e in data["evidence"][:3]],
            actions=data["actions"],
            drilldown=DrillDown(
                data_points=[Evidence(**e) for e in data["drilldown"]["data_points"]],
                comparisons=data["drilldown"]["comparisons"],
            ),
        )
