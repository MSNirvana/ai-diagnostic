"""模型厂商/API 配置管理端点。

可配置多个 LLM 配置，按 priority 主备 fallback。第一期只给运营用，不做鉴权 UI。
返回时 api_key 脱敏（只显示后 4 位）。
TODO 生产：api_key 应加密存储。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_session
from app.db.models import LLMConfig

router = APIRouter(prefix="/admin/llm-configs")


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


def _out(c: LLMConfig) -> LLMConfigOut:
    return LLMConfigOut(
        id=c.id, name=c.name, provider=c.provider, model=c.model,
        api_key_masked=_mask(c.api_key), base_url=c.base_url,
        priority=c.priority, is_active=c.is_active,
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
