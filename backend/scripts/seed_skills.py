"""把所有 skill 的 fallback prompt 写入数据库作为初始版本（幂等）。

运行：cd backend && .venv/bin/python -m scripts.seed_skills
每个 skill key 已存在版本则跳过，不重复插入。
"""
import asyncio

from sqlalchemy import select, func

from app.db.database import AsyncSessionLocal, init_db
from app.db.models import SkillVersion
from app.skills.skill_network import all_skill_definitions

# (module key, skill_type, method, prompt)
SEEDS = [
    (
        definition.key,
        definition.skill_type,
        definition.method,
        definition.fallback_prompt,
    )
    for definition in all_skill_definitions()
    if definition.fallback_prompt
]


async def seed() -> None:
    await init_db()
    async with AsyncSessionLocal() as session:
        for module, skill_type, method, prompt in SEEDS:
            existing = await session.scalar(
                select(func.count()).select_from(SkillVersion).where(
                    SkillVersion.module == module
                )
            )
            if existing:
                print(f"{module} 已有 {existing} 个版本，跳过")
                continue
            ver = SkillVersion(
                module=module,
                skill_type=skill_type,
                version=1,
                system_prompt=prompt,
                method=method,
                is_active=True,
                change_reason="初始版本，从代码迁移到数据库",
                change_category="migration",
                reviewed_by="system",
            )
            session.add(ver)
            await session.commit()
            print(f"已写入 {module} v1 并激活（{skill_type}）")


if __name__ == "__main__":
    asyncio.run(seed())
