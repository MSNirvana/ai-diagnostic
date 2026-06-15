from pydantic import BaseModel, Field


class BusinessProfile(BaseModel):
    """业务画像：用户在生成问卷前先填，让 AI 据此定制字段。"""
    company_name: str
    industry: str          # 如：直播电商、工业制造、SaaS 软件
    main_business: str     # 主营业务一句话
    business_model: str    # 如：B2B 订阅、B2C 零售、平台撮合
    scale: str             # 如：50 人 / 年营收 2000 万
    stage: str             # 如：初创期 / 成长期 / 成熟期


class GeneratedField(BaseModel):
    key: str
    label: str
    placeholder: str
    hint: str | None = None
    accept_file: bool = False
    # 二次诊断预填：历史已知值 + 来源标注。前端据此把字段预填为"已知，可修正"，
    # 老板不必重填已收集过的信息。默认 None → 全新字段，行为与改动前一致。
    prefilled_value: str | None = None
    known_source: str | None = None


class GeneratedModule(BaseModel):
    key: str               # 使用 Skill 网络里的诊断 key，可随业务场景扩展
    label: str
    subtitle: str
    fields: list[GeneratedField] = Field(default_factory=list)
    pains: list[str] = Field(default_factory=list)
    free_text_label: str


class GeneratedQuestionnaire(BaseModel):
    modules: list[GeneratedModule]


class QuestionnaireGenerationContext(BaseModel):
    mode: str = "coverage"
    company_name: str = ""
    industry: str = ""
    main_business: str = ""
    business_model: str = ""
    scale: str = ""
    stage: str = ""
    core_problem: str = ""
    sub_problems: list[str] = Field(default_factory=list)
    goal: str = ""
    constraints: str = ""
    success_criteria: str = ""
    impact: str = ""
    context: str = ""
    suspected_cause: str = ""
    tried: str = ""
    data_readiness: str = ""
    diagnosis_focus: str = ""
    scenario_key: str = ""
    scenario_label: str = ""
    benchmark_keywords: list[str] = Field(default_factory=list)
    evidence_lens: list[str] = Field(default_factory=list)
    available_skills: list[dict] = Field(default_factory=list)
    recommended_skills: list[dict] = Field(default_factory=list)
