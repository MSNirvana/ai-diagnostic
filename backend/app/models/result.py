from typing import Literal
from pydantic import BaseModel, Field


class Evidence(BaseModel):
    text: str
    source: str


class DrillDown(BaseModel):
    """下钻包：只露事实，不含方法。"""
    data_points: list[Evidence] = Field(default_factory=list)
    comparisons: list[str] = Field(default_factory=list)


class ModuleResult(BaseModel):
    module: str
    signal: Literal["red", "yellow", "green"]
    conclusion: str
    evidence: list[Evidence] = Field(max_length=3)
    actions: list[str] = Field(min_length=1)
    drilldown: DrillDown | None = None
