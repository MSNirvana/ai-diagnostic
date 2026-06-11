from pydantic import BaseModel, Field


class ModuleAnswer(BaseModel):
    module: str
    facts: dict[str, str] = Field(default_factory=dict)
    pains: list[str] = Field(default_factory=list)
    uploaded_files: list[str] = Field(default_factory=list)


class Questionnaire(BaseModel):
    answers: list[ModuleAnswer]
