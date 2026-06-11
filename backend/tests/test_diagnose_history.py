"""验证带 token 诊断会写入历史记录，匿名诊断不写。"""
import json

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.config import get_llm_client
from app.db.models import DiagnosisRecord

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


def _token() -> str:
    resp = client.post("/auth/register", json={"email": "hist@b.com", "password": "secret123"})
    return resp.json()["access_token"]


def test_authenticated_diagnose_writes_history(db_session):
    app.dependency_overrides[get_llm_client] = lambda: FakeLLM()
    token = _token()
    resp = client.post(
        "/diagnose",
        json={"answers": [{"module": "market", "facts": {}, "pains": ["x"]}]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    app.dependency_overrides.pop(get_llm_client, None)

    # 直接查库确认有一条记录
    import asyncio

    async def count_records():
        async with db_session() as s:
            rows = (await s.scalars(select(DiagnosisRecord))).all()
            return rows

    rows = asyncio.get_event_loop().run_until_complete(count_records())
    assert len(rows) == 1
    assert rows[0].answers_json


def test_anonymous_diagnose_writes_no_history(db_session):
    app.dependency_overrides[get_llm_client] = lambda: FakeLLM()
    resp = client.post(
        "/diagnose",
        json={"answers": [{"module": "market", "facts": {}, "pains": ["x"]}]},
    )
    assert resp.status_code == 200
    app.dependency_overrides.pop(get_llm_client, None)

    import asyncio

    async def count_records():
        async with db_session() as s:
            return (await s.scalars(select(DiagnosisRecord))).all()

    rows = asyncio.get_event_loop().run_until_complete(count_records())
    assert len(rows) == 0
