"""对话式追问入口：像顾问一样一次一问，锁定企业核心问题。

无状态——前端每次传完整 messages 历史。AI 判断信息充分后返回 done=true + summary，
前端据此进入问卷生成（summary 替代静态画像）。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from app.config import get_llm_client
from app.llm.base import LLMClient
from app.models.conversation import ChatRequest, ChatResponse, ProblemSummary
from app.skills.parsing import parse_json_object

router = APIRouter(prefix="/conversation")

_SYSTEM = """你是一位顶级管理咨询顾问，正在和一位企业老板做初次接触谈话（intake）。
你的目标：用最多 3-5 个问题，从对方模糊的描述里，精准锁定这家企业当前最核心的一个问题。

铁律：
1. 一次只问一个问题，绝不一次问两个或抛清单
2. 先让对方用自己的话描述，不要替他预设问题或下结论
3. 追问优先级：问题具体是什么 > 持续多久/多严重 > 你认为的原因 > 已经试过什么 > 不解决会怎样
4. 不要直接问"你是什么行业、几个人、年营收多少"这类填表式问题——这些从对话内容里自然推断
5. 语气专业、简洁、有同理心，像真顾问而非问卷机器

当你已经能清晰说出"这家企业最核心的一个问题、相关背景、对方猜测的原因"时，结束追问。

严格只输出 JSON，不要任何额外文字：
{
  "done": false,            // 还需继续追问时 false
  "message": "你的下一个问题（仅一个问题）",
  "summary": null
}
或信息充分时：
{
  "done": true,
  "message": "一句收尾话，告诉对方你已了解，将据此定制诊断",
  "summary": {
    "core_problem": "核心问题一句话",
    "context": "追问得到的背景信息",
    "suspected_cause": "对方猜测的原因",
    "tried": "已经尝试过的措施",
    "company_name": "如对话提及，否则留空",
    "industry": "从对话推断的行业，否则留空",
    "main_business": "主营业务，从对话推断",
    "business_model": "商业模式，从对话推断",
    "scale": "规模，从对话推断，否则留空",
    "stage": "发展阶段，从对话推断，否则留空"
  }
}"""


def _format_history(req: ChatRequest) -> str:
    if not req.messages:
        return "（对话刚开始，请用一句开场白邀请对方描述最头疼的问题）"
    lines = []
    for m in req.messages:
        who = "老板" if m.role == "user" else "顾问"
        lines.append(f"{who}：{m.content}")
    return "\n".join(lines)


@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    llm: LLMClient = Depends(get_llm_client),
) -> ChatResponse:
    prompt = _format_history(req)
    raw = await llm.complete(system=_SYSTEM, prompt=prompt)
    try:
        data = parse_json_object(raw)
    except (ValueError, ValidationError):
        raise HTTPException(status_code=502, detail="对话生成失败")

    done = bool(data.get("done", False))
    message = data.get("message", "能再具体说说吗？")
    summary = None
    if done:
        raw_summary = data.get("summary") or {}
        try:
            summary = ProblemSummary.model_validate(raw_summary)
        except ValidationError:
            summary = ProblemSummary(core_problem=message)
    return ChatResponse(message=message, done=done, summary=summary)
