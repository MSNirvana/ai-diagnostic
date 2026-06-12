import asyncio
from dataclasses import dataclass
from sqlalchemy.ext.asyncio import AsyncSession
from app.llm.base import LLMClient
from app.models.questionnaire import Questionnaire
from app.models.result import ModuleResult
from app.skills.registry import get_skill
from app.filters.moat import scrub_method_language


@dataclass
class DiagnoseOutcome:
    results: list[ModuleResult]
    skill_version_ids: dict[str, str]   # {module: skill_version_id}


async def diagnose_all(
    q: Questionnaire,
    llm: LLMClient,
    session: AsyncSession | None = None,
) -> DiagnoseOutcome:
    """读问卷 -> 对每个有对应 skill 的模块并行诊断 -> 护城河过滤后汇总。

    同时收集每个模块用了哪个 skill 版本（供反馈关联）。
    """
    modules: list[str] = []
    tasks = []
    for answer in q.answers:
        skill = get_skill(answer.module)
        if skill is not None:
            modules.append(answer.module)
            tasks.append(skill.diagnose(answer, llm, session))

    pairs = await asyncio.gather(*tasks)  # list[(ModuleResult, version_id)]

    results: list[ModuleResult] = []
    version_ids: dict[str, str] = {}
    for module, (result, version_id) in zip(modules, pairs):
        results.append(scrub_method_language(result))
        version_ids[module] = version_id
    return DiagnoseOutcome(results=results, skill_version_ids=version_ids)
