from app.skills.configured import ConfiguredExpertSkill, DataRequirement, ExpertConfig


# 诊断判断由 diagnostic_method 脑子按 domain 数据现场生成；本域只提供数据骨架（零 prose）。
ORG_CONFIG = ExpertConfig(
    module="org",
    method="organization-evidence",
    label="组织与人才",
    fallback_prompt="",
    scenarios=("saas_subscription", "b2b_solution", "local_service", "manufacturing", "general_business"),
    industry_kpis=("人均产值", "管理跨度", "关键岗位空缺", "离职率", "目标达成率", "中层断层"),
    judgment_hints=(
        "先分清是组织设计、岗位职责、管理机制还是激励失效。",
        "初创/老板驱动看是否过度依赖老板+关键岗位空缺+职责重叠；扩张期看中层断层+跨部门协作+管理跨度；连锁/制造看区域管理+执行一致性。",
    ),
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
        DataRequirement(
            key="role_accountability",
            label="岗位职责与协作分工",
            reason="很多组织问题来自职责重叠或无人负责，不是单纯人不够。",
            source_hint="上传职责边界、汇报链、跨部门协作流程或 RACI。",
            keywords=("职责", "边界", "协作", "RACI", "跨部门", "无人负责"),
            required=False,
        ),
    ),
)


class OrgSkill(ConfiguredExpertSkill):
    def __init__(self):
        super().__init__(ORG_CONFIG)
