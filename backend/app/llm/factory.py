from app.llm.base import LLMClient
from app.llm.anthropic_client import AnthropicClient
from app.llm.openai_client import OpenAIClient


def make_llm_client(provider: str, api_key: str, model: str) -> LLMClient:
    if provider == "anthropic":
        return AnthropicClient(api_key=api_key, model=model)
    if provider == "openai":
        return OpenAIClient(api_key=api_key, model=model)
    raise ValueError(f"unknown LLM provider: {provider}")
