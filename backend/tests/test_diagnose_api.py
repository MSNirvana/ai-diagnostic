import json
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import get_llm_client


class FakeLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "signal": "red",
            "conclusion": "定价偏高是流失主因",
            "evidence": [{"text": "定价高18%", "source": "行业报告"}],
            "actions": ["下调定价"],
            "drilldown": {"data_points": [], "comparisons": []},
        })


@pytest.fixture
def client(db_session):
    # db_session 注入内存库覆盖 get_session；这里再设 llm override
    app.dependency_overrides[get_llm_client] = lambda: FakeLLM()
    yield TestClient(app)
    app.dependency_overrides.pop(get_llm_client, None)


def test_diagnose_returns_results(client):
    resp = client.post("/diagnose", json={
        "answers": [{"module": "market", "facts": {}, "pains": ["竞品强"]}]
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["results"][0]["module"] == "market"
    assert body["results"][0]["signal"] == "red"


def test_diagnose_empty_answers_returns_empty(client):
    resp = client.post("/diagnose", json={"answers": []})
    assert resp.status_code == 200
    assert resp.json()["results"] == []
