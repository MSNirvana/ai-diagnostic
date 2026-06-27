import pytest
from unittest.mock import AsyncMock
from app.llm.base import LLMClient
from app.llm.fallback import FallbackLLMClient, FallbackLLMError


def test_llmclient_is_abstract():
    with pytest.raises(TypeError):
        LLMClient()


def test_subclass_must_implement_complete():
    class Incomplete(LLMClient):
        pass
    with pytest.raises(TypeError):
        Incomplete()


class _FailingLLM(LLMClient):
    def __init__(self, label: str, err: Exception):
        self._label = label
        self._err = err

    @property
    def debug_label(self) -> str:
        return self._label

    async def complete(self, system: str, prompt: str) -> str:
        raise self._err


from app.llm.factory import make_llm_client
from app.llm.anthropic_client import AnthropicClient
from app.llm.openai_client import OpenAIClient
from app.llm.base_url import normalize_anthropic_base_url, normalize_openai_base_url


def test_factory_returns_anthropic():
    client = make_llm_client(provider="anthropic", api_key="x", model="claude-opus-4-8")
    assert isinstance(client, AnthropicClient)


def test_factory_returns_openai():
    client = make_llm_client(provider="openai", api_key="x", model="gpt-4o")
    assert isinstance(client, OpenAIClient)


def test_factory_rejects_unknown():
    with pytest.raises(ValueError):
        make_llm_client(provider="nope", api_key="x", model="m")


def test_gateway_base_url_is_provider_aware():
    gateway = "https://api.tooken.ai/v1"

    assert normalize_anthropic_base_url(gateway) == "https://api.tooken.ai"
    assert normalize_openai_base_url(gateway) == "https://api.tooken.ai/v1"
    assert normalize_openai_base_url("https://api.tooken.ai") == "https://api.tooken.ai/v1"


@pytest.mark.asyncio
async def test_fallback_error_keeps_each_channel_failure():
    llm = FallbackLLMClient([
        _FailingLLM("openai:gpt-5.5@https://api.tooken.ai/v1", RuntimeError("503 unavailable")),
        _FailingLLM("openai:gpt-5.5@https://api.ggoo.ai/v1", PermissionError("403 blocked")),
    ])

    with pytest.raises(FallbackLLMError) as exc:
        await llm.complete("system", "prompt")

    assert exc.value.failures == [
        "openai:gpt-5.5@https://api.tooken.ai/v1 503 unavailable",
        "openai:gpt-5.5@https://api.ggoo.ai/v1 403 blocked",
    ]


@pytest.mark.asyncio
async def test_openai_client_falls_back_to_raw_http_when_sdk_is_blocked(monkeypatch):
    client = OpenAIClient(api_key="sk-test", model="gpt-5.5", base_url="https://api.ggoo.ai/v1")

    class _BlockedError(Exception):
        status_code = 403

        def __str__(self):
            return "Your request was blocked."

    client._client.chat.completions.create = AsyncMock(side_effect=_BlockedError())
    client._complete_via_http = AsyncMock(return_value="OK")

    result = await client.complete("system", "prompt")

    assert result == "OK"
    client._complete_via_http.assert_awaited_once()
