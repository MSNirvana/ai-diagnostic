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

from app.api.conversation import run_chat_turn
from app.auth.jwt import get_current_user, get_optional_user
from app.config import get_llm_client
from app.db.database import get_session
from app.db.models import User, DiagnosisSession, Project
from app.llm.base import LLMClient
from app.memory.project_memory import append_problem_map_memory
from app.memory.session_visibility import is_meaningful_session
from app.models.conversation import ChatMessage, ChatResponse

router = APIRouter(prefix="/session")


# ── 请求/响应模型 ───────────────────────────────────────────

class StartRequest(BaseModel):
    project_id: str | None = None


class StartResponse(BaseModel):
    session_id: str


class ChatTurnRequest(BaseModel):
    # 用户这一轮说的话（追加到已有历史）
    message: str


class SessionDetail(BaseModel):
    id: str
    created_at: datetime
    updated_at: datetime
    title: str
    status: str
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
    if s is None:
        raise HTTPException(status_code=404, detail="会话不存在")

    # 读所属项目的长期记忆，作为对话背景注入
    project_memory = ""
    if s.project_id:
        proj = await session.get(Project, s.project_id)
        if proj:
            project_memory = proj.memory_summary

    # 读历史，追加用户这轮发言
    history = [ChatMessage.model_validate(m) for m in json.loads(s.messages_json)]
    history.append(ChatMessage(role="user", content=body.message))

    resp = await run_chat_turn(history, llm, session, project_memory=project_memory)

    # AI 回复入历史
    history.append(ChatMessage(role="assistant", content=resp.message))

    # 落库
    s.messages_json = json.dumps([m.model_dump() for m in history], ensure_ascii=False)
    s.updated_at = datetime.now(timezone.utc)
    if resp.problem_map is not None:
        s.problem_map_json = resp.problem_map.model_dump_json()
        if resp.problem_map.core_problem:
            s.title = resp.problem_map.core_problem[:60]
    if resp.phase in ("confirm", "done"):
        s.status = "confirmed"
    session.add(s)

    # 对话确认后，把核心问题并入所属项目的长期记忆
    if resp.phase == "done" and resp.problem_map and s.project_id:
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
        .order_by(DiagnosisSession.updated_at.desc())
    )
    rows = (await session.scalars(stmt)).all()
    return [
        SessionSummary(
            id=r.id, created_at=r.created_at, updated_at=r.updated_at,
            title=r.title or "未命名会话", status=r.status,
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
    if s is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    # 登录用户只能看自己的；匿名会话（user_id 为 None）允许凭 id 访问
    if s.user_id is not None and (user is None or s.user_id != user.id):
        raise HTTPException(status_code=404, detail="会话不存在")
    return SessionDetail(
        id=s.id,
        created_at=s.created_at,
        updated_at=s.updated_at,
        title=s.title or "未命名会话",
        status=s.status,
        messages=[ChatMessage.model_validate(m) for m in json.loads(s.messages_json)],
        problem_map=json.loads(s.problem_map_json) if s.problem_map_json else None,
        diagnosis_record_id=s.diagnosis_record_id,
        draft_json=s.draft_json,
    )


@router.patch("/{session_id}/draft", status_code=204)
async def save_draft(
    session_id: str,
    body: DraftPayload,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """保存问卷填写进度（跨设备恢复）。"""
    s = await session.get(DiagnosisSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    if s.user_id is not None and (user is None or s.user_id != user.id):
        raise HTTPException(status_code=404, detail="会话不存在")
    s.draft_json = body.draft_json
    if s.status not in ("diagnosed",):
        s.status = "filling"
    s.updated_at = datetime.now(timezone.utc)
    session.add(s)
    await session.commit()
