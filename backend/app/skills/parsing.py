"""健壮地把 LLM 返回的文本解析成结果模型。

真实 LLM 输出不稳定：可能用 ```json 代码块包裹、字段名漂移、
缺字段。这里做防御性解析，让 skill 不会因为模型一次发挥失常就整体崩溃。
所有 skill 共用本模块。
"""
import json
import re
from app.models.result import Evidence, DrillDown

_FENCE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)
_TRAILING_COMMA = re.compile(r",(\s*[}\]])")
# 中文全角引号/书名号：出现在字符串值内部时不是 JSON 结构符，
# 但模型有时用半角双引号 " 包中文短语（如 "高签约"低存活），会提前闭合字符串。
# 把这些"内容性引号"统一换成安全的全角引号，避免破坏 JSON 结构。
_SMART_QUOTES = {
    "“": "「",  # " → 「
    "”": "」",  # " → 」
}


def _repair_common_defects(text: str) -> str:
    """修复真实 LLM 输出最常见的 JSON 毛病（保守，只动有把握的）。

    1. 尾随逗号：{"a":1,} / [1,2,] —— 合法 JSON 不允许，但模型高频产出。
    2. 弯引号 ""：模型常用它包中文短语，换成全角「」不影响语义也不破坏结构。
    字符串内未转义的"半角"双引号无法安全自动修复（无法区分内容引号和结构引号），
    故不处理——让它如实暴露给上层记 ERROR，不静默吞。
    """
    for bad, good in _SMART_QUOTES.items():
        text = text.replace(bad, good)
    return _TRAILING_COMMA.sub(r"\1", text)


def parse_json_object(raw: str) -> dict:
    """从模型输出里抽出 JSON 对象。容忍 ```json 代码块包裹与前后多余文本。"""
    text = raw.strip()
    m = _FENCE.search(text)
    if m:
        text = m.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # 兜底1：截取第一个 { 到最后一个 } 之间的内容
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidate = text[start : end + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            # 兜底2：修复尾随逗号等常见毛病后再试
            return json.loads(_repair_common_defects(candidate))
    # 没有花括号结构，最后再试一次修复
    return json.loads(_repair_common_defects(text))


def to_evidence(item: object) -> Evidence:
    """把一个证据项转成 Evidence，兼容字段名漂移。

    约定字段是 {text, source}；模型有时返回 {指标,数值}、{内容,来源} 等变体，
    或直接给一个字符串。一律降级合并成 text，缺来源时标"未注明"。
    """
    if isinstance(item, str):
        return Evidence(text=item, source="未注明")
    if isinstance(item, dict):
        text = item.get("text")
        source = item.get("source")
        if text is not None:
            return Evidence(text=str(text), source=str(source) if source else "未注明")
        # 字段名漂移：把所有键值拼成一句事实
        merged = "，".join(f"{k}：{v}" for k, v in item.items())
        return Evidence(text=merged or "（无内容）", source="未注明")
    return Evidence(text=str(item), source="未注明")


def to_drilldown(data: object) -> DrillDown:
    """把 drilldown 字段转成 DrillDown，缺失或畸形时返回空壳。"""
    if not isinstance(data, dict):
        return DrillDown()
    points = data.get("data_points") or []
    comparisons = data.get("comparisons") or []
    return DrillDown(
        data_points=[to_evidence(p) for p in points],
        comparisons=[str(c) for c in comparisons],
    )


def to_action(item: object) -> str:
    """把一条行动建议规整成字符串。

    约定是纯字符串；模型有时返回 {priority, action} 或 {step, detail} 等对象。
    优先取常见的"动作"字段，取不到就把键值拼成一句话。
    """
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        for key in ("action", "text", "建议", "step", "content", "description"):
            val = item.get(key)
            if val:
                return str(val)
        # 字段名漂移：拼接非空值（跳过 priority 这类纯序号）
        parts = [str(v) for k, v in item.items() if k not in ("priority", "序号", "order") and v]
        return "，".join(parts) if parts else "（无内容）"
    return str(item)


def to_actions(items: object) -> list[str]:
    """把 actions 列表规整成 list[str]，空时给占位，保证 min_length=1。"""
    if not isinstance(items, list) or not items:
        return ["（模型未给出建议）"]
    return [to_action(a) for a in items]
