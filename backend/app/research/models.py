from pydantic import BaseModel, Field


class ResearchQuery(BaseModel):
    module: str = ""
    query: str
    purpose: str = ""


class ResearchEvidenceItem(BaseModel):
    module: str = ""
    query: str = ""
    title: str = ""
    url: str = ""
    snippet: str = ""
    source_type: str = "web"
    credibility: float = Field(default=0.5, ge=0, le=1)
    provider: str = ""
    raw: dict = Field(default_factory=dict)


class ResearchBrief(BaseModel):
    queries: list[ResearchQuery] = Field(default_factory=list)
    evidence: list[ResearchEvidenceItem] = Field(default_factory=list)
    summary: str = ""
