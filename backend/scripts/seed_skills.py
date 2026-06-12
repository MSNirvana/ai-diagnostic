"""把现有 market skill 的代码 prompt 写入数据库作为 v1（幂等）。

运行：cd backend && .venv/bin/python -m scripts.seed_skills
已存在 market 的版本则跳过，不重复插入。
"""
import asyncio

from sqlalchemy import select, func

from app.db.database import AsyncSessionLocal, init_db
from app.db.models import SkillVersion
from app.skills.market import _SYSTEM_FALLBACK


async def seed() -> None:
    await init_db()
    async with AsyncSessionLocal() as session:
        existing = await session.scalar(
            select(func.count()).select_from(SkillVersion).where(
                SkillVersion.module == "market"
            )
        )
        if existing:
            print(f"market 已有 {existing} 个版本，跳过 seed")
            return
        ver = SkillVersion(
            module="market",
            version=1,
            system_prompt=_SYSTEM_FALLBACK,
            method="hypothesis",
            is_active=True,
            change_reason="初始版本，从代码迁移到数据库",
            change_category="migration",
            reviewed_by="system",
        )
        session.add(ver)
        await session.commit()
        print("已写入 market v1 并激活")


if __name__ == "__main__":
    asyncio.run(seed())
