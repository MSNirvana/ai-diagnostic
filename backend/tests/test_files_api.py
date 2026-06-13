"""文件上传/列表/删除端点测试。"""
import io

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


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

