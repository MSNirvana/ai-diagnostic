import json
from sqlalchemy.ext.asyncio import AsyncSession
from app.skills.base import Skill
from app.skills.parsing import parse_json_object, to_evidence, to_drilldown, to_actions
from app.skills.store import get_active_skill_version
from app.skills.prompts import MARKET_DIAGNOSIS
from app.llm.base import LLMClient
from app.models.questionnaire import ModuleAnswer
from app.models.result import ModuleResult
from app.data.external import fetch_industry_benchmark

# DB 无激活版本时的兜底 prompt（保证系统在空库下仍能诊断）
_SYSTEM_FALLBACK = MARKET_DIAGNOSIS


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
            actions=to_actions(data.get("actions")),
            drilldown=to_drilldown(data.get("drilldown")),
        )
        return result, version_id
