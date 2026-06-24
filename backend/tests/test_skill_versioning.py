"""Skill 版本化：DB 有激活版本时诊断用 DB 的 prompt，无则回退 fallback。

注：通用诊断方法（method.DIAGNOSTIC_METHOD）在运行时注入到领域 prompt 之后，
因此最终 system = 领域切片(DB 或 fallback) + 通用方法，断言用"包含"而非"相等"。
"""
import json

from app.skills.market import MarketSkill
from app.skills.method import _METHOD_SENTINEL
from app.models.questionnaire import ModuleAnswer
from app.db.models import SkillVersion


class SpyLLM:
    """记录收到的 system / user prompt，用于断言用了哪份。"""
    seen_system = ""
    seen_prompt = ""

    async def complete(self, system: str, prompt: str) -> str:
        SpyLLM.seen_system = system
        SpyLLM.seen_prompt = prompt
        return json.dumps({
            "signal": "green",
            "conclusion": "ok",
            "evidence": [{"text": "x", "source": "y"}],
            "actions": ["a"],
            "drilldown": {"data_points": [], "comparisons": []},
        })


async def test_skill_uses_db_version_when_active(db_session):
    # 往内存库塞一个激活的 market 版本
    async with db_session() as session:
        ver = SkillVersion(
            module="market", version=1, system_prompt="DB专属市场prompt",
            method="hypothesis", is_active=True,
        )
        session.add(ver)
        await session.commit()
        ver_id = ver.id

    async with db_session() as session:
        skill = MarketSkill()
        result, version_id = await skill.diagnose(
            ModuleAnswer(module="market", pains=["x"]), llm=SpyLLM(), session=session
        )
    assert "DB专属市场prompt" in SpyLLM.seen_system    # 用了 DB 的领域 prompt
    assert _METHOD_SENTINEL in SpyLLM.seen_system       # 且注入了通用诊断方法
    assert version_id == ver_id                        # 返回 DB 版本 id
    assert result.module == "market"


async def test_skill_falls_back_without_active_version(db_session):
    # 空库（无激活版本）→ 回退代码 fallback
    async with db_session() as session:
        skill = MarketSkill()
        _, version_id = await skill.diagnose(
            ModuleAnswer(module="market", pains=["x"]), llm=SpyLLM(), session=session
        )
    assert version_id == "fallback"
    # 诊断域零 prose：兜底 system 就是纯脑子；领域身份改从 user prompt 的 domain 块进。
    assert _METHOD_SENTINEL in SpyLLM.seen_system
    assert "市场与客户" in SpyLLM.seen_prompt
