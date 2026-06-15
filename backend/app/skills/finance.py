from app.skills.configured import ConfiguredExpertSkill, DataRequirement, ExpertConfig
from app.skills.prompts import FINANCE_DIAGNOSIS


FINANCE_CONFIG = ExpertConfig(
    module="finance",
    method="finance-evidence",
    label="财务与资本",
    fallback_prompt=FINANCE_DIAGNOSIS,
    scenarios=("live_commerce", "ecommerce_retail", "b2b_solution", "saas_subscription", "manufacturing"),
    data_requirements=(
        DataRequirement(
            key="financial_statements",
            label="核心财务报表",
            reason="财务诊断必须看到收入、成本、毛利、费用、利润和现金流。",
            source_hint="上传利润表、现金流、费用明细、收入成本表或财务月报。",
            keywords=("收入", "成本", "毛利", "费用", "利润", "现金流", "财务报表"),
        ),
        DataRequirement(
            key="working_capital",
            label="回款、库存与资金周转",
            reason="增长或运营建议必须经过现金流和营运资金约束校验。",
            source_hint="上传应收应付、账期、回款、库存金额和资金计划。",
            keywords=("回款", "应收", "应付", "账期", "库存金额", "资金计划"),
            required=False,
        ),
        DataRequirement(
            key="unit_economics",
            label="单客/单单经济模型",
            reason="很多增长问题本质是单位经济模型不成立，必须拆到单客、单单、单渠道。",
            source_hint="上传客单毛利、履约成本、渠道扣点、退款损失或单客户生命周期价值。",
            keywords=("客单毛利", "履约成本", "渠道扣点", "退款损失", "LTV", "单位经济"),
            required=False,
        ),
    ),
)


class FinanceSkill(ConfiguredExpertSkill):
    def __init__(self):
        super().__init__(FINANCE_CONFIG)
