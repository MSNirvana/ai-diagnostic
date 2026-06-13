from typing import Literal
from pydantic import BaseModel, Field


class Evidence(BaseModel):
    text: str
    source: str


class DrillDown(BaseModel):
    """下钻包：只露事实，不含方法。"""
    data_points: list[Evidence] = Field(default_factory=list)
    comparisons: list[str] = Field(default_factory=list)


class BenchmarkReference(BaseModel):
    """外部或行业基准引用。"""
    name: str
    source: str
    value: str


class AuditTrail(BaseModel):
    """证据包审计轨迹：说明该结论由什么版本、什么输入和哪些校验产生。"""
    skill_version_id: str
    input_modules: list[str] = Field(default_factory=list)
    checks: list[str] = Field(default_factory=list)


class DataRequest(BaseModel):
    """专家需要补充的数据，用于把低置信度结论变成下一步数据采集任务。"""
    key: str
    label: str
    reason: str
    source_hint: str = ""
    required: bool = True


class EvidencePackage(BaseModel):
    """可信证据层：给每个专家结论附上可解释、可追溯的证据包。"""
    confidence: float = Field(ge=0, le=1)
    confidence_reason: str
    citations: list[Evidence] = Field(default_factory=list)
    benchmarks: list[BenchmarkReference] = Field(default_factory=list)
    audit_trail: AuditTrail


class ModuleResult(BaseModel):
    module: str
    signal: Literal["red", "yellow", "green"]
    conclusion: str
    evidence: list[Evidence] = Field(max_length=3)
    actions: list[str] = Field(min_length=1)
    drilldown: DrillDown | None = None
    evidence_package: EvidencePackage | None = None
    data_requests: list[DataRequest] = Field(default_factory=list)


class ExpertRoute(BaseModel):
    """一次会诊中被选中的专家及其入选原因。"""
    module: str
    label: str
    reason: str
    priority: int


class TriageConflict(BaseModel):
    """专家判断之间需要用户关注的张力或冲突。"""
    modules: list[str] = Field(min_length=2)
    description: str


class TriageSummary(BaseModel):
    """多专家会诊汇总：给前端和长期记忆层使用的结构化摘要。"""
    primary_module: str | None = None
    selected_experts: list[ExpertRoute] = Field(default_factory=list)
    conflicts: list[TriageConflict] = Field(default_factory=list)
    dependencies: list[str] = Field(default_factory=list)
    priority_actions: list[str] = Field(default_factory=list)
