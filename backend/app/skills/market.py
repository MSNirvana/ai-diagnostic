from app.skills.configured import ConfiguredExpertSkill, DataRequirement, ExpertConfig


# 诊断判断由 diagnostic_method 脑子按 domain 数据现场生成；本域只提供数据骨架（零 prose）。
MARKET_CONFIG = ExpertConfig(
    module="market",
    method="market-evidence",
    label="市场与客户",
    fallback_prompt="",
    scenarios=("live_commerce", "ecommerce_retail", "b2b_solution", "local_service"),
    industry_kpis=("获客成本", "渠道结构占比", "自然/付费流量占比", "客群匹配度", "市场份额", "竞品价格带"),
    judgment_hints=(
        "先判断更像渠道结构、投放效率、客群定位，还是市场环境变化，别一上来归因单点。",
        "直播/电商看账号矩阵+自然/付费流量+投产退货；B2B 看线索质量+决策链+赢单周期；本地/连锁看区域差异+到店链路。",
    ),
    data_requirements=(
        DataRequirement(
            key="promotion_account",
            label="推广账号与广告平台",
            reason="没有账号或平台范围，无法核验真实获客渠道与预算结构。",
            source_hint="连接巨量/腾讯/百度/小红书/Meta/Google 等广告账号，或上传账号导出的投放报表。",
            keywords=("推广账号", "广告账号", "广告平台", "巨量", "腾讯广告", "百度", "小红书", "Meta", "Google"),
        ),
        DataRequirement(
            key="campaign_performance",
            label="近30/90天投放表现",
            reason="市场诊断必须看到花费、曝光、点击、CTR、CPC、转化、CAC、ROAS 等趋势。",
            source_hint="上传 campaign/adgroup/creative 维度投放报表。",
            keywords=("花费", "曝光", "点击", "CTR", "CPC", "转化", "CAC", "ROAS", "campaign", "计划"),
        ),
        DataRequirement(
            key="account_structure",
            label="账号矩阵与渠道结构",
            reason="仅看总花费看不出问题，需要知道主投平台、账号矩阵、自然流量与付费流量占比。",
            source_hint="补充账号矩阵、渠道占比、自然/付费流量结构、达人/自播占比。",
            keywords=("账号矩阵", "自然流量", "付费流量", "平台占比", "达人", "自播", "渠道结构"),
        ),
        DataRequirement(
            key="competitor_or_benchmark",
            label="竞品/行业基准",
            reason="需要外部基准判断市场表现是公司个体问题还是行业共同变化。",
            source_hint="提供主要竞品、目标客群、价格带，或允许系统抓取公开行业基准。",
            keywords=("竞品", "行业基准", "价格带", "目标客群", "市场份额"),
            required=False,
        ),
    ),
)


class MarketSkill(ConfiguredExpertSkill):
    def __init__(self):
        super().__init__(MARKET_CONFIG)
