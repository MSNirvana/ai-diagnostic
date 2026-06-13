from app.skills.configured import ConfiguredExpertSkill, DataRequirement, ExpertConfig
from app.skills.prompts import ORG_DIAGNOSIS


ORG_CONFIG = ExpertConfig(
    module="org",
    method="organization-evidence",
    label="组织与人才",
    fallback_prompt=ORG_DIAGNOSIS,
    data_requirements=(
        DataRequirement(
            key="org_structure",
            label="组织结构与岗位编制",
            reason="组织诊断需要看到角色分工、管理跨度、人效和关键岗位空缺。",
            source_hint="上传组织架构、岗位清单、人数、汇报关系和关键职责。",
            keywords=("组织架构", "岗位", "人数", "汇报", "职责", "编制", "人效"),
        ),
        DataRequirement(
            key="performance_incentive",
            label="绩效与激励数据",
            reason="需要判断问题来自能力、目标、激励还是协作机制。",
            source_hint="上传绩效指标、奖金方案、目标达成率、离职和招聘数据。",
            keywords=("绩效", "激励", "奖金", "目标达成", "离职", "招聘"),
            required=False,
        ),
    ),
)


class OrgSkill(ConfiguredExpertSkill):
    def __init__(self):
        super().__init__(ORG_CONFIG)
