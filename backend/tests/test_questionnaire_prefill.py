"""二次诊断预填测试：历史已知 facts 应预填进新问卷，首次诊断行为不变。"""
from app.memory.known_facts import match_known_value
from app.models.profile import GeneratedField, GeneratedModule, GeneratedQuestionnaire
from app.api.questionnaire import _prefill_known


def _q():
    return GeneratedQuestionnaire(modules=[
        GeneratedModule(
            key="market", label="市场与客户", subtitle="", free_text_label="补充",
            fields=[
                GeneratedField(key="cover_market_1", label="主要竞品", placeholder="x"),
                GeneratedField(key="cover_market_2", label="平均客单价", placeholder="y"),
                GeneratedField(key="cover_market_3", label="全新字段", placeholder="z"),
            ],
        )
    ])


def test_match_exact_label():
    known = {"主要竞品": "packyapi", "客单价": "420"}
    assert match_known_value("主要竞品", "cover_market_1", known) == "packyapi"


def test_match_contains():
    # 已知"客单价"，字段叫"平均客单价" → 包含匹配命中
    known = {"客单价": "420"}
    assert match_known_value("平均客单价", "k", known) == "420"


def test_match_miss_returns_none():
    known = {"主要竞品": "packyapi"}
    assert match_known_value("全新字段", "k", known) is None


def test_prefill_fills_known_marks_source():
    known = {"主要竞品": "packyapi", "客单价": "420"}
    q = _prefill_known(_q(), known)
    f = q.modules[0].fields
    assert f[0].prefilled_value == "packyapi" and f[0].known_source == "上次诊断已填"
    assert f[1].prefilled_value == "420"          # 平均客单价 ← 客单价 包含匹配
    assert f[2].prefilled_value is None           # 全新字段不预填


def test_empty_known_is_noop():
    """首次诊断（无历史）：问卷原样返回，所有字段无预填。"""
    q = _prefill_known(_q(), {})
    assert all(f.prefilled_value is None for f in q.modules[0].fields)
