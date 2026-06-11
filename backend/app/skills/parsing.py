"""健壮地把 LLM 返回的文本解析成结果模型。

真实 LLM 输出不稳定：可能用 ```json 代码块包裹、字段名漂移、
缺字段。这里做防御性解析，让 skill 不会因为模型一次发挥失常就整体崩溃。
所有 skill 共用本模块。
"""
import json
import re
from app.models.result import Evidence, DrillDown

_FENCE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def parse_json_object(raw: str) -> dict:
    """从模型输出里抽出 JSON 对象。容忍 ```json 代码块包裹与前后多余文本。"""
    text = raw.strip()
    m = _FENCE.search(text)
    if m:
        text = m.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # 兜底：截取第一个 { 到最后一个 } 之间的内容
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(text[start : end + 1])
        raise


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
