from app.skills.configured import ConfiguredExpertSkill, DataRequirement, ExpertConfig
from app.skills.prompts import FINANCE_DIAGNOSIS


FINANCE_CONFIG = ExpertConfig(
    module="finance",
    method="finance-evidence",
    label="财务与资本",
    fallback_prompt=FINANCE_DIAGNOSIS,
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
    ),
)


class FinanceSkill(ConfiguredExpertSkill):
    def __init__(self):
        super().__init__(FINANCE_CONFIG)
