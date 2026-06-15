import pytest
from app.llm.base import LLMClient


def test_llmclient_is_abstract():
    with pytest.raises(TypeError):
        LLMClient()


def test_subclass_must_implement_complete():
    class Incomplete(LLMClient):
        pass
    with pytest.raises(TypeError):
        Incomplete()


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
