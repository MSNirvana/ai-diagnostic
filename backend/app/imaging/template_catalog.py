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
        "promo-festival", "promo", "节日限定主题", "节日氛围明确，适合活动预热与社媒传播", "2:3", None,
        "节日主题宣传图，建立节日氛围、产品主体和行动信息的层级；不得虚构节日活动日期、价格或品牌标识。",
    ),
    ImageTemplate(
        "promo-live", "promo", "直播间促销图", "突出直播活动和行动信息，适合直播预热", "2:3", None,
        "直播促销视觉，突出商品主体、活动利益点和行动区域；活动时间、价格和优惠只使用用户明确提供的信息。",
    ),
    ImageTemplate(
        "promo-social", "promo", "社交媒体宣传图", "适合社交平台发布和内容传播", "2:3", None,
        "社交媒体传播视觉，首屏主体明确，保留标题、卖点和品牌安全区；避免密集文字和无法确认的宣传承诺。",
    ),
    ImageTemplate(
        "ecommerce-studio", "ecommerce", "清透商品主图", "干净背景突出商品，适合作为首图展示", "1:1", "hero",
        "商品主图优先，保持产品形状、颜色、材质和可见文字准确；背景干净，避免额外道具和虚构标识。",
    ),
    ImageTemplate(
        "ecommerce-life", "ecommerce", "生活方式场景", "用真实使用氛围表达商品价值和生活感", "2:3", "lifestyle",
        "生活方式电商场景，产品仍然清晰可辨；环境服务于使用情境，不添加无法确认的功能、人物身份或品牌信息。",
    ),
    ImageTemplate(
        "ecommerce-detail", "ecommerce", "卖点详情图", "围绕功能、材质、尺寸组织卖点信息", "2:3", "benefit-detail",
        "详情图按产品、功能、材质和卖点分区组织；只使用已提供或可观察的事实，文字保持短而可读。",
    ),
    ImageTemplate(
        "ecommerce-usage", "ecommerce", "使用场景图", "展示商品在真实环境中的使用方式", "2:3", "lifestyle",
        "使用场景图强调真实环境、使用动作和商品主体；环境服务于商品，不虚构功能、身份或品牌信息。",
    ),
    ImageTemplate(
        "ecommerce-spec", "ecommerce", "尺寸参数图", "展示尺寸、容量、材质或规格关系", "2:3", "size-spec",
        "规格信息图只展示用户提供或图片可确认的尺寸、容量和材质；保持标注清晰，不生成虚构参数。",
    ),
    ImageTemplate(
        "ecommerce-comparison", "ecommerce", "对比效果图", "用清晰对照表达产品解决的问题", "2:3", "before-after",
        "前后对比需要保持视角和光线一致，只呈现可观察差异，不添加医疗承诺、虚构数据或夸张效果。",
    ),
    ImageTemplate(
        "content-cover", "content", "内容平台封面", "适合小红书、公众号和短视频封面", "2:3", None,
        "内容封面需要在移动端首屏建立清晰主体和标题层级，保留安全边距，不编造标题事实或品牌信息。",
    ),
    ImageTemplate(
        "template-brand", "template", "品牌上新模板", "保留品牌留白和版式，替换商品与文案即可使用", "1:1", None,
        "品牌上新模板保留稳定的品牌安全区和版式节奏；商品、文案和标识只使用用户提供的事实，不生成假品牌信息。",
    ),
    ImageTemplate(
        "template-social", "template", "社媒内容卡片", "适合小红书、朋友圈等内容发布场景", "2:3", None,
        "社媒内容卡片优先移动端首屏阅读，建立标题、主体和卖点层级；不虚构数据、评价或活动承诺。",
    ),
    ImageTemplate(
        "template-minimal", "template", "极简产品展示", "结构清晰、信息克制，适合长期复用", "1:1", None,
        "极简产品展示使用克制留白和稳定构图突出商品本体；不得添加无法确认的规格、品牌或宣传文字。",
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
