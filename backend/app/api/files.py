"""文件上传端点：选完即时上传，存磁盘 + DB，跨设备恢复复用。

原始文件存 data/uploads/{session_id}/，DB（UploadedFile）存路径+元信息+解析摘要。
上传时立刻 parse_table 解析并缓存，诊断时直接合并进 facts，不必重传。
"""
import os
import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import get_optional_user
from app.data.uploads import parse_uploaded_file, render_file_summary
from app.db.database import get_session
from app.db.models import User, DiagnosisSession, UploadedFile

router = APIRouter()

UPLOAD_ROOT = "data/uploads"


class UploadedFileOut(BaseModel):
    id: str
    module_key: str
    field_key: str
    original_name: str
    parsed_summary: str = ""
    summary_text: str = ""


def _to_out(f: UploadedFile) -> UploadedFileOut:
    summary = _load_summary(f.parsed_summary)
    return UploadedFileOut(
        id=f.id, module_key=f.module_key,
        field_key=f.field_key, original_name=f.original_name,
        parsed_summary=f.parsed_summary,
        summary_text=render_file_summary(f.original_name, summary),
    )


def _load_summary(raw: str) -> dict:
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {"raw": parsed}
    except (TypeError, ValueError):
        return {"content_type": "legacy", "text": str(raw or "")}


async def _check_session(session: AsyncSession, session_id: str, user: User | None) -> DiagnosisSession:
    s = await session.get(DiagnosisSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    if s.user_id is not None and (user is None or s.user_id != user.id):
        raise HTTPException(status_code=404, detail="会话不存在")
    return s


@router.post("/session/{session_id}/files", response_model=UploadedFileOut, status_code=201)
async def upload_file(
    session_id: str,
    module_key: str = Form(...),
    field_key: str = Form(...),
    file: UploadFile = File(...),
    user: User | None = Depends(get_optional_user),
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
    parsed = parse_uploaded_file(rec.original_name, content)
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
