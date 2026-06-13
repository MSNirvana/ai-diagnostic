from app.skills.prompts import MARKET_DIAGNOSIS
from app.skills.configured import ConfiguredExpertSkill, DataRequirement, ExpertConfig

# DB 无激活版本时的兜底 prompt（保证系统在空库下仍能诊断）
_SYSTEM_FALLBACK = MARKET_DIAGNOSIS


MARKET_CONFIG = ExpertConfig(
    module="market",
    method="market-evidence",
    label="市场与客户",
    fallback_prompt=_SYSTEM_FALLBACK,
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
