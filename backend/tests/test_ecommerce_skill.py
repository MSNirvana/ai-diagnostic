import pytest

from app.imaging.ecommerce_skill import (
    SCENES,
    build_ecommerce_prompt,
    get_category_tip,
    get_conversion_driver,
    get_scene,
    get_style_variant,
    skill_catalog,
)


def test_catalog_exposes_eight_scenes_and_supported_dimensions():
    catalog = skill_catalog()

    assert len(catalog["scenes"]) == 8
    assert {item["id"] for item in catalog["styles"]} == {"clean", "minimal", "luxury", "tech"}
    assert {item["id"] for item in catalog["conversion_drivers"]} == {
        "visual",
        "pain_point",
        "trust",
    }


def test_prompt_uses_scene_category_style_and_conversion_rules():
    prompt, components = build_ecommerce_prompt(
        anchor_description="透明磨砂玻璃护肤瓶，白色旋盖，瓶身无可见文字",
        user_intent="生成适合移动端详情页的核心卖点图",
        size="1024x1536",
        scene_id="benefit-detail",
        conversion_driver="trust",
        product_category="beauty",
        style_variant="minimal",
    )

    assert "卖点详情图" in prompt
    assert "透明磨砂玻璃护肤瓶" in prompt
    assert "formula texture" in prompt
    assert "honest proof" in prompt
    assert "generous whitespace" in prompt
    assert "Do not invent brand, price, certification" in prompt
    assert components["skill_id"] == "ecommerce-visual"
    assert components["scene_id"] == "benefit-detail"


def test_defaults_are_stable_and_unknown_values_are_rejected():
    prompt, components = build_ecommerce_prompt(
        anchor_description="一只白色陶瓷杯",
        user_intent="生成商品图",
        size="1024x1024",
    )

    assert len(SCENES) == 8
    assert components["scene_id"] == "hero"
    assert "白底商品主图" in prompt

    with pytest.raises(ValueError, match="未知的电商场景"):
        get_scene("unknown")
    with pytest.raises(ValueError, match="未知的电商风格"):
        get_style_variant("unknown")
    with pytest.raises(ValueError, match="未知的转化目标"):
        get_conversion_driver("unknown")
    with pytest.raises(ValueError, match="未知的商品品类"):
        get_category_tip("unknown")
