from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel
from app.config import get_llm_client
from app.llm.base import LLMClient
from app.models.questionnaire import Questionnaire
from app.models.result import ModuleResult
from app.orchestrator.dispatcher import diagnose_all
from app.data.uploads import parse_table

router = APIRouter()


class DiagnoseResponse(BaseModel):
    results: list[ModuleResult]


@router.post("/diagnose", response_model=DiagnoseResponse)
async def diagnose(
    questionnaire: Questionnaire,
    llm: LLMClient = Depends(get_llm_client),
) -> DiagnoseResponse:
    results = await diagnose_all(questionnaire, llm)
    return DiagnoseResponse(results=results)


@router.post("/diagnose/upload", response_model=DiagnoseResponse)
async def diagnose_with_upload(
    answers_json: str = Form(...),
    files: list[UploadFile] = File(default=[]),
    llm: LLMClient = Depends(get_llm_client),
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
        module_key = upload.filename.split("_", 1)[0]
        answer = answers_by_module.get(module_key)
        if answer is None:
            continue
        try:
            parsed = parse_table(upload.filename, content)
        except ValueError:
            # 不支持的文件类型：记录文件名，跳过解析，不让整次诊断失败
            answer.facts[f"file_{upload.filename}"] = "（无法解析的文件类型）"
            continue
        answer.facts[f"file_{upload.filename}"] = str(parsed)
        answer.uploaded_files.append(upload.filename)

    results = await diagnose_all(questionnaire, llm)
    return DiagnoseResponse(results=results)
