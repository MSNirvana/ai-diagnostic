"""模型厂商/API 配置管理端点。

可配置多个 LLM 配置，按 priority 主备 fallback。第一期只给运营用，不做鉴权 UI。
返回时 api_key 脱敏（只显示后 4 位）。
TODO 生产：api_key 应加密存储。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import require_admin
from app.config import llm_config_debug_label
from app.db.database import get_session
from app.db.models import LLMConfig
from app.llm.factory import make_llm_client
from app.llm.fallback import get_channel_runtime_state

router = APIRouter(prefix="/admin/llm-configs", dependencies=[Depends(require_admin)])


def _mask(key: str) -> str:
    if len(key) <= 4:
        return "****"
    return "****" + key[-4:]


class LLMConfigOut(BaseModel):
    id: str
    name: str
    provider: str
    model: str
    api_key_masked: str
    base_url: str
    priority: int
    is_active: bool
    runtime_status: str = "unknown"
    cooldown_remaining_seconds: int = 0
    last_error: str = ""
    last_error_type: str = ""
    failure_count: int = 0
    success_count: int = 0


class NewConfigRequest(BaseModel):
    name: str
    provider: str
    model: str
    api_key: str
    base_url: str = ""
    priority: int = 0
    is_active: bool = True


class PatchConfigRequest(BaseModel):
    name: str | None = None
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    priority: int | None = None
    is_active: bool | None = None


class LLMProbeResult(BaseModel):
    ok: bool
    message: str
    config: LLMConfigOut


def _out(c: LLMConfig) -> LLMConfigOut:
    runtime = get_channel_runtime_state(llm_config_debug_label(c))
    return LLMConfigOut(
        id=c.id, name=c.name, provider=c.provider, model=c.model,
        api_key_masked=_mask(c.api_key), base_url=c.base_url,
        priority=c.priority, is_active=c.is_active,
        runtime_status=str(runtime.get("runtime_status", "unknown")),
        cooldown_remaining_seconds=int(runtime.get("cooldown_remaining_seconds", 0) or 0),
        last_error=str(runtime.get("last_error", "") or ""),
        last_error_type=str(runtime.get("last_error_type", "") or ""),
        failure_count=int(runtime.get("failure_count", 0) or 0),
        success_count=int(runtime.get("success_count", 0) or 0),
    )


@router.get("/", response_model=list[LLMConfigOut])
async def list_configs(session: AsyncSession = Depends(get_session)):
    stmt = select(LLMConfig).order_by(LLMConfig.priority.asc())
    return [_out(c) for c in await session.scalars(stmt)]


@router.post("/", response_model=LLMConfigOut, status_code=201)
async def create_config(body: NewConfigRequest, session: AsyncSession = Depends(get_session)):
    c = LLMConfig(
        name=body.name, provider=body.provider, model=body.model,
        api_key=body.api_key, base_url=body.base_url,
        priority=body.priority, is_active=body.is_active,
    )
    session.add(c)
    await session.commit()
    await session.refresh(c)
    return _out(c)


@router.patch("/{config_id}", response_model=LLMConfigOut)
async def patch_config(
    config_id: str, body: PatchConfigRequest, session: AsyncSession = Depends(get_session)
):
    c = await session.get(LLMConfig, config_id)
    if c is None:
        raise HTTPException(status_code=404, detail="配置不存在")
    data = body.model_dump(exclude_none=True)
    if data.get("api_key") == "":
        data.pop("api_key")
    for k, v in data.items():
        setattr(c, k, v)
    session.add(c)
    await session.commit()
    await session.refresh(c)
    return _out(c)


@router.delete("/{config_id}", status_code=204)
async def delete_config(config_id: str, session: AsyncSession = Depends(get_session)):
    c = await session.get(LLMConfig, config_id)
    if c is not None:
        await session.delete(c)
        await session.commit()


@router.post("/{config_id}/probe", response_model=LLMProbeResult)
async def probe_config(config_id: str, session: AsyncSession = Depends(get_session)):
    c = await session.get(LLMConfig, config_id)
    if c is None:
        raise HTTPException(status_code=404, detail="配置不存在")

    client = make_llm_client(
        provider=c.provider,
        api_key=c.api_key,
        model=c.model,
        base_url=c.base_url,
    )
    client._debug_label_override = llm_config_debug_label(c)

    ok = True
    message = "连通成功"
    try:
        result = await client.complete(
            system="你是连通性测试助手。请只回复 OK。",
            prompt="请只回复 OK",
        )
        if not result.strip():
            message = "连通成功，但返回为空"
        else:
            message = f"连通成功：{result.strip()[:80]}"
    except Exception as exc:
        ok = False
        status = getattr(exc, "status_code", None)
        status_text = f"[{status}] " if status is not None else ""
        message = f"{status_text}{exc.__class__.__name__}: {str(exc)[:240]}"
        raise HTTPException(
            status_code=400,
            detail=LLMProbeResult(ok=ok, message=message, config=_out(c)).model_dump(),
        ) from exc

    return LLMProbeResult(ok=ok, message=message, config=_out(c))
