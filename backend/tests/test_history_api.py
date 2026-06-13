"""历史记录端点：列表、详情、权限隔离。"""
import json
import asyncio

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.config import get_llm_client
from app.db.models import DiagnosisRecord, User

client = TestClient(app)


class FakeLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "signal": "green",
            "conclusion": "正常",
            "evidence": [{"text": "x", "source": "y"}],
            "actions": ["继续"],
            "drilldown": {"data_points": [], "comparisons": []},
        })


def _register(email: str) -> str:
    return client.post(
        "/auth/register", json={"email": email, "password": "secret123"}
    ).json()["access_token"]


def _diagnose(token: str) -> None:
    client.post(
        "/diagnose",
        json={"answers": [{"module": "market", "facts": {"a": "b"}, "pains": ["x"]}]},
        headers={"Authorization": f"Bearer {token}"},
    )


def test_history_requires_auth(db_session):
    resp = client.get("/history/")
    assert resp.status_code == 422  # 缺 Authorization header


def test_history_lists_own_records(db_session):
    app.dependency_overrides[get_llm_client] = lambda: FakeLLM()
    token = _register("owner@b.com")
    _diagnose(token)
    _diagnose(token)
    resp = client.get("/history/", headers={"Authorization": f"Bearer {token}"})
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    assert body[0]["module_count"] == 1


def test_history_detail_returns_full_record(db_session):
    app.dependency_overrides[get_llm_client] = lambda: FakeLLM()
    token = _register("detail@b.com")
    _diagnose(token)
    list_resp = client.get("/history/", headers={"Authorization": f"Bearer {token}"})
    record_id = list_resp.json()[0]["id"]
    resp = client.get(
        f"/history/{record_id}", headers={"Authorization": f"Bearer {token}"}
    )
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 200
    body = resp.json()
    assert body["answers"]["answers"][0]["module"] == "market"
    assert body["results"][0]["module"] == "market"
    assert body["war_room_plan"]["record_id"] == record_id
    assert body["war_room_plan"]["primary_battlefield"] == "market"


def test_history_detail_blocks_other_user(db_session):
    app.dependency_overrides[get_llm_client] = lambda: FakeLLM()
    token_a = _register("usera@b.com")
    _diagnose(token_a)
    record_id = client.get(
        "/history/", headers={"Authorization": f"Bearer {token_a}"}
    ).json()[0]["id"]
    token_b = _register("userb@b.com")
    resp = client.get(
        f"/history/{record_id}", headers={"Authorization": f"Bearer {token_b}"}
    )
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 404  # B 看不到 A 的记录


def test_history_detail_builds_and_persists_war_room_for_legacy_record(db_session):
    token = _register("legacy-war-room@b.com")

    async def seed_legacy_record() -> str:
        async with db_session() as session:
            user = (
                await session.scalars(
                    select(User).where(User.email == "legacy-war-room@b.com")
                )
            ).one()
            record = DiagnosisRecord(
                user_id=user.id,
                project_id="legacy-project",
                answers_json=json.dumps(
                    {
                        "answers": [
                            {
                                "module": "sales",
                                "facts": {},
                                "pains": ["成交率持续下降"],
                            }
                        ],
                        "project_id": "legacy-project",
                        "problem_map": {"goal": "30 天内恢复成交率"},
                    },
                    ensure_ascii=False,
                ),
                results_json=json.dumps(
                    [
                        {
                            "module": "sales",
                            "signal": "red",
                            "conclusion": "销售承接链路是当前主战场",
                            "evidence": [
                                {"text": "高意向线索流失增加", "source": "历史 CRM"}
                            ],
                            "actions": ["重分线索池"],
                            "drilldown": None,
                            "evidence_package": None,
                            "data_requests": [],
                        }
                    ],
                    ensure_ascii=False,
                ),
                war_room_plan_json=None,
            )
            session.add(record)
            await session.commit()
            return record.id

    record_id = asyncio.get_event_loop().run_until_complete(seed_legacy_record())
    resp = client.get(
        f"/history/{record_id}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    plan = resp.json()["war_room_plan"]
    assert plan["record_id"] == record_id
    assert plan["project_id"] == "legacy-project"
    assert plan["primary_battlefield"] == "sales"
    assert plan["department_actions"][0]["action_title"] == "重分线索池"

    async def read_persisted_plan() -> str | None:
        async with db_session() as session:
            record = await session.get(DiagnosisRecord, record_id)
            return record.war_room_plan_json if record else None

    persisted = asyncio.get_event_loop().run_until_complete(read_persisted_plan())
    assert persisted
