import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_llm_client
from app.llm.base import LLMClient
from app.models.profile import BusinessProfile, GeneratedQuestionnaire
from app.models.conversation import ProblemSummary
from app.skills.parsing import parse_json_object
from app.skills.store import get_active_skill_version
from app.skills.prompts import QUESTIONNAIRE_BASE, QUESTIONNAIRE_AB_A, QUESTIONNAIRE_AB_B
from app.auth.jwt import get_optional_user
from app.db.database import get_session
from app.db.models import User, QuestionnairePreference

router = APIRouter(prefix="/questionnaire")

# 代码兜底（DB 无激活版本时用）
_SYSTEM = QUESTIONNAIRE_BASE
_SYSTEM_A = QUESTIONNAIRE_AB_A
_SYSTEM_B = QUESTIONNAIRE_AB_B


async def _prompt_for(session: AsyncSession | None, module: str, fallback: str) -> str:
    """优先用 DB 激活版本的 prompt，无则用代码兜底。"""
    ver = await get_active_skill_version(session, module)
    return ver.system_prompt if ver else fallback


class GenerateRequest(BaseModel):
    # profile（静态画像）和 summary（对话摘要）二选一，summary 优先
    profile: BusinessProfile | None = None
    summary: ProblemSummary | None = None


def _build_input(body: "GenerateRequest") -> str:
    """把 profile 或 summary 转成喂给生成 prompt 的 JSON 文本。

    summary 信息更丰富（含核心问题/背景/猜测原因），优先使用。
    """
    if body.summary is not None:
        return json.dumps(body.summary.model_dump(), ensure_ascii=False)
    if body.profile is not None:
        return json.dumps(body.profile.model_dump(), ensure_ascii=False)
    return ""


def _parse_questionnaire(raw: str) -> GeneratedQuestionnaire:
    data = parse_json_object(raw)
    return GeneratedQuestionnaire.model_validate(data)


@router.post("/generate", response_model=GeneratedQuestionnaire)
async def generate_questionnaire(
    body: GenerateRequest,
    llm: LLMClient = Depends(get_llm_client),
    session: AsyncSession = Depends(get_session),
) -> GeneratedQuestionnaire:
    prompt = _build_input(body)
    system = await _prompt_for(session, "questionnaire_ab_a", _SYSTEM)
    raw = await llm.complete(system=system, prompt=prompt)
    try:
        data = parse_json_object(raw)
        return GeneratedQuestionnaire.model_validate(data)
    except (ValueError, ValidationError):
        # LLM 输出不合规：返回 422，前端降级到固定问卷
        raise HTTPException(status_code=422, detail="问卷生成失败，请使用通用问卷")


class GenerateABResponse(BaseModel):
    option_a: GeneratedQuestionnaire
    option_b: GeneratedQuestionnaire


@router.post("/generate-ab", response_model=GenerateABResponse)
async def generate_ab(
    body: GenerateRequest,
    llm: LLMClient = Depends(get_llm_client),
    session: AsyncSession = Depends(get_session),
) -> GenerateABResponse:
    """并发生成两份候选问卷（A 全面型 / B 痛点型）供用户选择。

    任一份解析失败时，用成功的那份兜底两侧；两份都失败返回 422。
    """
    prompt = _build_input(body)
    system_a = await _prompt_for(session, "questionnaire_ab_a", _SYSTEM_A)
    system_b = await _prompt_for(session, "questionnaire_ab_b", _SYSTEM_B)
    raw_a, raw_b = await asyncio.gather(
        llm.complete(system=system_a, prompt=prompt),
        llm.complete(system=system_b, prompt=prompt),
    )

    parsed_a: GeneratedQuestionnaire | None = None
    parsed_b: GeneratedQuestionnaire | None = None
    try:
        parsed_a = _parse_questionnaire(raw_a)
    except (ValueError, ValidationError):
        parsed_a = None
    try:
        parsed_b = _parse_questionnaire(raw_b)
    except (ValueError, ValidationError):
        parsed_b = None

    if parsed_a is None and parsed_b is None:
        raise HTTPException(status_code=422, detail="问卷生成失败，请使用通用问卷")
    # 任一失败用另一份兜底，保证两侧都有内容
    if parsed_a is None:
        parsed_a = parsed_b
    if parsed_b is None:
        parsed_b = parsed_a

    return GenerateABResponse(option_a=parsed_a, option_b=parsed_b)


class RecordPreferenceRequest(BaseModel):
    profile: BusinessProfile
    option_a: GeneratedQuestionnaire
    option_b: GeneratedQuestionnaire
    chosen: str  # "a" 或 "b"


@router.post("/preference", status_code=201)
async def record_preference(
    body: RecordPreferenceRequest,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, bool]:
    if body.chosen not in ("a", "b"):
        raise HTTPException(status_code=422, detail="chosen 必须是 a 或 b")
    record = QuestionnairePreference(
        user_id=user.id if user else None,
        industry=body.profile.industry,
        profile_json=body.profile.model_dump_json(),
        option_a_json=body.option_a.model_dump_json(),
        option_b_json=body.option_b.model_dump_json(),
        chosen=body.chosen,
    )
    session.add(record)
    await session.commit()
    return {"ok": True}
