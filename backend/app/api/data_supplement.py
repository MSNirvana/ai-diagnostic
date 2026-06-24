"""作战室补资料公开链接。"""
import json
import mimetypes
import os
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.files import UPLOAD_ROOT, UploadedFileOut, _to_out
from app.auth.jwt import get_current_user
from app.data.uploads import parse_uploaded_file
from app.db.database import get_session
from app.db.models import (
    DataSupplementRequest,
    DataSupplementSubmission,
    Project,
    ProjectMemoryEntry,
    UploadedFile,
    User,
)
from app.memory.project_memory import append_memory_entry
from app.models.result import DataRequest
from app.api.project import (
    _archive_file_content_type,
    _render_archive_file_preview_blocks,
    _render_archive_file_preview_text,
)
from app.warroom.history import get_or_build_project_war_room_plan

router = APIRouter(prefix="/data-supplement")


def _now() -> datetime:
    return datetime.now(timezone.utc)


class SupplementRequestCreate(BaseModel):
    war_room_plan_id: str
    data_request: DataRequest


class SupplementFileOut(BaseModel):
    id: str
    original_name: str
    summary_text: str = ""
    is_deleted: bool = False
    content_type: str = ""
    media_type: str = ""
    preview_text: str = ""
    preview_blocks: list[dict] = []


class SupplementSubmissionOut(BaseModel):
    id: str
    created_at: datetime
    submitter_name: str = ""
    note: str = ""
    files: list[SupplementFileOut] = []


class SupplementRequestOut(BaseModel):
    id: str
    token: str
    project_id: str
    created_at: datetime
    updated_at: datetime
    war_room_plan_id: str
    data_key: str
    label: str
    reason: str = ""
    source_hint: str = ""
    typical_owner: str = ""
    status: str
    public_url: str = ""
    submissions: list[SupplementSubmissionOut] = []


@router.post("/project/{project_id}/requests", response_model=SupplementRequestOut, status_code=201)
async def create_supplement_request(
    project_id: str,
    body: SupplementRequestCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SupplementRequestOut:
    project = await session.get(Project, project_id)
    if project is None or project.user_id != user.id:
        raise HTTPException(status_code=404, detail="项目不存在")

    plan = await get_or_build_project_war_room_plan(session, project)
    if plan is None or plan.id != body.war_room_plan_id:
        raise HTTPException(status_code=409, detail="作战室版本已更新，请刷新后再生成链接")

    data = body.data_request
    data_key = data.key.strip()
    if not data_key or not data.label.strip():
        raise HTTPException(status_code=400, detail="待补资料信息不完整")

    existing = await session.scalar(
        select(DataSupplementRequest).where(
            DataSupplementRequest.project_id == project_id,
            DataSupplementRequest.war_room_plan_id == body.war_room_plan_id,
            DataSupplementRequest.data_key == data_key,
        )
    )
    if existing is not None:
        return await _request_out(session, existing)

    request = DataSupplementRequest(
        project_id=project_id,
        user_id=user.id,
        war_room_plan_id=body.war_room_plan_id,
        data_key=data_key,
        label=data.label.strip()[:240],
        reason=data.reason.strip()[:1200],
        source_hint=data.source_hint.strip()[:500],
        typical_owner=(data.typical_owner or "").strip()[:120],
    )
    session.add(request)
    project.updated_at = _now()
    session.add(project)
    await session.commit()
    await session.refresh(request)
    return await _request_out(session, request)


@router.get("/project/{project_id}/requests", response_model=list[SupplementRequestOut])
async def list_project_supplement_requests(
    project_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[SupplementRequestOut]:
    project = await session.get(Project, project_id)
    if project is None or project.user_id != user.id:
        raise HTTPException(status_code=404, detail="项目不存在")
    rows = list(await session.scalars(
        select(DataSupplementRequest)
        .where(DataSupplementRequest.project_id == project_id)
        .order_by(DataSupplementRequest.updated_at.desc())
    ))
    return [await _request_out(session, row) for row in rows]


@router.get("/public/{token}", response_model=SupplementRequestOut)
async def get_public_supplement_request(
    token: str,
    session: AsyncSession = Depends(get_session),
) -> SupplementRequestOut:
    request = await _request_by_token(session, token)
    return await _request_out(session, request)


@router.delete(
    "/project/{project_id}/requests/{request_id}/submissions/{submission_id}/files/{file_id}",
    response_model=SupplementRequestOut,
)
async def delete_project_supplement_file(
    project_id: str,
    request_id: str,
    submission_id: str,
    file_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SupplementRequestOut:
    project = await session.get(Project, project_id)
    if project is None or project.user_id != user.id:
        raise HTTPException(status_code=404, detail="项目不存在")
    request = await session.get(DataSupplementRequest, request_id)
    if request is None or request.project_id != project_id or request.user_id != user.id:
        raise HTTPException(status_code=404, detail="补资料记录不存在")
    submission = await session.get(DataSupplementSubmission, submission_id)
    if submission is None or submission.request_id != request_id or submission.project_id != project_id:
        raise HTTPException(status_code=404, detail="提交记录不存在")

    file_ids = _load_file_ids(submission.file_ids_json)
    if file_id not in file_ids:
        raise HTTPException(status_code=404, detail="文件不存在")
    deleted_ids = set(_load_file_ids(submission.deleted_file_ids_json))
    if file_id not in deleted_ids:
        deleted_ids.add(file_id)
        submission.deleted_file_ids_json = json.dumps(list(deleted_ids), ensure_ascii=False)
        request.updated_at = _now()
        session.add(submission)
        session.add(request)
        file = await session.get(UploadedFile, file_id)
        await append_memory_entry(
            session,
            project_id=project_id,
            entry_type="uploaded_file_deleted",
            summary=f"补资料文件已删除留痕：{file.original_name if file else file_id}。",
            payload={
                "supplement_request_id": request.id,
                "supplement_submission_id": submission.id,
                "file_id": file_id,
                "file_name": file.original_name if file else "",
                "data_key": request.data_key,
                "label": request.label,
            },
            user_id=user.id,
            source_id=submission.id,
        )
        await session.commit()
        await session.refresh(request)
    return await _request_out(session, request)


@router.post("/public/{token}/submit", response_model=SupplementSubmissionOut, status_code=201)
async def submit_public_supplement(
    token: str,
    submitter_name: str = Form(default=""),
    note: str = Form(default=""),
    files: list[UploadFile] = File(default=[]),
    session: AsyncSession = Depends(get_session),
) -> SupplementSubmissionOut:
    request = await _request_by_token(session, token)
    if request.status != "open":
        raise HTTPException(status_code=409, detail="这个补资料链接已关闭")
    if not note.strip() and not files:
        raise HTTPException(status_code=400, detail="请至少填写说明或上传一个文件")

    uploaded: list[UploadedFile] = []
    for file in files:
        content = await file.read()
        original_name = _safe_upload_name(file.filename or "未命名文件")
        rec = UploadedFile(
            session_id=f"supplement_{request.token}",
            user_id=None,
            module_key="supplement",
            field_key=request.data_key,
            original_name=original_name,
            stored_path="",
        )
        folder = os.path.join(UPLOAD_ROOT, f"supplement_{request.token}")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, f"{rec.id}_{original_name}")
        with open(path, "wb") as fh:
            fh.write(content)
        rec.stored_path = path
        rec.parsed_summary = json.dumps(parse_uploaded_file(rec.original_name, content), ensure_ascii=False)
        session.add(rec)
        uploaded.append(rec)

    submission = DataSupplementSubmission(
        request_id=request.id,
        project_id=request.project_id,
        submitter_name=submitter_name.strip()[:120],
        note=note.strip()[:3000],
        file_ids_json=json.dumps([item.id for item in uploaded], ensure_ascii=False),
    )
    request.updated_at = _now()
    session.add(request)
    session.add(submission)

    await append_memory_entry(
        session,
        project_id=request.project_id,
        entry_type="uploaded_file",
        summary=_submission_summary(request, submission, uploaded),
        payload={
            "supplement_request_id": request.id,
            "supplement_submission_id": submission.id,
            "data_key": request.data_key,
            "label": request.label,
            "submitter_name": submission.submitter_name,
            "note": submission.note,
            "file_ids": [item.id for item in uploaded],
            "files": [
                {
                    "id": item.id,
                    "original_name": item.original_name,
                    "parsed_summary": json.loads(item.parsed_summary or "{}"),
                }
                for item in uploaded
            ],
        },
        user_id=request.user_id,
        source_id=submission.id,
    )
    await session.commit()
    await session.refresh(submission)
    return await _submission_out(session, submission)


async def _request_by_token(session: AsyncSession, token: str) -> DataSupplementRequest:
    request = await session.scalar(
        select(DataSupplementRequest).where(DataSupplementRequest.token == token)
    )
    if request is None:
        raise HTTPException(status_code=404, detail="补资料链接不存在")
    return request


async def _request_out(session: AsyncSession, request: DataSupplementRequest) -> SupplementRequestOut:
    submissions = list(await session.scalars(
        select(DataSupplementSubmission)
        .where(DataSupplementSubmission.request_id == request.id)
        .order_by(DataSupplementSubmission.created_at.desc())
    ))
    return SupplementRequestOut(
        id=request.id,
        token=request.token,
        project_id=request.project_id,
        created_at=request.created_at,
        updated_at=request.updated_at,
        war_room_plan_id=request.war_room_plan_id,
        data_key=request.data_key,
        label=request.label,
        reason=request.reason,
        source_hint=request.source_hint,
        typical_owner=request.typical_owner,
        status=request.status,
        public_url=f"/supplement/{request.token}",
        submissions=[await _submission_out(session, item) for item in submissions],
    )


async def _submission_out(session: AsyncSession, submission: DataSupplementSubmission) -> SupplementSubmissionOut:
    file_ids = _load_file_ids(submission.file_ids_json)
    deleted_ids = set(_load_file_ids(submission.deleted_file_ids_json))
    files: list[SupplementFileOut] = []
    if file_ids:
        rows = list(await session.scalars(select(UploadedFile).where(UploadedFile.id.in_(file_ids))))
        by_id = {row.id: row for row in rows}
        files = [
            SupplementFileOut(
                id=file.id,
                original_name=file.original_name,
                summary_text=_to_out(file).summary_text,
                is_deleted=file.id in deleted_ids,
                content_type=_archive_file_content_type(file.parsed_summary),
                media_type=mimetypes.guess_type(file.original_name)[0] or "",
                preview_text=_render_archive_file_preview_text(file.parsed_summary),
                preview_blocks=_render_archive_file_preview_blocks(file.parsed_summary),
            )
            for file_id in file_ids
            if (file := by_id.get(file_id)) is not None
        ]
    return SupplementSubmissionOut(
        id=submission.id,
        created_at=submission.created_at,
        submitter_name=submission.submitter_name,
        note=submission.note,
        files=files,
    )


def _load_file_ids(raw: str) -> list[str]:
    try:
        values = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    return [str(item) for item in values if str(item).strip()] if isinstance(values, list) else []


def _safe_upload_name(filename: str) -> str:
    name = os.path.basename(str(filename or "").replace("\\", "/")).strip()
    name = re.sub(r"[\x00-\x1f]", "", name)
    return name[:180] or "未命名文件"


def _submission_summary(
    request: DataSupplementRequest,
    submission: DataSupplementSubmission,
    files: list[UploadedFile],
) -> str:
    who = submission.submitter_name or request.typical_owner or "负责人"
    parts = [f"补充资料：{who}提交「{request.label}」"]
    if files:
        parts.append(f"{len(files)} 个文件")
    if submission.note:
        parts.append(f"说明：{submission.note}")
    summary = "；".join(parts)
    return summary if summary.endswith(("。", "！", "？", ".", "!", "?")) else f"{summary}。"
