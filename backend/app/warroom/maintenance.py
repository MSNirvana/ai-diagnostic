from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DiagnosisRecord, Project
from app.models.warroom import WarRoomPlan
from app.warroom.normalizer import normalize_war_room_plan


@dataclass
class WarRoomNormalizationSummary:
    records_seen: int = 0
    records_updated: int = 0
    projects_seen: int = 0
    projects_updated: int = 0
    changed_records: list[str] = field(default_factory=list)
    changed_projects: list[str] = field(default_factory=list)


async def normalize_persisted_war_room_plans(
    session: AsyncSession,
) -> WarRoomNormalizationSummary:
    """Normalize persisted war_room_plan JSON without changing diagnosis content."""
    summary = WarRoomNormalizationSummary()

    records = list(await session.scalars(select(DiagnosisRecord).order_by(DiagnosisRecord.created_at.asc())))
    for record in records:
        summary.records_seen += 1
        if not record.war_room_plan_json:
            continue
        after = _normalize_json(record.war_room_plan_json)
        if after and after != record.war_room_plan_json:
            record.war_room_plan_json = after
            session.add(record)
            summary.records_updated += 1
            summary.changed_records.append(record.id)

    projects = list(await session.scalars(select(Project).order_by(Project.created_at.asc())))
    for project in projects:
        summary.projects_seen += 1
        if not project.war_room_plan_json:
            continue
        after = _normalize_json(project.war_room_plan_json)
        if after and after != project.war_room_plan_json:
            project.war_room_plan_json = after
            session.add(project)
            summary.projects_updated += 1
            summary.changed_projects.append(project.id)

    await session.commit()
    return summary


def _normalize_json(raw: str) -> str | None:
    try:
        plan = WarRoomPlan.model_validate_json(raw)
    except ValueError:
        return None
    return normalize_war_room_plan(plan).model_dump_json()
