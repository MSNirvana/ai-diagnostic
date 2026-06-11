import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_llm_client
from app.llm.base import LLMClient
from app.models.profile import BusinessProfile, GeneratedQuestionnaire
from app.skills.parsing import parse_json_object
from app.auth.jwt import get_optional_user
from app.db.database import get_session
from app.db.models import User, QuestionnairePreference

router = APIRouter(prefix="/questionnaire")

_SYSTEM = """你是顶级管理咨询的企业诊断问卷设计专家。
根据用户的业务画像，为这家公司量身定制六个诊断模块的问卷字段。

模块固定为这六个（key 必须用英文）：
- market（市场与客户）
- product（产品与服务）
- sales（营销与销售）
- ops（运营与供应链）
- org（组织与人才）
- finance（财务与资本）

要求：
1. 字段必须贴合该行业实际——直播公司问 GMV/坑位费/退货率/主播数；钢铁厂问产能利用率/吨钢成本/能耗/库存周转。绝不能用通用模板。
2. 每个模块 4-6 个字段，key 全局唯一（可用中文）
3. accept_file=true 只给"有数据表支撑"的定量字段（如营收明细、销售流水、客户清单）
4. 每个模块给 3-5 个贴合该行业的 pains 痛点选项
5. 每个字段的 placeholder 给具体示例值，引导用户填写

严格输出 JSON，不要任何额外文字，格式：
{
  "modules": [
    {
      "key": "market",
      "label": "市场与客户",
      "subtitle": "一句话说明这个模块诊断什么",
      "fields": [
        {"key": "字段key", "label": "显示名", "placeholder": "示例值", "hint": "填写提示(可选)", "accept_file": false}
      ],
      "pains": ["痛点1", "痛点2", "痛点3"],
      "free_text_label": "补充说明的标签文字"
    }
  ]
}"""


class GenerateRequest(BaseModel):
    profile: BusinessProfile


# A/B 两种生成偏置：在基础 prompt 上追加不同侧重，让两份候选有明显差异
_SYSTEM_A = _SYSTEM + """

【本次生成的特别侧重：全面覆盖】
优先确保每个关键经营指标都有对应字段，构建完整的诊断数据地图，宁全勿缺。"""

_SYSTEM_B = _SYSTEM + """

【本次生成的特别侧重：痛点深挖】
优先贴合该公司最迫切的核心问题，每个字段都应直接服务于诊断其关键痛点，宁精勿泛。"""


def _parse_questionnaire(raw: str) -> GeneratedQuestionnaire:
    data = parse_json_object(raw)
    return GeneratedQuestionnaire.model_validate(data)


@router.post("/generate", response_model=GeneratedQuestionnaire)
async def generate_questionnaire(
    body: GenerateRequest,
    llm: LLMClient = Depends(get_llm_client),
) -> GeneratedQuestionnaire:
    prompt = json.dumps(body.profile.model_dump(), ensure_ascii=False)
    raw = await llm.complete(system=_SYSTEM, prompt=prompt)
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
) -> GenerateABResponse:
    """并发生成两份候选问卷（A 全面型 / B 痛点型）供用户选择。

    任一份解析失败时，用成功的那份兜底两侧；两份都失败返回 422。
    """
    prompt = json.dumps(body.profile.model_dump(), ensure_ascii=False)
    raw_a, raw_b = await asyncio.gather(
        llm.complete(system=_SYSTEM_A, prompt=prompt),
        llm.complete(system=_SYSTEM_B, prompt=prompt),
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
