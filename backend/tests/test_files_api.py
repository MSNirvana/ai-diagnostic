"""文件上传/列表/删除端点测试。"""
import io
import json

from fastapi.testclient import TestClient

from app.config import get_llm_client
from app.main import app

client = TestClient(app)


class PromptSpyLLM:
    seen_prompt = ""

    async def complete(self, system: str, prompt: str) -> str:
        PromptSpyLLM.seen_prompt = prompt
        return json.dumps({
            "phase": "intake",
            "done": False,
            "message": "我会结合你上传的资料继续追问。",
            "problem_map": None,
        }, ensure_ascii=False)


def _register(email: str) -> str:
    return client.post(
        "/auth/register", json={"email": email, "password": "secret123"}
    ).json()["access_token"]


def _start_session(auth: dict) -> str:
    return client.post("/session/start", headers=auth).json()["session_id"]


def test_upload_list_delete_file(db_session):
    token = _register("file@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    sid = _start_session(auth)

    csv = b"month,sales\n2026-01,100\n2026-02,150\n"
    resp = client.post(
        f"/session/{sid}/files",
        data={"module_key": "market", "field_key": "营收"},
        files={"file": ("sales.csv", io.BytesIO(csv), "text/csv")},
        headers=auth,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["original_name"] == "sales.csv"
    assert body["module_key"] == "market"
    file_id = body["id"]

    # 列表能看到
    files = client.get(f"/session/{sid}/files", headers=auth).json()
    assert len(files) == 1
    assert files[0]["original_name"] == "sales.csv"

    # 原始文件可在线查看，也可按原文件下载
    inline = client.get(f"/files/{file_id}/content", headers=auth)
    assert inline.status_code == 200
    assert inline.content == csv
    assert "inline" in inline.headers["content-disposition"]

    downloaded = client.get(f"/files/{file_id}/content?download=true", headers=auth)
    assert downloaded.status_code == 200
    assert downloaded.content == csv
    assert "attachment" in downloaded.headers["content-disposition"]

    # 删除
    assert client.delete(f"/files/{file_id}", headers=auth).status_code == 204
    assert len(client.get(f"/session/{sid}/files", headers=auth).json()) == 0


def test_file_parsed_summary_cached(db_session):
    """上传时即时解析，parsed_summary 存进 DB。"""
    import asyncio
    from sqlalchemy import select
    from app.db.models import UploadedFile

    token = _register("file2@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    sid = _start_session(auth)
    csv = b"month,revenue\n2026-01,500\n2026-02,600\n"
    client.post(
        f"/session/{sid}/files",
        data={"module_key": "finance", "field_key": "营收明细"},
        files={"file": ("rev.csv", io.BytesIO(csv), "text/csv")},
        headers=auth,
    )

    async def fetch():
        async with db_session() as s:
            return (await s.scalars(select(UploadedFile))).all()

    rows = asyncio.get_event_loop().run_until_complete(fetch())
    assert len(rows) == 1
    # 解析摘要已缓存，含行数
    assert "row_count" in rows[0].parsed_summary


def test_file_isolated_between_users(db_session):
    token_a = _register("fa@b.com")
    sid = _start_session({"Authorization": f"Bearer {token_a}"})
    token_b = _register("fb@b.com")
    # B 不能列 A 的会话文件
    resp = client.get(f"/session/{sid}/files", headers={"Authorization": f"Bearer {token_b}"})
    assert resp.status_code == 404


def test_diagnose_uses_stored_file(db_session):
    """上传文件后，_merge_stored_files 把解析摘要注入对应模块 facts（不依赖 multipart）。"""
    import asyncio
    from app.api.diagnose import _merge_stored_files
    from app.models.questionnaire import Questionnaire, ModuleAnswer

    token = _register("diaguse@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    sid = _start_session(auth)
    csv = b"month,sales\n2026-01,100\n2026-02,200\n"
    client.post(
        f"/session/{sid}/files",
        data={"module_key": "market", "field_key": "销售数据"},
        files={"file": ("s.csv", io.BytesIO(csv), "text/csv")},
        headers=auth,
    )

    # 构造一份不带文件的问卷，只带 session_id
    q = Questionnaire(
        answers=[ModuleAnswer(module="market", facts={}, pains=[])],
        session_id=sid,
    )

    async def run_merge():
        async with db_session() as s:
            await _merge_stored_files(s, q)

    asyncio.get_event_loop().run_until_complete(run_merge())

    # market 模块的 facts 被注入了文件解析摘要
    market = next(a for a in q.answers if a.module == "market")
    file_facts = [v for k, v in market.facts.items() if "_file_" in k]
    assert len(file_facts) == 1
    assert "row_count" in file_facts[0]


def test_chat_file_upload_adds_context_and_project_memory(db_session):
    """项目对话里上传资料后，前台历史不展开，AI 发送时可后台读取，并按开关沉淀。"""
    import asyncio
    from sqlalchemy import select
    from app.db.models import DiagnosisSession, ProjectMemoryEntry

    token = _register("chat-file@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    project_id = client.post("/project/", json={"name": "资料沉淀项目"}, headers=auth).json()["id"]
    sid = client.post("/session/start", json={"project_id": project_id}, headers=auth).json()["session_id"]

    resp = client.post(
        f"/session/{sid}/files",
        data={"module_key": "conversation", "field_key": "uploaded_context"},
        files={"file": ("notes.txt", io.BytesIO("近三个月ROI从1.2降到0.8".encode("utf-8")), "text/plain")},
        headers=auth,
    )
    assert resp.status_code == 201
    assert "近三个月ROI" in resp.json()["summary_text"]

    async def fetch():
        async with db_session() as s:
            row = await s.get(DiagnosisSession, sid)
            memories = list(await s.scalars(
                select(ProjectMemoryEntry).where(ProjectMemoryEntry.project_id == project_id)
            ))
            return row, memories

    row, memories = asyncio.get_event_loop().run_until_complete(fetch())
    history = json.loads(row.messages_json)
    assert history == []
    assert memories == []

    app.dependency_overrides[get_llm_client] = lambda: PromptSpyLLM()
    chat_resp = client.post(
        f"/session/{sid}/chat",
        json={"message": "基于刚才上传的资料，先问我一个关键问题"},
        headers=auth,
    )
    app.dependency_overrides.pop(get_llm_client, None)
    assert chat_resp.status_code == 200
    assert "本会话已上传资料" in PromptSpyLLM.seen_prompt
    assert "近三个月ROI从1.2降到0.8" in PromptSpyLLM.seen_prompt

    _, memories_after_send = asyncio.get_event_loop().run_until_complete(fetch())
    uploaded_memories = [m for m in memories_after_send if m.entry_type == "uploaded_file"]
    assert len(uploaded_memories) == 1
    assert "近三个月ROI" in uploaded_memories[0].summary

    client.post(
        f"/session/{sid}/chat",
        json={"message": "再结合资料追问一个问题"},
        headers=auth,
    )
    _, memories_after_second_send = asyncio.get_event_loop().run_until_complete(fetch())
    assert len([m for m in memories_after_second_send if m.entry_type == "uploaded_file"]) == 1


def test_chat_file_upload_respects_memory_toggle(db_session):
    import asyncio
    from sqlalchemy import select
    from app.db.models import ProjectMemoryEntry

    token = _register("chat-file-off@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    project_id = client.post("/project/", json={"name": "不沉淀资料项目"}, headers=auth).json()["id"]
    sid = client.post(
        "/session/start",
        json={"project_id": project_id, "memory_enabled": False},
        headers=auth,
    ).json()["session_id"]

    resp = client.post(
        f"/session/{sid}/files",
        data={"module_key": "conversation", "field_key": "uploaded_context"},
        files={"file": ("private.txt", io.BytesIO("这份资料不要沉淀".encode("utf-8")), "text/plain")},
        headers=auth,
    )
    assert resp.status_code == 201

    async def count_memory():
        async with db_session() as s:
            rows = list(await s.scalars(
                select(ProjectMemoryEntry).where(ProjectMemoryEntry.project_id == project_id)
            ))
            return len(rows)

    assert asyncio.get_event_loop().run_until_complete(count_memory()) == 0
