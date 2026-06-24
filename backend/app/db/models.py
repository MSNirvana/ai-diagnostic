import uuid
from datetime import datetime, timezone

from sqlmodel import SQLModel, Field


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    id: str = Field(default_factory=_uuid, primary_key=True)
    email: str = Field(unique=True, index=True)
    hashed_password: str
    created_at: datetime = Field(default_factory=_now)


class Project(SQLModel, table=True):
    """一个持续诊断项目 = 一个项目的诊断档案。

    一个用户可有多个项目。项目下沉淀多次诊断会话、诊断记录，
    随时间持续更新——这是从"一次性诊断"走向"持续诊断"的核心。
    """
    id: str = Field(default_factory=_uuid, primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
    name: str                              # 项目名（项目/品牌/业务线名）
    profile_json: str | None = None        # 最新画像/问题地图
    memory_summary: str = ""               # 项目长期记忆（重点摘要，供后续对话注入）
    war_room_plan_json: str | None = None   # 项目当前作战室快照（由多次诊断迭代更新）
    status: str = "active"                 # active | archived | deleted (user-hidden, data retained)


class ProjectMemoryEntry(SQLModel, table=True):
    """项目长期档案的一条结构化时间线事件。

    memory_summary 是给 LLM 复诊注入的短摘要；这里保留可审计原始事件，
    方便前端展示、后续检索和反馈驱动迭代。
    """
    id: str = Field(default_factory=_uuid, primary_key=True)
    project_id: str = Field(foreign_key="project.id", index=True)
    user_id: str | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=_now)
    entry_type: str = Field(index=True)     # conversation | problem_map | diagnosis | feedback
    summary: str
    payload_json: str = "{}"
    source_id: str | None = Field(default=None, index=True)


class WarRoomFeedbackEvent(SQLModel, table=True):
    """老板作战室的阶段反馈事件。

    作战室计划本身是交付快照；现场是否采纳、阶段效果和新增问题单独记录，
    用于后续复诊和项目档案迭代，避免把咨询系统做成 OA 任务流。
    """
    id: str = Field(default_factory=_uuid, primary_key=True)
    project_id: str = Field(foreign_key="project.id", index=True)
    user_id: str | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=_now)
    war_room_plan_id: str = Field(index=True)
    record_id: str | None = Field(default=None, index=True)
    card_type: str = Field(default="decision", index=True)  # decision | action | review
    card_id: str = Field(index=True)
    card_title: str
    adoption_status: str = Field(default="pending", index=True)  # pending | adopted | deferred | rejected
    feedback_result: str = Field(default="none", index=True)  # none | effective | no_change | new_issue | insufficient_data
    note: str = ""
    owner: str = ""
    attachments_json: str = "[]"


class DiagnosisRecord(SQLModel, table=True):
    id: str = Field(default_factory=_uuid, primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=_now)
    # 输入与输出都以 JSON 字符串整存，历史列表只读摘要字段，详情时再反序列化
    answers_json: str
    results_json: str
    war_room_plan_json: str | None = None
    profile_json: str | None = None
    # 关联的诊断会话（记忆文件），可空（旧记录无此关联）
    session_id: str | None = Field(default=None, index=True)
    # 所属项目，可空（兼容旧数据）
    project_id: str | None = Field(default=None, index=True)
    # —— 顾问审核流（诊断流水线阶段4，伪异步）——
    # 机器诊断同步跑完即 pending_review；顾问审核通过才 approved，老板才看到完整报告。
    review_status: str = Field(default="pending_review", index=True)  # pending_review|approved|rejected
    assigned_to: str | None = Field(default=None, index=True)  # 分派给哪个顾问（user_id/邮箱）
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None
    consultant_notes_json: str | None = None  # 顾问补充/修改的判断
    primary_module: str = ""                   # 主战场，用于审核分派


class DiagnosisJob(SQLModel, table=True):
    """深度尽调任务。

    用户提交后立即创建 job，后台完成外部预研、多专家诊断、证据闸门和作战室草稿。
    第一版使用应用内后台任务；表结构保持独立，后续可平滑迁到 Celery/RQ。
    """
    id: str = Field(default_factory=_uuid, primary_key=True)
    user_id: str | None = Field(default=None, index=True)
    project_id: str | None = Field(default=None, index=True)
    session_id: str | None = Field(default=None, index=True)
    record_id: str | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
    status: str = Field(default="queued", index=True)
    current_step: str = ""
    progress: float = Field(default=0)
    questionnaire_json: str
    error: str | None = None
    result_summary_json: str | None = None


class ResearchEvidence(SQLModel, table=True):
    """外部研究证据。

    每条证据必须可审计：来自哪个 job、服务商、query、URL、抓取时间和适用模块。
    """
    id: str = Field(default_factory=_uuid, primary_key=True)
    job_id: str = Field(foreign_key="diagnosisjob.id", index=True)
    project_id: str | None = Field(default=None, index=True)
    record_id: str | None = Field(default=None, index=True)
    module: str = Field(default="", index=True)
    source_stage: str = Field(default="system_pre_research", index=True)
    provider: str = ""
    query: str = ""
    title: str = ""
    url: str = ""
    snippet: str = ""
    source_type: str = "web"
    credibility: float = Field(default=0.5)
    retrieved_at: datetime = Field(default_factory=_now)
    raw_json: str = "{}"


class DiagnosisSession(SQLModel, table=True):
    """一次完整的诊断会话——从对话到诊断结果的全程记忆文件。

    用户可回看当时怎么聊出问题的，也能基于历史继续聊。
    """
    id: str = Field(default_factory=_uuid, primary_key=True)
    user_id: str | None = Field(default=None, index=True)  # 匿名为 None
    project_id: str | None = Field(default=None, index=True)  # 所属项目
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
    # 完整对话历史（ChatMessage 列表的 JSON）
    messages_json: str = "[]"
    # 结构化问题地图（对话确认后填入）
    problem_map_json: str | None = None
    # 关联的诊断记录（诊断完成后填入）
    diagnosis_record_id: str | None = Field(default=None, index=True)
    # 会话标题（取自核心问题，便于列表展示）
    title: str = ""
    title_is_custom: bool = False
    status: str = "chatting"   # chatting | confirmed | filling | diagnosed
    is_pinned: bool = False
    memory_enabled: bool = True
    deleted_at: datetime | None = Field(default=None, index=True)
    # 问卷填写进度快照（JSON）——跨设备恢复，避免重填/重新生成问卷
    draft_json: str | None = None


class BrainstormSession(SQLModel, table=True):
    """项目内头脑风暴会话。

    与正式 DiagnosisSession 分开：它沉淀想法推演和经营假设，不进入诊断/作战室流水线。
    """
    id: str = Field(default_factory=_uuid, primary_key=True)
    user_id: str | None = Field(default=None, index=True)
    project_id: str | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
    title: str = ""
    title_is_custom: bool = False
    messages_json: str = "[]"
    use_project_context: bool = True
    is_pinned: bool = False
    deleted_at: datetime | None = Field(default=None, index=True)


class IdeaCard(SQLModel, table=True):
    """头脑风暴沉淀的点子卡。

    它不是正式诊断记录，而是诊断前的机会假设。用户确认后保存，
    后续可转入已有项目或创建新项目继续做正式诊断。
    """
    id: str = Field(default_factory=_uuid, primary_key=True)
    user_id: str | None = Field(default=None, index=True)
    project_id: str | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
    title: str
    one_liner: str = ""
    source_context: str = ""
    target_customer: str = ""
    pain_point: str = ""
    value_proposition: str = ""
    core_assumption: str = ""
    contrary_risk: str = ""
    validation_action: str = ""
    next_step: str = ""
    confidence: str = "待验证"
    raw_card_json: str = "{}"
    messages_json: str = "[]"
    status: str = "saved"  # saved | converted | archived


class QuestionnairePreference(SQLModel, table=True):
    """问卷 A/B 偏好样本：一条 = 用户在两份候选问卷中的一次选择。

    用于后期分析"用户偏好什么样的问卷"，迭代生成 prompt。
    """
    id: str = Field(default_factory=_uuid, primary_key=True)
    created_at: datetime = Field(default_factory=_now)
    user_id: str | None = Field(default=None, index=True)  # 未登录用户为 None
    industry: str = Field(index=True)   # 画像行业，便于按行业聚合
    profile_json: str
    option_a_json: str
    option_b_json: str
    chosen: str                          # "a" 或 "b"


class SkillVersion(SQLModel, table=True):
    """诊断 skill 的一个版本。当前生效版本 = 同 module 下 is_active=True 的那条。

    把 skill 的 system prompt 从代码搬到这里，让它可版本化、可回滚、可审核——
    这是"会进化的 skill 系统"的地基。
    """
    id: str = Field(default_factory=_uuid, primary_key=True)
    module: str = Field(index=True)        # skill key：market/product/.../conversation_intake/questionnaire_ab_a
    skill_type: str = Field(default="diagnosis", index=True)  # diagnosis/conversation/questionnaire
    version: int                           # 同 module 下自增 1,2,3...
    system_prompt: str                     # 完整 system prompt
    method: str = "hypothesis"             # 自声明方法类型
    is_active: bool = Field(default=False, index=True)  # 同 module 只一条 True
    created_at: datetime = Field(default_factory=_now)
    # 改动治理元数据
    change_reason: str | None = None       # 为什么改
    change_category: str | None = None     # 分类：coverage/tone/prompt_quality...
    reviewed_by: str | None = None         # 审核人邮箱
    reviewed_at: datetime | None = None


class DiagnosisFeedback(SQLModel, table=True):
    """用户对一次诊断的反馈——skill 进化的燃料。"""
    id: str = Field(default_factory=_uuid, primary_key=True)
    record_id: str = Field(foreign_key="diagnosisrecord.id", index=True)
    module: str = Field(index=True)        # 反馈针对哪个模块
    skill_version_id: str = Field(index=True)  # 当时用的哪版 skill
    created_at: datetime = Field(default_factory=_now)
    user_id: str | None = None
    rating: int                            # 1-5
    is_useful: bool | None = None          # 有用/没用（👍👎）
    comment: str | None = None             # 用户文字意见



class LLMConfig(SQLModel, table=True):
    """模型厂商/API 配置。priority 小的为主，大的为备用，主失败自动切备。

    TODO 生产环境：api_key 应加密存储，当前开发期明文。
    """
    id: str = Field(default_factory=_uuid, primary_key=True)
    name: str                              # 配置名（如"主力-packy-claude"）
    provider: str                          # anthropic | openai
    model: str
    api_key: str                           # 开发期明文，生产需加密
    base_url: str = ""                     # 自定义网关，空走官方
    priority: int = Field(default=0, index=True)  # 0=主，升序 fallback
    is_active: bool = Field(default=True, index=True)
    created_at: datetime = Field(default_factory=_now)


class UploadedFile(SQLModel, table=True):
    """用户上传的文件。选完即存，关联会话，跨设备恢复复用。

    原始文件存磁盘（data/uploads/{session}/），DB 只存路径+元信息+解析摘要。
    parsed_summary 在上传时就算好缓存，诊断时直接合并进 facts。
    """
    id: str = Field(default_factory=_uuid, primary_key=True)
    session_id: str = Field(index=True)      # 关联会话
    user_id: str | None = Field(default=None, index=True)
    module_key: str                          # 挂在哪个模块
    field_key: str                           # 挂在哪个字段
    original_name: str                       # 原始文件名
    stored_path: str                         # 磁盘相对路径
    parsed_summary: str = ""                 # parse_table 解析结果（缓存）
    archive_extraction_json: str = "{}"      # AI 提炼出的待确认沉淀草稿
    archive_extraction_status: str = "none"  # none | pending_confirm | confirmed
    archive_extracted_at: datetime | None = None
    created_at: datetime = Field(default_factory=_now)


class DataSupplementRequest(SQLModel, table=True):
    """作战室待补资料的公开收集链接。

    老板复制链接给负责人；负责人无需登录即可多次上传文件和文字说明。
    """
    id: str = Field(default_factory=_uuid, primary_key=True)
    token: str = Field(default_factory=_uuid, unique=True, index=True)
    project_id: str = Field(foreign_key="project.id", index=True)
    user_id: str | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
    war_room_plan_id: str = Field(index=True)
    data_key: str = Field(index=True)
    label: str
    reason: str = ""
    source_hint: str = ""
    typical_owner: str = ""
    status: str = Field(default="open", index=True)  # open | closed


class DataSupplementSubmission(SQLModel, table=True):
    """公开补资料链接下的一次提交记录。"""
    id: str = Field(default_factory=_uuid, primary_key=True)
    request_id: str = Field(foreign_key="datasupplementrequest.id", index=True)
    project_id: str = Field(foreign_key="project.id", index=True)
    created_at: datetime = Field(default_factory=_now)
    submitter_name: str = ""
    note: str = ""
    file_ids_json: str = "[]"
    deleted_file_ids_json: str = "[]"


class RoutingSample(SQLModel, table=True):
    """一次诊断的路由决策 + 结果快照——router 越用越准的训练燃料（Loop 2）。

    记下"什么信号召回了谁、召回得准不准"，供离线校准关键词权重：
    - 高分召回却回 green/低置信 → 关键词可能假阳性
    - 手填+red 却没被关键词召到 → 关键词缺口（漏召回）
    写入失败绝不能影响诊断，全部 best-effort。
    """
    id: str = Field(default_factory=_uuid, primary_key=True)
    record_id: str | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=_now)
    scenario_key: str = ""
    problem_text: str = ""                   # 驱动关键词召回的文本
    recall_scores_json: str = "[]"           # [{key, score}] 候选打分快照
    selected_json: str = "[]"                # [{module, source, reason, priority}]
    outcomes_json: str = "[]"                # [{module, signal, confidence}]
    missed_json: str = "[]"                  # [module] 手填+red 但关键词漏召回


class CaseAsset(SQLModel, table=True):
    """脱敏后的结构化案例资产——Loop 3 案例飞轮的核心沉淀物。

    与 DiagnosisRecord 的区别：
    - DiagnosisRecord 是给用户看的原始历史（含项目名/精确数字，仅本人可见）。
    - CaseAsset 是脱敏后跨客户复用的"教材"：项目名抹掉、金额模糊成量级，
      保留行业/场景/KPI 结构。客户越多，系统对行业理解越准——这是真护城河。

    匿名诊断也归档（脱敏后无 PII，正是飞轮要的料）。归档失败绝不影响诊断。
    effectiveness_score / consultant_notes 由后续 7/14/30 天复盘回填。
    """
    id: str = Field(default_factory=_uuid, primary_key=True)
    created_at: datetime = Field(default_factory=_now)
    source_record_id: str | None = Field(default=None, index=True)  # 关联原始诊断记录
    industry: str = Field(default="", index=True)   # 行业标签，按行业聚合召回先验
    scenario_key: str = Field(default="", index=True)
    primary_module: str = ""                         # 主战场 skill
    company_profile_json: str = "{}"                 # 脱敏项目画像
    problem_map_json: str = "{}"                      # 脱敏问题地图
    skills_used_json: str = "[]"                     # 本案召回的 skill 列表
    diagnosis_summary_json: str = "{}"                # {module: {signal, conclusion(脱敏), confidence}}
    data_gaps_json: str = "[]"                        # 缺数据 key 列表
    # —— 复盘回填字段（7/14/30 天后），唯一可信的 PMF 信号，不可自动 ——
    effectiveness_score: float | None = None          # 老板执行后 KPI 是否改善
    consultant_notes_json: str | None = None          # 顾问标注：哪些洞察真有用


class IndustryBenchmark(SQLModel, table=True):
    """外部行业基准知识库——"抓取即沉淀"的载体（诊断流水线阶段2）。

    每次诊断需要外部基准时，先查这张表：同 scenario+module+data_type 且未过期则直接用，
    未命中才实时抓（LLM 估算 / 联网检索），抓到后写回这里。库越用越厚，抓取成本越来越低。

    过期分级（expires_at 由 data_type 决定）：
    - benchmark（行业基准）：30 天
    - competitor（竞品数据）：7 天
    - policy（政策监管）：1 天
    """
    id: str = Field(default_factory=_uuid, primary_key=True)
    created_at: datetime = Field(default_factory=_now)
    scenario_key: str = Field(default="", index=True)
    module: str = Field(default="", index=True)
    data_type: str = Field(default="benchmark", index=True)  # benchmark|competitor|policy
    keywords_json: str = "[]"               # 抓取时用的关键词
    payload_json: str = "{}"                # 结构化基准数据
    source: str = ""                        # llm_estimate | web_search | manual
    needs_verification: bool = False        # LLM 估算未联网核实 = True
    fetched_at: datetime = Field(default_factory=_now)
    expires_at: datetime = Field(index=True)
