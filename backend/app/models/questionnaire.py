from typing import Any

from pydantic import BaseModel, Field


class ModuleAnswer(BaseModel):
    module: str
    facts: dict[str, str] = Field(default_factory=dict)
    pains: list[str] = Field(default_factory=list)
    uploaded_files: list[str] = Field(default_factory=list)
    context: dict[str, Any] = Field(default_factory=dict)


class Questionnaire(BaseModel):
    answers: list[ModuleAnswer]
    # 关联的诊断会话（记忆文件），可选——前端从对话流程带过来
    session_id: str | None = None
    # 所属项目，可选
    project_id: str | None = None
    # 对话 intake 产出的问题地图，用于专家分诊编排
    problem_map: dict | None = None
    # 是否请顾问复核（默认否）：否=诊断完成即出给老板看（零等待）；是=进 pending_review 等顾问。
    request_review: bool = False
