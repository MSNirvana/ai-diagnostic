"""Deterministic cleanup for persisted War Room plans.

This layer is intentionally small and model-free. It removes old template copy
from stored war_room_plan JSON while preserving the underlying diagnosis,
actions, evidence, and review gate behavior.
"""

from app.models.warroom import WarRoomIteration, WarRoomPlan
from app.skills.skill_network import skill_label


def normalize_war_room_plan(plan: WarRoomPlan) -> WarRoomPlan:
    """Return a copy with boss-facing template copy normalized."""
    normalized = plan.model_copy(deep=True)
    primary_label = skill_label(normalized.primary_battlefield) if normalized.primary_battlefield else "相关部门"
    secondary_label = skill_label(normalized.secondary_battlefield) if normalized.secondary_battlefield else ""
    focus = _focus_text(normalized)

    if _looks_like_template_copy(normalized.summary):
        normalized.summary = _summary_from_focus(focus, primary_label, secondary_label)
    else:
        normalized.summary = _ensure_sentence(normalized.summary)

    if _looks_like_template_copy(normalized.objective):
        normalized.objective = _objective_from_focus(focus)
    else:
        normalized.objective = _clean_objective(normalized.objective)

    normalized.risk_summary = [_rename_confidence_word(item) for item in normalized.risk_summary]
    normalized.evidence_summary = [_clean_boss_sentence(item, "当前证据不足，建议先补齐关键经营数据。") for item in normalized.evidence_summary]
    normalized.risk_summary = [_clean_boss_sentence(item, "暂未发现重大冲突，但仍需按复盘节点校验动作有效性。") for item in normalized.risk_summary]
    normalized.department_actions = [_normalize_action(action) for action in normalized.department_actions]
    normalized.iterations = [_normalize_iteration(item, normalized) for item in normalized.iterations]
    return normalized


def war_room_plan_needs_normalization(plan: WarRoomPlan) -> bool:
    return normalize_war_room_plan(plan).model_dump_json() != plan.model_dump_json()


def _normalize_iteration(item: WarRoomIteration, plan: WarRoomPlan) -> WarRoomIteration:
    update: dict = {
        "changes": [_rename_confidence_word(change) for change in item.changes],
    }
    if _looks_like_template_copy(item.summary):
        primary_label = skill_label(item.primary_battlefield) if item.primary_battlefield else "相关部门"
        update["summary"] = _summary_from_focus(_focus_text(plan), primary_label, "")
    else:
        update["summary"] = _ensure_sentence(item.summary)
    if _looks_like_template_copy(item.objective):
        update["objective"] = _objective_from_focus(_focus_text(plan))
    else:
        update["objective"] = _clean_objective(item.objective)
    return item.model_copy(update=update)


def _normalize_action(action):
    return action.model_copy(
        update={
            "battle_goal": _clean_boss_sentence(action.battle_goal, "明确本轮要解决的经营问题。"),
            "problem": _clean_boss_sentence(action.problem, "") if action.problem else "",
            "internal_evidence": [_clean_boss_text(item, "") for item in action.internal_evidence if _clean_boss_text(item, "")],
            "external_evidence": [_clean_boss_text(item, "") for item in action.external_evidence if _clean_boss_text(item, "")],
            "action_title": _clean_boss_text(action.action_title, "明确一个可执行动作"),
            "action_detail": _clean_boss_sentence(action.action_detail, "暂无更多执行说明。"),
            "acceptance_rule": _clean_boss_sentence(action.acceptance_rule, "下次复盘时提交执行记录和指标变化。"),
            "risk_note": _clean_boss_sentence(action.risk_note, "") if action.risk_note else "",
            "confidence_reason": _clean_boss_text(action.confidence_reason, "") if action.confidence_reason else "",
            "evidence_refs": [_clean_boss_text(ref, "") for ref in action.evidence_refs if _clean_boss_text(ref, "")],
        }
    )


def _focus_text(plan: WarRoomPlan) -> str:
    first_action = next((action for action in plan.department_actions if action.priority == "now"), None)
    first_action = first_action or (plan.department_actions[0] if plan.department_actions else None)
    if first_action and first_action.battle_goal.strip():
        return first_action.battle_goal.strip()
    first_decision = plan.decision_items[0].title if plan.decision_items else ""
    first_decision = first_decision.replace("拍板：", "").replace("拍板:", "").strip()
    if first_decision:
        return first_decision
    objective = _clean_objective(plan.objective)
    if objective and not _looks_like_template_copy(objective):
        return objective
    return "本轮最关键的经营问题"


def _summary_from_focus(focus: str, primary_label: str, secondary_label: str) -> str:
    secondary = f"，{secondary_label}只处理会影响落地的协同事项" if secondary_label else ""
    return f"本轮经营会先围绕「{focus}」定动作，由{primary_label}牵头，把判断落到负责人、时间窗和验收标准{secondary}。"


def _objective_from_focus(focus: str) -> str:
    return f"本轮要解决：{focus}"


def _clean_objective(value: str) -> str:
    cleaned = " ".join((value or "").strip().split())
    for prefix in ("未来 30 天内", "未来30天内", "未来 30 天", "未来30天", "30 天内", "30天内", "改善：", "改善:"):
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix):].strip()
    return cleaned or "补齐关键经营输入，形成可复盘的本期作战目标"


def _looks_like_template_copy(value: str) -> bool:
    compact = (value or "").replace(" ", "")
    return (
        compact.startswith("未来30天优先打")
        or compact.startswith("未来30天主攻")
        or "主战场" in compact
        or "次战场" in compact
        or ("主攻" in compact and "协同" in compact)
    )


def _rename_confidence_word(value: str) -> str:
    return (value or "").replace("证据置信度", "证据完整度").replace("置信度", "证据完整度")


def _ensure_sentence(value: str) -> str:
    text = " ".join((value or "").strip().split())
    if not text:
        return "顾问已把本轮判断拆成决策、动作、证据和复盘节点。"
    if text.endswith(("。", "！", "？", ".", "!", "?")):
        return text
    return f"{text}。"


def _clean_boss_text(value: object, fallback: str = "") -> str:
    text = str(value or "").replace("\r\n", "\n").strip()
    if not text:
        return fallback
    text = " ".join(text.split())
    for marker in ("source:", "source：", "'source'", '"source"', "_cache", "needs_verification", "fetched_at"):
        pos = text.find(marker)
        if pos >= 0:
            text = text[:pos].strip(" ;；,，({[")
    for marker in ("facts.", "payload.", "data.", "audit_trail", "evidence_package"):
        text = text.replace(marker, "")
    for char in "{}[]'\"":
        text = text.replace(char, "")
    text = text.strip(" ;；,，")
    if not text:
        return fallback
    return text


def _clean_boss_sentence(value: object, fallback: str = "") -> str:
    text = _clean_boss_text(value, fallback)
    if not text:
        return fallback
    return _ensure_sentence(text)
