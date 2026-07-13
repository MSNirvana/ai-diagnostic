"""对话式追问入口：注入 brainstorming 拆解精髓的深度 intake。

无状态——前端每次传完整 messages 历史。AI 按 phase 工作：
- intake：还在追问（一次一问，五条纪律）
- confirm：信息问扎实，给问题地图请用户确认
- done：用户确认满意，可进问卷生成

prompt 优先从数据库 SkillVersion 表（module='conversation_intake'）读，
DB 空时回退代码 fallback。
"""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_llm_client
from app.auth.jwt import get_current_user, get_optional_user
from app.db.models import BrainstormSession, IdeaCard, Project, ProjectMemoryEntry, User
from app.llm.base import LLMClient
from app.llm.fallback import FallbackLLMError
from app.models.conversation import (
    ChatRequest,
    ChatMessage,
    ChatResponse,
    FreeChatRequest,
    FreeChatResponse,
    BrainstormSessionDetail,
    BrainstormSessionPatchRequest,
    BrainstormSessionSummary,
    IdeaCardResponse,
    SaveIdeaCardRequest,
    ProblemMap,
)
from app.skills.intake_completeness import (
    annotate_problem_map,
    build_intake_gate_message,
    evaluate_problem_map,
)
from app.skills.parsing import parse_json_object
from app.skills.store import get_active_skill_version
from app.skills.prompts import CONVERSATION_INTAKE, FREE_CHAT, INTAKE_COMPLETENESS
from app.db.database import get_session
from app.data.uploads import render_file_summary
from app.db.models import UploadedFile

router = APIRouter(prefix="/conversation")

LLM_UNAVAILABLE_MESSAGE = (
    "模型通道暂时不可用。请先在后台「模型通道」配置可用 API Key，"
    "或检查当前模型服务连接后再继续对话。"
)

PROJECT_CONTEXT_RUNTIME_RULE = (
    "\n\n【项目上下文运行时规则】\n"
    "- 如果本轮 prompt 出现【可参考的项目信息】，说明用户已开启“带入项目信息思考”。"
    "你必须基于这些项目档案、长期记忆和作战室摘要回答。\n"
    "- 不要回答“当前模式没有绑定项目”“我没有读取你的项目档案”“不知道当前项目”。"
    "如果信息不足，只能说“项目档案中还缺少哪些字段”。\n"
    "- 如果本轮 prompt 出现【项目信息状态】且说明未找到项目档案，才可以说明项目档案不可用。"
)

INTAKE_MEMORY_RUNTIME_RULE = (
    "\n\n【项目档案优先规则】\n"
    "- 如果系统提示中出现【这个项目的历史诊断记忆】、【项目当前档案】或【最近档案事件】，"
    "这些都是当前项目已知事实，不是闲聊噪音。\n"
    "- 已知事实必须直接写入 problem_map；不要再次追问同一件事。"
    "例如档案里已有预算、人手、时间、阶段、核心业务、目标客户、已尝试动作，就不能再问用户“你不知道吗/你先告诉我”。\n"
    "- 只有三类信息可以继续问：项目档案没有的关键缺口、用户刚刚说法与档案冲突的地方、可能随时间变化需要确认的数字。"
    "这类问题要写成“我看到档案里是……，现在是否有变化？”而不是从零提问。\n"
    "- 语气要像顾问复诊：先承认已知，再问缺口。禁止责备式、反问式、考试式表达。\n"
    "- 信息完整度够进入确认时，直接基于档案与本轮对话生成 confirm，不要为了补齐可选字段拖着用户。"
)


def _format_history(req: ChatRequest) -> str:
    if not req.messages:
        return "（对话刚开始，请用一句开场白邀请对方描述最头疼的问题）"
    lines = []
    for m in req.messages:
        who = "老板" if m.role == "user" else "顾问"
        lines.append(f"{who}：{m.content}")
    return "\n".join(lines)


def _draft_problem_map_from_history(messages: list[ChatMessage]) -> ProblemMap | None:
    """When the LLM is still asking questions, keep a conservative visible draft.

    The draft only uses text the user has already provided. Completeness scoring
    still runs afterwards, so the UI can show what is known and what is missing
    without pretending the map is final.
    """
    user_texts = [
        _clean_card_text(message.content)
        for message in messages
        if message.role == "user" and _clean_card_text(message.content)
    ]
    if not user_texts:
        return None

    joined = "；".join(user_texts[-3:])
    all_text = "；".join(user_texts)
    core_problem = _clip_text(joined or user_texts[-1], 96)
    problem_map = ProblemMap(
        core_problem=core_problem,
        context=_clip_text(all_text, 220) if len(user_texts) > 1 else "",
        impact=_clip_text(_pick_signal_text(user_texts, ("成本", "亏", "收入", "利润", "下降", "下滑", "高", "低", "持续", "多久")), 140),
        constraints=_clip_text(_pick_signal_text(user_texts, ("不能", "没有", "暂无", "缺", "限制", "预算", "人手", "库存")), 140),
        data_readiness=_clip_text(_pick_signal_text(user_texts, ("数据", "报表", "账号", "后台", "文件", "资料", "截图", "上传")), 140),
        diagnosis_focus=_guess_focus(all_text),
    )
    return annotate_problem_map(problem_map)


def _clip_text(text: str, limit: int) -> str:
    text = _clean_card_text(text)
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}…"


def _pick_signal_text(texts: list[str], keywords: tuple[str, ...]) -> str:
    for text in reversed(texts):
        if any(keyword in text for keyword in keywords):
            return text
    return ""


def _guess_focus(text: str) -> str:
    rules = (
        ("market", ("获客", "流量", "投放", "广告", "推广", "渠道", "招商", "线索", "客户")),
        ("finance", ("利润", "现金流", "亏损", "预算", "成本", "毛利")),
        ("ops", ("库存", "供应链", "交付", "发货", "生产", "仓库")),
        ("sales", ("成交", "销售", "转化", "回款", "客单", "跟进")),
        ("product", ("产品", "定价", "sku", "服务", "功能", "体验")),
        ("org", ("团队", "员工", "组织", "岗位", "绩效", "招聘")),
    )
    for focus, keywords in rules:
        if any(keyword in text for keyword in keywords):
            return focus
    return ""


async def _project_context_for_free_chat(
    session: AsyncSession,
    project_id: str | None,
    user: User | None,
) -> str:
    if not project_id or user is None:
        return ""
    project = await session.get(Project, project_id)
    if project is None or project.user_id != user.id:
        return ""

    memory_rows = list((await session.scalars(
        select(ProjectMemoryEntry)
        .where(ProjectMemoryEntry.project_id == project_id)
        .order_by(ProjectMemoryEntry.created_at.desc())
        .limit(8)
    )).all())
    memory_lines = [
        f"- {row.entry_type}：{_clean_card_text(row.summary)[:220]}"
        for row in memory_rows
        if _clean_card_text(row.summary)
    ]
    war_room = ""
    if project.war_room_plan_json:
        try:
            plan = json.loads(project.war_room_plan_json)
            war_room = "\n".join([
                f"作战室目标：{_clean_card_text(plan.get('objective'))}",
                f"主战场：{_clean_card_text(plan.get('primary_battlefield'))}",
                f"作战室摘要：{_clean_card_text(plan.get('summary'))[:260]}",
            ])
        except (TypeError, ValueError, AttributeError):
            war_room = ""

    return "\n\n".join([
        f"项目名称：{project.name}",
        f"项目长期记忆：{project.memory_summary}" if project.memory_summary.strip() else "",
        f"最近档案事件：\n{chr(10).join(memory_lines)}" if memory_lines else "",
        war_room,
    ]).strip()


async def _project_context_for_intake(
    session: AsyncSession,
    project_id: str | None,
    user: User | None,
) -> str:
    if not project_id:
        return ""
    project = await session.get(Project, project_id)
    if project is None:
        return ""
    if project.user_id is not None and (user is None or project.user_id != user.id):
        return ""

    sections: list[str] = [f"项目名称：{project.name}"]
    if project.profile_json:
        try:
            profile = json.loads(project.profile_json)
            if isinstance(profile, dict):
                facts = _problem_map_fact_lines(profile)
                if facts:
                    sections.append("【项目当前档案】\n" + "\n".join(facts))
        except (TypeError, ValueError):
            pass
    if project.memory_summary.strip():
        sections.append("【长期记忆摘要】\n" + project.memory_summary.strip())

    memory_rows = list((await session.scalars(
        select(ProjectMemoryEntry)
        .where(ProjectMemoryEntry.project_id == project_id)
        .order_by(ProjectMemoryEntry.created_at.desc())
        .limit(10)
    )).all())
    memory_lines = [
        f"- {row.entry_type}：{_clean_card_text(row.summary)[:260]}"
        for row in memory_rows
        if _clean_card_text(row.summary)
    ]
    if memory_lines:
        sections.append("【最近档案事件】\n" + "\n".join(memory_lines))

    return "\n\n".join(section for section in sections if section.strip()).strip()


def _problem_map_fact_lines(payload: dict) -> list[str]:
    labels = {
        "company_name": "企业/项目",
        "industry": "行业",
        "main_business": "主营业务",
        "business_model": "商业模式",
        "scale": "规模",
        "stage": "阶段",
        "core_problem": "核心问题",
        "goal": "目标",
        "constraints": "约束",
        "success_criteria": "成功标准",
        "impact": "影响",
        "context": "背景",
        "suspected_cause": "疑似原因",
        "tried": "已尝试动作",
        "data_readiness": "可用数据",
        "diagnosis_focus": "优先诊断方向",
    }
    lines: list[str] = []
    for key, label in labels.items():
        value = payload.get(key)
        if isinstance(value, list):
            text = "；".join(str(item).strip() for item in value if str(item).strip())
        else:
            text = str(value or "").strip()
        if text:
            lines.append(f"- {label}：{_clean_card_text(text)[:260]}")
    sub_problems = payload.get("sub_problems")
    if isinstance(sub_problems, list) and sub_problems:
        text = "；".join(str(item).strip() for item in sub_problems if str(item).strip())
        if text:
            lines.append(f"- 相关子问题：{_clean_card_text(text)[:260]}")
    return lines


def _is_stale_no_project_reply(text: str) -> bool:
    compact = _clean_card_text(text)
    stale_markers = (
        "没有绑定任何项目",
        "没有绑定项目",
        "没有读取你的项目档案",
        "没有项目档案",
        "不知道当前项目",
        "这张桌子是空的",
        "空白纸",
        "当前模式没有绑定",
    )
    return any(marker in compact for marker in stale_markers)


def _filtered_free_chat_messages(messages: list[ChatMessage], has_project_context: bool) -> list[ChatMessage]:
    if not has_project_context:
        return messages
    return [
        message for message in messages
        if not (message.role == "assistant" and _is_stale_no_project_reply(message.content))
    ]


def _project_name_from_context(project_context: str) -> str:
    for line in project_context.splitlines():
        if line.startswith("项目名称："):
            return line.removeprefix("项目名称：").strip()
    return ""


def _is_project_identity_question(messages: list[ChatMessage]) -> bool:
    last_user = next((m.content for m in reversed(messages) if m.role == "user"), "")
    compact = _clean_card_text(last_user)
    return any(phrase in compact for phrase in (
        "当前是什么项目",
        "现在是什么项目",
        "这是什么项目",
        "当前项目是什么",
        "你知道这个项目吗",
        "你知道当前项目吗",
    ))


def _project_identity_answer(project_context: str) -> str:
    project_name = _project_name_from_context(project_context) or "当前项目"
    context_lines = [
        line for line in project_context.splitlines()
        if line.strip() and not line.startswith("项目名称：")
    ]
    if context_lines:
        return (
            f"当前带入的是**「{project_name}」**。\n\n"
            "我已经读取到这个项目的档案摘要，后续头脑风暴会基于这些信息展开：\n"
            + "\n".join(f"- {line.strip()}" for line in context_lines[:6])
            + "\n\n你可以直接说一个想推演的动作，例如获客、渠道招商、转化、产品定位或 7 天验证计划。"
        )
    return (
        f"当前带入的是**「{project_name}」**。\n\n"
        "不过这个项目目前沉淀的信息还比较少，我至少已经拿到项目名称。"
        "你接下来可以直接说想推演的动作，我会围绕这个项目继续追问和拆解。"
    )


def _format_free_chat_history(req: FreeChatRequest, project_context: str = "") -> str:
    context = (project_context or req.project_context).strip()
    if context:
        context_block = (
            "【可参考的项目信息】\n"
            f"{context}\n\n"
            "【本轮要求】用户已开启“带入项目信息思考”。回答必须基于以上项目背景推演；"
            "不要说不了解该项目，除非上方明确提示项目档案不可用。\n\n"
        )
    elif req.use_project_context:
        context_block = (
            "【项目信息状态】用户已开启“带入项目信息思考”，但后端没有找到当前账号可访问的项目档案。"
            "请先说明无法读取项目档案，再按用户当前输入做通用推演，并提醒用户回到正确项目后重试。\n\n"
        )
    else:
        context_block = ""
    messages = _filtered_free_chat_messages(req.messages, bool(context))
    if not messages:
        return f"{context_block}用户刚进入头脑风暴模式，请用一句简洁开场邀请用户说出一个商业点子、营销想法或新项目灵感。"
    lines = []
    for m in messages:
        who = "用户" if m.role == "user" else "助手"
        content = m.content.strip()
        if content:
            lines.append(f"{who}：{content}")
    history = "\n".join(lines) or "用户刚进入头脑风暴模式，请用一句简洁开场邀请用户说出一个商业点子、营销想法或新项目灵感。"
    return f"{context_block}{history}"


def _load_uploaded_summary(raw: str) -> dict:
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {"raw": parsed}
    except (TypeError, ValueError):
        return {"content_type": "legacy", "text": str(raw or "")}


async def _attachment_context_for_free_chat(
    session: AsyncSession,
    file_ids: list[str],
    user: User | None,
) -> str:
    ids = [file_id for file_id in dict.fromkeys(file_ids) if file_id]
    if not ids:
        return ""
    rows = list((await session.scalars(
        select(UploadedFile).where(UploadedFile.id.in_(ids))
    )).all())
    visible = [
        row for row in rows
        if row.user_id is None or (user is not None and row.user_id == user.id)
    ]
    if not visible:
        return ""
    lines = []
    for row in visible[:8]:
        summary = render_file_summary(row.original_name, _load_uploaded_summary(row.parsed_summary))
        if summary.strip():
            lines.append(f"【{row.original_name}】\n{summary[:1600]}")
    if not lines:
        return ""
    return (
        "【本轮上传资料摘要】\n"
        + "\n\n".join(lines)
        + "\n\n【资料使用要求】以上资料是用户本轮随消息发送的上下文。回答时必须阅读并引用其中可用事实；"
        "如果资料不足，请明确指出还缺什么，不要假装已经有数据。"
    )


def _clean_card_text(value: object, fallback: str = "") -> str:
    text = str(value or "").strip()
    if not text:
        return fallback
    return " ".join(text.split())


def _idea_card_response(card: IdeaCard) -> IdeaCardResponse:
    return IdeaCardResponse(
        id=card.id,
        project_id=card.project_id,
        created_at=card.created_at.isoformat(),
        updated_at=card.updated_at.isoformat(),
        status=card.status,
        title=card.title,
        one_liner=card.one_liner,
        source_context=card.source_context,
        target_customer=card.target_customer,
        pain_point=card.pain_point,
        value_proposition=card.value_proposition,
        core_assumption=card.core_assumption,
        contrary_risk=card.contrary_risk,
        validation_action=card.validation_action,
        next_step=card.next_step,
        confidence=card.confidence,
    )


def _brainstorm_title(messages: list[ChatMessage]) -> str:
    for message in messages:
        if message.role != "user":
            continue
        text = _clean_card_text(message.content)
        if text:
            return text[:28]
    return "风暴记录"


def _brainstorm_summary(row: BrainstormSession) -> BrainstormSessionSummary:
    return BrainstormSessionSummary(
        id=row.id,
        project_id=row.project_id,
        created_at=row.created_at.isoformat(),
        updated_at=row.updated_at.isoformat(),
        title=row.title or "风暴记录",
        is_pinned=row.is_pinned,
        use_project_context=row.use_project_context,
    )


def _can_access_brainstorm(row: BrainstormSession, user: User | None) -> bool:
    return row.user_id is None or (user is not None and row.user_id == user.id)


async def run_chat_turn(
    messages: list,
    llm: LLMClient,
    session: AsyncSession | None,
    project_memory: str = "",
) -> ChatResponse:
    """跑一轮对话：读 prompt（DB 优先）→ 调 LLM → 解析 phase/problem_map。

    供无状态 /conversation/chat 和有状态 /session/{id}/chat 共用。
    project_memory：所属项目的长期记忆，作为背景注入，让持续诊断能延续历史。
    """
    ver = await get_active_skill_version(session, "conversation_intake")
    system = ver.system_prompt if ver else CONVERSATION_INTAKE
    completeness_ver = await get_active_skill_version(session, "intake_completeness")
    completeness_prompt = (
        completeness_ver.system_prompt if completeness_ver else INTAKE_COMPLETENESS
    )
    system = system + "\n\n" + completeness_prompt
    system = system + INTAKE_MEMORY_RUNTIME_RULE

    # 注入项目长期记忆，让"再次诊断"能基于这个项目的历史，而非从零开始
    if project_memory.strip():
        system = (
            system
            + "\n\n【这个项目的历史诊断记忆（供参考，延续上下文）】\n"
            + project_memory
        )

    prompt = _format_history(ChatRequest(messages=messages))

    # LLM 网关偶尔抖动（超时/返回非 JSON），重试一次。
    # 如果仍失败，返回明确错误，不再伪装成“没听懂用户的话”。
    data: dict | None = None
    last_error: Exception | None = None
    for _ in range(2):
        try:
            raw = await llm.complete(system=system, prompt=prompt)
            data = parse_json_object(raw)
            break
        except Exception as exc:
            last_error = exc
            data = None
            continue

    if data is None:
        detail = LLM_UNAVAILABLE_MESSAGE
        if last_error:
            if isinstance(last_error, FallbackLLMError):
                detail = f"{detail}（已尝试通道：{'; '.join(last_error.failures)}）"
            else:
                detail = f"{detail}（错误类型：{last_error.__class__.__name__}）"
        raise HTTPException(
            status_code=503,
            detail=detail,
        )

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

    problem_map = annotate_problem_map(problem_map) or _draft_problem_map_from_history(messages)
    if phase in ("confirm", "done"):
        completeness = evaluate_problem_map(problem_map)
        if not completeness.can_confirm:
            return ChatResponse(
                message=build_intake_gate_message(completeness),
                done=False,
                phase="intake",
                problem_map=problem_map,
                summary=None,
            )

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


@router.post("/free-chat", response_model=FreeChatResponse)
async def free_chat(
    req: FreeChatRequest,
    user: User | None = Depends(get_optional_user),
    llm: LLMClient = Depends(get_llm_client),
    session: AsyncSession = Depends(get_session),
) -> FreeChatResponse:
    """头脑风暴对话：不创建诊断会话、不产出正式问题地图；项目内风暴会话会独立留存。"""
    ver = await get_active_skill_version(session, "free_chat")
    system = ver.system_prompt if ver else FREE_CHAT
    if req.use_project_context:
        system = system + PROJECT_CONTEXT_RUNTIME_RULE
    project_context = ""
    if req.use_project_context:
        project_context = await _project_context_for_free_chat(session, req.project_id, user)
    attachment_context = await _attachment_context_for_free_chat(session, req.attachment_file_ids, user)
    merged_context = "\n\n".join([part for part in [project_context, attachment_context] if part.strip()])
    if project_context and _is_project_identity_question(req.messages):
        message = _project_identity_answer(project_context)
        brainstorm_session_id = await _persist_brainstorm_turn(
            session=session,
            req=req,
            user=user,
            message=message,
        )
        return FreeChatResponse(message=message, brainstorm_session_id=brainstorm_session_id)
    prompt = _format_free_chat_history(req, merged_context)
    try:
        message = (await llm.complete(system=system, prompt=prompt)).strip()
    except Exception as exc:
        detail = (
            f"{LLM_UNAVAILABLE_MESSAGE}（已尝试通道：{'; '.join(exc.failures)}）"
            if isinstance(exc, FallbackLLMError)
            else f"{LLM_UNAVAILABLE_MESSAGE}（错误类型：{exc.__class__.__name__}）"
        )
        raise HTTPException(
            status_code=503,
            detail=detail,
        ) from exc
    message = message or "我在，说一个你想风暴的点子，我们先把它拆开看看。"
    brainstorm_session_id = await _persist_brainstorm_turn(
        session=session,
        req=req,
        user=user,
        message=message,
    )
    return FreeChatResponse(message=message, brainstorm_session_id=brainstorm_session_id)


async def _persist_brainstorm_turn(
    session: AsyncSession,
    req: FreeChatRequest,
    user: User | None,
    message: str,
) -> str | None:
    brainstorm_session_id = req.brainstorm_session_id
    if req.project_id and user is not None:
        project = await session.get(Project, req.project_id)
        if project is not None and project.user_id == user.id:
            row: BrainstormSession | None = None
            if req.brainstorm_session_id:
                candidate = await session.get(BrainstormSession, req.brainstorm_session_id)
                if (
                    candidate is not None
                    and candidate.deleted_at is None
                    and candidate.project_id == req.project_id
                    and _can_access_brainstorm(candidate, user)
                ):
                    row = candidate
            messages = list(req.messages)
            if not messages or messages[-1].role != "assistant" or messages[-1].content != message:
                messages.append(ChatMessage(role="assistant", content=message))
            if row is None:
                row = BrainstormSession(
                    user_id=user.id,
                    project_id=req.project_id,
                    title=_brainstorm_title(messages),
                    use_project_context=req.use_project_context,
                )
            elif not row.title_is_custom:
                row.title = _brainstorm_title(messages)
            row.messages_json = json.dumps([m.model_dump() for m in messages], ensure_ascii=False)
            row.use_project_context = req.use_project_context
            row.updated_at = datetime.now(timezone.utc)
            session.add(row)
            await session.commit()
            await session.refresh(row)
            brainstorm_session_id = row.id
    return brainstorm_session_id


@router.get("/brainstorm-sessions", response_model=list[BrainstormSessionSummary])
async def list_brainstorm_sessions(
    project_id: str | None = None,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[BrainstormSessionSummary]:
    stmt = (
        select(BrainstormSession)
        .where(BrainstormSession.user_id == user.id)
        .where(BrainstormSession.deleted_at.is_(None))
        .order_by(BrainstormSession.is_pinned.desc(), BrainstormSession.updated_at.desc())
    )
    if project_id:
        stmt = stmt.where(BrainstormSession.project_id == project_id)
    rows = list((await session.scalars(stmt)).all())
    visible = []
    for row in rows:
        try:
            messages = json.loads(row.messages_json or "[]")
        except (TypeError, ValueError):
            messages = []
        if messages:
            visible.append(_brainstorm_summary(row))
    return visible


@router.get("/brainstorm-sessions/{brainstorm_session_id}", response_model=BrainstormSessionDetail)
async def get_brainstorm_session(
    brainstorm_session_id: str,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> BrainstormSessionDetail:
    row = await session.get(BrainstormSession, brainstorm_session_id)
    if row is None or row.deleted_at is not None or not _can_access_brainstorm(row, user):
        raise HTTPException(status_code=404, detail="风暴记录不存在")
    return BrainstormSessionDetail(
        **_brainstorm_summary(row).model_dump(),
        messages=[ChatMessage.model_validate(m) for m in json.loads(row.messages_json or "[]")],
    )


@router.patch("/brainstorm-sessions/{brainstorm_session_id}", response_model=BrainstormSessionSummary)
async def patch_brainstorm_session(
    brainstorm_session_id: str,
    body: BrainstormSessionPatchRequest,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> BrainstormSessionSummary:
    row = await session.get(BrainstormSession, brainstorm_session_id)
    if row is None or row.deleted_at is not None or not _can_access_brainstorm(row, user):
        raise HTTPException(status_code=404, detail="风暴记录不存在")
    if body.title is not None:
        title = body.title.strip()
        if title:
            row.title = title[:80]
            row.title_is_custom = True
    if body.is_pinned is not None:
        row.is_pinned = body.is_pinned
    row.updated_at = datetime.now(timezone.utc)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _brainstorm_summary(row)


@router.delete("/brainstorm-sessions/{brainstorm_session_id}", status_code=204)
async def delete_brainstorm_session(
    brainstorm_session_id: str,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    row = await session.get(BrainstormSession, brainstorm_session_id)
    if row is None or row.deleted_at is not None or not _can_access_brainstorm(row, user):
        raise HTTPException(status_code=404, detail="风暴记录不存在")
    row.deleted_at = datetime.now(timezone.utc)
    row.is_pinned = False
    row.updated_at = row.deleted_at
    session.add(row)
    await session.commit()


@router.post("/idea-cards", response_model=IdeaCardResponse, status_code=201)
async def save_idea_card(
    req: SaveIdeaCardRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> IdeaCardResponse:
    """保存头脑风暴点子卡。"""
    card = req.card
    title = _clean_card_text(card.title) or _clean_card_text(card.one_liner) or "未命名点子"
    record = IdeaCard(
        user_id=user.id,
        project_id=req.project_id,
        title=title[:120],
        one_liner=_clean_card_text(card.one_liner),
        source_context=_clean_card_text(card.source_context),
        target_customer=_clean_card_text(card.target_customer),
        pain_point=_clean_card_text(card.pain_point),
        value_proposition=_clean_card_text(card.value_proposition),
        core_assumption=_clean_card_text(card.core_assumption),
        contrary_risk=_clean_card_text(card.contrary_risk),
        validation_action=_clean_card_text(card.validation_action),
        next_step=_clean_card_text(card.next_step),
        confidence=_clean_card_text(card.confidence, "待验证"),
        raw_card_json=card.model_dump_json(),
        messages_json=json.dumps([m.model_dump() for m in req.messages], ensure_ascii=False),
    )
    session.add(record)
    await session.commit()
    await session.refresh(record)
    return _idea_card_response(record)


@router.get("/idea-cards", response_model=list[IdeaCardResponse])
async def list_idea_cards(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[IdeaCardResponse]:
    stmt = (
        select(IdeaCard)
        .where(IdeaCard.user_id == user.id)
        .order_by(IdeaCard.updated_at.desc())
        .limit(50)
    )
    cards = list((await session.scalars(stmt)).all())
    return [_idea_card_response(card) for card in cards]
