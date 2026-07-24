"""Preset definitions for the image tool's basic mode.

Four entry points share the same backend pipeline; they differ only in
preset data (task type copy, default style, default aspect ratio).
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ImagePreset:
    id: str
    name: str
    tagline: str
    default_style: str
    default_size: str
    prompt_skeleton: str


PRESETS: dict[str, ImagePreset] = {
    "promo": ImagePreset(
        id="promo",
        name="一键生成宣传图",
        tagline="为门店、活动、产品快速生成宣传海报",
        default_style="明亮、高饱和、商业摄影感、突出主体",
        default_size="1024x1024",
        prompt_skeleton=(
            "基于以下商品/场景事实描述，生成一张宣传海报。"
            "事实描述：{anchor_description}\n"
            "用户意图：{user_intent}\n"
            "风格要求：{style}\n"
            "画面比例：{size}\n"
            "要求：主体突出、色彩鲜明、适合社交媒体传播，"
            "不要虚构商品名称、价格、商标或任何文字信息。"
        ),
    ),
    "ecommerce": ImagePreset(
        id="ecommerce",
        name="一键生成电商图",
        tagline="为商品生成主图、详情图、场景图",
        default_style="干净、专业、电商白底或场景化展示",
        default_size="1024x1024",
        prompt_skeleton=(
            "基于以下商品事实描述，生成一张电商展示图。"
            "事实描述：{anchor_description}\n"
            "用户意图：{user_intent}\n"
            "风格要求：{style}\n"
            "画面比例：{size}\n"
            "要求：商品主体清晰、背景简洁或场景化、适合电商平台使用，"
            "不要虚构商品名称、价格、商标或任何文字信息。"
        ),
    ),
    "content": ImagePreset(
        id="content",
        name="一键生成内容配图",
        tagline="为社交媒体、公众号和短视频生成配图",
        default_style="清晰、易读、适合移动端传播",
        default_size="1024x1536",
        prompt_skeleton=(
            "基于以下商品/主题事实描述，生成一张内容平台配图。"
            "事实描述：{anchor_description}\n"
            "用户意图：{user_intent}\n"
            "风格要求：{style}\n"
            "画面比例：{size}\n"
            "要求：移动端首屏主体明确、标题层级清晰、保留安全边距，"
            "不要虚构品牌、价格、数据或无法确认的文字信息。"
        ),
    ),
    "template": ImagePreset(
        id="template",
        name="从模板开始",
        tagline="选择预设模板，快速生成定制化图片",
        default_style="简约、现代、模板化布局",
        default_size="1024x1024",
        prompt_skeleton=(
            "基于以下参考内容，生成一张模板化图片。"
            "参考内容：{anchor_description}\n"
            "用户意图：{user_intent}\n"
            "风格要求：{style}\n"
            "画面比例：{size}\n"
            "要求：布局规整、视觉层次清晰、适合快速迭代修改，"
            "不要虚构任何文字信息。"
        ),
    ),
}


def get_preset(preset_id: str) -> ImagePreset | None:
    return PRESETS.get(preset_id)


def list_presets() -> list[ImagePreset]:
    return list(PRESETS.values())
