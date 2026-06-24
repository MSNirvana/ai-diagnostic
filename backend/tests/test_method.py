"""诊断方法主 skill：合成逻辑（注入一次、幂等、领域在前、空领域退化）+ DB 可版本化。"""
from app.skills.method import (
    DIAGNOSTIC_METHOD,
    METHOD_MODULE_KEY,
    _METHOD_SENTINEL,
    compose_preview,
    compose_system_prompt,
)


def test_compose_injects_method_once():
    domain = "你是XX诊断专家。本领域判断纪律：1. 测试。"
    out = compose_preview(domain)
    assert domain in out                       # 领域切片保留
    assert _METHOD_SENTINEL in out             # 注入了通用方法
    assert out.count(_METHOD_SENTINEL) == 1    # 只注入一次
    assert out.startswith("你是XX诊断专家")     # 领域在前


def test_compose_is_idempotent():
    domain = "你是XX诊断专家。"
    once = compose_preview(domain)
    twice = compose_preview(once)              # 对已合成 prompt 再合成
    assert twice.count(_METHOD_SENTINEL) == 1  # 不二次叠加方法
    assert domain in twice                     # 领域切片仍在
    assert twice == once.strip()               # 幂等到内容（_compose 会 strip 收尾空白）


def test_compose_empty_domain_falls_back_to_method_only():
    # 空领域 → 只剩通用方法（可能附带运行时追加的来源纪律），不带领域前缀
    out = compose_preview("")
    assert out.startswith(DIAGNOSTIC_METHOD)
    assert _METHOD_SENTINEL in out
    assert compose_preview(None).startswith(DIAGNOSTIC_METHOD)


def test_diagnosis_domains_are_zero_prose_with_data():
    # 诊断域零 prose（判断由脑子现场生成），但必须携带 domain 数据：label/KPI/易误判提示
    from app.skills.registry import get_skill

    for key in ("market", "finance", "legal_compliance", "acquisition_efficiency"):
        cfg = get_skill(key).config
        assert cfg.fallback_prompt == ""   # 零 prose
        assert cfg.industry_kpis           # 有 KPI 锚点
        assert cfg.judgment_hints          # 有易误判提示


def test_method_is_a_registered_versionable_skill():
    # 脑子本身是注册的 skill 定义（能进 seed、进后台、可版本化），不是写死的常量
    from app.skills.skill_network import skill_definition

    d = skill_definition(METHOD_MODULE_KEY)
    assert d is not None
    assert d.fallback_prompt == DIAGNOSTIC_METHOD
    assert d.skill_type == "method"            # 不是 diagnosis，不会污染诊断路由


async def test_compose_system_prompt_without_session_uses_fallback():
    # 无 DB session（session=None）→ 用兜底常量，保证空库可用
    out = await compose_system_prompt("你是XX诊断专家。", session=None)
    assert _METHOD_SENTINEL in out
    assert out.count(_METHOD_SENTINEL) == 1
