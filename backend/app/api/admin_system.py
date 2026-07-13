from __future__ import annotations

import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import require_admin
from app.db.database import get_session
from app.db.models import SystemConfig
from app.research.models import ResearchQuery
from app.research.perplexity import PPLX_BASE_URL, PerplexityResearchClient
from app.system_config import RESEARCH_CONFIG_KEYS, SECRET_KEYS, mask_secret, set_system_config

router = APIRouter(prefix="/admin/system-config", dependencies=[Depends(require_admin)])


RESEARCH_DEFAULTS = {
    "PERPLEXITY_BASE_URL": PPLX_BASE_URL,
    "PERPLEXITY_MODEL": "sonar",
    "RESEARCH_MAX_QUERIES": "24",
    "RESEARCH_RESULTS_PER_QUERY": "5",
    "RESEARCH_CONCURRENCY": "4",
}

RESEARCH_LABELS = {
    "PERPLEXITY_API_KEY": "Perplexity API Key",
    "PERPLEXITY_BASE_URL": "Perplexity Base URL",
    "PERPLEXITY_MODEL": "Perplexity 模型",
    "RESEARCH_MAX_QUERIES": "最大研究问题数",
    "RESEARCH_RESULTS_PER_QUERY": "每个问题返回数",
    "RESEARCH_CONCURRENCY": "搜索并发数",
}

RESEARCH_DESCRIPTIONS = {
    "PERPLEXITY_API_KEY": "深度尽调外部搜索必需。缺失时无法沉淀可审计外部证据。",
    "PERPLEXITY_BASE_URL": "默认使用 Perplexity 官方地址；如需代理网关可在这里覆盖。",
    "PERPLEXITY_MODEL": "Sonar 搜索模型，默认 sonar。",
    "RESEARCH_MAX_QUERIES": "一次深度尽调最多生成多少个外部研究问题。",
    "RESEARCH_RESULTS_PER_QUERY": "每个研究问题最多保留多少条原始搜索结果。",
    "RESEARCH_CONCURRENCY": "同时发起多少个搜索请求。过高可能触发限流。",
}


class ConfigItemOut(BaseModel):
    key: str
    label: str
    value: str = ""
    masked_value: str = ""
    is_secret: bool = False
    source: str = "default"  # database | environment | default | missing
    status: str = "ok"       # ok | missing | warning
    description: str = ""
    updated_at: datetime | None = None


class RuntimeHealthOut(BaseModel):
    key: str
    label: str
    status: str
    message: str


class SystemConfigOut(BaseModel):
    research: list[ConfigItemOut]
    runtime_health: list[RuntimeHealthOut]


class ResearchConfigPatch(BaseModel):
    perplexity_api_key: str | None = None
    clear_perplexity_api_key: bool = False
    perplexity_base_url: str | None = None
    perplexity_model: str | None = None
    max_queries: int | None = None
    results_per_query: int | None = None
    concurrency: int | None = None


class ResearchProbeResult(BaseModel):
    ok: bool
    message: str
    evidence_count: int = 0
    config: list[ConfigItemOut]


@router.get("/", response_model=SystemConfigOut)
async def get_system_config(session: AsyncSession = Depends(get_session)) -> SystemConfigOut:
    return SystemConfigOut(
        research=await _research_items(session),
        runtime_health=await _runtime_health(session),
    )


@router.patch("/research", response_model=SystemConfigOut)
async def patch_research_config(
    body: ResearchConfigPatch,
    session: AsyncSession = Depends(get_session),
) -> SystemConfigOut:
    if body.clear_perplexity_api_key:
        await set_system_config(session, "PERPLEXITY_API_KEY", "", is_secret=True)
    elif body.perplexity_api_key is not None and body.perplexity_api_key.strip():
        await set_system_config(session, "PERPLEXITY_API_KEY", body.perplexity_api_key.strip(), is_secret=True)
    if body.perplexity_base_url is not None:
        await set_system_config(session, "PERPLEXITY_BASE_URL", body.perplexity_base_url.strip())
    if body.perplexity_model is not None:
        await set_system_config(session, "PERPLEXITY_MODEL", body.perplexity_model.strip() or "sonar")
    if body.max_queries is not None:
        await set_system_config(session, "RESEARCH_MAX_QUERIES", str(max(1, body.max_queries)))
    if body.results_per_query is not None:
        await set_system_config(session, "RESEARCH_RESULTS_PER_QUERY", str(max(1, body.results_per_query)))
    if body.concurrency is not None:
        await set_system_config(session, "RESEARCH_CONCURRENCY", str(max(1, body.concurrency)))
    await session.commit()
    return await get_system_config(session)


@router.post("/research/probe", response_model=ResearchProbeResult)
async def probe_research_config(session: AsyncSession = Depends(get_session)) -> ResearchProbeResult:
    values = await _effective_research_values(session)
    client = PerplexityResearchClient(
        api_key=values.get("PERPLEXITY_API_KEY") or None,
        base_url=values.get("PERPLEXITY_BASE_URL") or None,
        model=values.get("PERPLEXITY_MODEL") or None,
        timeout=20,
    )
    if not client.enabled:
        result = ResearchProbeResult(
            ok=False,
            message="未配置 PERPLEXITY_API_KEY，外部搜索不可用。",
            evidence_count=0,
            config=await _research_items(session),
        )
        raise HTTPException(status_code=400, detail=result.model_dump(mode="json"))
    try:
        items = await client.search(
            ResearchQuery(
                module="market",
                query="AI API gateway developer acquisition benchmark 2026",
                purpose="测试外部搜索连通性",
            ),
            max_results=2,
        )
    except Exception as exc:
        result = ResearchProbeResult(
            ok=False,
            message=f"{exc.__class__.__name__}: {str(exc)[:240]}",
            evidence_count=0,
            config=await _research_items(session),
        )
        raise HTTPException(status_code=400, detail=result.model_dump(mode="json")) from exc
    if not items:
        result = ResearchProbeResult(
            ok=False,
            message="搜索请求已发送，但没有返回可用来源。请检查 Key、Base URL、模型或服务商额度。",
            evidence_count=0,
            config=await _research_items(session),
        )
        raise HTTPException(status_code=400, detail=result.model_dump(mode="json"))
    return ResearchProbeResult(
        ok=True,
        message=f"外部搜索连通成功，返回 {len(items)} 条来源。",
        evidence_count=len(items),
        config=await _research_items(session),
    )


async def _effective_research_values(session: AsyncSession) -> dict[str, str]:
    rows = list(await session.scalars(select(SystemConfig).where(SystemConfig.key.in_(RESEARCH_CONFIG_KEYS))))
    by_key = {row.key: row.value for row in rows if str(row.value or "").strip()}
    values: dict[str, str] = {}
    for key in RESEARCH_CONFIG_KEYS:
        values[key] = by_key.get(key) or os.environ.get(key) or RESEARCH_DEFAULTS.get(key, "")
    return values


async def _research_items(session: AsyncSession) -> list[ConfigItemOut]:
    rows = list(await session.scalars(select(SystemConfig).where(SystemConfig.key.in_(RESEARCH_CONFIG_KEYS))))
    by_key = {row.key: row for row in rows}
    items: list[ConfigItemOut] = []
    for key in RESEARCH_CONFIG_KEYS:
        row = by_key.get(key)
        db_value = row.value if row is not None else ""
        env_value = os.environ.get(key, "")
        default_value = RESEARCH_DEFAULTS.get(key, "")
        if db_value:
            value = db_value
            source = "database"
        elif env_value:
            value = env_value
            source = "environment"
        elif default_value:
            value = default_value
            source = "default"
        else:
            value = ""
            source = "missing"
        is_secret = key in SECRET_KEYS
        status = "missing" if key == "PERPLEXITY_API_KEY" and not value else "ok"
        items.append(ConfigItemOut(
            key=key,
            label=RESEARCH_LABELS.get(key, key),
            value="" if is_secret else value,
            masked_value=mask_secret(value) if is_secret else value,
            is_secret=is_secret,
            source=source,
            status=status,
            description=RESEARCH_DESCRIPTIONS.get(key, ""),
            updated_at=row.updated_at if row is not None else None,
        ))
    return items


async def _runtime_health(session: AsyncSession) -> list[RuntimeHealthOut]:
    admin_emails = os.environ.get("ADMIN_EMAILS", "")
    allowed_origins = os.environ.get("ALLOWED_ORIGINS", "")
    research_values = await _effective_research_values(session)
    ggoo_model = os.environ.get("GGOO_MODEL", "auto").strip() or "auto"
    legacy_auth = os.environ.get("BUILD_LEGACY_AUTH_ENABLED", "false").strip().lower() in {
        "1", "true", "yes", "on",
    }
    return [
        RuntimeHealthOut(
            key="llm",
            label="GGOO 模型网关",
            status="ok",
            message=f"用户请求通过自己的 GGOO API Key 计费，当前路由模型：{ggoo_model}。",
        ),
        RuntimeHealthOut(
            key="research",
            label="外部搜索",
            status="ok" if research_values.get("PERPLEXITY_API_KEY") else "missing",
            message="Perplexity Key 已配置，深度尽调可执行外部搜索。" if research_values.get("PERPLEXITY_API_KEY") else "缺少 Perplexity Key，深度尽调无法沉淀外部搜索证据。",
        ),
        RuntimeHealthOut(
            key="auth",
            label="统一账号",
            status="warning" if legacy_auth else "ok",
            message="本地旧登录仍处于迁移开关状态。" if legacy_auth else "GGOO 统一身份已启用，本地密码登录已停用。",
        ),
        RuntimeHealthOut(
            key="admin_emails",
            label="管理员邮箱",
            status="ok" if admin_emails else "warning",
            message=f"ADMIN_EMAILS={admin_emails}" if admin_emails else "未设置 ADMIN_EMAILS，存量管理员可能无法自动提权。",
        ),
        RuntimeHealthOut(
            key="cors",
            label="CORS 域名",
            status="ok" if allowed_origins else "warning",
            message=f"ALLOWED_ORIGINS={allowed_origins}" if allowed_origins else "未设置 ALLOWED_ORIGINS，将使用本地开发默认值。",
        ),
    ]
