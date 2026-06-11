import json

from fastapi import APIRouter, Depends, File, Form, UploadFile
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
from app.db.models import User, DiagnosisRecord

router = APIRouter()


class DiagnoseResponse(BaseModel):
    results: list[ModuleResult]


async def _save_history(
    session: AsyncSession,
    user: User | None,
    questionnaire: Questionnaire,
    results: list[ModuleResult],
    profile_json: str | None = None,
) -> None:
    """已登录用户的诊断写入历史记录；匿名用户跳过。"""
    if user is None:
        return
    record = DiagnosisRecord(
        user_id=user.id,
        answers_json=questionnaire.model_dump_json(),
        results_json=json.dumps([r.model_dump() for r in results], ensure_ascii=False),
        profile_json=profile_json,
    )
    session.add(record)
    await session.commit()


@router.post("/diagnose", response_model=DiagnoseResponse)
async def diagnose(
    questionnaire: Questionnaire,
    llm: LLMClient = Depends(get_llm_client),
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> DiagnoseResponse:
    results = await diagnose_all(questionnaire, llm)
    await _save_history(session, user, questionnaire, results)
    return DiagnoseResponse(results=results)


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

    results = await diagnose_all(questionnaire, llm)
    await _save_history(session, user, questionnaire, results)
    return DiagnoseResponse(results=results)
