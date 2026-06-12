"""Skill 版本管理端点。

第一期只给运营自己用（curl/Postman），不做鉴权 UI。
负责 skill 版本的查看、新增、激活——是"会进化的 skill 系统"的人工治理入口。
所有改动都留痕（change_reason/category/reviewed_by）。
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_session
from app.db.models import SkillVersion

router = APIRouter(prefix="/admin/skills")


class NewVersionRequest(BaseModel):
    system_prompt: str
    method: str = "hypothesis"
    change_reason: str
    change_category: str | None = None
    reviewed_by: str | None = None
    activate: bool = False   # 新建即激活


class SkillVersionOut(BaseModel):
    id: str
    module: str
    version: int
    system_prompt: str
    method: str
    is_active: bool
    change_reason: str | None
    change_category: str | None
    reviewed_by: str | None


@router.get("/", response_model=list[SkillVersionOut])
async def list_active(session: AsyncSession = Depends(get_session)):
    """所有模块的当前激活版本。"""
    stmt = select(SkillVersion).where(SkillVersion.is_active == True)  # noqa: E712
    return list(await session.scalars(stmt))


@router.get("/{module}/versions", response_model=list[SkillVersionOut])
async def list_versions(module: str, session: AsyncSession = Depends(get_session)):
    stmt = (
        select(SkillVersion)
        .where(SkillVersion.module == module)
        .order_by(SkillVersion.version.desc())
    )
    return list(await session.scalars(stmt))


async def _deactivate_all(session: AsyncSession, module: str) -> None:
    stmt = select(SkillVersion).where(
        SkillVersion.module == module,
        SkillVersion.is_active == True,  # noqa: E712
    )
    for v in await session.scalars(stmt):
        v.is_active = False
        session.add(v)


@router.post("/{module}/versions", response_model=SkillVersionOut, status_code=201)
async def add_version(
    module: str,
    body: NewVersionRequest,
    session: AsyncSession = Depends(get_session),
):
    # version 号 = 当前该模块最大版本 + 1
    max_v = await session.scalar(
        select(func.max(SkillVersion.version)).where(SkillVersion.module == module)
    )
    next_v = (max_v or 0) + 1
    if body.activate:
        await _deactivate_all(session, module)
    ver = SkillVersion(
        module=module,
        version=next_v,
        system_prompt=body.system_prompt,
        method=body.method,
        is_active=body.activate,
        change_reason=body.change_reason,
        change_category=body.change_category,
        reviewed_by=body.reviewed_by,
        reviewed_at=datetime.now(timezone.utc) if body.reviewed_by else None,
    )
    session.add(ver)
    await session.commit()
    await session.refresh(ver)
    return ver


@router.post("/{module}/activate/{version_id}", response_model=SkillVersionOut)
async def activate_version(
    module: str,
    version_id: str,
    session: AsyncSession = Depends(get_session),
):
    ver = await session.get(SkillVersion, version_id)
    if ver is None or ver.module != module:
        raise HTTPException(status_code=404, detail="版本不存在")
    await _deactivate_all(session, module)
    ver.is_active = True
    session.add(ver)
    await session.commit()
    await session.refresh(ver)
    return ver
