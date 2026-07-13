from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import SystemConfig


RESEARCH_CONFIG_KEYS = (
    "PERPLEXITY_API_KEY",
    "PERPLEXITY_BASE_URL",
    "PERPLEXITY_MODEL",
    "RESEARCH_MAX_QUERIES",
    "RESEARCH_RESULTS_PER_QUERY",
    "RESEARCH_CONCURRENCY",
)

SECRET_KEYS = {"PERPLEXITY_API_KEY"}


def mask_secret(value: str) -> str:
    value = str(value or "")
    if not value:
        return ""
    if len(value) <= 8:
        return "****"
    return f"{value[:6]}{'*' * 8}{value[-4:]}"


async def get_system_config(session: AsyncSession, key: str, default: str = "") -> str:
    row = await session.get(SystemConfig, key)
    if row is not None and str(row.value or "").strip():
        return row.value
    return os.environ.get(key, default)


async def get_system_configs(session: AsyncSession, keys: Iterable[str]) -> dict[str, str]:
    key_list = list(dict.fromkeys(keys))
    if not key_list:
        return {}
    rows = list(await session.scalars(select(SystemConfig).where(SystemConfig.key.in_(key_list))))
    by_key = {row.key: row.value for row in rows if str(row.value or "").strip()}
    return {key: by_key.get(key) or os.environ.get(key, "") for key in key_list}


async def set_system_config(
    session: AsyncSession,
    key: str,
    value: str,
    *,
    is_secret: bool | None = None,
) -> SystemConfig:
    row = await session.get(SystemConfig, key)
    if row is None:
        row = SystemConfig(key=key)
    row.value = value
    row.is_secret = (key in SECRET_KEYS) if is_secret is None else is_secret
    row.updated_at = datetime.now(timezone.utc)
    session.add(row)
    return row


async def research_config_values(session: AsyncSession) -> dict[str, str]:
    return await get_system_configs(session, RESEARCH_CONFIG_KEYS)
