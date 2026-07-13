import os

from fastapi import Header, HTTPException

from app.integrations.ggoo import GGOOError, ggoo_client
from app.llm.base import LLMClient
from app.db.models import LLMConfig


def llm_config_debug_label(config: LLMConfig) -> str:
    base = (config.base_url or "default").strip() or "default"
    return f"{config.name}|{config.provider}:{config.model}@{base}"


async def get_llm_client(
    authorization: str | None = Header(default=None),
) -> LLMClient:
    """Build runtime always uses the current GGOO user's metered API key."""
    raw = authorization if isinstance(authorization, str) else None
    token = ""
    if raw:
        scheme, _, credentials = raw.strip().partition(" ")
        if scheme.lower() != "bearer" or not credentials.strip():
            raise HTTPException(status_code=401, detail="请先登录 GGOO")
        token = credentials.strip()
    else:
        token = os.environ.get("GGOO_SERVICE_API_KEY", "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="请先登录 GGOO")
    try:
        return await ggoo_client.make_llm_client(token)
    except GGOOError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
