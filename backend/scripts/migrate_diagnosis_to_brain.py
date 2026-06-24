"""零 prose 化迁移：停用所有 diagnosis 域的激活 SkillVersion。

诊断判断改由 diagnostic_method 脑子按 domain 数据（label/industry_kpis/judgment_hints）
现场生成，各诊断域不再存 prose。本脚本停用 DB 里残留的 diagnosis 激活版本，让
get_active_skill_version 返回 None → 运行时 domain_prompt 为空 → 只用脑子。
旧版本保留在历史里可回溯。

运行：cd backend && .venv/bin/python -m scripts.migrate_diagnosis_to_brain
"""
import asyncio

from sqlalchemy import select

from app.db.database import AsyncSessionLocal, init_db
from app.db.models import SkillVersion
from app.skills.skill_network import diagnosis_skill_definitions


async def migrate() -> None:
    await init_db()
    diag_keys = {d.key for d in diagnosis_skill_definitions()}
    deactivated = 0
    async with AsyncSessionLocal() as session:
        rows = await session.scalars(
            select(SkillVersion).where(SkillVersion.is_active == True)  # noqa: E712
        )
        for row in rows:
            if row.module in diag_keys:
                row.is_active = False
                session.add(row)
                deactivated += 1
                print(f"停用 {row.module} v{row.version}")
        await session.commit()
    print(f"\n完成：停用 {deactivated} 个 diagnosis 激活版本，判断改由 diagnostic_method 脑子现场生成。")


if __name__ == "__main__":
    asyncio.run(migrate())
