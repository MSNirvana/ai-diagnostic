from app.skills.configured import ConfiguredExpertSkill, DataRequirement, ExpertConfig


# 诊断判断由 diagnostic_method 脑子按 domain 数据现场生成；本域只提供数据骨架（零 prose）。
SALES_CONFIG = ExpertConfig(
    module="sales",
    method="funnel-evidence",
    label="销售与增长",
    fallback_prompt="",
    scenarios=("live_commerce", "ecommerce_retail", "b2b_solution", "saas_subscription", "local_service"),
    industry_kpis=("转化率", "赢单率", "获客成本", "销售周期", "客单价", "复购率"),
    judgment_hints=(
        "先判断卡在线索质量、销售响应、过程跟进、成交策略还是复购。",
        "直播/电商看投流到成交的衔接别只看 ROI；B2B 看 MQL/SQL/商机/赢单周期/丢单原因；SaaS 看试用激活/续费扩张而非只看新签。",
    ),
    data_requirements=(
        DataRequirement(
            key="sales_funnel",
            label="销售漏斗数据",
            reason="销售诊断必须看到线索、到店/咨询、报价、成交、客单价和各环节转化率。",
            source_hint="上传近30/90天线索漏斗、渠道漏斗或销售日报。",
            keywords=("线索", "漏斗", "转化率", "报价", "成交", "客单价", "到店", "咨询"),
        ),
        DataRequirement(
            key="crm_deal_data",
            label="CRM与成交明细",
            reason="需要把获客与成交打通，识别是渠道质量、跟进效率还是成交策略问题。",
            source_hint="连接 CRM，或上传客户跟进、成交、丢单原因和销售阶段明细。",
            keywords=("CRM", "跟进", "成交明细", "丢单", "销售阶段", "商机"),
        ),
        DataRequirement(
            key="rep_followup",
            label="销售跟进节奏",
            reason="只看结果看不出卡点，需要销售动作频率、跟进时效和响应时长。",
            source_hint="上传首次响应时间、跟进间隔、未跟进商机和关键丢单节点。",
            keywords=("响应时间", "跟进间隔", "跟进时效", "商机阶段", "首响"),
            required=False,
        ),
        DataRequirement(
            key="channel_performance",
            label="渠道投放与获客成本",
            reason="增长问题需要联动广告花费、渠道来源、CAC 和 ROI。",
            source_hint="连接广告账号或上传渠道花费与线索来源报表。",
            keywords=("渠道", "广告", "投放", "CAC", "ROI", "ROAS", "来源"),
            required=False,
        ),
    ),
)


class SalesSkill(ConfiguredExpertSkill):
    def __init__(self):
        super().__init__(SALES_CONFIG)
