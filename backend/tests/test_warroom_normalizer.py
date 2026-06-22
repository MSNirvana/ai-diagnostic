import asyncio

from app.db.models import DiagnosisRecord, Project, User
from app.models.questionnaire import Questionnaire
from app.models.result import Evidence, ModuleResult, TriageSummary
from app.models.warroom import WarRoomPlan
from app.warroom.composer import compose_war_room_plan
from app.warroom.maintenance import normalize_persisted_war_room_plans
from app.warroom.normalizer import normalize_war_room_plan


def _legacy_plan(project_id: str | None = None, record_id: str | None = None) -> WarRoomPlan:
    result = ModuleResult(
        module="sales",
        signal="red",
        conclusion="销售承接链路响应慢，导致高意向线索流失。",
        evidence=[Evidence(text="近 30 天成交转化下滑", source="CRM")],
        actions=["重分线索池", "A 类线索 10 分钟内首响"],
        data_requests=[],
    )
    plan = compose_war_room_plan(
        Questionnaire(
            project_id=project_id,
            answers=[],
            problem_map={"goal": "未来 30 天主攻市场与客户，协同销售与增长"},
        ),
        [result],
        TriageSummary(primary_module="sales"),
        {},
        record_id=record_id,
    )
    return plan.model_copy(
        update={
            "summary": "未来 30 天优先打销售承接战，次战场关注市场投放结构。",
            "objective": "未来 30 天主攻市场与客户，协同销售与增长",
            "risk_summary": ["证据置信度下降，需补充校验"],
        }
    )


def test_normalize_war_room_plan_removes_old_template_copy():
    plan = _legacy_plan()

    normalized = normalize_war_room_plan(plan)

    assert "未来 30 天优先打" not in normalized.summary
    assert "主攻市场与客户" not in normalized.objective
    assert normalized.objective.startswith("本轮要解决：")
    assert "证据完整度下降" in normalized.risk_summary[0]
    assert normalized.department_actions[0].action_title == "重分线索池"


def test_normalize_persisted_war_room_plans_updates_records_and_projects(db_session):
    async def run() -> None:
        async with db_session() as session:
            user = User(email="warroom-normalize@test.com", hashed_password="x")
            project = Project(user_id=user.id, name="旧作战室文案项目")
            session.add(user)
            session.add(project)
            await session.commit()

            plan = _legacy_plan(project_id=project.id, record_id="rec-old")
            record = DiagnosisRecord(
                id="rec-old",
                user_id=user.id,
                project_id=project.id,
                answers_json=Questionnaire(project_id=project.id, answers=[]).model_dump_json(),
                results_json="[]",
                war_room_plan_json=plan.model_dump_json(),
                review_status="approved",
            )
            project.war_room_plan_json = plan.model_dump_json()
            session.add(record)
            session.add(project)
            await session.commit()

            summary = await normalize_persisted_war_room_plans(session)
            assert summary.records_updated == 1
            assert summary.projects_updated == 1

            refreshed_record = await session.get(DiagnosisRecord, record.id)
            refreshed_project = await session.get(Project, project.id)
            record_plan = WarRoomPlan.model_validate_json(refreshed_record.war_room_plan_json)
            project_plan = WarRoomPlan.model_validate_json(refreshed_project.war_room_plan_json)
            assert "未来 30 天优先打" not in record_plan.summary
            assert "未来 30 天优先打" not in project_plan.summary
            assert "证据完整度下降" in project_plan.risk_summary[0]

            second = await normalize_persisted_war_room_plans(session)
            assert second.records_updated == 0
            assert second.projects_updated == 0

    asyncio.get_event_loop().run_until_complete(run())
