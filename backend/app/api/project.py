"""项目（持续诊断档案）端点。

一个用户可有多个项目，每个项目沉淀其下所有诊断会话与诊断记录，
随时间持续更新——这是从一次性诊断走向持续诊断的载体。
"""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import get_current_user
from app.db.database import get_session
from app.db.models import User, Project, DiagnosisSession, DiagnosisRecord, ProjectMemoryEntry

router = APIRouter(prefix="/project")


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CreateProjectRequest(BaseModel):
    name: str


class ProjectSummary(BaseModel):
    id: str
    name: str
    created_at: datetime
    updated_at: datetime
    status: str
    memory_summary: str = ""


class MemoryEntryOut(BaseModel):
    id: str
    created_at: datetime
    entry_type: str
    summary: str
    payload: dict
    source_id: str | None = None


class SessionBrief(BaseModel):
    id: str
    title: str
    status: str
    updated_at: datetime


class RecordBrief(BaseModel):
    id: str
    created_at: datetime
    module_count: int


class ProjectDetail(BaseModel):
    id: str
    name: str
    created_at: datetime
    updated_at: datetime
    status: str
    memory_summary: str
    memory_entries: list[MemoryEntryOut]
    sessions: list[SessionBrief]
    records: list[RecordBrief]


class PatchProjectRequest(BaseModel):
    name: str | None = None
    status: str | None = None


@router.post("/", response_model=ProjectSummary, status_code=201)
async def create_project(
    body: CreateProjectRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProjectSummary:
    p = Project(user_id=user.id, name=body.name.strip() or "未命名项目")
    session.add(p)
    await session.commit()
    await session.refresh(p)
    return ProjectSummary(
        id=p.id, name=p.name, created_at=p.created_at,
        updated_at=p.updated_at, status=p.status, memory_summary=p.memory_summary,
    )


@router.get("/", response_model=list[ProjectSummary])
async def list_projects(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ProjectSummary]:
    stmt = (
        select(Project)
        .where(Project.user_id == user.id)
        .order_by(Project.updated_at.desc())
    )
    rows = (await session.scalars(stmt)).all()
    return [
        ProjectSummary(
            id=p.id, name=p.name, created_at=p.created_at,
            updated_at=p.updated_at, status=p.status, memory_summary=p.memory_summary,
        )
        for p in rows
    ]


@router.get("/{project_id}", response_model=ProjectDetail)
async def get_project(
    project_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProjectDetail:
    p = await session.get(Project, project_id)
    if p is None or p.user_id != user.id:
        raise HTTPException(status_code=404, detail="项目不存在")

    sess_stmt = (
        select(DiagnosisSession)
        .where(DiagnosisSession.project_id == project_id)
        .order_by(DiagnosisSession.updated_at.desc())
    )
    sessions = [
        SessionBrief(id=s.id, title=s.title or "未命名会话", status=s.status, updated_at=s.updated_at)
        for s in (await session.scalars(sess_stmt)).all()
    ]

    rec_stmt = (
        select(DiagnosisRecord)
        .where(DiagnosisRecord.project_id == project_id)
        .order_by(DiagnosisRecord.created_at.desc())
    )
    records = []
    for r in (await session.scalars(rec_stmt)).all():
        try:
            answers = json.loads(r.answers_json)
            mc = len(answers.get("answers", []))
        except (ValueError, TypeError):
            mc = 0
        records.append(RecordBrief(id=r.id, created_at=r.created_at, module_count=mc))

    mem_stmt = (
        select(ProjectMemoryEntry)
        .where(ProjectMemoryEntry.project_id == project_id)
        .order_by(ProjectMemoryEntry.created_at.desc())
    )
    memory_entries: list[MemoryEntryOut] = []
    for entry in (await session.scalars(mem_stmt)).all():
        try:
            payload = json.loads(entry.payload_json)
        except (ValueError, TypeError):
            payload = {}
        memory_entries.append(
            MemoryEntryOut(
                id=entry.id,
                created_at=entry.created_at,
                entry_type=entry.entry_type,
                summary=entry.summary,
                payload=payload,
                source_id=entry.source_id,
            )
        )

    return ProjectDetail(
        id=p.id, name=p.name, created_at=p.created_at, updated_at=p.updated_at,
        status=p.status, memory_summary=p.memory_summary,
        memory_entries=memory_entries,
        sessions=sessions, records=records,
    )


@router.patch("/{project_id}", response_model=ProjectSummary)
async def patch_project(
    project_id: str,
    body: PatchProjectRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProjectSummary:
    p = await session.get(Project, project_id)
    if p is None or p.user_id != user.id:
        raise HTTPException(status_code=404, detail="项目不存在")
    if body.name is not None:
        p.name = body.name.strip() or p.name
    if body.status is not None and body.status in ("active", "archived"):
        p.status = body.status
    p.updated_at = _now()
    session.add(p)
    await session.commit()
    await session.refresh(p)
    return ProjectSummary(
        id=p.id, name=p.name, created_at=p.created_at,
        updated_at=p.updated_at, status=p.status, memory_summary=p.memory_summary,
    )
