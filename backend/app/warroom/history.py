import json

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DiagnosisRecord, Project, ProjectMemoryEntry
from app.models.questionnaire import Questionnaire
from app.models.result import ModuleResult, TriageSummary
from app.models.warroom import WarRoomIteration, WarRoomPlan
from app.skills.skill_network import skill_label
from app.warroom.composer import compose_war_room_plan
from app.warroom.normalizer import normalize_war_room_plan


MAX_PROJECT_ITERATIONS = 12


async def get_or_build_war_room_plan(
    session: AsyncSession,
    record: DiagnosisRecord,
) -> WarRoomPlan | None:
    """读取已落库方案；旧记录则从原始诊断确定性重建并回存。"""
    if record.war_room_plan_json:
        try:
            plan = WarRoomPlan.model_validate_json(record.war_room_plan_json)
            normalized = normalize_war_room_plan(plan)
            if normalized.model_dump_json() != plan.model_dump_json():
                record.war_room_plan_json = normalized.model_dump_json()
                session.add(record)
                await session.commit()
            return normalized
        except ValueError:
            pass

    try:
        questionnaire = Questionnaire.model_validate_json(record.answers_json)
        results = [
            ModuleResult.model_validate(item)
            for item in json.loads(record.results_json)
        ]
    except (ValueError, TypeError):
        return None

    if record.project_id and not questionnaire.project_id:
        questionnaire = questionnaire.model_copy(
            update={"project_id": record.project_id}
        )

    plan = compose_war_room_plan(
        questionnaire=questionnaire,
        results=results,
        triage=TriageSummary(),
        skill_version_ids={},
        record_id=record.id,
    )
    plan = normalize_war_room_plan(plan)
    record.war_room_plan_json = plan.model_dump_json()
    session.add(record)
    await session.commit()
    return plan


def can_build_war_room_plan(record: DiagnosisRecord) -> bool:
    if record.war_room_plan_json:
        return True
    try:
        raw_results = json.loads(record.results_json)
    except (ValueError, TypeError):
        return False
    return isinstance(raw_results, list) and bool(raw_results)


async def get_or_build_project_war_room_plan(
    session: AsyncSession,
    project: Project,
) -> WarRoomPlan | None:
    """项目级作战室：只合并顾问审核通过的诊断记录。

    机器诊断生成的 war_room_plan_json 是内部审核草稿；老板侧项目作战室必须
    等 review_status=approved 后才交付，避免未复核结论提前进入经营会视图。
    """
    stmt = (
        select(DiagnosisRecord)
        .where(DiagnosisRecord.project_id == project.id)
        .where(DiagnosisRecord.review_status == "approved")
        .order_by(DiagnosisRecord.created_at.asc())
    )
    records = list((await session.scalars(stmt)).all())
    if not records:
        if project.war_room_plan_json:
            project.war_room_plan_json = None
            session.add(project)
            await session.commit()
        return None

    plan: WarRoomPlan | None = None
    for record in records:
        record_plan = await get_or_build_war_room_plan(session, record)
        if record_plan is None:
            continue
        plan = merge_project_war_room_plan(
            previous=plan,
            incoming=record_plan,
            record=record,
            project_id=project.id,
        )

    if plan is None:
        return None
    plan = await add_project_accumulation_note(session, plan, project.id)
    project.war_room_plan_json = plan.model_dump_json()
    session.add(project)
    await session.commit()
    return plan


async def apply_project_war_room_iteration(
    session: AsyncSession,
    project_id: str,
    record: DiagnosisRecord,
    incoming: WarRoomPlan,
) -> WarRoomPlan | None:
    if record.review_status != "approved":
        return None
    project = await session.get(Project, project_id)
    if project is None:
        return None
    previous: WarRoomPlan | None = None
    if project.war_room_plan_json:
        try:
            previous = WarRoomPlan.model_validate_json(project.war_room_plan_json)
        except ValueError:
            previous = None

    plan = merge_project_war_room_plan(
        previous=previous,
        incoming=incoming,
        record=record,
        project_id=project_id,
    )
    plan = await add_project_accumulation_note(session, plan, project_id)
    project.war_room_plan_json = plan.model_dump_json()
    session.add(project)
    await session.commit()
    return plan


def merge_project_war_room_plan(
    previous: WarRoomPlan | None,
    incoming: WarRoomPlan,
    record: DiagnosisRecord,
    project_id: str,
) -> WarRoomPlan:
    """把单次诊断方案转成项目当前作战室，并保留迭代轨迹。"""
    incoming = incoming.model_copy(deep=True)
    incoming = normalize_war_room_plan(incoming)
    incoming.project_id = project_id
    incoming.record_id = record.id

    prior_iterations = previous.iterations if previous else []
    prior_record_ids = previous.source_record_ids if previous else []
    source_record_ids = [*prior_record_ids]
    if record.id not in source_record_ids:
        source_record_ids.append(record.id)

    iteration = WarRoomIteration(
        record_id=record.id,
        created_at=record.created_at,
        summary=incoming.summary,
        primary_battlefield=incoming.primary_battlefield,
        objective=incoming.objective,
        confidence=incoming.confidence,
        changes=_iteration_changes(previous, incoming),
    )
    iterations = [item for item in prior_iterations if item.record_id != record.id]
    iterations.append(iteration)
    iterations = iterations[-MAX_PROJECT_ITERATIONS:]

    incoming.id = previous.id if previous else incoming.id
    incoming.source_record_ids = source_record_ids
    incoming.iteration_count = len(source_record_ids)
    incoming.iterations = iterations
    incoming.accumulation_note = _project_accumulation_note(
        iteration_count=incoming.iteration_count,
        memory_entry_count=None,
    )
    return normalize_war_room_plan(incoming)


async def add_project_accumulation_note(
    session: AsyncSession,
    plan: WarRoomPlan,
    project_id: str,
) -> WarRoomPlan:
    """Attach visible "越用越准" copy. Best-effort only."""
    try:
        count = await session.scalar(
            select(func.count(ProjectMemoryEntry.id)).where(ProjectMemoryEntry.project_id == project_id)
        )
        plan.accumulation_note = _project_accumulation_note(
            iteration_count=plan.iteration_count,
            memory_entry_count=int(count or 0),
        )
    except Exception:  # noqa: BLE001 - 展示文案不能影响作战室交付
        plan.accumulation_note = ""
    return plan


def _iteration_changes(previous: WarRoomPlan | None, incoming: WarRoomPlan) -> list[str]:
    if previous is None:
        return ["建立项目作战室"]

    changes: list[str] = []
    if previous.primary_battlefield != incoming.primary_battlefield:
        changes.append(
            f"主战场从{_battlefield_label(previous.primary_battlefield)}调整为{_battlefield_label(incoming.primary_battlefield)}"
        )
    if previous.secondary_battlefield != incoming.secondary_battlefield:
        changes.append("次战场已更新")
    if previous.objective != incoming.objective:
        changes.append("经营目标已根据本轮诊断更新")
    if incoming.confidence > previous.confidence:
        changes.append("证据完整度提升")
    elif incoming.confidence < previous.confidence:
        changes.append("证据完整度下降，需补充校验")
    if len(incoming.data_gaps) != len(previous.data_gaps):
        changes.append("关键数据缺口已更新")

    return changes or ["本轮诊断补充了作战室证据与行动依据"]


def _project_accumulation_note(
    *,
    iteration_count: int,
    memory_entry_count: int | None,
) -> str:
    try:
        if iteration_count <= 1:
            return ""
        prior_count = iteration_count - 1
        if memory_entry_count is not None and memory_entry_count > 0:
            return f"本次基于此前 {prior_count} 次诊断 + {memory_entry_count} 条沉淀，结论比首次更贴合。"
        return f"本次基于此前 {prior_count} 次诊断，结论比首次更贴合。"
    except Exception:  # noqa: BLE001
        return ""


def _battlefield_label(module: str) -> str:
    return skill_label(module) if module else "待判定"
