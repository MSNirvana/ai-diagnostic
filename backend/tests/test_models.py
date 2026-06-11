import pytest
from pydantic import ValidationError
from app.models.questionnaire import ModuleAnswer, Questionnaire
from app.models.result import Evidence, ModuleResult


def test_questionnaire_holds_module_answers():
    q = Questionnaire(answers=[
        ModuleAnswer(module="market", facts={"revenue": "1000万"}, pains=["打不过竞品"])
    ])
    assert q.answers[0].module == "market"


def test_module_result_caps_evidence_at_three():
    with pytest.raises(ValidationError):
        ModuleResult(
            module="market", signal="red", conclusion="x",
            evidence=[Evidence(text=f"e{i}", source="s") for i in range(4)],
            actions=["a"],
        )
