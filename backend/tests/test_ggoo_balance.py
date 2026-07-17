"""GGOOClient.get_credit_balance: adaptive balance probing.

GGOO has not confirmed a dedicated balance endpoint yet, so the client
probes `users/me` for a plausible field by default and can be pointed at a
real endpoint/field via env vars once GGOO confirms one.
"""
import httpx
import pytest

from app.integrations.ggoo import GGOOClient


@pytest.mark.asyncio
async def test_probes_users_me_for_known_balance_field(monkeypatch):
    monkeypatch.delenv("GGOO_BALANCE_PATH", raising=False)
    monkeypatch.delenv("GGOO_BALANCE_FIELD", raising=False)

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/sys/users/me"
        return httpx.Response(200, json={"code": 200, "data": {"id": 1, "balance": 42.5}})

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = GGOOClient(http_client)
    assert await client.get_credit_balance("user-token") == 42.5
    await http_client.aclose()


@pytest.mark.asyncio
async def test_returns_none_when_no_known_field_present(monkeypatch):
    monkeypatch.delenv("GGOO_BALANCE_PATH", raising=False)
    monkeypatch.delenv("GGOO_BALANCE_FIELD", raising=False)

    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"code": 200, "data": {"id": 1, "nickname": "无余额字段"}})

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = GGOOClient(http_client)
    assert await client.get_credit_balance("user-token") is None
    await http_client.aclose()


@pytest.mark.asyncio
async def test_configured_path_and_dotted_field_take_priority(monkeypatch):
    monkeypatch.setenv("GGOO_BALANCE_PATH", "/api/v1/platform/credits")
    monkeypatch.setenv("GGOO_BALANCE_FIELD", "wallet.balance")

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/platform/credits"
        return httpx.Response(
            200,
            json={"code": 200, "data": {"wallet": {"balance": 128}, "balance": 999}},
        )

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = GGOOClient(http_client)
    assert await client.get_credit_balance("user-token") == 128.0
    await http_client.aclose()


@pytest.mark.asyncio
async def test_api_key_without_dedicated_path_returns_none_without_request(monkeypatch):
    monkeypatch.delenv("GGOO_BALANCE_PATH", raising=False)

    async def handler(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("sk- token without GGOO_BALANCE_PATH must not call GGOO")

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = GGOOClient(http_client)
    assert await client.get_credit_balance("sk-some-api-key") is None
    await http_client.aclose()


@pytest.mark.asyncio
async def test_result_is_cached_for_ttl_window(monkeypatch):
    monkeypatch.delenv("GGOO_BALANCE_PATH", raising=False)
    monkeypatch.delenv("GGOO_BALANCE_FIELD", raising=False)
    calls = 0

    async def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"code": 200, "data": {"balance": 10}})

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = GGOOClient(http_client)
    assert await client.get_credit_balance("user-token") == 10.0
    assert await client.get_credit_balance("user-token") == 10.0
    assert calls == 1
    await http_client.aclose()


@pytest.mark.asyncio
async def test_missing_balance_result_is_also_cached(monkeypatch):
    monkeypatch.delenv("GGOO_BALANCE_PATH", raising=False)
    monkeypatch.delenv("GGOO_BALANCE_FIELD", raising=False)
    calls = 0

    async def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"code": 200, "data": {"nickname": "no balance"}})

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = GGOOClient(http_client)
    assert await client.get_credit_balance("user-token") is None
    assert await client.get_credit_balance("user-token") is None
    assert calls == 1
    await http_client.aclose()
