from app.skills.configured import ConfiguredExpertSkill, DataRequirement, ExpertConfig
from app.skills.prompts import OPS_DIAGNOSIS


OPS_CONFIG = ExpertConfig(
    module="ops",
    method="operations-evidence",
    label="运营与供应链",
    fallback_prompt=OPS_DIAGNOSIS,
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
    ),
)


class OpsSkill(ConfiguredExpertSkill):
    def __init__(self):
        super().__init__(OPS_CONFIG)
