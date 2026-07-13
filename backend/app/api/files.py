"""文件上传端点：选完即时上传，存磁盘 + DB，跨设备恢复复用。

原始文件存 data/uploads/{session_id}/，DB（UploadedFile）存路径+元信息+解析摘要。
上传时立刻 parse_table 解析并缓存，诊断时直接合并进 facts，不必重传。
"""
import os
import json
import mimetypes
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import get_optional_user
from app.config import get_llm_client
from app.data.uploads import parse_uploaded_file, render_file_summary
from app.db.database import get_session
from app.db.models import User, DiagnosisSession, UploadedFile
from app.llm.base import LLMClient

router = APIRouter()

UPLOAD_ROOT = "data/uploads"
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff")
IMAGE_READ_SYSTEM = (
    "你是企业咨询系统的图片资料读取助手。"
    "任务是把用户上传的截图、照片、表格图或网页图转成可供后续咨询诊断使用的结构化文字。"
    "只描述图片中能看到的信息，不要臆测；如果看不清，要明确写出不确定。"
)
IMAGE_READ_PROMPT = """请读取这张图片，输出中文摘要，要求：
1. 先说明图片类型，例如聊天截图、网页截图、数据报表、产品图、合同/文档截图等。
2. 提取所有可见关键文字、数字、表格字段、按钮、页面标题和异常提示。
3. 如果是业务/营销/产品/财务相关截图，提炼对经营诊断有用的事实。
4. 如果图片中信息不足或模糊，请列出需要用户补充的点。
5. 不要说“我无法识别图片”，除非图片确实不可读。"""


class UploadedFileOut(BaseModel):
    id: str
    module_key: str
    field_key: str
    original_name: str
    parsed_summary: str = ""
    summary_text: str = ""
    content_type: str = ""
    extraction_status: str = ""
    extraction_note: str = ""


def _to_out(f: UploadedFile) -> UploadedFileOut:
    summary = _load_summary(f.parsed_summary)
    return UploadedFileOut(
        id=f.id, module_key=f.module_key,
        field_key=f.field_key, original_name=f.original_name,
        parsed_summary=f.parsed_summary,
        summary_text=render_file_summary(f.original_name, summary),
        content_type=str(summary.get("content_type") or ""),
        extraction_status=str(summary.get("extraction_status") or ""),
        extraction_note=str(summary.get("extraction_note") or ""),
    )


def _load_summary(raw: str) -> dict:
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {"raw": parsed}
    except (TypeError, ValueError):
        return {"content_type": "legacy", "text": str(raw or "")}


def _is_image_file(filename: str, media_type: str) -> bool:
    name = str(filename or "").lower()
    return media_type.startswith("image/") or name.endswith(IMAGE_EXTENSIONS)


async def _enrich_image_summary(
    parsed: dict,
    *,
    filename: str,
    content: bytes,
    media_type: str,
    llm: LLMClient,
) -> dict:
    if not _is_image_file(filename, media_type):
        return parsed
    if len(content) > 12 * 1024 * 1024:
        return {
            **parsed,
            "extraction_status": parsed.get("extraction_status") or "image_too_large",
            "extraction_note": "图片已保存，但超过 12MB，暂未自动读取内容。请压缩后重传或补充关键内容。",
        }
    try:
        vision_text = (await llm.describe_image(
            IMAGE_READ_SYSTEM,
            IMAGE_READ_PROMPT,
            content,
            media_type,
        )).strip()
    except Exception as exc:
        note = str(parsed.get("extraction_note") or "").strip()
        return {
            **parsed,
            "vision_status": "failed",
            "vision_error": exc.__class__.__name__,
            "extraction_note": note or "图片已保存，但视觉模型暂时不可用。请补充截图里的关键文字、数字或结论。",
        }
    if not vision_text:
        return {
            **parsed,
            "vision_status": "empty",
            "extraction_note": "图片已保存，但视觉模型没有返回可用内容。请补充截图里的关键文字、数字或结论。",
        }
    return {
        **parsed,
        "extraction_status": "parsed",
        "vision_status": "parsed",
        "vision_text": vision_text,
        "text": vision_text,
        "paragraphs": [line.strip() for line in vision_text.splitlines() if line.strip()][:1000],
        "preview_blocks": [
            {"type": "paragraph", "text": line.strip()}
            for line in vision_text.splitlines()
            if line.strip()
        ][:1000],
        "extraction_note": "已通过视觉模型读取图片内容。",
    }


async def _parse_and_enrich_upload(
    *,
    filename: str,
    content: bytes,
    media_type: str,
    llm: LLMClient,
) -> dict:
    parsed = parse_uploaded_file(filename, content)
    if not _is_image_file(filename, media_type):
        return parsed

    return await _enrich_image_summary(
        parsed,
        filename=filename,
        content=content,
        media_type=media_type,
        llm=llm,
    )


async def _check_session(session: AsyncSession, session_id: str, user: User | None) -> DiagnosisSession:
    s = await session.get(DiagnosisSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    if s.user_id is not None and (user is None or s.user_id != user.id):
        raise HTTPException(status_code=404, detail="会话不存在")
    return s


async def _get_accessible_file(file_id: str, user: User | None, session: AsyncSession) -> UploadedFile:
    f = await session.get(UploadedFile, file_id)
    if f is None:
        raise HTTPException(status_code=404, detail="文件不存在")
    if f.user_id is not None and (user is None or f.user_id != user.id):
        raise HTTPException(status_code=404, detail="文件不存在")
    if not f.stored_path or not os.path.exists(f.stored_path):
        raise HTTPException(status_code=404, detail="文件不存在")
    return f


@router.post("/session/{session_id}/files", response_model=UploadedFileOut, status_code=201)
async def upload_file(
    session_id: str,
    module_key: str = Form(...),
    field_key: str = Form(...),
    file: UploadFile = File(...),
    user: User | None = Depends(get_optional_user),
    llm: LLMClient = Depends(get_llm_client),
    session: AsyncSession = Depends(get_session),
) -> UploadedFileOut:
    diagnosis_session = await _check_session(session, session_id, user)
    content = await file.read()

    # 先建记录拿 id，再用 id 命名落盘
    rec = UploadedFile(
        session_id=session_id,
        user_id=user.id if user else None,
        module_key=module_key,
        field_key=field_key,
        original_name=file.filename or "未命名",
        stored_path="",
    )
    folder = os.path.join(UPLOAD_ROOT, session_id)
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{rec.id}_{rec.original_name}")
    with open(path, "wb") as fh:
        fh.write(content)
    rec.stored_path = path

    # 即时解析并缓存（诊断/对话时直接用，不重复解析）
    media_type = file.content_type or mimetypes.guess_type(rec.original_name)[0] or "application/octet-stream"
    parsed = await _parse_and_enrich_upload(
        filename=rec.original_name,
        content=content,
        media_type=media_type,
        llm=llm,
    )
    summary_text = render_file_summary(rec.original_name, parsed)
    rec.parsed_summary = json.dumps(parsed, ensure_ascii=False)

    session.add(rec)

    await session.commit()
    await session.refresh(rec)
    return _to_out(rec)


@router.get("/session/{session_id}/files", response_model=list[UploadedFileOut])
async def list_files(
    session_id: str,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> list[UploadedFileOut]:
    await _check_session(session, session_id, user)
    stmt = select(UploadedFile).where(UploadedFile.session_id == session_id)
    return [_to_out(f) for f in await session.scalars(stmt)]


@router.delete("/files/{file_id}", status_code=204)
async def delete_file(
    file_id: str,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    f = await session.get(UploadedFile, file_id)
    if f is None:
        return
    if f.user_id is not None and (user is None or f.user_id != user.id):
        raise HTTPException(status_code=404, detail="文件不存在")
    try:
        if f.stored_path and os.path.exists(f.stored_path):
            os.remove(f.stored_path)
    except OSError:
        pass
    await session.delete(f)
    await session.commit()


@router.get("/files/{file_id}/content")
async def get_file_content(
    file_id: str,
    download: bool = Query(False),
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> FileResponse:
    f = await _get_accessible_file(file_id, user, session)
    media_type = mimetypes.guess_type(f.original_name)[0] or "application/octet-stream"
    disposition_type = "attachment" if download else "inline"
    quoted_name = quote(f.original_name)
    headers = {
        "Content-Disposition": f"{disposition_type}; filename*=UTF-8''{quoted_name}",
    }
    return FileResponse(
        f.stored_path,
        media_type=media_type,
        filename=f.original_name if download else None,
        headers=headers,
    )
