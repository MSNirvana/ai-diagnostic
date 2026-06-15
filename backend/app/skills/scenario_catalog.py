from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BusinessScenario:
    key: str
    label: str
    keywords: tuple[str, ...]
    benchmark_keywords: tuple[str, ...]
    evidence_lens: tuple[str, ...]


SCENARIOS: tuple[BusinessScenario, ...] = (
    BusinessScenario(
        key="live_commerce",
        label="直播电商",
        keywords=("直播", "达人带货", "抖音", "快手", "小店", "GMV", "坑位费", "主播"),
        benchmark_keywords=("GMV", "投流ROI", "直播间转化率", "退货率", "自然流量占比"),
        evidence_lens=("账号矩阵", "直播间流量结构", "单场盈利模型", "退货与复购"),
    ),
    BusinessScenario(
        key="ecommerce_retail",
        label="电商零售",
        keywords=("电商", "天猫", "京东", "拼多多", "店铺", "SKU", "零售", "货盘"),
        benchmark_keywords=("转化率", "客单价", "复购率", "退货率", "投产比"),
        evidence_lens=("店铺流量", "货盘结构", "活动依赖", "退款售后"),
    ),
    BusinessScenario(
        key="b2b_solution",
        label="B2B 解决方案",
        keywords=("B2B", "招投标", "大客户", "线索", "商机", "项目制", "KA", "经销商"),
        benchmark_keywords=("MQL", "SQL", "赢单率", "销售周期", "大客户集中度"),
        evidence_lens=("线索质量", "商机阶段", "决策链条", "回款与交付联动"),
    ),
    BusinessScenario(
        key="saas_subscription",
        label="SaaS 订阅",
        keywords=("SaaS", "订阅", "续费", "ARR", "MRR", "活跃用户", "流失", "试用"),
        benchmark_keywords=("ARR", "激活率", "续费率", "NRR", "CAC 回收期"),
        evidence_lens=("激活留存", "功能使用", "续费扩张", "客户成功"),
    ),
    BusinessScenario(
        key="local_service",
        label="本地服务/连锁",
        keywords=("到店", "门店", "本地服务", "团购", "核销", "门店经营", "加盟", "连锁"),
        benchmark_keywords=("到店率", "核销率", "门店坪效", "复购率", "客诉率"),
        evidence_lens=("门店流量", "到店转化", "门店执行", "区域差异"),
    ),
    BusinessScenario(
        key="manufacturing",
        label="制造/供应链",
        keywords=("工厂", "制造", "产线", "产能", "库存", "供应链", "交付", "能耗"),
        benchmark_keywords=("产能利用率", "单位成本", "交付准时率", "库存周转", "良率"),
        evidence_lens=("产能与排产", "采购与库存", "交付瓶颈", "返工损耗"),
    ),
)

GENERAL_SCENARIO = BusinessScenario(
    key="general_business",
    label="综合经营",
    keywords=(),
    benchmark_keywords=("收入增长", "毛利率", "转化率", "现金流", "人效"),
    evidence_lens=("增长", "效率", "利润", "组织协同"),
)


def detect_business_scenario(
    *,
    industry: str = "",
    main_business: str = "",
    business_model: str = "",
    extra_text: str = "",
) -> BusinessScenario:
    haystack = " ".join(
        part for part in (industry, main_business, business_model, extra_text) if part
    ).lower()
    best = GENERAL_SCENARIO
    best_score = 0
    for scenario in SCENARIOS:
        score = sum(1 for keyword in scenario.keywords if keyword.lower() in haystack)
        if score > best_score:
            best = scenario
            best_score = score
    return best


def render_problem_text(problem_map: dict | None) -> str:
    if not problem_map:
        return ""
    parts: list[str] = []
    for key in (
        "company_name",
        "industry",
        "main_business",
        "business_model",
        "scale",
        "stage",
        "core_problem",
        "goal",
        "constraints",
        "success_criteria",
        "impact",
        "context",
        "suspected_cause",
        "tried",
        "data_readiness",
    ):
        value = problem_map.get(key)
        if value:
            parts.append(str(value))
    for item in problem_map.get("sub_problems") or []:
        if item:
            parts.append(str(item))
    return " ".join(parts)

