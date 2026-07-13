"""诊断会话（记忆文件）端点。

一次诊断从"开始对话"就创建一个 DiagnosisSession，对话消息实时落库，
关联问题地图和最终诊断结果。用户可回看、可续聊。

匿名用户也能用（user_id 为 None），登录后才能在历史里看到自己的会话列表。
"""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.conversation import _project_context_for_intake, run_chat_turn
from app.auth.jwt import get_current_user, get_optional_user
from app.config import get_llm_client
from app.data.uploads import render_file_summary
from app.db.database import get_session
from app.db.models import User, DiagnosisSession, ProjectMemoryEntry, UploadedFile
from app.llm.base import LLMClient
from app.memory.project_memory import append_conversation_memory, append_memory_entry, append_problem_map_memory
from app.memory.session_visibility import is_meaningful_session
from app.memory.session_title import display_session_title, title_from_history
from app.models.conversation import ChatMessage, ChatResponse

router = APIRouter(prefix="/session")


# ── 请求/响应模型 ───────────────────────────────────────────

class StartRequest(BaseModel):
    project_id: str | None = None
    memory_enabled: bool = True


class StartResponse(BaseModel):
    session_id: str


class ChatTurnRequest(BaseModel):
    # 用户这一轮说的话（追加到已有历史）
    message: str
    memory_enabled: bool | None = None


class SessionDetail(BaseModel):
    id: str
    created_at: datetime
    updated_at: datetime
    title: str
    status: str
    is_pinned: bool = False
    memory_enabled: bool = True
    messages: list[ChatMessage]
    problem_map: dict | None = None
    diagnosis_record_id: str | None = None
    draft_json: str | None = None


class DraftPayload(BaseModel):
    draft_json: str


class SessionSummary(BaseModel):
    id: str
    created_at: datetime
    updated_at: datetime
    title: str
    status: str
    is_pinned: bool = False
    memory_enabled: bool = True


class SessionPatchRequest(BaseModel):
    title: str | None = None
    is_pinned: bool | None = None
    memory_enabled: bool | None = None


def _can_access_session(s: DiagnosisSession, user: User | None) -> bool:
    return s.user_id is None or (user is not None and s.user_id == user.id)


def _load_file_summary(raw: str) -> dict:
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {"raw": parsed}
    except (TypeError, ValueError):
        return {"content_type": "legacy", "text": str(raw or "")}


async def _session_uploaded_files(session: AsyncSession, session_id: str) -> list[UploadedFile]:
    stmt = (
        select(UploadedFile)
        .where(UploadedFile.session_id == session_id)
        .order_by(UploadedFile.created_at.asc())
    )
    return list(await session.scalars(stmt))


async def _append_uploaded_file_memories(
    session: AsyncSession,
    *,
    diagnosis_session: DiagnosisSession,
    files: list[UploadedFile],
) -> None:
    if not diagnosis_session.project_id or not diagnosis_session.memory_enabled:
        return
    for file in files:
        exists = await session.scalar(
            select(ProjectMemoryEntry).where(
                ProjectMemoryEntry.project_id == diagnosis_session.project_id,
                ProjectMemoryEntry.entry_type == "uploaded_file",
                ProjectMemoryEntry.source_id == file.id,
            )
        )
        if exists is not None:
            continue
        parsed = _load_file_summary(file.parsed_summary)
        summary_text = render_file_summary(file.original_name, parsed)
        await append_memory_entry(
            session,
            project_id=diagnosis_session.project_id,
            entry_type="uploaded_file",
            summary=f"上传资料《{file.original_name}》：{summary_text[:180]}",
            payload={
                "session_id": diagnosis_session.id,
                "file_id": file.id,
                "module_key": file.module_key,
                "field_key": file.field_key,
                "original_name": file.original_name,
                "parsed_summary": parsed,
                "summary_text": summary_text,
            },
            user_id=diagnosis_session.user_id,
            source_id=file.id,
        )


# ── 端点 ────────────────────────────────────────────────────

@router.post("/start", response_model=StartResponse, status_code=201)
async def start_session(
    body: StartRequest | None = None,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> StartResponse:
    project_id = body.project_id if body else None
    s = DiagnosisSession(
        user_id=user.id if user else None,
        project_id=project_id,
        memory_enabled=body.memory_enabled if body else True,
    )
    session.add(s)
    await session.commit()
    await session.refresh(s)
    return StartResponse(session_id=s.id)


@router.post("/{session_id}/chat", response_model=ChatResponse)
async def session_chat(
    session_id: str,
    body: ChatTurnRequest,
    user: User | None = Depends(get_optional_user),
    llm: LLMClient = Depends(get_llm_client),
    session: AsyncSession = Depends(get_session),
) -> ChatResponse:
    s = await session.get(DiagnosisSession, session_id)
    if s is None or s.deleted_at is not None:
        raise HTTPException(status_code=404, detail="会话不存在")
    if body.memory_enabled is not None:
        s.memory_enabled = body.memory_enabled

    # 读所属项目档案与长期记忆，作为对话背景注入，避免复诊时重复追问已知事实。
    project_memory = ""
    if s.project_id:
        project_memory = await _project_context_for_intake(session, s.project_id, user)

    # 读历史，追加用户这轮发言
    history = [ChatMessage.model_validate(m) for m in json.loads(s.messages_json)]
    history.append(ChatMessage(role="user", content=body.message))
    uploaded_files = await _session_uploaded_files(session, session_id)
    file_context = "\n\n".join([
        render_file_summary(file.original_name, _load_file_summary(file.parsed_summary))
        for file in uploaded_files
    ])
    llm_history = history
    if file_context.strip():
        llm_history = [
            ChatMessage(
                role="user",
                content=(
                    "【本会话已上传资料，供后台参考，不要在回复中全文复述】\n"
                    f"{file_context}\n"
                    "请结合这些资料回答；如果资料解析不完整，请明确指出还需要用户补充什么。"
                ),
            ),
            *history,
        ]

    resp = await run_chat_turn(llm_history, llm, session, project_memory=project_memory)

    # AI 回复入历史
    history.append(ChatMessage(role="assistant", content=resp.message))

    # 落库
    s.messages_json = json.dumps([m.model_dump() for m in history], ensure_ascii=False)
    s.updated_at = datetime.now(timezone.utc)
    if resp.problem_map is not None:
        s.problem_map_json = resp.problem_map.model_dump_json()
    if not s.title_is_custom:
        s.title = title_from_history(history, resp.problem_map)
    if resp.phase in ("confirm", "done"):
        s.status = "confirmed"
    session.add(s)

    if s.memory_enabled and s.project_id:
        await append_conversation_memory(
            session,
            project_id=s.project_id,
            diagnosis_session=s,
            user_message=body.message,
            assistant_message=resp.message,
            problem_map=resp.problem_map,
            user_id=s.user_id,
        )
        await _append_uploaded_file_memories(
            session,
            diagnosis_session=s,
            files=uploaded_files,
        )

    # 对话确认后，把核心问题并入所属项目的长期记忆
    if s.memory_enabled and resp.phase == "done" and resp.problem_map and s.project_id:
        await append_problem_map_memory(
            session,
            project_id=s.project_id,
            problem_map=resp.problem_map,
            user_id=s.user_id,
            source_id=s.id,
        )

    await session.commit()
    return resp


@router.get("/", response_model=list[SessionSummary])
async def list_sessions(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[SessionSummary]:
    stmt = (
        select(DiagnosisSession)
        .where(DiagnosisSession.user_id == user.id)
        .where(DiagnosisSession.deleted_at.is_(None))
        .order_by(DiagnosisSession.is_pinned.desc(), DiagnosisSession.updated_at.desc())
    )
    rows = (await session.scalars(stmt)).all()
    return [
        SessionSummary(
            id=r.id, created_at=r.created_at, updated_at=r.updated_at,
            title=display_session_title(r), status=r.status, is_pinned=r.is_pinned,
            memory_enabled=r.memory_enabled,
        )
        for r in rows if is_meaningful_session(r)
    ]


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session_detail(
    session_id: str,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> SessionDetail:
    s = await session.get(DiagnosisSession, session_id)
    if s is None or s.deleted_at is not None:
        raise HTTPException(status_code=404, detail="会话不存在")
    # 登录用户只能看自己的；匿名会话（user_id 为 None）允许凭 id 访问
    if not _can_access_session(s, user):
        raise HTTPException(status_code=404, detail="会话不存在")
    return SessionDetail(
        id=s.id,
        created_at=s.created_at,
        updated_at=s.updated_at,
        title=display_session_title(s),
        status=s.status,
        is_pinned=s.is_pinned,
        memory_enabled=s.memory_enabled,
        messages=[ChatMessage.model_validate(m) for m in json.loads(s.messages_json)],
        problem_map=json.loads(s.problem_map_json) if s.problem_map_json else None,
        diagnosis_record_id=s.diagnosis_record_id,
        draft_json=s.draft_json,
    )


@router.patch("/{session_id}", response_model=SessionSummary)
async def patch_session(
    session_id: str,
    body: SessionPatchRequest,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> SessionSummary:
    s = await session.get(DiagnosisSession, session_id)
    if s is None or s.deleted_at is not None or not _can_access_session(s, user):
        raise HTTPException(status_code=404, detail="会话不存在")
    if body.title is not None:
        title = body.title.strip()
        if title:
            s.title = title[:80]
            s.title_is_custom = True
    if body.is_pinned is not None:
        s.is_pinned = body.is_pinned
    if body.memory_enabled is not None:
        s.memory_enabled = body.memory_enabled
    s.updated_at = datetime.now(timezone.utc)
    session.add(s)
    await session.commit()
    await session.refresh(s)
    return SessionSummary(
        id=s.id,
        created_at=s.created_at,
        updated_at=s.updated_at,
        title=s.title or "未命名会话",
        status=s.status,
        is_pinned=s.is_pinned,
        memory_enabled=s.memory_enabled,
    )


@router.delete("/{session_id}", status_code=204)
async def delete_session(
    session_id: str,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    s = await session.get(DiagnosisSession, session_id)
    if s is None or s.deleted_at is not None or not _can_access_session(s, user):
        raise HTTPException(status_code=404, detail="会话不存在")
    s.deleted_at = datetime.now(timezone.utc)
    s.is_pinned = False
    s.updated_at = s.deleted_at
    session.add(s)
    await session.commit()


@router.patch("/{session_id}/draft", status_code=204)
async def save_draft(
    session_id: str,
    body: DraftPayload,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """保存问卷填写进度（跨设备恢复）。"""
    s = await session.get(DiagnosisSession, session_id)
    if s is None or s.deleted_at is not None:
        raise HTTPException(status_code=404, detail="会话不存在")
    if not _can_access_session(s, user):
        raise HTTPException(status_code=404, detail="会话不存在")
    s.draft_json = body.draft_json
    if s.status not in ("diagnosed",):
        s.status = "filling"
    s.updated_at = datetime.now(timezone.utc)
    session.add(s)
    await session.commit()
