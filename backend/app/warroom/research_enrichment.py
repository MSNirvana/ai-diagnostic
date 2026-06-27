"""Attach persisted external research evidence to War Room cards.

The diagnosis experts may cite only their module-local evidence. Deep diligence
search results are persisted separately, so this layer backfills those audited
sources into the boss-facing action cards after the record exists.
"""

from __future__ import annotations

import json
from typing import Iterable

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DiagnosisRecord, Project
from app.models.warroom import WarRoomPlan


_PLACEHOLDER_MARKERS = (
    "signal:",
    "signal：",
    "conclusion:",
    "conclusion：",
    "evidence:",
    "evidence：",
    "typical_range",
    "_estimated",
)


def enrich_war_room_plan_with_research(plan: WarRoomPlan, rows: Iterable[object]) -> WarRoomPlan:
    """Return a copy of plan whose action cards cite real searched sources.

    Existing credible action evidence is preserved. Placeholder benchmark dumps
    are removed, then module-matched research evidence fills the gap. If a module
    has too little direct evidence, use the strongest project-level evidence as
    context rather than leaving a one-line unsupported claim.
    """

    row_list = [row for row in rows if _row_url(row) or _row_title(row)]
    if not row_list:
        return _strip_placeholder_external_evidence(plan)

    enriched = plan.model_copy(deep=True)
    used: set[str] = set()
    ranked_all = sorted(row_list, key=lambda row: _row_score(row), reverse=True)

    for action in enriched.department_actions:
        existing = [
            item
            for item in action.external_evidence
            if _clean_text(item) and not looks_like_placeholder_evidence(item)
        ]
        for item in existing:
            used.add(_evidence_identity(item))

        direct = [row for row in ranked_all if _row_module(row) == action.department]
        candidates = [*direct, *ranked_all]
        for row in candidates:
            if len(existing) >= 4:
                break
            rendered = _render_research_row(row)
            if not rendered:
                continue
            ident = _row_identity(row)
            if ident in used:
                continue
            existing.append(rendered)
            used.add(ident)

        action.external_evidence = existing[:4]

    if enriched.evidence_summary:
        enriched.evidence_summary = [
            item for item in enriched.evidence_summary if not looks_like_placeholder_evidence(item)
        ]
    if len(enriched.evidence_summary) < 3:
        for row in ranked_all:
            rendered = _render_research_row(row)
            if rendered and _evidence_identity(rendered) not in {_evidence_identity(x) for x in enriched.evidence_summary}:
                enriched.evidence_summary.append(rendered)
            if len(enriched.evidence_summary) >= 5:
                break

    return enriched


def _strip_placeholder_external_evidence(plan: WarRoomPlan) -> WarRoomPlan:
    stripped = plan.model_copy(deep=True)
    for action in stripped.department_actions:
        action.external_evidence = [
            item
            for item in action.external_evidence
            if _clean_text(item) and not looks_like_placeholder_evidence(item)
        ]
    stripped.evidence_summary = [
        item
        for item in stripped.evidence_summary
        if _clean_text(item) and not looks_like_placeholder_evidence(item)
    ]
    return stripped


async def enrich_record_war_room_plan_with_research(
    session: AsyncSession,
    *,
    record_id: str,
    research_rows: Iterable[object],
) -> WarRoomPlan | None:
    """Persist research-enriched record/project War Room plans.

    Best-effort by design: callers can keep delivering the original diagnosis if
    enrichment fails.
    """

    record = await session.get(DiagnosisRecord, record_id)
    if record is None or not record.war_room_plan_json:
        return None

    try:
        plan = WarRoomPlan.model_validate_json(record.war_room_plan_json)
    except ValueError:
        return None

    enriched = enrich_war_room_plan_with_research(plan, research_rows)
    record.war_room_plan_json = enriched.model_dump_json()
    session.add(record)
    await session.commit()

    if record.project_id and record.review_status == "approved":
        project = await session.get(Project, record.project_id)
        if project is not None:
            from app.warroom.history import get_or_build_project_war_room_plan

            project_plan = await get_or_build_project_war_room_plan(session, project)
            if project_plan is not None:
                return project_plan
    return enriched


def looks_like_placeholder_evidence(value: object) -> bool:
    text = _clean_text(value).lower()
    if not text:
        return True
    return any(marker in text for marker in _PLACEHOLDER_MARKERS)


def _render_research_row(row: object) -> str:
    title = _clean_text(_row_title(row))
    url = _clean_text(_row_url(row))
    snippet = _clean_snippet(getattr(row, "snippet", ""))
    if not title and not snippet:
        return ""
    if snippet and title:
        body = f"{title}：{snippet}"
    else:
        body = title or snippet
    if url:
        return f"{body}（{url}）"
    return body


def _clean_snippet(value: object, limit: int = 140) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    text = text.replace("...", "。").replace("…", "。")
    pieces = [piece.strip() for piece in text.split("。") if piece.strip()]
    selected = "。".join(pieces[:2]) if pieces else text
    if len(selected) > limit:
        selected = f"{selected[:limit].rstrip()}..."
    return selected


def _row_score(row: object) -> float:
    raw = _row_raw(row)
    relevance = float(raw.get("relevance_score") or 0)
    credibility = float(getattr(row, "credibility", 0) or 0)
    stage_bonus = 1.5 if getattr(row, "source_stage", "") == "expert_supplemental_research" else 0
    direct_bonus = 1.0 if raw.get("relevance_bucket") == "project_direct" else 0
    return relevance + credibility * 5 + stage_bonus + direct_bonus


def _row_raw(row: object) -> dict:
    raw_json = getattr(row, "raw_json", "") or "{}"
    try:
        payload = json.loads(raw_json)
    except Exception:  # noqa: BLE001
        return {}
    return payload if isinstance(payload, dict) else {}


def _row_module(row: object) -> str:
    return _clean_text(getattr(row, "module", ""))


def _row_title(row: object) -> str:
    return _clean_text(getattr(row, "title", ""))


def _row_url(row: object) -> str:
    return _clean_text(getattr(row, "url", ""))


def _row_identity(row: object) -> str:
    return _row_url(row) or _row_title(row)


def _evidence_identity(value: object) -> str:
    text = _clean_text(value)
    start = text.rfind("（http")
    if start >= 0 and text.endswith("）"):
        return text[start + 1 : -1]
    return text


def _clean_text(value: object) -> str:
    return " ".join(str(value or "").replace("\r\n", "\n").split()).strip()
