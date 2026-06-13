from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str   # "user" | "assistant"
    content: str


class ProblemSummary(BaseModel):
    """[向后兼容] 对话追问得到的核心问题摘要。新代码请用 ProblemMap。"""
    core_problem: str = ""
    context: str = ""
    suspected_cause: str = ""
    tried: str = ""
    company_name: str = ""
    industry: str = ""
    main_business: str = ""
    business_model: str = ""
    scale: str = ""
    stage: str = ""


class ProblemMap(BaseModel):
    """深度 intake 后产出的结构化问题地图——比 ProblemSummary 信息丰富。

    包含拆解出的子问题、目的/约束/成功标准、建议优先诊断模块等。
    """
    # 基本信息（从对话自然提取）
    company_name: str = ""
    industry: str = ""
    main_business: str = ""
    business_model: str = ""
    scale: str = ""
    stage: str = ""
    # 问题结构
    core_problem: str = ""             # 最核心的一个问题
    sub_problems: list[str] = Field(default_factory=list)  # 拆解出的相关问题
    goal: str = ""                     # 想达成什么
    constraints: str = ""              # 约束/不能动的
    success_criteria: str = ""         # 怎么算解决了
    impact: str = ""                   # 影响程度/时间范围/量化损失
    # 背景
    context: str = ""
    suspected_cause: str = ""
    tried: str = ""
    data_readiness: str = ""           # 已有数据、文件、指标口径，或明确暂无
    # 诊断优先级（建议先诊断哪个模块的 key）
    diagnosis_focus: str = ""
    # intake 质量闸门（由后端 Skill 评估补充）
    information_score: int = 0
    missing_fields: list[str] = Field(default_factory=list)
    next_question_reason: str = ""

    def to_summary(self) -> ProblemSummary:
        """投影成 ProblemSummary 喂给现有 questionnaire 生成端点。"""
        return ProblemSummary(
            core_problem=self.core_problem,
            context=self.context,
            suspected_cause=self.suspected_cause,
            tried=self.tried,
            company_name=self.company_name,
            industry=self.industry,
            main_business=self.main_business,
            business_model=self.business_model,
            scale=self.scale,
            stage=self.stage,
        )


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list)


class ChatResponse(BaseModel):
    message: str                       # AI 的下一个追问 / 复述确认 / 收尾语
    done: bool = False                 # True = 用户已确认问题地图，可进问卷生成
    phase: str = "intake"              # "intake" | "confirm" | "done"
    problem_map: ProblemMap | None = None   # phase 为 confirm/done 时返回
    # 向后兼容：在 done 时同步填一份 summary
    summary: ProblemSummary | None = None
