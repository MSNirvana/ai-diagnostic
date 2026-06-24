from app.skills.configured import ConfiguredExpertSkill, DataRequirement, ExpertConfig


# 诊断判断由 diagnostic_method 脑子按 domain 数据现场生成；本域只提供数据骨架（零 prose）。
PRODUCT_CONFIG = ExpertConfig(
    module="product",
    method="product-evidence",
    label="产品与服务",
    fallback_prompt="",
    scenarios=("saas_subscription", "ecommerce_retail", "manufacturing", "b2b_solution", "local_service"),
    industry_kpis=("留存率", "复购率", "客诉率", "交付准时率", "NPS/满意度", "续约率"),
    judgment_hints=(
        "先分清问题在价值主张、产品体验、服务兑现还是交付质量。",
        "SaaS 看激活/留存/续费/功能使用；服务/项目制看交付延期/返工/验收/客诉；硬件看缺陷率/售后返修。",
    ),
    data_requirements=(
        DataRequirement(
            key="usage_retention",
            label="产品使用与留存数据",
            reason="产品判断需要看到活跃、留存、复购、流失或服务续约信号。",
            source_hint="上传用户行为、订单复购、服务续约或 NPS/满意度数据。",
            keywords=("留存", "复购", "活跃", "NPS", "满意度", "流失", "续约"),
        ),
        DataRequirement(
            key="product_feedback",
            label="客户反馈与需求池",
            reason="需要区分产品价值不足、体验问题和交付承诺偏差。",
            source_hint="上传客户访谈、工单、评价、需求池或售后问题分类。",
            keywords=("工单", "评价", "访谈", "需求", "售后", "投诉", "反馈"),
            required=False,
        ),
        DataRequirement(
            key="delivery_quality",
            label="交付质量与服务兑现",
            reason="很多产品问题不是功能本身，而是承诺落地、服务质量和交付节奏失控。",
            source_hint="上传交付里程碑、延期率、返工率、客户验收或客诉明细。",
            keywords=("交付", "延期", "返工", "验收", "客诉", "服务质量"),
            required=False,
        ),
    ),
)


class ProductSkill(ConfiguredExpertSkill):
    def __init__(self):
        super().__init__(PRODUCT_CONFIG)
