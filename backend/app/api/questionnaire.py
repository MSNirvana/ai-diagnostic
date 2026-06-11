import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ValidationError

from app.config import get_llm_client
from app.llm.base import LLMClient
from app.models.profile import BusinessProfile, GeneratedQuestionnaire
from app.skills.parsing import parse_json_object

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
