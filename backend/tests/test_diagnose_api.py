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
        "answers": [{"module": "market", "facts": {}, "pains": ["竞品强"]}],
        "problem_map": {"core_problem": "获客成本高", "diagnosis_focus": "sales"},
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["results"][0]["module"] == "sales"
    assert body["results"][0]["signal"] == "red"
    assert body["results"][0]["evidence_package"]["confidence"] > 0
    assert body["results"][0]["evidence_package"]["citations"][0]["source"] == "行业报告"
    assert body["triage"]["primary_module"] == "sales"
    assert body["triage"]["selected_experts"][0]["reason"] == "问题地图建议优先诊断"


def test_diagnose_empty_answers_returns_empty(client):
    resp = client.post("/diagnose", json={"answers": []})
    assert resp.status_code == 200
    assert resp.json()["results"] == []
    assert resp.json()["triage"]["selected_experts"] == []
