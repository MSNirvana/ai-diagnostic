"""从数据库读取 skill 的当前激活版本。

skill 的 system prompt 存在 DB（SkillVersion 表），这里提供查询。
session 为 None 或查不到时返回 None，调用方回退到代码里的 fallback prompt，
保证数据库为空时系统仍能诊断。
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import SkillVersion


async def get_active_skill_version(
    session: AsyncSession | None, module: str
) -> SkillVersion | None:
    if session is None:
        return None
    stmt = select(SkillVersion).where(
        SkillVersion.module == module,
        SkillVersion.is_active == True,  # noqa: E712
    )
    return await session.scalar(stmt)
