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
    """一个持续诊断项目 = 一家企业的诊断档案。

    一个用户可有多个项目。项目下沉淀多次诊断会话、诊断记录，
    随时间持续更新——这是从"一次性诊断"走向"持续诊断"的核心。
    """
    id: str = Field(default_factory=_uuid, primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
    name: str                              # 项目名（企业名/业务线名）
    profile_json: str | None = None        # 最新画像/问题地图
    memory_summary: str = ""               # 项目长期记忆（重点摘要，供后续对话注入）
    war_room_plan_json: str | None = None   # 项目当前作战室快照（由多次诊断迭代更新）
    status: str = "active"                 # active | archived


class ProjectMemoryEntry(SQLModel, table=True):
    """企业长期档案的一条结构化时间线事件。

    memory_summary 是给 LLM 复诊注入的短摘要；这里保留可审计原始事件，
    方便前端展示、后续检索和反馈驱动迭代。
    """
    id: str = Field(default_factory=_uuid, primary_key=True)
    project_id: str = Field(foreign_key="project.id", index=True)
    user_id: str | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=_now)
    entry_type: str = Field(index=True)     # problem_map | diagnosis | feedback
    summary: str
    payload_json: str = "{}"
    source_id: str | None = Field(default=None, index=True)


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
    status: str = "chatting"   # chatting | confirmed | filling | diagnosed
    # 问卷填写进度快照（JSON）——跨设备恢复，避免重填/重新生成问卷
    draft_json: str | None = None


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
    created_at: datetime = Field(default_factory=_now)


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
    - DiagnosisRecord 是给用户看的原始历史（含企业名/精确数字，仅本人可见）。
    - CaseAsset 是脱敏后跨客户复用的"教材"：企业名抹掉、金额模糊成量级，
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
    company_profile_json: str = "{}"                 # 脱敏企业画像
    problem_map_json: str = "{}"                      # 脱敏问题地图
    skills_used_json: str = "[]"                     # 本案召回的 skill 列表
    diagnosis_summary_json: str = "{}"                # {module: {signal, conclusion(脱敏), confidence}}
    data_gaps_json: str = "[]"                        # 缺数据 key 列表
    # —— 复盘回填字段（7/14/30 天后），唯一可信的 PMF 信号，不可自动 ——
    effectiveness_score: float | None = None          # 老板执行后 KPI 是否改善
    consultant_notes_json: str | None = None          # 顾问标注：哪些洞察真有用
