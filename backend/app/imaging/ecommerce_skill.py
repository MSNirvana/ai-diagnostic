"""Built-in ecommerce visual skill catalog and prompt assembly rules."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class EcommerceScene:
    id: str
    name: str
    description: str
    keywords: tuple[str, ...]
    default_ratio: str
    composition: str
    lighting: str
    negative_constraints: tuple[str, ...]


SKILL_ID = "ecommerce-visual"
SKILL_VERSION = "v1"

SCENES: tuple[EcommerceScene, ...] = (
    EcommerceScene("hero", "白底商品主图", "清晰展示商品本身，适合电商首图", ("主图", "白底", "packshot"), "1:1", "产品居中，占画面 35%-40%，正面或 3/4 视角", "柔和均匀的棚拍光线", ("额外道具", "额外产品", "虚构文字", "假 logo")),
    EcommerceScene("lifestyle", "生活方式场景", "展示商品在真实生活中的使用氛围", ("场景图", "生活方式", "lifestyle"), "1:1", "产品占画面 20%-30%，环境承担情绪，主体仍清晰可见", "自然方向光和真实环境阴影", ("过度磨皮", "不相关道具", "虚构人物身份", "假 logo")),
    EcommerceScene("benefit-detail", "卖点详情图", "把核心功能和利益点组织成易扫读的信息图", ("卖点", "详情图", "信息图", "A+"), "2:3", "结构化双栏或网格布局，产品与 2-4 个卖点标签形成层级", "清晰、均匀、适合阅读的商业光线", ("大段小字", "虚构数据", "虚构认证", "不可读文字")),
    EcommerceScene("usage-steps", "使用步骤图", "降低理解成本，展示 3-4 步使用流程", ("步骤", "怎么用", "使用方法"), "2:3", "编号步骤或时间线布局，每步一个动作，最终效果作为收束", "明亮清晰的说明性光线", ("缺失步骤", "虚构功能", "大段文字", "假 logo")),
    EcommerceScene("size-spec", "尺寸规格图", "展示尺寸、容量、材质或规格关系", ("尺寸", "规格", "参数"), "2:3", "产品配尺寸标注、比例参照或简洁规格表，保持移动端可读", "均匀光线，避免遮挡测量区域", ("虚构尺寸", "虚构参数", "密集小字", "假认证")),
    EcommerceScene("before-after", "前后对比图", "用可观察差异表达产品解决的问题", ("对比", "前后", "before after"), "2:3", "清晰对照布局，前后状态可比较，产品或使用动作作为证据中心", "一致的光线和视角，避免夸张效果", ("医疗承诺", "虚构效果", "虚构数据", "误导性标签")),
    EcommerceScene("ugc", "UGC 真实使用图", "适合社媒、买家秀和真实使用语境", ("UGC", "买家秀", "真实使用"), "4:5", "手机拍摄感，轻微不完美构图，商品在真实环境中自然出现", "手机环境光，轻微噪点和自然色偏", ("棚拍感", "过度磨皮", "完美无瑕", "虚构评价")),
    EcommerceScene("poster-social", "海报与社媒推广图", "用于活动、上新和社交媒体传播", ("海报", "Banner", "社媒", "促销"), "4:5", "产品占画面约 40%，保留标题、卖点和行动区域的清晰层级", "具有方向性的商业广告光线", ("虚构价格", "虚构活动时间", "假 logo", "密集文字")),
)

STYLE_VARIANTS = {
    "clean": {"name": "清透专业", "prompt": "clean commercial ecommerce visual, restrained palette, crisp product edges"},
    "minimal": {"name": "极简留白", "prompt": "minimal composition, generous whitespace, quiet premium presentation"},
    "luxury": {"name": "高级质感", "prompt": "premium editorial product direction, controlled contrast, refined material texture"},
    "tech": {"name": "科技感", "prompt": "modern technology campaign direction, precise highlights, cool controlled contrast"},
}

CATEGORY_TIPS = {
    "beauty": "emphasize formula texture, packaging finish, controlled reflections and skin-safe factual presentation",
    "electronics": "show material finish, ports, controls, screen details and construction precision without inventing specifications",
    "food": "emphasize freshness, color, surface texture and serving context without inventing nutrition claims",
    "fashion": "show fabric texture, drape, stitching and fit using the supplied product reference",
    "home": "show material quality, scale, craftsmanship and practical use in a believable environment",
    "jewelry": "use macro detail, accurate metal and stone reflections, craftsmanship and restrained luxury lighting",
}

CATEGORY_LABELS = {
    "beauty": "美妆个护",
    "electronics": "电子数码",
    "food": "食品饮料",
    "fashion": "服饰鞋包",
    "home": "家居生活",
    "jewelry": "珠宝配饰",
}

MARKET_SCOPES = {
    "domestic": {
        "name": "国内电商",
        "prompt": "面向中国大陆电商渠道，优先考虑中文信息层级、移动端商品展示习惯和国内平台首图清晰度；不要虚构平台规则或宣传承诺",
    },
    "overseas": {
        "name": "海外/跨境电商",
        "prompt": "面向海外或跨境电商渠道，优先考虑国际化视觉、目标市场阅读习惯、跨境商品展示和简洁的英文或无文字信息层级；不要虚构当地法规、认证或宣传承诺",
    },
}

CONVERSION_DRIVERS = {
    "visual": {"name": "突出外观", "prompt": "make visual appeal, material quality and product clarity the primary conversion signal"},
    "pain_point": {"name": "解决痛点", "prompt": "show the concrete user problem first, then make the product mechanism and observable benefit easy to understand"},
    "trust": {"name": "建立信任", "prompt": "prioritize clear evidence, material details, usage clarity and honest proof over exaggerated claims"},
}


def _catalog_item(item: EcommerceScene) -> dict[str, object]:
    return {
        "id": item.id,
        "name": item.name,
        "description": item.description,
        "keywords": list(item.keywords),
        "default_ratio": item.default_ratio,
        "composition": item.composition,
        "lighting": item.lighting,
        "negative_constraints": list(item.negative_constraints),
    }


def get_scene(scene_id: str | None) -> EcommerceScene:
    requested = (scene_id or "hero").strip() or "hero"
    for scene in SCENES:
        if scene.id == requested:
            return scene
    raise ValueError("未知的电商场景")


def get_style_variant(style_variant: str | None) -> dict[str, str]:
    requested = (style_variant or "clean").strip() or "clean"
    try:
        return STYLE_VARIANTS[requested]
    except KeyError as exc:
        raise ValueError("未知的电商风格") from exc


def get_conversion_driver(driver: str | None) -> dict[str, str]:
    requested = (driver or "visual").strip() or "visual"
    try:
        return CONVERSION_DRIVERS[requested]
    except KeyError as exc:
        raise ValueError("未知的转化目标") from exc


def get_category_tip(category: str | None) -> str:
    requested = (category or "").strip()
    if not requested:
        return ""
    try:
        return CATEGORY_TIPS[requested]
    except KeyError as exc:
        raise ValueError("未知的商品品类") from exc


def get_market_scope(scope: str | None) -> dict[str, str]:
    requested = (scope or "domestic").strip() or "domestic"
    try:
        return MARKET_SCOPES[requested]
    except KeyError as exc:
        raise ValueError("未知的电商市场范围") from exc


def skill_catalog() -> dict[str, object]:
    return {
        "skill_id": SKILL_ID,
        "skill_version": SKILL_VERSION,
        "scenes": [_catalog_item(scene) for scene in SCENES],
        "styles": [{"id": key, **value} for key, value in STYLE_VARIANTS.items()],
        "categories": [{"id": key, "name": CATEGORY_LABELS[key], "prompt": value} for key, value in CATEGORY_TIPS.items()],
        "market_scopes": [{"id": key, **value} for key, value in MARKET_SCOPES.items()],
        "conversion_drivers": [{"id": key, **value} for key, value in CONVERSION_DRIVERS.items()],
    }


def build_ecommerce_prompt(
    *,
    anchor_description: str,
    user_intent: str,
    size: str,
    scene_id: str | None = None,
    conversion_driver: str | None = None,
    product_category: str | None = None,
    market_scope: str | None = None,
    style_variant: str | None = None,
) -> tuple[str, dict[str, object]]:
    scene = get_scene(scene_id)
    style = get_style_variant(style_variant)
    driver = get_conversion_driver(conversion_driver)
    category_tip = get_category_tip(product_category)
    market = get_market_scope(market_scope)
    anchor = anchor_description.strip() if anchor_description else "无参考图片事实锚点"
    components = {
        "skill_id": SKILL_ID,
        "skill_version": SKILL_VERSION,
        "scene_id": scene.id,
        "conversion_driver": conversion_driver or "visual",
        "product_category": product_category or "",
        "market_scope": market_scope or "domestic",
        "style_variant": style_variant or "clean",
        "scene": _catalog_item(scene),
        "style": style,
        "driver": driver,
        "category_tip": category_tip,
        "anchor_description": anchor,
    }
    prompt = "\n".join(
        [
            f"E-commerce visual task: {scene.name}. {scene.description}.",
            f"Product facts from reference image: {anchor}",
            f"User intent: {user_intent.strip()}",
            f"Conversion goal: {driver['prompt']}.",
            f"Composition: {scene.composition}.",
            f"Lighting: {scene.lighting}.",
            f"Style: {style['prompt']}.",
            f"Category guidance: {category_tip or 'use only observable product facts; do not invent category claims'}.",
            f"Market guidance: {market['prompt']}.",
            f"Canvas size: {size}.",
            "Keep copy short and readable; use placeholders when supplied claims are missing.",
            "Do not invent brand, price, certification, rating, review, sales, medical result, specification or logo.",
            "Negative constraints: " + ", ".join(scene.negative_constraints) + ".",
        ]
    )
    return prompt, components
