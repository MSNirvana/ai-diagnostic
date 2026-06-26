"""顾问审核端点（诊断流水线阶段4）。

伪异步：机器诊断完成即 pending_review，顾问在后台审核通过后老板才看到完整报告。
- 列表按 SLA 剩余时间排序（越紧急越靠前），24h SLA
- 审核操作：通过 / 打回 / 补充注释
- 早期统一队列，预留 assigned_to 分派字段

第一期不做鉴权 UI（与 admin 一致），但端点要求登录用户。
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_session
from app.db.models import DiagnosisRecord
from app.db.models import Project
from app.research.store import list_record_evidence
from app.warroom.history import get_or_build_project_war_room_plan

from app.auth.jwt import require_admin

router = APIRouter(prefix="/admin/review", dependencies=[Depends(require_admin)])

SLA_HOURS = 24


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ReviewQueueItem(BaseModel):
    record_id: str
    user_id: str
    primary_module: str
    created_at: str
    sla_deadline: str
    hours_remaining: float
    overdue: bool
    assigned_to: str | None


class ReviewDetail(BaseModel):
    record_id: str
    review_status: str
    primary_module: str
    results: list[dict]
    war_room_plan: dict | None
    consultant_notes: list[str]
    created_at: str
    evidence_pack: list[dict] = []


class ReviewAction(BaseModel):
    action: str                 # approve | reject | annotate
    notes: list[str] = []       # 顾问补充判断
    reviewer: str | None = None


def _sla_fields(created_at: datetime) -> tuple[datetime, float, bool]:
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    deadline = created_at + timedelta(hours=SLA_HOURS)
    remaining = (deadline - _now()).total_seconds() / 3600
    return deadline, round(remaining, 1), remaining < 0


@router.get("/queue", response_model=list[ReviewQueueItem])
async def review_queue(session: AsyncSession = Depends(get_session)):
    """待审核队列，按 SLA 剩余时间升序（越紧急越靠前）。"""
    rows = list(await session.scalars(
        select(DiagnosisRecord)
        .where(DiagnosisRecord.review_status == "pending_review")
        .order_by(DiagnosisRecord.created_at.asc())
    ))
    items: list[ReviewQueueItem] = []
    for r in rows:
        deadline, remaining, overdue = _sla_fields(r.created_at)
        items.append(ReviewQueueItem(
            record_id=r.id,
            user_id=r.user_id,
            primary_module=r.primary_module or "",
            created_at=str(r.created_at),
            sla_deadline=str(deadline),
            hours_remaining=remaining,
            overdue=overdue,
            assigned_to=r.assigned_to,
        ))
    # 已超期的排最前
    items.sort(key=lambda x: x.hours_remaining)
    return items


@router.get("/{record_id}", response_model=ReviewDetail)
async def review_detail(record_id: str, session: AsyncSession = Depends(get_session)):
    """取一条诊断的完整内容供审核。"""
    r = await session.get(DiagnosisRecord, record_id)
    if r is None:
        raise HTTPException(status_code=404, detail="诊断记录不存在")
    try:
        results = json.loads(r.results_json)
    except Exception:
        results = []
    war_room = None
    if r.war_room_plan_json:
        try:
            war_room = json.loads(r.war_room_plan_json)
        except Exception:
            war_room = None
    notes = []
    if r.consultant_notes_json:
        try:
            notes = json.loads(r.consultant_notes_json)
        except Exception:
            notes = []
    evidence_rows = await list_record_evidence(session, r.id, limit=200)
    return ReviewDetail(
        record_id=r.id,
        review_status=r.review_status,
        primary_module=r.primary_module or "",
        results=results,
        war_room_plan=war_room,
        consultant_notes=notes,
        created_at=str(r.created_at),
        evidence_pack=[
            {
                "id": row.id,
                "job_id": row.job_id,
                "project_id": row.project_id,
                "record_id": row.record_id,
                "module": row.module,
                "source_stage": row.source_stage,
                "provider": row.provider,
                "query": row.query,
                "title": row.title,
                "url": row.url,
                "snippet": row.snippet,
                "source_type": row.source_type,
                "credibility": row.credibility,
                "retrieved_at": row.retrieved_at.isoformat(),
            }
            for row in evidence_rows
        ],
    )


@router.post("/{record_id}", response_model=ReviewDetail)
async def submit_review(
    record_id: str,
    body: ReviewAction,
    session: AsyncSession = Depends(get_session),
):
    """顾问审核：通过 / 打回 / 补充注释。"""
    r = await session.get(DiagnosisRecord, record_id)
    if r is None:
        raise HTTPException(status_code=404, detail="诊断记录不存在")

    if body.notes:
        existing = []
        if r.consultant_notes_json:
            try:
                existing = json.loads(r.consultant_notes_json)
            except Exception:
                existing = []
        existing.extend(body.notes)
        r.consultant_notes_json = json.dumps(existing, ensure_ascii=False)

    if body.action == "approve":
        r.review_status = "approved"
        r.reviewed_by = body.reviewer
        r.reviewed_at = _now()
        await _publish_project_war_room_iteration(session, r)
    elif body.action == "reject":
        r.review_status = "rejected"
        r.reviewed_by = body.reviewer
        r.reviewed_at = _now()
    elif body.action == "annotate":
        pass  # 只追加注释，不改状态
    else:
        raise HTTPException(status_code=400, detail=f"未知操作: {body.action}")

    session.add(r)
    await session.commit()
    return await review_detail(record_id, session)


async def _publish_project_war_room_iteration(
    session: AsyncSession,
    record: DiagnosisRecord,
) -> None:
    """审核通过后，按所有 approved 记录重建老板侧项目作战室。"""
    if not record.project_id:
        return
    project = await session.get(Project, record.project_id)
    if project is None:
        return
    project.war_room_plan_json = None
    session.add(project)
    await session.flush()
    await get_or_build_project_war_room_plan(session, project)
