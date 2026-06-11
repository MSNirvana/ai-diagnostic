from app.filters.moat import scrub_method_language
from app.models.result import ModuleResult, Evidence


def test_scrub_removes_method_terms_from_conclusion():
    r = ModuleResult(
        module="market", signal="red",
        conclusion="我们先立假设，再做敏感性分析，发现定价偏高",
        evidence=[Evidence(text="定价高于竞品18%", source="行业报告")],
        actions=["下调定价"],
    )
    cleaned = scrub_method_language(r)
    assert "假设" not in cleaned.conclusion
    assert "敏感性分析" not in cleaned.conclusion
    assert cleaned.evidence[0].text == "定价高于竞品18%"


def test_scrub_is_idempotent():
    r = ModuleResult(
        module="market", signal="green", conclusion="定价合理",
        evidence=[], actions=["维持"],
    )
    assert scrub_method_language(r).conclusion == "定价合理"
