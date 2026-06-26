"""数据需求由脑子按公司真实情况决定（没有的业务不列），静态死清单只兜底。"""
import json

from app.models.questionnaire import ModuleAnswer
from app.skills.configured import _brain_data_requests
from app.skills.market import MARKET_CONFIG, MarketSkill


def test_brain_data_needs_used_and_reuses_static_key():
    data = {"data_needs": [
        {"key": "promotion_account", "label": "投放账号", "reason": "r"},  # 复用静态 key
        {"label": "开发者注册→首次调用转化", "reason": "API 公司该看的"},      # 公司特有新增
    ]}
    reqs = _brain_data_requests(data, MARKET_CONFIG.data_requirements)
    keys = [r.key for r in reqs]
    assert "promotion_account" in keys                       # 复用 key（系统可跨轮追踪）
    assert any("注册" in r.label for r in reqs)               # 新增公司特有项
    promo = next(r for r in reqs if r.key == "promotion_account")
    assert promo.source_hint                                 # 复用 key 带上了静态取数指引


def test_brain_empty_data_needs_means_no_requests():
    # 脑子判定「没有真正缺的」→ 空，不该再套死清单
    assert _brain_data_requests({"data_needs": []}, MARKET_CONFIG.data_requirements) == []


def test_brain_absent_data_needs_falls_back_to_static():
    # 脑子没给 data_needs（老版本/解析失败）→ None → 调用方退回静态清单
    assert _brain_data_requests({}, MARKET_CONFIG.data_requirements) is None


async def test_diagnose_uses_brain_data_needs_over_static(db_session):
    # 脑子说「没投放，只缺开发者转化数据」→ 结果用脑子的，不是静态的「推广账号/投放表现」
    class BrainLLM:
        async def complete(self, system: str, prompt: str) -> str:
            return json.dumps({
                "signal": "red", "conclusion": "客群错配，渠道没建",
                "evidence": [], "actions": ["收窄客群"],
                "drilldown": {"data_points": [], "comparisons": []},
                "data_needs": [{"key": "dev_funnel", "label": "开发者注册→首次调用转化", "reason": "判断拉新质量"}],
            }, ensure_ascii=False)

    async with db_session() as session:
        result, _ = await MarketSkill().diagnose(
            ModuleAnswer(module="market", pains=["获客难"]), BrainLLM(), session=session
        )
    labels = [r.label for r in result.data_requests]
    assert labels == ["开发者注册→首次调用转化"]              # 脑子的，不是静态投放清单
    assert "推广账号与广告平台" not in labels
