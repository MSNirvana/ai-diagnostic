import json
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import get_llm_client


class FakeLLM:
    """回显收到的 facts，便于断言文件数据是否合并进了 prompt。"""

    last_prompt: str = ""
    all_prompts: list[str] = []

    async def complete(self, system: str, prompt: str) -> str:
        FakeLLM.last_prompt = prompt
        FakeLLM.all_prompts.append(prompt)
        return json.dumps({
            "signal": "green",
            "conclusion": "数据已接收",
            "evidence": [{"text": "已解析上传文件", "source": "上传表格"}],
            "actions": ["继续补充数据"],
            "drilldown": {"data_points": [], "comparisons": []},
        })


@pytest.fixture
def client(db_session):
    # db_session 注入内存库覆盖 get_session；再设 llm override
    FakeLLM.last_prompt = ""
    FakeLLM.all_prompts = []
    app.dependency_overrides[get_llm_client] = lambda: FakeLLM()
    yield TestClient(app)
    app.dependency_overrides.pop(get_llm_client, None)


def test_upload_merges_file_into_facts(client):
    answers = {"answers": [{"module": "market", "facts": {"客单价": "420"}, "pains": ["打不过竞品"]}]}
    csv_bytes = b"month,sales\n2026-01,100\n2026-02,150\n"
    resp = client.post(
        "/diagnose/upload",
        data={"answers_json": json.dumps(answers)},
        files=[("files", ("market_sales.csv", csv_bytes, "text/csv"))],
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["results"][0]["module"] == "market"
    # 文件解析后的数据进入了 LLM prompt（合并到了 facts）。
    # 用 all_prompts：诊断后还有作战方案增强调用，last_prompt 会被覆盖。
    joined = "\n".join(FakeLLM.all_prompts)
    assert "file_market_sales.csv" in joined
    assert "row_count" in joined


def test_upload_without_files_still_works(client):
    answers = {"answers": [{"module": "market", "facts": {}, "pains": ["客户在流失"]}]}
    resp = client.post(
        "/diagnose/upload",
        data={"answers_json": json.dumps(answers)},
    )
    assert resp.status_code == 200
    assert resp.json()["results"][0]["module"] == "market"


def test_upload_unsupported_file_type_does_not_crash(client):
    answers = {"answers": [{"module": "market", "facts": {}, "pains": ["市场在萎缩"]}]}
    resp = client.post(
        "/diagnose/upload",
        data={"answers_json": json.dumps(answers)},
        files=[("files", ("market_notes.txt", b"some text", "text/plain"))],
    )
    assert resp.status_code == 200
    assert resp.json()["results"][0]["module"] == "market"
