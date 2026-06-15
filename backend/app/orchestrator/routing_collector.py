"""路由样本收集器（Loop 2）。

在每次诊断收口时，把"路由决策 + 诊断结果"存成一条 RoutingSample，
作为日后离线校准关键词权重的训练数据。

设计纪律：遥测绝不能拖垮诊断。session 为 None、写库异常、字段缺失——
一律静默跳过，diagnose_all 照常返回。
"""
import json
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import RoutingSample
from app.models.result import ModuleResult

logger = logging.getLogger(__name__)

# _Route.reason → 召回来源。决定这个模块是怎么被选进来的。
_REASON_TO_SOURCE = {
    "用户填写了该模块": "user_filled",
    "问题地图建议优先诊断": "focus",
    "问题地图提到相关经营信号": "keyword",
}


def _source_of(reason: str) -> str:
    return _REASON_TO_SOURCE.get(reason, "other")


async def collect_routing_sample(
    session: AsyncSession | None,
    *,
    record_id: str | None,
    problem_text: str,
    scenario_key: str,
    routes,  # list[_Route]，避免循环导入不标注具体类型
    results: list[ModuleResult],
    recall_scores: list[tuple[str, int]],
) -> None:
    """best-effort 写入一条路由样本。任何异常都吞掉。"""
    if session is None:
        return
    try:
        result_by_module = {r.module: r for r in results}

        selected = [
            {
                "module": route.answer.module,
                "source": _source_of(route.reason),
                "reason": route.reason,
                "priority": route.priority,
            }
            for route in routes
        ]

        outcomes = [
            {
                "module": r.module,
                "signal": r.signal,
                "confidence": (
                    r.evidence_package.confidence
                    if r.evidence_package is not None
                    else None
                ),
            }
            for r in results
        ]

        # 漏召回：用户手填了该模块、诊断回 red，但它不是被关键词召回的
        # （说明若用户没填，关键词路由会漏掉这个真问题 → 关键词缺口）。
        keyword_recalled = {
            route.answer.module
            for route in routes
            if _source_of(route.reason) == "keyword"
        }
        missed = [
            route.answer.module
            for route in routes
            if _source_of(route.reason) == "user_filled"
            and route.answer.module not in keyword_recalled
            and (result := result_by_module.get(route.answer.module)) is not None
            and result.signal == "red"
        ]

        sample = RoutingSample(
            record_id=record_id,
            problem_text=problem_text[:2000],
            scenario_key=scenario_key,
            recall_scores_json=json.dumps(
                [{"key": k, "score": s} for k, s in recall_scores], ensure_ascii=False
            ),
            selected_json=json.dumps(selected, ensure_ascii=False),
            outcomes_json=json.dumps(outcomes, ensure_ascii=False),
            missed_json=json.dumps(missed, ensure_ascii=False),
        )
        session.add(sample)
        await session.commit()
    except Exception:  # noqa: BLE001 — 遥测失败不影响诊断
        logger.warning("collect_routing_sample 写入失败，已跳过", exc_info=True)
        try:
            await session.rollback()
        except Exception:  # noqa: BLE001
            pass
