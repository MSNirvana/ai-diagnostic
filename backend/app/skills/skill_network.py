from dataclasses import dataclass

from app.skills.configured import DataRequirement, ExpertConfig
from app.skills.method import DIAGNOSTIC_METHOD, METHOD_MODULE_KEY
from app.skills.prompts import (
    ARCHIVE_EXTRACTION,
    ARCHIVE_REFINEMENT,
    CONVERSATION_INTAKE,
    DIAGNOSIS_SCOUT,
    EVIDENCE_CONFIDENCE,
    FREE_CHAT,
    INTAKE_COMPLETENESS,
    QUESTIONNAIRE_BASE,
    QUESTIONNAIRE_QUALITY_GATE,
    RESEARCH_PLANNER,
)


@dataclass(frozen=True)
class SkillDefinition:
    """Skill 网络的稳定契约。

    诊断、问卷生成和后台方法库都从这里读取元数据，避免再次散落成固定六模块。
    """

    key: str
    label: str
    category: str
    category_label: str
    skill_type: str
    method: str
    description: str
    trigger_keywords: tuple[str, ...] = ()
    data_requirements: tuple[DataRequirement, ...] = ()
    fallback_prompt: str = ""
    upgrade_policy: str = "基于用户反馈、证据缺口和复盘偏差生成新版本，人工审核后激活。"
    evaluation_metrics: tuple[str, ...] = (
        "用户评分",
        "证据完整度",
        "复盘命中率",
    )
    enabled: bool = True
    default_core: bool = False


CORE_DEFINITIONS: tuple[SkillDefinition, ...] = (
    SkillDefinition(
        key="market",
        label="市场与客户",
        category="core",
        category_label="核心经营",
        skill_type="diagnosis",
        method="market-evidence",
        description="核验推广账号、投放表现、客户结构、竞品与行业基准。",
        trigger_keywords=("市场", "客户", "竞品", "竞争", "定位", "客群", "推广账号", "广告账号", "投放", "流量"),
        fallback_prompt="",
        default_core=True,
    ),
    SkillDefinition(
        key="product",
        label="产品与服务",
        category="core",
        category_label="核心经营",
        skill_type="diagnosis",
        method="product-evidence",
        description="判断价值主张、产品体验、交付质量、留存复购与客户反馈。",
        trigger_keywords=("产品", "服务", "功能", "体验", "留存", "复购", "交付物", "定价", "售后", "工单"),
        fallback_prompt="",
        default_core=True,
    ),
    SkillDefinition(
        key="sales",
        label="销售与增长",
        category="core",
        category_label="核心经营",
        skill_type="diagnosis",
        method="funnel-evidence",
        description="诊断线索质量、销售漏斗、CRM 跟进、成交与丢单原因。",
        trigger_keywords=("销售", "增长", "获客", "转化", "成交", "线索", "复购", "渠道", "CRM", "丢单"),
        fallback_prompt="",
        default_core=True,
    ),
    SkillDefinition(
        key="ops",
        label="运营与供应链",
        category="core",
        category_label="核心经营",
        skill_type="diagnosis",
        method="operations-evidence",
        description="分析流程效率、交付周期、产能、库存、供应稳定与返工。",
        trigger_keywords=("运营", "供应链", "交付", "库存", "产能", "生产", "流程效率", "履约", "返工"),
        fallback_prompt="",
        default_core=True,
    ),
    SkillDefinition(
        key="org",
        label="组织与人才",
        category="core",
        category_label="核心经营",
        skill_type="diagnosis",
        method="organization-evidence",
        description="识别组织结构、职责、人效、激励和关键人才缺口。",
        trigger_keywords=("组织", "人才", "团队", "绩效", "激励", "招聘", "人效", "职责", "中层", "岗位"),
        fallback_prompt="",
        default_core=True,
    ),
    SkillDefinition(
        key="finance",
        label="财务与资本",
        category="core",
        category_label="核心经营",
        skill_type="diagnosis",
        method="finance-evidence",
        description="判断收入质量、毛利、费用、现金流和增长动作的财务约束。",
        trigger_keywords=("财务", "现金流", "利润", "毛利", "亏损", "资金", "回款", "成本", "预算", "融资"),
        fallback_prompt="",
        default_core=True,
    ),
)


SPECIALIST_CONFIGS: dict[str, ExpertConfig] = {
    "legal_compliance": ExpertConfig(
        module="legal_compliance",
        method="compliance-evidence",
        label="法务合规",
        fallback_prompt="",
        industry_kpis=("资质完备性", "合同风险敞口", "宣传/广告合规", "平台规则符合度", "用工合规"),
        judgment_hints=(
            "先判断问题是否涉及资质许可、广告宣传、合同责任、平台规则或劳动用工风险。",
            "涉及医疗、教育、餐饮、新能源、金融、加盟等行业时，必须优先核验资质和监管边界。",
            "涉及投放、招商、加盟、承诺收益时，必须核验宣传口径与合同条款是否一致。",
            "只给经营决策风险提示，不替代律师法律意见。",
        ),
        data_requirements=(
            DataRequirement(
                key="licenses_permits",
                label="经营资质与许可文件",
                reason="缺少资质许可，无法判断当前业务推广和交付是否存在合规红线。",
                source_hint="上传营业执照、行业许可证、产品认证、平台资质或备案材料。",
                keywords=("许可证", "资质", "备案", "认证", "营业执照", "许可", "准入"),
            ),
            DataRequirement(
                key="contract_terms",
                label="合同与承诺条款",
                reason="合同责任、赔付边界和宣传承诺决定经营动作的风险敞口。",
                source_hint="上传主合同、加盟协议、服务协议、销售话术或宣传承诺样稿。",
                keywords=("合同", "协议", "条款", "承诺", "赔付", "免责", "加盟协议"),
            ),
            DataRequirement(
                key="ad_compliance_materials",
                label="广告与宣传素材",
                reason="推广素材是否夸大承诺、触发禁限词或平台规则，是增长动作能否继续的前置条件。",
                source_hint="上传广告素材、落地页、直播话术、招商页或平台审核记录。",
                keywords=("广告", "宣传", "落地页", "直播话术", "禁限词", "平台审核"),
                required=False,
            ),
        ),
        scenarios=("general_business", "local_service", "ecommerce_retail", "manufacturing", "b2b_solution"),
    ),
    "tax": ExpertConfig(
        module="tax",
        method="tax-evidence",
        label="税务与票据",
        fallback_prompt="",
        industry_kpis=("税负率", "发票链路完整性", "进项抵扣率", "三流一致性", "收入确认合规"),
        judgment_hints=(
            "先判断问题是税负异常、发票链路不完整、收入确认偏差还是成本扣除风险。",
            "电商、加盟、平台撮合和项目制业务必须核验资金流、票据流、合同流是否一致。",
            "涉及补贴、返利、佣金、服务费时，必须看计税口径和凭证完整性。",
            "只给经营和资料补齐建议，不替代注册税务师意见。",
        ),
        data_requirements=(
            DataRequirement(
                key="tax_returns",
                label="纳税申报与税负数据",
                reason="税务诊断需要看到申报税种、税负率、收入成本口径和历史变化。",
                source_hint="上传近12个月纳税申报表、税负测算或财务月报。",
                keywords=("纳税申报", "税负", "增值税", "所得税", "附加税", "税率"),
            ),
            DataRequirement(
                key="invoice_flow",
                label="进销项发票链路",
                reason="发票链路决定成本扣除、进项抵扣和收入确认风险。",
                source_hint="上传销项/进项发票汇总、开票明细、未开票收入或供应商发票记录。",
                keywords=("发票", "进项", "销项", "开票", "抵扣", "未开票"),
            ),
            DataRequirement(
                key="contract_cash_flow",
                label="合同流与资金流水",
                reason="合同、发票、资金流水不一致时，税务和收入质量判断都需要降级。",
                source_hint="上传合同台账、收付款流水、佣金/返利/服务费明细。",
                keywords=("合同流", "资金流", "流水", "佣金", "返利", "服务费"),
                required=False,
            ),
        ),
        scenarios=("ecommerce_retail", "b2b_solution", "local_service", "manufacturing"),
    ),
    "policy": ExpertConfig(
        module="policy",
        method="policy-evidence",
        label="政策与监管",
        fallback_prompt="",
        industry_kpis=("政策准入符合度", "补贴兑现周期", "申报资质匹配度", "监管趋势风险"),
        judgment_hints=(
            "先判断当前问题是否受政策准入、补贴退坡、监管趋严或地方产业导向影响。",
            "新能源、制造、教育、医疗、餐饮和平台业务必须核验监管趋势。",
            "涉及政府补贴或项目申报时，必须区分政策确定性、兑现周期和合规成本。",
            "不得把政策机会包装成确定收益。",
        ),
        data_requirements=(
            DataRequirement(
                key="policy_documents",
                label="相关政策与监管文件",
                reason="没有政策文件或监管口径，无法判断机会窗口和合规边界。",
                source_hint="上传政策通知、补贴文件、监管要求、申报指南或地方产业目录。",
                keywords=("政策", "监管", "补贴", "申报", "通知", "指南", "产业目录"),
            ),
            DataRequirement(
                key="qualification_status",
                label="申报条件与资质状态",
                reason="政策机会是否可用，取决于企业资质、地域、规模和申报条件是否匹配。",
                source_hint="补充企业资质、所在地区、纳税/社保/研发投入、过往申报记录。",
                keywords=("申报条件", "资质", "地区", "研发投入", "社保", "纳税", "高新"),
                required=False,
            ),
        ),
        scenarios=("manufacturing", "local_service", "b2b_solution", "general_business"),
    ),
    "ip": ExpertConfig(
        module="ip",
        method="ip-evidence",
        label="知识产权",
        fallback_prompt="",
        industry_kpis=("商标/专利布局完备性", "权属清晰度", "侵权风险敞口", "授权边界合规"),
        judgment_hints=(
            "先判断问题涉及品牌保护、技术壁垒、侵权风险还是商业秘密泄露。",
            "有硬件、配方、软件、内容、品牌连锁时，必须核验商标/专利/著作权布局。",
            "涉及招商、加盟、代理或出海时，必须看权利归属和授权边界。",
            "只给资产保护和风险提示，不替代专业知识产权法律意见。",
        ),
        data_requirements=(
            DataRequirement(
                key="ip_assets",
                label="知识产权资产清单",
                reason="没有商标、专利、著作权和域名清单，无法判断保护缺口。",
                source_hint="上传商标/专利/软著/版权/域名清单和申请状态。",
                keywords=("商标", "专利", "软著", "著作权", "版权", "域名", "知识产权"),
            ),
            DataRequirement(
                key="ownership_authorization",
                label="权属与授权文件",
                reason="权属不清会影响融资、加盟、授权和对外合作安全。",
                source_hint="上传权属证明、合作开发协议、授权协议、员工保密协议。",
                keywords=("权属", "授权", "保密协议", "合作开发", "许可", "归属"),
                required=False,
            ),
        ),
        scenarios=("manufacturing", "saas_subscription", "ecommerce_retail", "b2b_solution"),
    ),
    "supply_chain": ExpertConfig(
        module="supply_chain",
        method="supply-chain-evidence",
        label="供应链韧性",
        fallback_prompt="",
        industry_kpis=("供应商集中度", "采购周期", "到货准时率", "质检不良率", "库存安全水位"),
        judgment_hints=(
            "先判断风险来自单一供应商、采购周期、质量波动、价格波动还是库存策略。",
            "制造、餐饮、硬件和零售场景必须核验关键物料和替代供应商。",
            "增长建议必须经过供给能力和交付稳定性校验。",
            "把风险转成可执行的采购、库存和供应商动作。",
        ),
        data_requirements=(
            DataRequirement(
                key="supplier_concentration",
                label="供应商集中度与采购占比",
                reason="供应商集中度决定断供、议价和质量波动风险。",
                source_hint="上传供应商清单、采购金额占比、核心物料来源和账期。",
                keywords=("供应商", "采购占比", "核心物料", "账期", "集中度"),
            ),
            DataRequirement(
                key="lead_time_quality",
                label="采购周期与质量记录",
                reason="缺少周期和质量记录，无法判断交付风险是否结构性存在。",
                source_hint="上传采购周期、到货准时率、质检不良率、退换货记录。",
                keywords=("采购周期", "到货", "质检", "不良率", "退换货", "准时率"),
            ),
        ),
        scenarios=("manufacturing", "ecommerce_retail", "local_service"),
    ),
    "channel_franchise": ExpertConfig(
        module="channel_franchise",
        method="channel-franchise-evidence",
        label="渠道与加盟",
        fallback_prompt="",
        industry_kpis=("单店回本周期", "加盟商存活率", "动销率", "渠道冲突率", "招商转化率"),
        judgment_hints=(
            "先判断问题来自渠道质量、加盟模型、区域冲突、终端执行还是总部赋能不足。",
            "连锁、招商、经销和代理场景必须看单店模型、回本周期和渠道冲突。",
            "涉及承诺收益、区域保护或返利政策时，必须联动法务合规与财务测算。",
            "动作建议必须能落到渠道筛选、培训、督导和政策调整。",
        ),
        data_requirements=(
            DataRequirement(
                key="channel_unit_model",
                label="渠道/门店单元模型",
                reason="没有单店或单渠道模型，无法判断扩张是否可复制。",
                source_hint="上传门店/代理商收入、毛利、投入、回本周期、闭店或流失数据。",
                keywords=("加盟", "代理", "经销", "门店", "回本", "单店", "渠道"),
            ),
            DataRequirement(
                key="channel_policy",
                label="渠道政策与区域规则",
                reason="渠道冲突、价格体系和区域保护决定扩张质量。",
                source_hint="上传招商政策、返利政策、区域保护、价格体系和督导记录。",
                keywords=("招商政策", "返利", "区域保护", "价格体系", "督导", "窜货"),
                required=False,
            ),
        ),
        scenarios=("local_service", "ecommerce_retail", "manufacturing", "general_business"),
    ),
    "data_systems": ExpertConfig(
        module="data_systems",
        method="data-systems-evidence",
        label="数据与系统",
        fallback_prompt="",
        industry_kpis=("数据口径一致性", "系统打通度", "关键指标可追踪率", "看板可用性"),
        judgment_hints=(
            "先判断问题来自数据缺失、口径不一、系统割裂还是流程没有数字化。",
            "诊断所有经营动作前，必须标记哪些数据不能被可靠追踪。",
            "涉及投放、销售、财务、交付闭环时，必须核验系统是否能串联。",
            "建议要落到数据口径、系统责任人和最小可用看板。",
        ),
        data_requirements=(
            DataRequirement(
                key="system_map",
                label="系统与数据流向图",
                reason="系统割裂会导致诊断和复盘都无法闭环。",
                source_hint="补充当前使用的 CRM、ERP、财务、广告、客服系统和数据流转方式。",
                keywords=("系统", "CRM", "ERP", "财务系统", "数据流", "看板", "自动化"),
            ),
            DataRequirement(
                key="metric_definitions",
                label="核心指标口径",
                reason="口径不一致时，部门间复盘会持续争议。",
                source_hint="上传经营指标口径表、报表截图、看板字段或数据字典。",
                keywords=("口径", "指标", "数据字典", "报表", "看板", "字段"),
            ),
            DataRequirement(
                key="id_mapping",
                label="客户/订单/线索 ID 对齐方式",
                reason="投放、销售、交付和财务之间无法对齐同一客户或订单时，归因和复盘都会失真。",
                source_hint="说明广告线索、CRM 客户、订单、合同、回款之间是否有统一 ID 或匹配规则。",
                keywords=("ID", "线索", "客户", "订单", "合同", "回款", "归因"),
                required=False,
            ),
            DataRequirement(
                key="dashboard_usage",
                label="经营看板与使用频率",
                reason="看板是否被经营会稳定使用，决定数据系统能否真正支撑决策。",
                source_hint="上传当前经营看板截图，或说明老板/部门每周查看哪些指标、由谁维护。",
                keywords=("经营看板", "周报", "日报", "复盘", "维护人", "使用频率"),
                required=False,
            ),
        ),
        scenarios=("general_business", "saas_subscription", "b2b_solution", "ecommerce_retail"),
    ),
}


SPECIALIST_DEFINITIONS: tuple[SkillDefinition, ...] = tuple(
    SkillDefinition(
        key=config.module,
        label=config.label,
        category="professional",
        category_label="专业风险",
        skill_type="diagnosis",
        method=config.method,
        description={
            "legal_compliance": "识别广告、合同、资质、平台规则和用工相关的经营合规风险。",
            "tax": "核验税负、发票、收入确认和合同/资金/票据一致性。",
            "policy": "判断政策窗口、监管趋势、补贴兑现和准入条件对经营动作的影响。",
            "ip": "梳理商标、专利、版权、商业秘密和授权边界。",
            "supply_chain": "评估关键供应商、采购周期、质量稳定和库存安全。",
            "channel_franchise": "诊断代理、加盟、经销、门店扩张和渠道政策。",
            "data_systems": "校验数据口径、系统打通、经营看板和复盘追踪能力。",
        }.get(config.module, config.label),
        trigger_keywords={
            "legal_compliance": ("法务", "合规", "合同", "资质", "许可", "广告法", "禁限词", "监管", "劳动用工", "平台规则", "加盟协议", "legal", "compliance"),
            "tax": ("税务", "税负", "发票", "进项", "销项", "增值税", "所得税", "开票", "票据", "抵扣", "tax"),
            "policy": ("政策", "监管", "补贴", "申报", "准入", "政府", "产业政策", "退坡", "专项资金", "policy"),
            "ip": ("知识产权", "商标", "专利", "软著", "著作权", "版权", "侵权", "商业秘密", "授权", "ip"),
            "supply_chain": ("供应链", "供应商", "采购", "断供", "物料", "库存安全", "交期", "质检", "不良率", "supply"),
            "channel_franchise": ("加盟", "代理", "经销", "招商", "门店", "渠道冲突", "区域保护", "返利", "窜货", "franchise"),
            "data_systems": ("数据口径", "系统割裂", "CRM", "ERP", "看板", "报表", "自动化", "数据字典", "systems"),
        }.get(config.module, (config.label,)),
        data_requirements=config.data_requirements,
        fallback_prompt=config.fallback_prompt,
        upgrade_policy="当低评分、低置信度或复盘偏差集中出现时，先沉淀失败样本，再补充数据需求和判断纪律，形成候选版本。",
        evaluation_metrics=("低评分率", "关键数据补齐率", "风险命中率", "复盘偏差"),
    )
    for config in SPECIALIST_CONFIGS.values()
)


SYSTEM_DEFINITIONS: tuple[SkillDefinition, ...] = (
    SkillDefinition(
        key=METHOD_MODULE_KEY,
        label="诊断方法（通用脑子）",
        category="system",
        category_label="诊断方法",
        skill_type="method",
        method="diagnostic_method",
        description="所有诊断 skill 共用的通用方法、证据纪律与输出契约；运行时注入到各领域切片之后。改一处全局诊断生效。",
        trigger_keywords=("诊断方法", "通用方法", "输出契约", "method"),
        fallback_prompt=DIAGNOSTIC_METHOD,
        upgrade_policy="作为全局脑子，任何改动影响所有诊断；必须人工审核、灰度后再激活，并保留可回滚的历史版本。",
        evaluation_metrics=("跨 skill 输出合规率", "约束定位命中率", "缺数据诚实率", "证据可审计率"),
    ),
    SkillDefinition(
        key="diagnosis_scout",
        label="诊断调度脑子",
        category="system",
        category_label="诊断方法",
        skill_type="method",
        method="diagnosis_scout",
        description="从问题地图决定本次该诊断哪些角度；命中已有域则复用其取数项/基准，覆盖不到的关键角度现场新建。让固定域成为起跑库而非边界。",
        trigger_keywords=("调度", "诊断角度", "路由", "scout"),
        fallback_prompt=DIAGNOSIS_SCOUT,
        upgrade_policy="根据漏诊/误派/新角度命中率迭代；影响全局诊断覆盖面，人工审核后激活。",
        evaluation_metrics=("关键角度覆盖率", "已有域复用率", "新角度有效率", "误派率"),
    ),
    SkillDefinition(
        key="research_planner",
        label="外部研究规划脑子",
        category="system",
        category_label="诊断方法",
        skill_type="method",
        method="research_planner",
        description="诊断前决定上网搜什么：按问题地图与诊断域规划外部研究查询，先搜行业基准/竞品/政策/口碑再交专家。需配 PERPLEXITY_API_KEY 才会真正搜索。",
        trigger_keywords=("外部研究", "搜索", "预研", "research", "query"),
        fallback_prompt=RESEARCH_PLANNER,
        upgrade_policy="根据搜到证据的相关度、被专家引用率和漏搜补搜率迭代，人工审核后激活。",
        evaluation_metrics=("证据相关度", "专家引用率", "漏搜补搜率", "查询有效率"),
    ),
    SkillDefinition(
        key="free_chat",
        label="头脑风暴陪练",
        category="assistant",
        category_label="头脑风暴",
        skill_type="assistant",
        method="brainstorm_chat",
        description="陪用户推演已有项目的新想法或全新项目灵感，追问关键假设、反证风险和低成本验证动作。",
        trigger_keywords=("头脑风暴", "脑暴", "点子", "想法", "灵感", "商业假设", "新项目", "营销点子", "brainstorm"),
        fallback_prompt=FREE_CHAT,
        upgrade_policy="根据用户是否继续追问、点子卡完整度、验证动作可执行性和转项目诊断率调整提示词，人工审核后激活。",
        evaluation_metrics=("追问有效率", "点子逻辑链完整度", "验证动作可执行性", "转项目诊断率"),
    ),
    SkillDefinition(
        key="conversation_intake",
        label="深度访谈与问题地图",
        category="intake",
        category_label="客户进入",
        skill_type="conversation",
        method="intake",
        description="逐轮追问项目画像、核心问题、目标、约束和成功标准。",
        trigger_keywords=("访谈", "问题地图", "intake"),
        fallback_prompt=CONVERSATION_INTAKE,
        evaluation_metrics=("信息完整度", "确认通过率", "追问轮次", "用户中断率"),
    ),
    SkillDefinition(
        key="intake_completeness",
        label="信息完整度闸门",
        category="intake",
        category_label="客户进入",
        skill_type="conversation",
        method="quality_gate",
        description="判断问题地图是否足够进入诊断，缺关键字段时继续追问。",
        trigger_keywords=("完整度", "信息闸门", "quality gate"),
        fallback_prompt=INTAKE_COMPLETENESS,
        evaluation_metrics=("缺口识别率", "误放行率", "确认通过率"),
    ),
    SkillDefinition(
        key="questionnaire",
        label="诊断问卷生成",
        category="questionnaire",
        category_label="数据采集",
        skill_type="questionnaire",
        method="coverage",
        description="按问题地图与行业，动态生成贴合的关键信息收集问卷，必须收集真实数据入口（直播间/商品/账号链接）。",
        trigger_keywords=("问卷", "数据采集", "信息收集", "questionnaire"),
        fallback_prompt=QUESTIONNAIRE_BASE,
        upgrade_policy="根据填写完成率、字段有效率、数据入口命中率和诊断置信度提升迭代，人工审核后激活。",
        evaluation_metrics=("填写完成率", "字段有效率", "数据入口命中率", "诊断置信度提升"),
    ),
    SkillDefinition(
        key="questionnaire_quality_gate",
        label="问卷质量评审",
        category="questionnaire",
        category_label="数据采集",
        skill_type="questionnaire",
        method="quality_gate",
        description="LLM 评审生成的问卷：是否贴合行业与问题、是否收集了真实数据入口（直播间/商品/账号链接），不达标则打回重生成。",
        trigger_keywords=("问卷", "质量", "把关", "评审", "quality gate"),
        fallback_prompt=QUESTIONNAIRE_QUALITY_GATE,
        evaluation_metrics=("拦截率", "数据入口命中率", "行业贴合度", "重生成通过率"),
    ),
    SkillDefinition(
        key="evidence_confidence",
        label="证据置信度评估",
        category="delivery",
        category_label="证据交付",
        skill_type="delivery",
        method="confidence_calibration",
        description="按来源质量、数据完整度、外部基准、缺失数据和可验证性校准证据置信度。",
        trigger_keywords=("置信度", "评分", "证据等级", "校准", "可信度"),
        fallback_prompt=EVIDENCE_CONFIDENCE,
        upgrade_policy="根据用户反馈、复盘命中率和过度自信样本调整评分权重，必须人工审核后激活。",
        evaluation_metrics=("过度自信率", "低估命中率", "证据解释完整度", "复盘校准误差"),
    ),
    SkillDefinition(
        key="archive_extraction",
        label="项目档案资料沉淀",
        category="delivery",
        category_label="证据交付",
        skill_type="delivery",
        method="archive_extraction",
        description="从上传资料中提炼可长期复用的项目档案事实，识别报告性质、参与人、撰写/审阅关系、数据口径和经营上下文。",
        trigger_keywords=("项目档案", "资料沉淀", "上传资料", "报告性质", "参与人", "撰写人", "审阅人", "archive"),
        fallback_prompt=ARCHIVE_EXTRACTION,
        upgrade_policy="根据用户确认/修改沉淀字段的差异、漏提的人名角色和复诊引用率迭代字段识别纪律，人工审核后激活。",
        evaluation_metrics=("字段确认率", "用户手动修改率", "报告元信息命中率", "复诊引用率"),
    ),
    SkillDefinition(
        key="archive_refinement",
        label="项目档案智能提炼",
        category="delivery",
        category_label="证据交付",
        skill_type="delivery",
        method="archive_refinement",
        description="把对话、问卷和诊断过程中的原始事实提炼、合并、改写并归档到正确业务板块。",
        trigger_keywords=("项目档案", "自动沉淀", "提炼入档", "字段合并", "板块归类", "archive refinement"),
        fallback_prompt=ARCHIVE_REFINEMENT,
        upgrade_policy="根据用户对档案字段的修改、误分板块、重复字段和复诊引用情况迭代提炼纪律，人工审核后激活。",
        evaluation_metrics=("字段合并率", "误分板块率", "重复字段率", "复诊引用率", "用户修正率"),
    ),
)


def _config_definitions() -> tuple[SkillDefinition, ...]:
    """从 configs/ 目录的文件型 skill 生成 SkillDefinition。

    让 Loop 1 产出的 skill 不只是"能执行"，还能被 router 召回、被 admin 治理、
    被 seed 写入版本表——即文件即上线的完整闭环。导入在函数内，避免循环依赖。
    """
    try:
        from app.skills.config_loader import list_config_keys, load_config, load_config_meta
    except Exception:  # noqa: BLE001
        return ()
    out: list[SkillDefinition] = []
    for key in list_config_keys():
        try:
            config = load_config(key)
            meta = load_config_meta(key)
        except Exception:  # noqa: BLE001
            continue
        category = meta.get("category", "industry")
        category_label = {
            "core": "核心经营", "professional": "专业风险",
            "capability": "诊断能力", "industry": "行业专项", "intake": "客户进入",
        }.get(category, "诊断能力")
        out.append(SkillDefinition(
            key=config.module,
            label=config.label,
            category=category,
            category_label=category_label,
            skill_type="diagnosis",
            method=config.method,
            description=meta.get("description", config.label),
            trigger_keywords=tuple(meta.get("trigger_keywords", ())),
            data_requirements=config.data_requirements,
            fallback_prompt=config.fallback_prompt,
        ))
    return tuple(out)


_CONFIG_DEFINITIONS: tuple[SkillDefinition, ...] = _config_definitions()

# configs/ 定义放最后，同 key 时覆盖内置（便于用文件迭代覆盖硬编码）
_CORE_AND_SPECIALIST = (*CORE_DEFINITIONS, *SPECIALIST_DEFINITIONS, *SYSTEM_DEFINITIONS)
_seen_keys = {d.key for d in _CONFIG_DEFINITIONS}
_ALL_DEFINITIONS: tuple[SkillDefinition, ...] = (
    *(d for d in _CORE_AND_SPECIALIST if d.key not in _seen_keys),
    *_CONFIG_DEFINITIONS,
)
_DEFINITIONS_BY_KEY = {definition.key: definition for definition in _ALL_DEFINITIONS}


def all_skill_definitions() -> tuple[SkillDefinition, ...]:
    return _ALL_DEFINITIONS


def diagnosis_skill_definitions() -> tuple[SkillDefinition, ...]:
    return tuple(
        definition
        for definition in _ALL_DEFINITIONS
        if definition.skill_type == "diagnosis" and definition.enabled
    )


def skill_definition(key: str) -> SkillDefinition | None:
    return _DEFINITIONS_BY_KEY.get(key)


def skill_label(key: str) -> str:
    definition = skill_definition(key)
    if definition:
        return definition.label
    # ad-hoc 角度（调度脑子现场新建，不在注册表）：去掉前缀显示原始角度名
    if key.startswith("adhoc_"):
        return key[len("adhoc_"):]
    return key


# 每个 skill 用在哪个流程（后台"?"悬停说明）。先按 key 精确匹配，再按 skill_type 兜底。
_FLOW_BY_TYPE: dict[str, str] = {
    "method": "诊断引擎·通用判断脑子：所有诊断域共用的方法与输出契约，运行时注入到每个域。改它会影响全部诊断。",
    "diagnosis": "经营诊断阶段：问题命中本域后，脑子据本域的 KPI / 数据入口 / 取数项现场生成诊断结论。本卡是数据骨架，不含 prose、不单独版本化。",
    "questionnaire": "数据采集阶段：按问题地图与行业，生成老板要填的诊断问卷。",
    "conversation": "客户进入阶段：与老板对话深挖，产出结构化问题地图。",
    "delivery": "证据交付阶段：对诊断结论做证据 / 档案加工。",
    "assistant": "头脑风暴：陪老板推演新点子或新项目，不绑定诊断流程。",
}
_FLOW_BY_KEY: dict[str, str] = {
    "diagnosis_scout": "诊断引擎·调度脑子：开诊前从问题地图决定本次该看哪些角度，不限于固定域（命中已有域就借用其取数项/基准，覆盖不到的新角度现场新建）。",
    "research_planner": "诊断引擎·外部研究规划：开诊前决定上网搜什么（行业基准/竞品/政策/口碑），搜到的证据喂给专家并作为结论来源。需配 PERPLEXITY_API_KEY 才会真正联网。",
    "questionnaire_quality_gate": "数据采集阶段·质量闸门：审查生成的问卷是否够格（行业贴合 + 真实数据入口齐全），不达标打回重生成。",
    "intake_completeness": "客户进入阶段·完整度闸门：判断问题地图是否够格进入诊断，缺关键字段时继续追问。",
    "evidence_confidence": "证据交付阶段：给每条诊断结论校准可审计的置信度（百分比可解释到来源/缺口）。",
    "archive_extraction": "证据交付阶段：把上传资料沉淀成可长期复用的项目档案事实。",
}


def skill_flow(key: str, skill_type: str) -> str:
    """返回该 skill 用在哪个流程的说明（后台悬停展示）。"""
    return _FLOW_BY_KEY.get(key) or _FLOW_BY_TYPE.get(skill_type, "")


def resolve_skill_key(value: str | None) -> str | None:
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    normalized = raw.lower().replace("-", "_").replace(" ", "_")
    if normalized in _DEFINITIONS_BY_KEY:
        return normalized
    for definition in diagnosis_skill_definitions():
        if raw == definition.label or raw in definition.label or definition.label in raw:
            return definition.key
        if any(raw.lower() == keyword.lower() for keyword in definition.trigger_keywords):
            return definition.key
    haystack = raw.lower()
    scored = _score_definitions(haystack)
    return scored[0][0] if scored else None


def skill_keys_from_text(text: str, *, limit: int | None = 8) -> list[str]:
    scored = _score_definitions(text)
    keys = [key for key, _score in scored]
    return keys[:limit] if limit is not None else keys


def default_core_skill_keys() -> list[str]:
    return [definition.key for definition in CORE_DEFINITIONS if definition.default_core]


def questionnaire_skill_hints(
    *,
    text: str,
    focus: str | None = None,
    max_count: int = 8,
) -> list[dict[str, object]]:
    selected: list[tuple[str, str]] = []
    focus_key = resolve_skill_key(focus)
    if focus_key:
        selected.append((focus_key, "问题地图建议优先诊断"))
    for key in skill_keys_from_text(text, limit=max_count):
        if key not in {item[0] for item in selected}:
            selected.append((key, "文本信号触发"))

    if not selected:
        selected = [(key, "默认经营全景基线") for key in default_core_skill_keys()]

    hints: list[dict[str, object]] = []
    for key, reason in selected[:max_count]:
        definition = skill_definition(key)
        if definition is None:
            continue
        hints.append(
            {
                "key": definition.key,
                "label": definition.label,
                "category": definition.category,
                "category_label": definition.category_label,
                "description": definition.description,
                "reason": reason,
                "required_data": [
                    requirement.label for requirement in definition.data_requirements[:4]
                ],
            }
        )
    return hints


def _score_definitions(text: str) -> list[tuple[str, int]]:
    if not text:
        return []
    haystack = text.lower()
    scored: list[tuple[str, int]] = []
    for definition in diagnosis_skill_definitions():
        score = 0
        if definition.key.lower() in haystack:
            score += 6
        if definition.label in text:
            score += 6
        for keyword in definition.trigger_keywords:
            keyword_text = keyword.lower()
            if keyword_text and keyword_text in haystack:
                score += 3 if len(keyword_text) >= 3 else 1
        if score:
            scored.append((definition.key, score))
    category_rank = {"professional": 0, "core": 1}
    return sorted(
        scored,
        key=lambda item: (
            -item[1],
            category_rank.get(skill_definition(item[0]).category if skill_definition(item[0]) else "", 9),
            item[0],
        ),
    )
