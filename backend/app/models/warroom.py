from typing import Literal
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.result import DataRequest


Urgency = Literal["now", "soon", "later"]
MetricDirection = Literal["up", "down", "stable"]


class DecisionItem(BaseModel):
    title: str
    detail: str
    urgency: Urgency


class ActionMetric(BaseModel):
    name: str
    current: str | None = None
    target: str
    direction: MetricDirection


class DepartmentAction(BaseModel):
    id: str
    department: str
    department_label: str
    battle_goal: str
    priority: Urgency
    action_title: str
    action_detail: str
    owner_role: str
    start_window: str
    dependency: str = ""
    acceptance_rule: str
    required_data: list[DataRequest] = Field(default_factory=list)
    metrics: list[ActionMetric] = Field(default_factory=list)
    risk_note: str = ""
    confidence: float | None = None
    confidence_reason: str = ""
    evidence_refs: list[str] = Field(default_factory=list)


class BattleChainStep(BaseModel):
    id: str
    label: str
    depends_on: list[str] = Field(default_factory=list)
    note: str = ""


class ReviewCheckpoint(BaseModel):
    window: Literal["7d", "14d", "30d"]
    title: str
    checks: list[str] = Field(default_factory=list)


class PriorityBoard(BaseModel):
    now: list[str] = Field(default_factory=list)
    soon: list[str] = Field(default_factory=list)
    later: list[str] = Field(default_factory=list)


class WarRoomIteration(BaseModel):
    record_id: str
    created_at: datetime
    summary: str
    primary_battlefield: str
    objective: str
    confidence: float = Field(default=0, ge=0, le=1)
    changes: list[str] = Field(default_factory=list)


class WarRoomPlan(BaseModel):
    id: str
    record_id: str | None = None
    project_id: str | None = None
    source_record_ids: list[str] = Field(default_factory=list)
    iteration_count: int = 0
    iterations: list[WarRoomIteration] = Field(default_factory=list)
    summary: str
    primary_battlefield: str
    secondary_battlefield: str = ""
    objective: str
    confidence: float = Field(default=0, ge=0, le=1)
    decision_items: list[DecisionItem] = Field(default_factory=list)
    battle_chain: list[BattleChainStep] = Field(default_factory=list)
    department_actions: list[DepartmentAction] = Field(default_factory=list)
    priority_board: PriorityBoard = Field(default_factory=PriorityBoard)
    evidence_summary: list[str] = Field(default_factory=list)
    risk_summary: list[str] = Field(default_factory=list)
    data_gaps: list[DataRequest] = Field(default_factory=list)
    checkpoints: list[ReviewCheckpoint] = Field(default_factory=list)
