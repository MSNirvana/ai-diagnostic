"""GGOOImageClient: generate_image with mocked httpx responses."""
import json
import httpx
import pytest

from app.imaging.client import GGOOImageClient, _lookup_dotted
from app.integrations.ggoo import GGOOAuthenticationError, GGOOError


def _make_client(handler) -> GGOOImageClient:
    transport = httpx.MockTransport(handler)
    http_client = httpx.AsyncClient(transport=transport)
    return GGOOImageClient(
        client=http_client,
        api_key="sk-test",
        gateway_base_url="https://gateway.example.com/v1",
    )


@pytest.mark.asyncio
async def test_generate_image_returns_url_on_success():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/images/generations"
        assert request.headers["Authorization"] == "Bearer sk-test"
        return httpx.Response(200, json={"data": [{"url": "https://img.example.com/1.png"}]})

    client = _make_client(handler)
    url = await client.generate_image(prompt="a cat", size="1024x1024")
    assert url == "https://img.example.com/1.png"


@pytest.mark.asyncio
async def test_generate_image_returns_all_urls_for_multiple_candidates():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["n"] == 3
        return httpx.Response(200, json={"data": [
            {"url": "https://img.example.com/1.png"},
            {"url": "https://img.example.com/2.png"},
        ]})

    client = _make_client(handler)
    urls = await client.generate_image(prompt="a cat", size="1024x1024", n=3)
    assert urls == ["https://img.example.com/1.png", "https://img.example.com/2.png"]


@pytest.mark.asyncio
async def test_generate_image_sends_multiple_reference_images_as_a_list():
    async def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["image"] == ["data:image/png;base64,one", "data:image/png;base64,two"]
        return httpx.Response(200, json={"data": [{"url": "https://img.example.com/edited.png"}]})

    client = _make_client(handler)
    url = await client.generate_image(
        prompt="商品场景图",
        size="1024x1024",
        reference_image_urls=["data:image/png;base64,one", "data:image/png;base64,two"],
    )
    assert url == "https://img.example.com/edited.png"


@pytest.mark.asyncio
async def test_generate_image_raises_auth_error_on_401():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "unauthorized"})

    client = _make_client(handler)
    with pytest.raises(GGOOAuthenticationError):
        await client.generate_image(prompt="a cat", size="1024x1024")


@pytest.mark.asyncio
async def test_generate_image_raises_payment_error_on_402():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(402, json={"error": "payment required"})

    client = _make_client(handler)
    with pytest.raises(GGOOError, match="积分不足"):
        await client.generate_image(prompt="a cat", size="1024x1024")


@pytest.mark.asyncio
async def test_generate_image_raises_rate_limit_on_429():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": "rate limited"})

    client = _make_client(handler)
    with pytest.raises(GGOOError, match="过于频繁"):
        await client.generate_image(prompt="a cat", size="1024x1024")


@pytest.mark.asyncio
async def test_generate_image_raises_on_missing_url_field():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [{"b64_json": "..."}]})

    client = _make_client(handler)
    with pytest.raises(GGOOError, match="格式异常"):
        await client.generate_image(prompt="a cat", size="1024x1024")


@pytest.mark.asyncio
async def test_generate_image_maps_provider_connection_error():
    async def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connect failed", request=request)

    client = _make_client(handler)
    with pytest.raises(GGOOError, match="无法连接 GGOO 图片接口") as exc_info:
        await client.generate_image(prompt="a cat", size="1024x1024")
    assert exc_info.value.status_code == 503


@pytest.mark.asyncio
async def test_generate_image_accepts_base64_png_result():
    import base64

    png = base64.b64encode(b"\x89PNG\r\n\x1a\n").decode()

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [{"b64_json": png}]})

    client = _make_client(handler)
    result = await client.generate_image(prompt="a cat", size="1024x1024")
    assert result == f"data:image/png;base64,{png}"


@pytest.mark.asyncio
async def test_generate_image_raises_on_invalid_json():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not json")

    client = _make_client(handler)
    with pytest.raises(GGOOError, match="格式异常"):
        await client.generate_image(prompt="a cat", size="1024x1024")


@pytest.mark.asyncio
async def test_generate_image_uses_custom_env_path(monkeypatch):
    monkeypatch.setenv("GGOO_IMAGE_GENERATIONS_PATH", "/custom/images")

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/custom/images"
        return httpx.Response(200, json={"data": [{"url": "https://img.example.com/2.png"}]})

    client = _make_client(handler)
    url = await client.generate_image(prompt="a dog", size="1024x1024")
    assert url == "https://img.example.com/2.png"


@pytest.mark.asyncio
async def test_generate_image_uses_custom_response_field(monkeypatch):
    monkeypatch.setenv("GGOO_IMAGE_RESPONSE_URL_FIELD", "output.image_url")

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"output": {"image_url": "https://img.example.com/3.png"}})

    client = _make_client(handler)
    url = await client.generate_image(prompt="a bird", size="1024x1024")
    assert url == "https://img.example.com/3.png"


def test_lookup_dotted_dict():
    assert _lookup_dotted({"a": {"b": {"c": 1}}}, "a.b.c") == 1


def test_lookup_dotted_list():
    assert _lookup_dotted({"data": [{"url": "x"}]}, "data.0.url") == "x"


def test_lookup_dotted_missing():
    assert _lookup_dotted({"a": {}}, "a.b.c") is None
    assert _lookup_dotted({"a": []}, "a.0.b") is None
    assert _lookup_dotted(None, "a.b") is None
