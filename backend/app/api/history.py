import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import get_current_user
from app.db.database import get_session
from app.db.models import User, DiagnosisRecord

router = APIRouter(prefix="/history")


class HistorySummary(BaseModel):
    id: str
    created_at: datetime
    module_count: int


class HistoryDetail(BaseModel):
    id: str
    created_at: datetime
    answers: dict
    results: list
    profile: dict | None = None


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
    summaries: list[HistorySummary] = []
    for r in records:
        answers = json.loads(r.answers_json)
        module_count = len(answers.get("answers", []))
        summaries.append(
            HistorySummary(id=r.id, created_at=r.created_at, module_count=module_count)
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
    return HistoryDetail(
        id=record.id,
        created_at=record.created_at,
        answers=json.loads(record.answers_json),
        results=json.loads(record.results_json),
        profile=json.loads(record.profile_json) if record.profile_json else None,
    )
