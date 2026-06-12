from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str   # "user" | "assistant"
    content: str


class ProblemSummary(BaseModel):
    """对话追问得到的核心问题摘要，替代静态 BusinessProfile 喂给问卷生成。"""
    core_problem: str = ""        # 核心问题一句话
    context: str = ""             # 追问得到的背景
    suspected_cause: str = ""     # 用户猜测的原因
    tried: str = ""               # 已经尝试过的
    # 从对话中提取的画像字段，供问卷生成沿用
    company_name: str = ""
    industry: str = ""
    main_business: str = ""
    business_model: str = ""
    scale: str = ""
    stage: str = ""


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list)


class ChatResponse(BaseModel):
    message: str                       # AI 的下一个追问（done 时为收尾语）
    done: bool = False                 # True = 信息充分，可生成问卷
    summary: ProblemSummary | None = None
