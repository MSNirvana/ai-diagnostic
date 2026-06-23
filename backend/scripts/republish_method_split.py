"""方法/领域拆分迁移：把各诊断 skill 的 DB 版本刷成"薄领域 prompt"。

背景：通用诊断方法已抽成单一主 skill（app/skills/method.py），运行时由
ConfiguredExpertSkill 注入；各 skill 存储的 prompt 改为只含领域切片。
本脚本把 DB 里旧的"方法+领域"合并版（fat）重新发布为新的薄版本：
停用旧激活版、插入并激活新薄版，旧版保留在历史里可回溯。

只处理 skill_type == "diagnosis" 的 skill（走 method 注入路径的那批）；
问卷/访谈/证据/档案等不受影响。幂等：已是薄版本则跳过。

运行：cd backend && .venv/bin/python -m scripts.republish_method_split
"""
import asyncio
from datetime import datetime, timezone

from sqlalchemy import func, select

from app.db.database import AsyncSessionLocal, init_db
from app.db.models import SkillVersion
from app.skills.skill_network import diagnosis_skill_definitions


async def _deactivate_active(session, module: str) -> None:
    stmt = select(SkillVersion).where(
        SkillVersion.module == module,
        SkillVersion.is_active == True,  # noqa: E712
    )
    for row in await session.scalars(stmt):
        row.is_active = False
        session.add(row)


async def republish() -> None:
    await init_db()
    published, skipped = 0, 0
    async with AsyncSessionLocal() as session:
        for d in diagnosis_skill_definitions():
            thin_prompt = d.fallback_prompt
            if not thin_prompt:
                continue
            current = await session.scalar(
                select(SkillVersion)
                .where(SkillVersion.module == d.key, SkillVersion.is_active == True)  # noqa: E712
                .order_by(SkillVersion.version.desc())
                .limit(1)
            )
            if current and current.system_prompt == thin_prompt:
                print(f"{d.key} 当前激活版本已是薄版本，跳过")
                skipped += 1
                continue

            max_v = await session.scalar(
                select(func.max(SkillVersion.version)).where(SkillVersion.module == d.key)
            )
            next_v = (max_v or 0) + 1
            await _deactivate_active(session, d.key)
            session.add(
                SkillVersion(
                    module=d.key,
                    skill_type=d.skill_type,
                    version=next_v,
                    system_prompt=thin_prompt,
                    method=d.method,
                    is_active=True,
                    change_reason="方法/领域拆分：领域 prompt 瘦身，通用方法改为运行时注入",
                    change_category="method_split",
                    reviewed_by="system",
                    reviewed_at=datetime.now(timezone.utc),
                )
            )
            await session.commit()
            print(f"已发布并激活 {d.key} v{next_v}（薄领域版）")
            published += 1
    print(f"\n完成：新发布 {published} 个，跳过 {skipped} 个。")


if __name__ == "__main__":
    asyncio.run(republish())
