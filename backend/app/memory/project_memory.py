import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DiagnosisFeedback, DiagnosisRecord, DiagnosisSession, Project, ProjectMemoryEntry
from app.models.conversation import ChatMessage, ProblemMap
from app.models.result import ModuleResult, TriageSummary


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _finish_sentence(text: str) -> str:
    text = " ".join(str(text or "").split()).strip("；;，, ")
    if not text:
        return ""
    return text if text[-1] in "。！？.!?" else f"{text}。"


def _compact_sentence(text: str, limit: int = 110) -> str:
    """Keep memory summaries readable without cutting words mid-sentence."""
    text = " ".join(str(text or "").split()).strip()
    if len(text) <= limit:
        return _finish_sentence(text)
    for mark in ("。", "！", "？", ".", "!", "?"):
        idx = text.find(mark)
        if 0 < idx + 1 <= limit:
            return _finish_sentence(text[: idx + 1])
    return _finish_sentence(text[:limit].rsplit("，", 1)[0] or text[:limit])


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
    summary = f"核心问题：{_finish_sentence(core or '未命名问题')}"
    if goal:
        summary += f"；目标：{_finish_sentence(goal)}"
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


async def append_conversation_memory(
    session: AsyncSession,
    *,
    project_id: str,
    diagnosis_session: DiagnosisSession,
    user_message: str,
    assistant_message: str,
    problem_map: ProblemMap | None = None,
    user_id: str | None = None,
) -> ProjectMemoryEntry | None:
    """Persist useful intake facts from each project conversation turn.

    This is deliberately deterministic and low-risk: it extracts explicit facts
    already present in the user message / problem map, instead of asking another
    model to infer hidden meaning.
    """
    if not user_message.strip() and problem_map is None:
        return None

    payload = {
        "session_id": diagnosis_session.id,
        "user_message": user_message.strip(),
        "assistant_message": assistant_message.strip(),
        "problem_map": _dump_model(problem_map),
        "extracted": _extract_conversation_facts(user_message, problem_map),
    }
    summary = _conversation_summary(payload["extracted"], user_message)
    if not summary:
        return None
    exists = await session.scalar(
        select(ProjectMemoryEntry).where(
            ProjectMemoryEntry.project_id == project_id,
            ProjectMemoryEntry.source_id == diagnosis_session.id,
            ProjectMemoryEntry.entry_type == "conversation",
            ProjectMemoryEntry.summary == summary,
        )
    )
    if exists is not None:
        return None
    return await append_memory_entry(
        session,
        project_id=project_id,
        entry_type="conversation",
        summary=summary,
        payload=payload,
        user_id=user_id,
        source_id=diagnosis_session.id,
    )


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
    summary = (
        f"{top.module}（{signal_cn}）：{_compact_sentence(top.conclusion)}"
        f"；建议：{_compact_sentence(first_action)}"
    )
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
    parts = [f"{feedback.module} 诊断反馈：{tone}，评分 {feedback.rating}/5"]
    if feedback.comment:
        parts.append(f"反馈：{_finish_sentence(feedback.comment)}")
    summary = "；".join(parts)
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
        "conversation": "对话沉淀",
        "problem_map": "问题地图",
        "diagnosis": "诊断",
        "feedback": "反馈",
        "war_room_feedback": "阶段反馈",
        "uploaded_file": "上传资料",
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


def _extract_conversation_facts(user_message: str, problem_map: ProblemMap | None) -> dict[str, Any]:
    extracted: dict[str, Any] = {}
    payload = _dump_model(problem_map)
    for key in (
        "company_name",
        "industry",
        "main_business",
        "business_model",
        "scale",
        "stage",
        "core_problem",
        "goal",
        "constraints",
        "success_criteria",
        "impact",
        "context",
        "suspected_cause",
        "tried",
        "data_readiness",
        "diagnosis_focus",
    ):
        value = str(payload.get(key) or "").strip()
        if value:
            extracted[key] = value
    if payload.get("sub_problems"):
        extracted["sub_problems"] = payload["sub_problems"]
    metrics = _extract_metric_phrases(user_message)
    if metrics:
        extracted["metrics"] = metrics
    clean_user_message = _compact_sentence(user_message, 160)
    if clean_user_message:
        extracted["latest_user_input"] = clean_user_message
    return extracted


def _conversation_summary(extracted: dict[str, Any], user_message: str) -> str:
    parts: list[str] = []
    if extracted.get("core_problem"):
        parts.append(f"问题：{_compact_sentence(str(extracted['core_problem']), 70)}")
    elif extracted.get("latest_user_input"):
        parts.append(f"线索：{_compact_sentence(str(extracted['latest_user_input']), 70)}")
    if extracted.get("goal"):
        parts.append(f"目标：{_compact_sentence(str(extracted['goal']), 54)}")
    if extracted.get("metrics"):
        parts.append(f"数据：{_compact_sentence('；'.join(extracted['metrics'][:3]), 70)}")
    if not parts:
        parts.append(f"线索：{_compact_sentence(user_message, 80)}")
    return "；".join(part for part in parts if part).strip()


def _extract_metric_phrases(text: str) -> list[str]:
    text = " ".join(str(text or "").split())
    if not text:
        return []
    fragments = []
    for chunk in text.replace("，", "\n").replace("。", "\n").replace("；", "\n").replace(",", "\n").splitlines():
        clean = chunk.strip(" ：:")
        if not clean:
            continue
        if any(char.isdigit() for char in clean) and any(unit in clean for unit in ("%", "元", "万", "天", "月", "年", "单", "人", "个", "台", "条", "ROI", "roi")):
            fragments.append(clean[:48])
    return fragments[:5]
