"""案例脱敏（Loop 3 案例飞轮第一关）。

把一次真实诊断脱敏成可跨客户复用的"案例资产"：去掉能定位到具体项目的信息，
保留行业结构、场景、KPI 量级——后者才是 skill 飞轮要学的料。

纯函数、无 LLM：快、确定、可测。脱敏是隐私底线，不能依赖会抽风的外部调用。
"""
from __future__ import annotations

import re

# 需要直接抹掉的定位性字段（项目名、公司名、联系人、品牌名等）
_PII_KEYS = ("company_name", "公司名", "企业名称", "brand", "品牌名", "contact", "联系人", "联系方式", "phone", "电话", "法人")

# 数字模糊化：把精确金额/规模映射到量级区间，保留"大概多大"但不暴露真实经营数字。
_MONEY_UNIT_RE = re.compile(r"(\d[\d,\.]*)\s*(万元|万|亿元|亿|元|w|W|k|K)")


def _bucket_amount(value: float, unit: str) -> str:
    """把金额规整到量级区间（保留量级信号，抹掉精确值）。"""
    # 统一换算成"万"
    u = unit.lower()
    if unit in ("亿元", "亿"):
        wan = value * 10000
    elif unit in ("万元", "万", "w"):
        wan = value
    elif u == "k":
        wan = value / 10
    else:  # 元
        wan = value / 10000
    buckets = [
        (1, "1万以内"), (10, "1-10万"), (50, "10-50万"), (100, "50-100万"),
        (500, "100-500万"), (1000, "500-1000万"), (5000, "1000-5000万"),
        (10000, "5000万-1亿"),
    ]
    for ceil, label in buckets:
        if wan < ceil:
            return label
    return "1亿以上"


def fuzz_numbers(text: str) -> str:
    """把文本里的精确金额模糊成量级区间。百分比/比率等小数字保留（KPI 要用）。"""
    def _repl(m: re.Match) -> str:
        raw, unit = m.group(1), m.group(2)
        try:
            value = float(raw.replace(",", ""))
        except ValueError:
            return m.group(0)
        # 只模糊"金额"类（带元/万/亿/k），不动百分比和纯比率
        return _bucket_amount(value, unit)
    return _MONEY_UNIT_RE.sub(_repl, text)


def anonymize_profile(profile: dict | None) -> dict:
    """脱敏项目画像：删定位字段、模糊金额，保留行业/规模/阶段等结构性标签。"""
    if not profile:
        return {}
    out: dict = {}
    for key, value in profile.items():
        if any(pii in key for pii in _PII_KEYS):
            continue  # 直接抹掉定位字段
        if isinstance(value, str):
            out[key] = fuzz_numbers(value)
        else:
            out[key] = value
    return out


def anonymize_problem_map(problem_map: dict | None) -> dict:
    """脱敏问题地图：同画像规则，但保留 industry/scenario 等飞轮要用的结构标签。"""
    if not problem_map:
        return {}
    out: dict = {}
    for key, value in problem_map.items():
        if any(pii in key for pii in _PII_KEYS):
            continue
        if isinstance(value, str):
            out[key] = fuzz_numbers(value)
        elif isinstance(value, list):
            out[key] = [fuzz_numbers(v) if isinstance(v, str) else v for v in value]
        else:
            out[key] = value
    return out


def anonymize_text(text: str) -> str:
    """脱敏自由文本（结论、证据等）：模糊金额。项目名通常不出现在结论里，但金额会。"""
    return fuzz_numbers(text or "")
