import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_llm_client
from app.llm.base import LLMClient
from app.models.questionnaire import Questionnaire
from app.models.result import ModuleResult
from app.orchestrator.dispatcher import diagnose_all
from app.data.uploads import parse_table
from app.auth.jwt import get_optional_user
from app.db.database import get_session
from app.db.models import User, DiagnosisRecord, DiagnosisFeedback, DiagnosisSession, Project

router = APIRouter()


class DiagnoseResponse(BaseModel):
    results: list[ModuleResult]
    record_id: str | None = None
    skill_version_ids: dict[str, str] = {}


async def _save_history(
    session: AsyncSession,
    user: User | None,
    questionnaire: Questionnaire,
    results: list[ModuleResult],
    profile_json: str | None = None,
) -> str | None:
    """已登录用户的诊断写入历史记录，返回 record_id；匿名用户返回 None。

    若 questionnaire 带了 session_id，则把诊断记录回关到对应的诊断会话
    （记忆文件），让"对话→诊断结果"形成完整闭环。
    """
    sid = questionnaire.session_id
    if user is None:
        # 匿名也回填 session 状态（如果有），但不建历史记录
        if sid:
            await _link_session(session, sid, None)
        return None
    record = DiagnosisRecord(
        user_id=user.id,
        answers_json=questionnaire.model_dump_json(),
        results_json=json.dumps([r.model_dump() for r in results], ensure_ascii=False),
        profile_json=profile_json,
        session_id=sid,
        project_id=questionnaire.project_id,
    )
    session.add(record)
    await session.commit()
    if sid:
        await _link_session(session, sid, record.id)
    # 诊断完成 → 把核心结论沉淀进项目长期记忆
    if questionnaire.project_id:
        await _append_diagnosis_memory(session, questionnaire.project_id, results)
    return record.id


async def _append_diagnosis_memory(
    session: AsyncSession,
    project_id: str,
    results: list[ModuleResult],
) -> None:
    """诊断完成后，把本次核心结论追加进项目长期记忆。

    记忆反映真实诊断结果（模块 + 信号 + 一句结论），让后续诊断能延续历史。
    保留最近 10 条，避免无限膨胀（AI 压缩留待后续）。
    """
    proj = await session.get(Project, project_id)
    if proj is None or not results:
        return
    from datetime import datetime, timezone

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    # 取信号最重的模块作为本次诊断的标志性结论
    order = {"red": 0, "yellow": 1, "green": 2}
    top = sorted(results, key=lambda r: order.get(r.signal, 9))[0]
    signal_cn = {"red": "需关注", "yellow": "观察", "green": "健康"}.get(top.signal, top.signal)
    entry = f"[{stamp}] {top.module}（{signal_cn}）：{top.conclusion[:60]}"
    lines = [ln for ln in proj.memory_summary.split("\n") if ln.strip()]
    lines.append(entry)
    proj.memory_summary = "\n".join(lines[-10:])
    proj.updated_at = datetime.now(timezone.utc)
    session.add(proj)
    await session.commit()


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
    outcome = await diagnose_all(questionnaire, llm, session)
    record_id = await _save_history(session, user, questionnaire, outcome.results)
    return DiagnoseResponse(
        results=outcome.results,
        record_id=record_id,
        skill_version_ids=outcome.skill_version_ids,
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
        try:
            parsed = parse_table(upload.filename, content)
        except ValueError:
            # 不支持的文件类型：记录文件名，跳过解析，不让整次诊断失败
            answer.facts[facts_key] = "（无法解析的文件类型）"
            continue
        answer.facts[facts_key] = str(parsed)
        answer.uploaded_files.append(upload.filename)

    outcome = await diagnose_all(questionnaire, llm, session)
    record_id = await _save_history(session, user, questionnaire, outcome.results)
    return DiagnoseResponse(
        results=outcome.results,
        record_id=record_id,
        skill_version_ids=outcome.skill_version_ids,
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
    return {"ok": True}
