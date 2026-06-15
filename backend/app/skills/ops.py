from app.skills.configured import ConfiguredExpertSkill, DataRequirement, ExpertConfig
from app.skills.prompts import OPS_DIAGNOSIS


OPS_CONFIG = ExpertConfig(
    module="ops",
    method="operations-evidence",
    label="运营与供应链",
    fallback_prompt=OPS_DIAGNOSIS,
    scenarios=("manufacturing", "local_service", "ecommerce_retail", "b2b_solution"),
    data_requirements=(
        DataRequirement(
            key="process_metrics",
            label="核心流程效率数据",
            reason="运营诊断需要看到周期、吞吐、返工、准时率或产能利用。",
            source_hint="上传生产/交付/履约流程表、SLA、产能和异常记录。",
            keywords=("周期", "吞吐", "返工", "准时率", "产能", "SLA", "履约", "交付"),
        ),
        DataRequirement(
            key="inventory_supply",
            label="库存与供应链数据",
            reason="库存、缺货和供应稳定性决定运营问题的真实约束。",
            source_hint="上传库存周转、缺货率、采购周期、供应商表现或仓储数据。",
            keywords=("库存", "周转", "缺货", "采购", "供应商", "仓储"),
            required=False,
        ),
        DataRequirement(
            key="exception_rework",
            label="异常返工与缺陷记录",
            reason="没有异常记录就无法判断流程是结构性低效还是偶发波动。",
            source_hint="上传返工、退货、缺陷、超时、异常工单或售后返修明细。",
            keywords=("异常", "返工", "缺陷", "超时", "返修", "退货"),
            required=False,
        ),
    ),
)


class OpsSkill(ConfiguredExpertSkill):
    def __init__(self):
        super().__init__(OPS_CONFIG)
