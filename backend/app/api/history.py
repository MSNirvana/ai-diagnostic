import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import get_current_user
from app.db.database import get_session
from app.db.models import User, DiagnosisRecord, Project
from app.skills.skill_network import skill_label
from app.warroom.history import get_or_build_war_room_plan

router = APIRouter(prefix="/history")


class HistorySummary(BaseModel):
    id: str
    created_at: datetime
    module_count: int
    review_status: str = "approved"   # 老板侧据此显示"待审核/已出报告"
    project_id: str | None = None
    project_name: str = "未归档项目"
    stage: str = ""
    primary_module: str = ""
    primary_module_label: str = ""


class HistoryDetail(BaseModel):
    id: str
    created_at: datetime
    answers: dict
    results: list
    war_room_plan: dict | None = None
    profile: dict | None = None
    review_status: str = "approved"
    consultant_notes: list[str] = []


@router.get("/", response_model=list[HistorySummary])
async def list_history(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[HistorySummary]:
    stmt = (
        select(DiagnosisRecord)
        .where(DiagnosisRecord.user_id == user.id)
        .order_by(DiagnosisRecord.created_at.desc())
    )
    records = (await session.scalars(stmt)).all()
    project_ids = sorted({r.project_id for r in records if r.project_id})
    projects: dict[str, Project] = {}
    if project_ids:
        project_rows = (
            await session.scalars(select(Project).where(Project.id.in_(project_ids)))
        ).all()
        projects = {p.id: p for p in project_rows}
    summaries: list[HistorySummary] = []
    for r in records:
        answers = json.loads(r.answers_json)
        module_count = len(answers.get("answers", []))
        problem_map = answers.get("problem_map") or {}
        if not isinstance(problem_map, dict):
            problem_map = {}
        project = projects.get(r.project_id or "")
        primary_module = r.primary_module or str(problem_map.get("diagnosis_focus") or "")
        summaries.append(
            HistorySummary(
                id=r.id,
                created_at=r.created_at,
                module_count=module_count,
                review_status=r.review_status,
                project_id=r.project_id,
                project_name=project.name if project else "未归档项目",
                stage=str(problem_map.get("stage") or ""),
                primary_module=primary_module,
                primary_module_label=skill_label(primary_module) if primary_module else "",
            )
        )
    return summaries


@router.get("/{record_id}", response_model=HistoryDetail)
async def get_history(
    record_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> HistoryDetail:
    record = await session.get(DiagnosisRecord, record_id)
    if record is None or record.user_id != user.id:
        raise HTTPException(status_code=404, detail="记录不存在")
    war_room_plan = None
    if record.review_status == "approved":
        war_room_plan = await get_or_build_war_room_plan(session, record)
    notes = []
    if record.consultant_notes_json:
        try:
            notes = json.loads(record.consultant_notes_json)
        except Exception:
            notes = []
    return HistoryDetail(
        id=record.id,
        created_at=record.created_at,
        answers=json.loads(record.answers_json),
        results=json.loads(record.results_json),
        war_room_plan=war_room_plan.model_dump() if war_room_plan else None,
        profile=json.loads(record.profile_json) if record.profile_json else None,
        review_status=record.review_status,
        consultant_notes=notes,
    )
