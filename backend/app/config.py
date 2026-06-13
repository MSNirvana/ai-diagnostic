import os

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.base import LLMClient
from app.llm.factory import make_llm_client
from app.llm.fallback import FallbackLLMClient
from app.db.database import get_session
from app.db.models import LLMConfig


def _client_from_env() -> LLMClient:
    """环境变量单配置（DB 无激活配置时的兜底）。"""
    provider = os.environ.get("LLM_PROVIDER", "anthropic")
    model = os.environ.get("LLM_MODEL", "claude-opus-4-8")
    key_var = "ANTHROPIC_API_KEY" if provider == "anthropic" else "OPENAI_API_KEY"
    api_key = os.environ.get(key_var, "")
    base_url = os.environ.get("LLM_BASE_URL", "")
    return make_llm_client(provider=provider, api_key=api_key, model=model, base_url=base_url)


async def get_llm_client(
    session: AsyncSession = Depends(get_session),
) -> LLMClient:
    """优先用 DB 里的模型配置（按 priority 主备 fallback），DB 为空回退环境变量。"""
    stmt = (
        select(LLMConfig)
        .where(LLMConfig.is_active == True)  # noqa: E712
        .order_by(LLMConfig.priority.asc())
    )
    configs = list(await session.scalars(stmt))
    if not configs:
        return _client_from_env()
    clients = [
        make_llm_client(
            provider=c.provider, api_key=c.api_key, model=c.model, base_url=c.base_url
        )
        for c in configs
    ]
    return FallbackLLMClient(clients)
