import asyncio
from app.llm.base import LLMClient
from app.models.questionnaire import Questionnaire
from app.models.result import ModuleResult
from app.skills.registry import get_skill
from app.filters.moat import scrub_method_language


async def diagnose_all(q: Questionnaire, llm: LLMClient) -> list[ModuleResult]:
    """读问卷 -> 对每个有对应 skill 的模块并行诊断 -> 护城河过滤后汇总。"""
    tasks = []
    for answer in q.answers:
        skill = get_skill(answer.module)
        if skill is not None:
            tasks.append(skill.diagnose(answer, llm))

    raw_results = await asyncio.gather(*tasks)
    return [scrub_method_language(r) for r in raw_results]
