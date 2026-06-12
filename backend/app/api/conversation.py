"""对话式追问入口：注入 brainstorming 拆解精髓的深度 intake。

无状态——前端每次传完整 messages 历史。AI 按 phase 工作：
- intake：还在追问（一次一问，五条纪律）
- confirm：信息问扎实，给问题地图请用户确认
- done：用户确认满意，可进问卷生成

prompt 优先从数据库 SkillVersion 表（module='conversation_intake'）读，
DB 空时回退代码 fallback。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_llm_client
from app.llm.base import LLMClient
from app.models.conversation import ChatRequest, ChatResponse, ProblemMap
from app.skills.parsing import parse_json_object
from app.skills.store import get_active_skill_version
from app.skills.prompts import CONVERSATION_INTAKE
from app.db.database import get_session

router = APIRouter(prefix="/conversation")


def _format_history(req: ChatRequest) -> str:
    if not req.messages:
        return "（对话刚开始，请用一句开场白邀请对方描述最头疼的问题）"
    lines = []
    for m in req.messages:
        who = "老板" if m.role == "user" else "顾问"
        lines.append(f"{who}：{m.content}")
    return "\n".join(lines)


async def run_chat_turn(
    messages: list,
    llm: LLMClient,
    session: AsyncSession | None,
) -> ChatResponse:
    """跑一轮对话：读 prompt（DB 优先）→ 调 LLM → 解析 phase/problem_map。

    供无状态 /conversation/chat 和有状态 /session/{id}/chat 共用。
    """
    ver = await get_active_skill_version(session, "conversation_intake")
    system = ver.system_prompt if ver else CONVERSATION_INTAKE

    prompt = _format_history(ChatRequest(messages=messages))
    raw = await llm.complete(system=system, prompt=prompt)
    try:
        data = parse_json_object(raw)
    except (ValueError, ValidationError):
        raise HTTPException(status_code=502, detail="对话生成失败")

    phase = data.get("phase")
    legacy_done = bool(data.get("done", False))
    if phase not in ("intake", "confirm", "done"):
        phase = "done" if legacy_done else "intake"

    message = data.get("message", "能再具体说说吗？")

    problem_map: ProblemMap | None = None
    raw_map = data.get("problem_map") or data.get("summary")
    if raw_map:
        try:
            problem_map = ProblemMap.model_validate(raw_map)
        except ValidationError:
            problem_map = None

    done = phase == "done"
    return ChatResponse(
        message=message,
        done=done,
        phase=phase,
        problem_map=problem_map,
        summary=problem_map.to_summary() if (done and problem_map) else None,
    )


@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    llm: LLMClient = Depends(get_llm_client),
    session: AsyncSession = Depends(get_session),
) -> ChatResponse:
    return await run_chat_turn(req.messages, llm, session)
