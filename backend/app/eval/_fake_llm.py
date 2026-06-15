"""桩 LLM：用于 --fake 模式冒烟测试断言管线本身（不打真实 API）。

它读 prompt 里的 facts，回填一个"合规但简单"的诊断，让评测管线能端到端跑通。
真实质量评测必须用真实 LLM —— 这个只验证管线连通。
"""
from __future__ import annotations

import json


class FakeDiagnosisLLM:
    async def complete(self, system: str, prompt: str) -> str:
        try:
            payload = json.loads(prompt)
        except json.JSONDecodeError:
            payload = {}
        facts: dict = payload.get("facts", {}) or {}
        missing = payload.get("missing_data_requests", []) or []

        # 缺数据场景：老实申报，低信号
        if not facts and missing:
            return json.dumps({
                "signal": "yellow",
                "conclusion": "当前缺少关键经营数据，暂无法形成可靠判断，建议先补齐数据再诊断。",
                "evidence": [],
                "actions": ["补齐关键经营数据后重新诊断"],
                "drilldown": {"data_points": [], "comparisons": []},
            }, ensure_ascii=False)

        # 有数据场景：引用第一个数字，给红灯
        first_key = next(iter(facts), None)
        first_val = facts.get(first_key, "") if first_key else ""
        return json.dumps({
            "signal": "red",
            "conclusion": f"{first_key}为{first_val}，处于偏高水平，是当前需要优先处理的瓶颈。",
            "evidence": [{"text": f"{first_key}={first_val}", "source": "你提供的经营数据"}],
            "actions": [f"下调{first_key}相关投入", "核验数据后重分资源"],
            "drilldown": {"data_points": [], "comparisons": []},
        }, ensure_ascii=False)
