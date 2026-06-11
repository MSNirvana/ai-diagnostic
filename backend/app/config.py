import os
from app.llm.base import LLMClient
from app.llm.factory import make_llm_client


def get_llm_client() -> LLMClient:
    provider = os.environ.get("LLM_PROVIDER", "anthropic")
    model = os.environ.get("LLM_MODEL", "claude-opus-4-8")
    key_var = "ANTHROPIC_API_KEY" if provider == "anthropic" else "OPENAI_API_KEY"
    api_key = os.environ.get(key_var, "")
    base_url = os.environ.get("LLM_BASE_URL", "")
    return make_llm_client(
        provider=provider, api_key=api_key, model=model, base_url=base_url
    )
