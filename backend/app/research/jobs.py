from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.cases.archiver import archive_case
from app.config import get_llm_client
from app.db.database import AsyncSessionLocal
from app.db.models import DiagnosisJob, User
from app.models.questionnaire import Questionnaire
from app.models.warroom import WarRoomPlan
from app.llm.base import LLMClient
from app.orchestrator.dispatcher import diagnose_all
from app.warroom.composer import compose_war_room_plan
from app.warroom.enhancer import enhance_war_room_plan
from app.api.diagnose import _link_session, _merge_stored_files

from . import engine, supplement
from .store import attach_evidence_to_record, list_job_evidence, render_evidence_for_prompt


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


async def run_deep_diligence_job(
    job_id: str,
    sessionmaker=AsyncSessionLocal,
    llm: LLMClient | None = None,
) -> None:
    async with sessionmaker() as session:
        job = await session.get(DiagnosisJob, job_id)
        if job is None:
            return
        try:
            questionnaire = Questionnaire.model_validate_json(job.questionnaire_json)
            await _update_job(session, job, status="collecting_data", current_step="合并上传文件", progress=0.08)
            await _merge_stored_files(session, questionnaire)

            await _update_job(session, job, status="researching", current_step="系统预研外部证据", progress=0.18)
            await engine.run_system_pre_research(
                session,
                job_id=job.id,
                project_id=job.project_id,
                questionnaire=questionnaire,
            )
            evidence_rows = await list_job_evidence(session, job.id, limit=160)
            research_evidence = render_evidence_for_prompt(evidence_rows)

            await _update_job(session, job, status="diagnosing", current_step="多专家并行诊断", progress=0.45)
            llm = llm or await get_llm_client(session)
            outcome = await diagnose_all(
                questionnaire,
                llm,
                session,
                research_evidence=research_evidence,
            )
            research_questions = supplement.collect_expert_research_questions(outcome.results)
            if research_questions:
                await _update_job(session, job, status="researching", current_step="专家补充追搜", progress=0.58)
                await supplement.run_expert_supplemental_research(
                    session,
                    job_id=job.id,
                    project_id=job.project_id,
                    research_questions=research_questions,
                )
                evidence_rows = await list_job_evidence(session, job.id, limit=200)
                research_evidence = render_evidence_for_prompt(evidence_rows)
                await _update_job(session, job, status="diagnosing", current_step="专家基于补充证据复判", progress=0.64)
                outcome = await diagnose_all(
                    questionnaire,
                    llm,
                    session,
                    research_evidence=research_evidence,
                )

            await _update_job(session, job, status="composing_war_room", current_step="生成作战室草稿", progress=0.72)
            war_room_plan = compose_war_room_plan(
                questionnaire,
                outcome.results,
                outcome.triage,
                outcome.skill_version_ids,
            )
            war_room_plan = await enhance_war_room_plan(war_room_plan, outcome.results, llm)
            record_id, war_room_plan = await _save_job_history(
                session,
                job,
                questionnaire,
                outcome.results,
                outcome.triage,
                war_room_plan,
            )
            if record_id:
                await attach_evidence_to_record(session, job_id=job.id, record_id=record_id)
                evidence_rows = await list_job_evidence(session, job.id, limit=200)
            await archive_case(session, questionnaire, outcome.results, outcome.triage, record_id)

            job.record_id = record_id
            job.status = "pending_review" if record_id else "anonymous_complete"
            job.current_step = "顾问审核中" if record_id else "诊断完成"
            job.progress = 1
            job.result_summary_json = json.dumps(
                {
                    "record_id": record_id,
                    "triage": outcome.triage.model_dump(),
                    "war_room_plan": war_room_plan.model_dump(),
                    "research_evidence_count": len(evidence_rows),
                    "skill_version_ids": outcome.skill_version_ids,
                },
                ensure_ascii=False,
                default=str,
            )
            job.updated_at = utc_now()
            session.add(job)
            await session.commit()
        except Exception as exc:  # noqa: BLE001
            await _mark_failed(session, job, exc)


async def _update_job(
    session: AsyncSession,
    job: DiagnosisJob,
    *,
    status: str,
    current_step: str,
    progress: float,
) -> None:
    job.status = status
    job.current_step = current_step
    job.progress = progress
    job.updated_at = utc_now()
    session.add(job)
    await session.commit()


async def _mark_failed(session: AsyncSession, job: DiagnosisJob, exc: Exception) -> None:
    job.status = "failed"
    job.current_step = "任务失败"
    job.error = f"{exc.__class__.__name__}: {exc}"
    job.updated_at = utc_now()
    session.add(job)
    await session.commit()


async def _save_job_history(
    session: AsyncSession,
    job: DiagnosisJob,
    questionnaire: Questionnaire,
    results,
    triage,
    war_room_plan: WarRoomPlan,
) -> tuple[str | None, WarRoomPlan]:
    from app.api.diagnose import _save_history

    user = await session.get(User, job.user_id) if job.user_id else None
    record_id, saved_plan = await _save_history(
        session,
        user,
        questionnaire,
        results,
        triage,
        war_room_plan,
    )
    if questionnaire.session_id:
        await _link_session(session, questionnaire.session_id, record_id)
    return record_id, saved_plan
