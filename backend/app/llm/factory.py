import os

from app.llm.base import LLMClient
from app.llm.anthropic_client import AnthropicClient
from app.llm.openai_client import OpenAIClient


def make_llm_client(
    provider: str, api_key: str, model: str, base_url: str | None = None
) -> LLMClient:
    if os.environ.get("BUILD_TEST_API_BYPASS", "").strip().lower() == "true":
        raise RuntimeError("测试模式只允许使用 GGOO API，不允许调用其他模型供应商")
    if provider == "anthropic":
        return AnthropicClient(api_key=api_key, model=model, base_url=base_url)
    if provider == "openai":
        return OpenAIClient(api_key=api_key, model=model, base_url=base_url)
    raise ValueError(f"unknown LLM provider: {provider}")
