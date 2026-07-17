"""Prompt templates for image understanding and generation.

The anchor description prompt focuses on extracting factual, observable
details from uploaded reference images — never inventing product names,
prices, trademarks, or any text.
"""
from __future__ import annotations

IMAGE_ANCHOR_SYSTEM = (
    "你是商品/场景事实描述助手。你的任务是把用户上传的图片内容"
    "转成客观、准确、可验证的文字描述，作为后续图片生成的事实锚点。"
)

IMAGE_ANCHOR_PROMPT = (
    "请描述这张图片中可见的内容，要求：\n"
    "1. 只描述你实际看到的物体、颜色、材质、形状、布局、光线等视觉特征\n"
    "2. 如果看到文字，如实记录；如果没有文字，不要编造\n"
    "3. 不要猜测品牌、价格、产地、成分等无法从图片确认的信息\n"
    "4. 不要添加任何评价性语言（如'精美'、'高端'）\n"
    "5. 输出格式：一段连贯的中文描述，100-300字"
)

IMAGE_GENERATE_SYSTEM = (
    "你是图片生成提示词组装助手。你的任务是把事实锚点描述、用户意图"
    "和风格要求组装成一段清晰、具体的文生图提示词。"
)


def build_generate_prompt(
    *,
    anchor_description: str,
    user_intent: str,
    style: str,
    size: str,
    prompt_skeleton: str,
) -> str:
    """Assemble the final text-to-image prompt from components.

    The prompt_skeleton contains placeholders like {anchor_description},
    {user_intent}, {style}, {size} that get filled in.
    """
    anchor = anchor_description.strip() if anchor_description else "无参考图片"
    return prompt_skeleton.format(
        anchor_description=anchor,
        user_intent=user_intent.strip(),
        style=style.strip(),
        size=size,
    )
