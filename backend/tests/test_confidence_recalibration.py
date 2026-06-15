import json
import asyncio

from sqlalchemy import select

from app.db.models import DiagnosisRecord, Project, ProjectMemoryEntry, User
from app.evidence_recalibration import recalibrate_all_confidence
from app.models.questionnaire import Questionnaire
from app.models.result import (
    AuditTrail,
    BenchmarkReference,
    DataRequest,
    Evidence,
    EvidencePackage,
    ModuleResult,
    TriageSummary,
)
from app.models.warroom import WarRoomPlan
from app.warroom.composer import compose_war_room_plan


def test_recalibrate_all_confidence_updates_records_memory_and_project_war_room(db_session):
    async def run() -> None:
        async with db_session() as session:
            user = User(email="confidence-recalibration@test.com", hashed_password="x")
            project = Project(user_id=user.id, name="可信度回填项目")
            session.add(user)
            session.add(project)
            await session.commit()

            questionnaire = Questionnaire(
                project_id=project.id,
                answers=[
                    {
                        "module": "market",
                        "facts": {"市场问题": "获客贵"},
                        "pains": ["获客成本高"],
                    }
                ],
            )
            stale_result = ModuleResult(
                module="market",
                signal="red",
                conclusion="获客判断证据不足，不能高置信度推进。",
                evidence=[Evidence(text="获客成本可能偏高", source="分析")],
                actions=["继续观察"],
                evidence_package=EvidencePackage(
                    confidence=0.92,
                    confidence_reason="旧版本固定高分",
                    citations=[Evidence(text="获客成本可能偏高", source="分析")],
                    benchmarks=[
                        BenchmarkReference(
                            name="market 外部基准",
                            source="AI Diagnostic benchmark stub",
                            value="note: external benchmark placeholder",
                        )
                    ],
                    audit_trail=AuditTrail(
                        skill_version_id="market-v1",
                        input_modules=["market"],
                    ),
                ),
                data_requests=[
                    DataRequest(
                        key="promotion_account",
                        label="推广账号与广告平台",
                        reason="缺少账号无法核验投放情况。",
                        required=True,
                    ),
                    DataRequest(
                        key="campaign_performance",
                        label="近90天投放表现",
                        reason="缺少花费、点击和转化数据。",
                        required=True,
                    ),
                ],
            )
            record = DiagnosisRecord(
                user_id=user.id,
                project_id=project.id,
                answers_json=questionnaire.model_dump_json(),
                results_json=json.dumps([stale_result.model_dump()], ensure_ascii=False),
            )
            plan = compose_war_room_plan(
                questionnaire,
                [stale_result],
                triage=TriageSummary(primary_module="market"),
                skill_version_ids={},
                record_id=record.id,
            )
            record.war_room_plan_json = plan.model_dump_json()
            project.war_room_plan_json = plan.model_copy(
                update={
                    "project_id": project.id,
                    "source_record_ids": [record.id],
                    "iteration_count": 1,
                }
            ).model_dump_json()
            memory = ProjectMemoryEntry(
                project_id=project.id,
                user_id=user.id,
                entry_type="diagnosis",
                summary="market：旧诊断",
                payload_json=json.dumps(
                    {"results": [stale_result.model_dump()]},
                    ensure_ascii=False,
                ),
                source_id=record.id,
            )
            session.add(record)
            session.add(memory)
            session.add(project)
            await session.commit()

            summary = await recalibrate_all_confidence(session)
            assert summary.records_seen == 1
            assert summary.records_updated == 1
            assert summary.projects_rebuilt == 1

            refreshed_record = await session.get(DiagnosisRecord, record.id)
            refreshed_project = await session.get(Project, project.id)
            refreshed_memory = (
                await session.scalars(
                    select(ProjectMemoryEntry).where(ProjectMemoryEntry.source_id == record.id)
                )
            ).one()

            results = json.loads(refreshed_record.results_json)
            confidence = results[0]["evidence_package"]["confidence"]
            assert confidence < 0.92
            assert confidence <= 0.78
            assert "缺少 2 类必需数据" in results[0]["evidence_package"]["confidence_reason"]
            benchmark = results[0]["evidence_package"]["benchmarks"][0]
            assert benchmark["source"] == "AI Diagnostic benchmark stub"
            assert benchmark["value"] == "note: external benchmark placeholder"

            record_plan = WarRoomPlan.model_validate_json(refreshed_record.war_room_plan_json)
            project_plan = WarRoomPlan.model_validate_json(refreshed_project.war_room_plan_json)
            assert record_plan.department_actions[0].confidence == confidence
            assert project_plan.department_actions[0].confidence == confidence
            assert project_plan.source_record_ids == [record.id]

            memory_payload = json.loads(refreshed_memory.payload_json)
            assert memory_payload["results"][0]["evidence_package"]["confidence"] == confidence

            first_results_json = refreshed_record.results_json
            second_summary = await recalibrate_all_confidence(session)
            second_record = await session.get(DiagnosisRecord, record.id)
            assert second_summary.records_updated == 0
            assert second_record.results_json == first_results_json

    asyncio.get_event_loop().run_until_complete(run())
