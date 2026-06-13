import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DiagnosisRecord
from app.models.questionnaire import Questionnaire
from app.models.result import ModuleResult, TriageSummary
from app.models.warroom import WarRoomPlan
from app.warroom.composer import compose_war_room_plan


async def get_or_build_war_room_plan(
    session: AsyncSession,
    record: DiagnosisRecord,
) -> WarRoomPlan | None:
    """读取已落库方案；旧记录则从原始诊断确定性重建并回存。"""
    if record.war_room_plan_json:
        try:
            return WarRoomPlan.model_validate_json(record.war_room_plan_json)
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
