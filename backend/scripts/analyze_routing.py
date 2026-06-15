"""Loop 2 观测脚本：把已收集的 RoutingSample 翻译成 router 健康指标。

用法：cd backend && .venv/bin/python -m scripts.analyze_routing

只读不写——绝不改线上召回逻辑。目的：让"router 到底准不准"可量化，
为日后是否值得做"离线重训+回灌"提供依据。没有这个数，调 router 就是盲调。

关键指标：
- 召回来源分布：focus / keyword / user_filled / other 各占多少
- 漏召回率：手填+red 却没被关键词召到的比例（关键词缺口，越低越好）
- 假阳性信号：关键词召回了某 skill，但它回 green/低置信（可能是噪声召回）
- 各 skill 召回频次：哪些 skill 常被召、哪些从没被召（死 skill）
"""
from __future__ import annotations

import asyncio
import json
from collections import Counter

from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.db.models import RoutingSample

LOW_CONFIDENCE = 0.5


async def analyze() -> dict:
    async with AsyncSessionLocal() as session:
        samples = list(await session.scalars(select(RoutingSample)))

    total = len(samples)
    if total == 0:
        return {"total": 0, "note": "还没有路由样本——先跑几次真实诊断让收集器落库。"}

    source_counter: Counter = Counter()
    skill_recall_counter: Counter = Counter()
    missed_total = 0
    samples_with_missed = 0
    keyword_recalls = 0
    keyword_false_positive = 0  # 关键词召回但结果 green/低置信

    for s in samples:
        selected = json.loads(s.selected_json or "[]")
        outcomes = {o["module"]: o for o in json.loads(s.outcomes_json or "[]")}
        missed = json.loads(s.missed_json or "[]")

        if missed:
            samples_with_missed += 1
            missed_total += len(missed)

        for sel in selected:
            module = sel["module"]
            source = sel.get("source", "other")
            source_counter[source] += 1
            skill_recall_counter[module] += 1

            if source == "keyword":
                keyword_recalls += 1
                outcome = outcomes.get(module)
                if outcome is not None:
                    signal = outcome.get("signal")
                    conf = outcome.get("confidence")
                    if signal == "green" or (conf is not None and conf < LOW_CONFIDENCE):
                        keyword_false_positive += 1

    return {
        "total": total,
        "source_distribution": dict(source_counter),
        "skill_recall_frequency": dict(skill_recall_counter.most_common()),
        "missed_recall": {
            "samples_with_missed": samples_with_missed,
            "missed_rate": round(samples_with_missed / total, 3),
            "total_missed_modules": missed_total,
            "note": "手填+red 却没被关键词召到的样本占比，越低越好（关键词缺口）",
        },
        "keyword_false_positive": {
            "keyword_recalls": keyword_recalls,
            "false_positive": keyword_false_positive,
            "rate": round(keyword_false_positive / keyword_recalls, 3) if keyword_recalls else 0.0,
            "note": "关键词召回却回 green/低置信的比例，越低说明关键词越精准",
        },
    }


def _print_report(report: dict) -> None:
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report.get("total", 0) == 0:
        return
    print("\n=== Router 健康速读 ===")
    mr = report["missed_recall"]
    fp = report["keyword_false_positive"]
    print(f"样本数: {report['total']}")
    print(f"漏召回率: {mr['missed_rate']:.0%}（{mr['samples_with_missed']}/{report['total']} 样本有漏召回）")
    print(f"关键词假阳性率: {fp['rate']:.0%}（{fp['false_positive']}/{fp['keyword_recalls']} 次关键词召回是噪声）")
    dead = [k for k, v in report["skill_recall_frequency"].items()]
    print(f"被召回过的 skill: {len(dead)} 个")


def main() -> None:
    report = asyncio.run(analyze())
    _print_report(report)


if __name__ == "__main__":
    main()
