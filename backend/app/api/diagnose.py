import json
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_llm_client
from app.llm.base import LLMClient
from app.memory.project_memory import (
    append_diagnosis_memory,
    append_feedback_memory,
    append_problem_map_memory,
)
from app.memory.archive_refiner import refine_questionnaire_archive
from app.models.questionnaire import Questionnaire
from app.models.result import ModuleResult, TriageSummary
from app.models.warroom import WarRoomPlan
from app.orchestrator.dispatcher import diagnose_all
from app.research.engine import gather_pre_research_evidence
from app.research.store import attach_evidence_to_record, list_job_evidence
from app.warroom.composer import compose_war_room_plan
from app.warroom.enhancer import enhance_war_room_plan
from app.warroom.research_enrichment import enrich_record_war_room_plan_with_research
from app.cases.archiver import archive_case
from app.warroom.history import (
    apply_project_war_room_iteration,
    get_or_build_project_war_room_plan,
)
from app.data.uploads import parse_uploaded_file, render_file_summary
from app.auth.jwt import get_optional_user
from app.db.database import get_session
from app.db.models import User, DiagnosisRecord, DiagnosisFeedback, DiagnosisSession, Project, UploadedFile
from sqlalchemy import select

router = APIRouter()


class DiagnoseResponse(BaseModel):
    results: list[ModuleResult]
    record_id: str | None = None
    skill_version_ids: dict[str, str] = Field(default_factory=dict)
    triage: TriageSummary = Field(default_factory=TriageSummary)
    war_room_plan: WarRoomPlan
    review_status: str = "pending_review"   # 老板侧据此显示"待审核/已出报告"

async def _merge_stored_files(
    session: AsyncSession, questionnaire: Questionnaire
) -> None:
    """诊断前，把该会话已存文件的解析摘要合并进对应模块的 facts。

    文件选完即已上传并解析（UploadedFile.parsed_summary），这里直接复用，
    无需请求带文件——跨设备恢复也能用到之前上传的文件。
    """
    sid = questionnaire.session_id
    if not sid:
        return
    stmt = select(UploadedFile).where(UploadedFile.session_id == sid)
    files = list(await session.scalars(stmt))
    if not files:
        return
    by_module = {ans.module: ans for ans in questionnaire.answers}
    for f in files:
        answer = by_module.get(f.module_key)
        if answer is None:
            continue
        answer.facts[f"{f.field_key}_file_{f.original_name}"] = f.parsed_summary


async def _save_history(
    session: AsyncSession,
    user: User | None,
    questionnaire: Questionnaire,
    results: list[ModuleResult],
    triage: TriageSummary,
    war_room_plan: WarRoomPlan,
    profile_json: str | None = None,
) -> tuple[str | None, WarRoomPlan]:
    """已登录用户的诊断写入历史记录，返回 record_id；匿名用户返回 None。

    若 questionnaire 带了 session_id，则把诊断记录回关到对应的诊断会话
    （记忆文件），让"对话→诊断结果"形成完整闭环。
    """
    sid = questionnaire.session_id
    if user is None:
        # 匿名也回填 session 状态（如果有），但不建历史记录
        if sid:
            await _link_session(session, sid, None)
        return None, war_room_plan
    record = DiagnosisRecord(
        user_id=user.id,
        answers_json=questionnaire.model_dump_json(),
        results_json=json.dumps([r.model_dump() for r in results], ensure_ascii=False),
        profile_json=profile_json,
        session_id=sid,
        project_id=questionnaire.project_id,
        # 审核可选：默认 approved（诊断完成即出给老板看，零等待）；勾选请顾问复核才进 pending_review。
        review_status="pending_review" if questionnaire.request_review else "approved",
        primary_module=triage.primary_module or "",  # 用于审核分派
    )
    war_room_plan.record_id = record.id
    record.war_room_plan_json = war_room_plan.model_dump_json()
    session.add(record)
    await session.commit()
    if sid:
        await _link_session(session, sid, record.id)
    if questionnaire.project_id:
        project_plan = await apply_project_war_room_iteration(
            session,
            questionnaire.project_id,
            record,
            war_room_plan,
        )
        if project_plan is not None:
            war_room_plan = project_plan
        if questionnaire.problem_map:
            await append_problem_map_memory(
                session,
                project_id=questionnaire.project_id,
                problem_map=questionnaire.problem_map,
                user_id=user.id,
                source_id=sid or record.id,
            )
        await append_diagnosis_memory(
            session,
            project_id=questionnaire.project_id,
            results=results,
            triage=triage,
            user_id=user.id,
            source_id=record.id,
        )
        await refine_questionnaire_archive(
            session,
            project_id=questionnaire.project_id,
            questionnaire=questionnaire,
            results=results,
            llm=None,
            user_id=user.id,
            source_id=record.id,
        )
        await session.commit()
    return record.id, war_room_plan


async def _link_session(
    session: AsyncSession, session_id: str, record_id: str | None
) -> None:
    """把诊断记录关联回诊断会话，并标记会话已完成诊断。"""
    s = await session.get(DiagnosisSession, session_id)
    if s is None:
        return
    if record_id:
        s.diagnosis_record_id = record_id
    s.status = "diagnosed"
    session.add(s)
    await session.commit()


@router.post("/diagnose", response_model=DiagnoseResponse)
async def diagnose(
    questionnaire: Questionnaire,
    llm: LLMClient = Depends(get_llm_client),
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> DiagnoseResponse:
    await _merge_stored_files(session, questionnaire)
    # 外部预研（best-effort）：先上网搜行业基准/竞品/政策/口碑，喂进诊断并作为结论来源。无 key/失败→空，不阻断。
    research_job_id = uuid.uuid4().hex
    research_evidence = await gather_pre_research_evidence(
        session, questionnaire, job_id=research_job_id, project_id=questionnaire.project_id, llm=llm,
    )
    outcome = await diagnose_all(questionnaire, llm, session, research_evidence=research_evidence)
    war_room_plan = compose_war_room_plan(
        questionnaire,
        outcome.results,
        outcome.triage,
        outcome.skill_version_ids,
    )
    war_room_plan = await enhance_war_room_plan(war_room_plan, outcome.results, llm, session)
    record_id, war_room_plan = await _save_history(
        session,
        user,
        questionnaire,
        outcome.results,
        outcome.triage,
        war_room_plan,
    )
    if not war_room_plan.record_id:
        war_room_plan.record_id = record_id
    if record_id and research_evidence:
        await attach_evidence_to_record(session, job_id=research_job_id, record_id=record_id)
        evidence_rows = await list_job_evidence(session, research_job_id, limit=200)
        enriched_plan = await enrich_record_war_room_plan_with_research(
            session,
            record_id=record_id,
            research_rows=evidence_rows,
        )
        if enriched_plan is not None:
            war_room_plan = enriched_plan
    # Loop 3 案例飞轮：脱敏归档为可复用案例资产（旁路，失败不影响返回）
    await archive_case(session, questionnaire, outcome.results, outcome.triage, record_id)
    return DiagnoseResponse(
        results=outcome.results,
        record_id=record_id,
        skill_version_ids=outcome.skill_version_ids,
        triage=outcome.triage,
        war_room_plan=war_room_plan,
        # 审核可选默认不选：请了复核→pending_review；否则登录用户即 approved（立即可见）；匿名无记录→anonymous
        review_status=(
            "pending_review" if (record_id and questionnaire.request_review)
            else "approved" if record_id else "anonymous"
        ),
    )


@router.post("/diagnose/upload", response_model=DiagnoseResponse)
async def diagnose_with_upload(
    answers_json: str = Form(...),
    files: list[UploadFile] = File(default=[]),
    llm: LLMClient = Depends(get_llm_client),
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> DiagnoseResponse:
    """支持文件上传的诊断端点。

    answers_json 是 Questionnaire 的 JSON 字符串；files 的文件名格式为
    "{moduleKey}_{原名}"，据此把解析后的表格数据合并进对应模块的 facts。
    """
    questionnaire = Questionnaire.model_validate_json(answers_json)
    answers_by_module = {ans.module: ans for ans in questionnaire.answers}

    for upload in files:
        if not upload.filename:
            continue
        content = await upload.read()
        # 文件名格式：三段 {moduleKey}_{fieldKey}_{原名}（字段级上传），
        # 或两段 {moduleKey}_{原名}（旧的模块级，向后兼容）
        parts = upload.filename.split("_", 2)
        module_key = parts[0]
        if len(parts) == 3:
            field_key, original = parts[1], parts[2]
            facts_key = f"{field_key}_file_{original}"
        else:
            facts_key = f"file_{upload.filename}"
        answer = answers_by_module.get(module_key)
        if answer is None:
            continue
        parsed = parse_uploaded_file(upload.filename, content)
        answer.facts[facts_key] = render_file_summary(upload.filename, parsed)
        answer.uploaded_files.append(upload.filename)

    # 合并该会话已存文件（之前即时上传的）
    await _merge_stored_files(session, questionnaire)
    # 外部预研（best-effort）：先上网搜行业基准/竞品/政策/口碑，喂进诊断并作为结论来源。无 key/失败→空，不阻断。
    research_job_id = uuid.uuid4().hex
    research_evidence = await gather_pre_research_evidence(
        session, questionnaire, job_id=research_job_id, project_id=questionnaire.project_id, llm=llm,
    )
    outcome = await diagnose_all(questionnaire, llm, session, research_evidence=research_evidence)
    war_room_plan = compose_war_room_plan(
        questionnaire,
        outcome.results,
        outcome.triage,
        outcome.skill_version_ids,
    )
    war_room_plan = await enhance_war_room_plan(war_room_plan, outcome.results, llm, session)
    record_id, war_room_plan = await _save_history(
        session,
        user,
        questionnaire,
        outcome.results,
        outcome.triage,
        war_room_plan,
    )
    if not war_room_plan.record_id:
        war_room_plan.record_id = record_id
    if record_id and research_evidence:
        await attach_evidence_to_record(session, job_id=research_job_id, record_id=record_id)
        evidence_rows = await list_job_evidence(session, research_job_id, limit=200)
        enriched_plan = await enrich_record_war_room_plan_with_research(
            session,
            record_id=record_id,
            research_rows=evidence_rows,
        )
        if enriched_plan is not None:
            war_room_plan = enriched_plan
    # Loop 3 案例飞轮：脱敏归档为可复用案例资产（旁路，失败不影响返回）
    await archive_case(session, questionnaire, outcome.results, outcome.triage, record_id)
    return DiagnoseResponse(
        results=outcome.results,
        record_id=record_id,
        skill_version_ids=outcome.skill_version_ids,
        triage=outcome.triage,
        war_room_plan=war_room_plan,
        # 审核可选默认不选：请了复核→pending_review；否则登录用户即 approved（立即可见）；匿名无记录→anonymous
        review_status=(
            "pending_review" if (record_id and questionnaire.request_review)
            else "approved" if record_id else "anonymous"
        ),
    )


class FeedbackRequest(BaseModel):
    module: str
    skill_version_id: str
    rating: int
    is_useful: bool | None = None
    comment: str | None = None


@router.post("/diagnose/{record_id}/feedback", status_code=201)
async def submit_feedback(
    record_id: str,
    body: FeedbackRequest,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, bool]:
    if not (1 <= body.rating <= 5):
        raise HTTPException(status_code=422, detail="rating 必须在 1-5")
    record = await session.get(DiagnosisRecord, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="诊断记录不存在")
    feedback = DiagnosisFeedback(
        record_id=record_id,
        module=body.module,
        skill_version_id=body.skill_version_id,
        user_id=user.id if user else None,
        rating=body.rating,
        is_useful=body.is_useful,
        comment=body.comment,
    )
    session.add(feedback)
    await session.commit()
    await append_feedback_memory(session, record=record, feedback=feedback)
    await session.commit()
    return {"ok": True}


@router.post("/diagnose/{record_id}/request-review")
async def request_consultant_review(
    record_id: str,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    """老板在「诊断完成、立即可见」的结果上主动请顾问复核，把该记录送进审核队列。

    审核默认不选、诊断即出；这是事后可选的人工复核入口（对应「诊断→审核(可选)→作战室」）。
    送审后该记录回到 pending_review：老板侧项目作战室按"仅已通过记录"重建——本条暂时隐藏，
    待顾问通过再现。幂等：已在审核中直接返回当前状态。
    """
    if user is None:
        raise HTTPException(status_code=401, detail="请先登录")
    record = await session.get(DiagnosisRecord, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="诊断记录不存在")
    if record.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权操作该诊断记录")
    if record.review_status != "pending_review":
        record.review_status = "pending_review"
        record.reviewed_by = None
        record.reviewed_at = None
        session.add(record)
        await session.commit()
        if record.project_id:
            project = await session.get(Project, record.project_id)
            if project is not None:
                # 重算项目作战室：本条未通过则从已通过集合里移除（无已通过记录时自动隐藏）。
                await get_or_build_project_war_room_plan(session, project)
    return {"record_id": record_id, "review_status": record.review_status}
