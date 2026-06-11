import pytest
from app.skills.base import Skill
from app.models.questionnaire import ModuleAnswer
from app.models.result import ModuleResult


def test_skill_is_abstract():
    with pytest.raises(TypeError):
        Skill()


async def test_concrete_skill_returns_module_result():
    class FakeSkill(Skill):
        module = "market"
        method = "hypothesis"

        async def diagnose(self, answer, llm) -> ModuleResult:
            return ModuleResult(
                module="market", signal="green", conclusion="ok",
                evidence=[], actions=["维持现状"],
            )

    result = await FakeSkill().diagnose(
        ModuleAnswer(module="market"), llm=None
    )
    assert result.module == "market"
    assert FakeSkill().method == "hypothesis"
