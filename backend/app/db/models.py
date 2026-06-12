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


class DiagnosisRecord(SQLModel, table=True):
    id: str = Field(default_factory=_uuid, primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=_now)
    # 输入与输出都以 JSON 字符串整存，历史列表只读摘要字段，详情时再反序列化
    answers_json: str
    results_json: str
    profile_json: str | None = None


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
    module: str = Field(index=True)        # market/product/sales/ops/org/finance
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
