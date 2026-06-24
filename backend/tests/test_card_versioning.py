"""诊断卡内容版本化：DB 激活版本若是「卡片数据」JSON，运行时覆盖文件默认（可改/留痕/回滚）。"""
import json

from app.db.models import SkillVersion
from app.models.questionnaire import ModuleAnswer
from app.skills.configured import card_from_version, card_requirements, serialize_card
from app.skills.market import MARKET_CONFIG, MarketSkill


class SpyLLM:
    seen_prompt = ""

    async def complete(self, system: str, prompt: str) -> str:
        SpyLLM.seen_prompt = prompt
        return json.dumps({
            "signal": "yellow", "conclusion": "x",
            "evidence": [], "actions": ["a"],
            "drilldown": {"data_points": [], "comparisons": []},
        }, ensure_ascii=False)


def test_card_from_version_parses_card_rejects_prose():
    card = json.dumps({"industry_kpis": ["A", "B"], "judgment_hints": ["h"], "data_requirements": []})
    assert card_from_version(card)["industry_kpis"] == ["A", "B"]
    assert card_from_version("你是市场诊断专家。") is None   # prose → 不当卡片
    assert card_from_version("") is None
    assert card_from_version("{坏 json") is None


def test_serialize_card_roundtrip():
    data = serialize_card(MARKET_CONFIG)
    assert set(data) >= {"industry_kpis", "judgment_hints", "data_requirements"}
    parsed = card_from_version(json.dumps(data, ensure_ascii=False))
    assert parsed["industry_kpis"] == list(MARKET_CONFIG.industry_kpis)
    reqs = card_requirements(parsed)
    assert len(reqs) == len(MARKET_CONFIG.data_requirements)
    assert reqs[0].keywords == MARKET_CONFIG.data_requirements[0].keywords  # keywords 不丢，取数匹配不坏


async def test_active_card_version_overrides_file_default(db_session):
    custom = {
        "industry_kpis": ["自定义指标X", "自定义指标Y"],
        "judgment_hints": ["后台新加的避坑提示"],
        "data_requirements": [],
    }
    async with db_session() as session:
        session.add(SkillVersion(
            module="market", version=1, skill_type="diagnosis",
            system_prompt=json.dumps(custom, ensure_ascii=False),
            method="market-evidence", is_active=True,
        ))
        await session.commit()

    async with db_session() as session:
        await MarketSkill().diagnose(
            ModuleAnswer(module="market", pains=["x"]), SpyLLM(), session=session
        )

    domain = json.loads(SpyLLM.seen_prompt)["domain"]
    assert domain["industry_kpis"] == ["自定义指标X", "自定义指标Y"]   # 用了后台卡片版本
    assert "后台新加的避坑提示" in domain["judgment_hints"]
    assert "获客成本" not in domain["industry_kpis"]                  # 不再是文件默认
