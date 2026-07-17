"""Billing endpoints: balance display and per-user task ledger listing."""
from fastapi.testclient import TestClient

from app.billing.ledger import create_task, transition_task
from app.integrations.ggoo import GGOOAuthenticationError, GGOOError, ggoo_client
from app.main import app

client = TestClient(app)


def _register(email: str) -> str:
    return client.post(
        "/auth/register", json={"email": email, "password": "secret123"}
    ).json()["access_token"]


def test_balance_reports_available_when_ggoo_returns_a_number(db_session, monkeypatch):
    token = _register("balance-ok@b.com")

    async def fake_balance(_token: str) -> float | None:
        return 42.0

    monkeypatch.setattr(ggoo_client, "get_credit_balance", fake_balance)
    resp = client.get("/billing/balance", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json() == {"available": True, "points": 42.0}


def test_balance_hides_display_when_ggoo_has_no_known_field(db_session, monkeypatch):
    token = _register("balance-none@b.com")

    async def fake_balance(_token: str) -> float | None:
        return None

    monkeypatch.setattr(ggoo_client, "get_credit_balance", fake_balance)
    resp = client.get("/billing/balance", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json() == {"available": False, "points": None}


def test_balance_hides_display_instead_of_erroring_on_ggoo_failure(db_session, monkeypatch):
    token = _register("balance-error@b.com")

    async def fake_balance(_token: str) -> float | None:
        raise GGOOError("GGOO 服务暂时不可用", status_code=502)

    monkeypatch.setattr(ggoo_client, "get_credit_balance", fake_balance)
    resp = client.get("/billing/balance", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json() == {"available": False, "points": None}


def test_balance_requires_login(db_session, monkeypatch):
    # get_current_user falls back to GGOO verification for unrecognized
    # tokens; force that to reject so an invalid token surfaces as 401
    # rather than hitting the real GGOO service.
    async def fake_verify(_token: str):
        raise GGOOAuthenticationError()

    monkeypatch.setattr("app.auth.jwt.ggoo_client.verify_user", fake_verify)
    resp = client.get("/billing/balance", headers={"Authorization": "Bearer not-a-real-token"})
    assert resp.status_code == 401


def test_tasks_endpoint_only_returns_current_users_rows(db_session):
    token_a = _register("tasks-a@b.com")
    token_b = _register("tasks-b@b.com")
    auth_a = {"Authorization": f"Bearer {token_a}"}
    auth_b = {"Authorization": f"Bearer {token_b}"}

    from app.auth.jwt import _decode_user_id

    user_a = _decode_user_id(token_a)
    user_b = _decode_user_id(token_b)

    async def seed() -> None:
        async with db_session() as session:
            task_a = await create_task(session, user_id=user_a, tool="image", mode="basic", quote_points=10)
            await transition_task(session, task_a, "reserved")
            await create_task(session, user_id=user_b, tool="image", mode="basic", quote_points=20)

    import asyncio

    asyncio.run(seed())

    resp_a = client.get("/billing/tasks", headers=auth_a)
    assert resp_a.status_code == 200
    rows_a = resp_a.json()
    assert len(rows_a) == 1
    assert rows_a[0]["tool"] == "image"
    assert rows_a[0]["status"] == "reserved"
    assert rows_a[0]["quote_points"] == 10

    resp_b = client.get("/billing/tasks", headers=auth_b)
    assert len(resp_b.json()) == 1
    assert resp_b.json()[0]["quote_points"] == 20


def test_tasks_endpoint_filters_by_tool(db_session):
    token = _register("tasks-filter@b.com")
    auth = {"Authorization": f"Bearer {token}"}

    from app.auth.jwt import _decode_user_id

    user_id = _decode_user_id(token)

    async def seed() -> None:
        async with db_session() as session:
            await create_task(session, user_id=user_id, tool="image", mode="basic")
            await create_task(session, user_id=user_id, tool="diagnostic", mode="api")

    import asyncio

    asyncio.run(seed())

    resp = client.get("/billing/tasks", params={"tool": "diagnostic"}, headers=auth)
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["tool"] == "diagnostic"
