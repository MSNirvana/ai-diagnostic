import json

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import get_optional_user
from app.config import get_llm_client
from app.db.database import AsyncSessionLocal, get_session
from app.db.models import DiagnosisJob, User
from app.llm.base import LLMClient
from app.models.questionnaire import Questionnaire
from app.research.jobs import run_deep_diligence_job
from app.research.store import list_job_evidence

router = APIRouter(prefix="/diagnosis-jobs")


class CreateDiagnosisJobResponse(BaseModel):
    job_id: str
    status: str


class DiagnosisJobStatus(BaseModel):
    id: str
    status: str
    current_step: str
    progress: float
    record_id: str | None = None
    project_id: str | None = None
    error: str | None = None
    result_summary: dict | None = None


class ResearchEvidenceOut(BaseModel):
    id: str
    module: str
    source_stage: str
    provider: str
    query: str
    title: str
    url: str
    snippet: str
    source_type: str
    credibility: float
    retrieved_at: str


@router.post("/", response_model=CreateDiagnosisJobResponse, status_code=202)
async def create_diagnosis_job(
    questionnaire: Questionnaire,
    background_tasks: BackgroundTasks,
    user: User | None = Depends(get_optional_user),
    llm: LLMClient = Depends(get_llm_client),
    session: AsyncSession = Depends(get_session),
) -> CreateDiagnosisJobResponse:
    job = DiagnosisJob(
        user_id=user.id if user else None,
        project_id=questionnaire.project_id,
        session_id=questionnaire.session_id,
        questionnaire_json=questionnaire.model_dump_json(),
        status="queued",
        current_step="等待深度尽调启动",
        progress=0,
    )
    session.add(job)
    await session.commit()
    # The user-scoped GGOO client stays in memory for this in-process job. No
    # access token or model key is persisted in Build's independent database.
    background_tasks.add_task(run_deep_diligence_job, job.id, AsyncSessionLocal, llm)
    return CreateDiagnosisJobResponse(job_id=job.id, status=job.status)


@router.get("/session/{session_id}/latest", response_model=DiagnosisJobStatus | None)
async def get_latest_session_diagnosis_job(
    session_id: str,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> DiagnosisJobStatus | None:
    stmt = (
        select(DiagnosisJob)
        .where(DiagnosisJob.session_id == session_id)
        .order_by(DiagnosisJob.created_at.desc())
        .limit(1)
    )
    job = await session.scalar(stmt)
    if job is None:
        return None
    if job.user_id and (user is None or user.id != job.user_id):
        return None
    return _job_status(job)


@router.get("/{job_id}", response_model=DiagnosisJobStatus)
async def get_diagnosis_job(
    job_id: str,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> DiagnosisJobStatus:
    job = await _load_job(session, job_id, user)
    return _job_status(job)


@router.get("/{job_id}/evidence", response_model=list[ResearchEvidenceOut])
async def get_diagnosis_job_evidence(
    job_id: str,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> list[ResearchEvidenceOut]:
    job = await _load_job(session, job_id, user)
    rows = await list_job_evidence(session, job.id, limit=200)
    return [
        ResearchEvidenceOut(
            id=row.id,
            module=row.module,
            source_stage=row.source_stage,
            provider=row.provider,
            query=row.query,
            title=row.title,
            url=row.url,
            snippet=row.snippet,
            source_type=row.source_type,
            credibility=row.credibility,
            retrieved_at=row.retrieved_at.isoformat(),
        )
        for row in rows
    ]


async def _load_job(
    session: AsyncSession,
    job_id: str,
    user: User | None,
) -> DiagnosisJob:
    job = await session.get(DiagnosisJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="尽调任务不存在")
    if job.user_id and (user is None or user.id != job.user_id):
        raise HTTPException(status_code=404, detail="尽调任务不存在")
    return job


def _job_status(job: DiagnosisJob) -> DiagnosisJobStatus:
    result_summary = None
    if job.result_summary_json:
        try:
            result_summary = json.loads(job.result_summary_json)
        except Exception:
            result_summary = None
    return DiagnosisJobStatus(
        id=job.id,
        status=job.status,
        current_step=job.current_step,
        progress=job.progress,
        record_id=job.record_id,
        project_id=job.project_id,
        error=job.error,
        result_summary=result_summary,
    )
