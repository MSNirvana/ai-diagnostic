import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DiagnosisFeedback, DiagnosisRecord, Project, ProjectMemoryEntry
from app.models.result import ModuleResult, TriageSummary


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def append_memory_entry(
    session: AsyncSession,
    *,
    project_id: str,
    entry_type: str,
    summary: str,
    payload: dict[str, Any],
    user_id: str | None = None,
    source_id: str | None = None,
) -> ProjectMemoryEntry | None:
    """Append one structured event to the enterprise long-term file."""
    project = await session.get(Project, project_id)
    if project is None:
        return None

    entry = ProjectMemoryEntry(
        project_id=project_id,
        user_id=user_id or project.user_id,
        entry_type=entry_type,
        summary=summary,
        payload_json=json.dumps(payload, ensure_ascii=False),
        source_id=source_id,
    )
    session.add(entry)
    _append_summary_line(project, entry_type, summary)
    session.add(project)
    return entry


async def append_problem_map_memory(
    session: AsyncSession,
    *,
    project_id: str,
    problem_map: Any,
    user_id: str | None = None,
    source_id: str | None = None,
) -> ProjectMemoryEntry | None:
    payload = _dump_model(problem_map)
    core = str(payload.get("core_problem") or "").strip()
    goal = str(payload.get("goal") or "").strip()
    summary = f"核心问题：{core or '未命名问题'}"
    if goal:
        summary += f"；目标：{goal}"
    entry = await append_memory_entry(
        session,
        project_id=project_id,
        entry_type="problem_map",
        summary=summary,
        payload=payload,
        user_id=user_id,
        source_id=source_id,
    )
    project = await session.get(Project, project_id)
    if project is not None and core:
        project.profile_json = json.dumps(payload, ensure_ascii=False)
        project.updated_at = _now()
        session.add(project)
    return entry


async def append_diagnosis_memory(
    session: AsyncSession,
    *,
    project_id: str,
    results: list[ModuleResult],
    triage: TriageSummary | None = None,
    user_id: str | None = None,
    source_id: str | None = None,
) -> ProjectMemoryEntry | None:
    if not results:
        return None
    order = {"red": 0, "yellow": 1, "green": 2}
    top = sorted(results, key=lambda r: order.get(r.signal, 9))[0]
    signal_cn = {"red": "需关注", "yellow": "观察", "green": "健康"}.get(top.signal, top.signal)
    first_action = top.actions[0] if top.actions else "暂无行动建议"
    summary = f"{top.module}（{signal_cn}）：{top.conclusion[:60]}；建议：{first_action[:60]}"
    payload = {
        "top_module": top.module,
        "signal": top.signal,
        "conclusion": top.conclusion,
        "actions": top.actions,
        "triage": triage.model_dump() if triage else None,
        "results": [r.model_dump() for r in results],
    }
    return await append_memory_entry(
        session,
        project_id=project_id,
        entry_type="diagnosis",
        summary=summary,
        payload=payload,
        user_id=user_id,
        source_id=source_id,
    )


async def append_feedback_memory(
    session: AsyncSession,
    *,
    record: DiagnosisRecord,
    feedback: DiagnosisFeedback,
) -> ProjectMemoryEntry | None:
    if not record.project_id:
        return None
    tone = "有帮助" if feedback.is_useful else "待改进"
    comment = f"；反馈：{feedback.comment}" if feedback.comment else ""
    summary = f"{feedback.module} 诊断反馈：{tone}，评分 {feedback.rating}/5{comment}"
    return await append_memory_entry(
        session,
        project_id=record.project_id,
        entry_type="feedback",
        summary=summary,
        payload={
            "record_id": record.id,
            "module": feedback.module,
            "skill_version_id": feedback.skill_version_id,
            "rating": feedback.rating,
            "is_useful": feedback.is_useful,
            "comment": feedback.comment,
        },
        user_id=feedback.user_id or record.user_id,
        source_id=feedback.id,
    )


def _append_summary_line(project: Project, entry_type: str, summary: str) -> None:
    stamp = _now().strftime("%Y-%m-%d")
    label = {
        "problem_map": "问题地图",
        "diagnosis": "诊断",
        "feedback": "反馈",
    }.get(entry_type, entry_type)
    lines = [line for line in project.memory_summary.split("\n") if line.strip()]
    lines.append(f"[{stamp}] {label}：{summary}")
    project.memory_summary = "\n".join(lines[-10:])
    project.updated_at = _now()
    # The caller owns commit timing so memory writes can join larger transactions.


def _dump_model(value: Any) -> dict[str, Any]:
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if isinstance(value, dict):
        return value
    return {}
