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


class GeneratedModule(BaseModel):
    key: str               # 仍用 market/product/sales/ops/org/finance
    label: str
    subtitle: str
    fields: list[GeneratedField] = Field(default_factory=list)
    pains: list[str] = Field(default_factory=list)
    free_text_label: str


class GeneratedQuestionnaire(BaseModel):
    modules: list[GeneratedModule]
