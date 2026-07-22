"""User-facing image template catalog with private prompt guidance.

The catalog exposes stable template IDs and recommended settings. Prompt
guidance stays server-side so the frontend only needs to render business
choices and cannot drift from the backend prompt contract.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ImageTemplate:
    id: str
    preset_id: str
    name: str
    description: str
    recommended_ratio: str
    scene_id: str | None
    prompt_guidance: str


TEMPLATES: tuple[ImageTemplate, ...] = (
    ImageTemplate(
        "promo-weekend", "promo", "周末门店活动", "大标题与活动利益点，适合门店引流", "1:1", None,
        "商业活动海报，建立清晰的标题区、利益点区、品牌区和行动区；保留活动信息占位，不编造价格、时间或优惠承诺。",
    ),
    ImageTemplate(
        "promo-launch", "promo", "新品上新海报", "突出新品主体与上新信息，保留品牌落款", "1:1", None,
        "新品发布海报，产品是唯一视觉主体；使用克制的新品标题和卖点层级，保留品牌落款与信息安全区。",
    ),
    ImageTemplate(
        "promo-festival", "promo", "节日限定主题", "节日氛围明确，适合活动预热与社媒传播", "4:5", None,
        "节日主题宣传图，建立节日氛围、产品主体和行动信息的层级；不得虚构节日活动日期、价格或品牌标识。",
    ),
    ImageTemplate(
        "ecommerce-studio", "ecommerce", "清透商品主图", "干净背景突出商品，适合作为首图展示", "1:1", "hero",
        "商品主图优先，保持产品形状、颜色、材质和可见文字准确；背景干净，避免额外道具和虚构标识。",
    ),
    ImageTemplate(
        "ecommerce-life", "ecommerce", "生活方式场景", "用真实使用氛围表达商品价值和生活感", "4:5", "lifestyle",
        "生活方式电商场景，产品仍然清晰可辨；环境服务于使用情境，不添加无法确认的功能、人物身份或品牌信息。",
    ),
    ImageTemplate(
        "ecommerce-detail", "ecommerce", "卖点详情图", "围绕功能、材质、尺寸组织卖点信息", "2:3", "benefit-detail",
        "详情图按产品、功能、材质和卖点分区组织；只使用已提供或可观察的事实，文字保持短而可读。",
    ),
)


def get_template(template_id: str | None, preset_id: str | None = None) -> ImageTemplate:
    if template_id:
        for template in TEMPLATES:
            if template.id == template_id:
                if preset_id and template.preset_id != preset_id:
                    break
                return template
        raise ValueError("未知的图片模板")
    for template in TEMPLATES:
        if template.preset_id == preset_id:
            return template
    raise ValueError("未知的图片预设")


def template_catalog() -> dict[str, object]:
    return {
        "version": "v1",
        "templates": [
            {
                "id": item.id,
                "preset_id": item.preset_id,
                "name": item.name,
                "description": item.description,
                "recommended_ratio": item.recommended_ratio,
                "scene_id": item.scene_id,
            }
            for item in TEMPLATES
        ],
    }
