"""一次性清理：删除 8 个行业绑定 skill（架构重构：行业→能力）。

删除范围：
- DB skillversion 表：8 个行业 module 的所有版本
- configs/<key>.json + <key>.prompt.md
- configs/_tests|_eval|_review/<key>.json
- configs/_research/ 全部旧研究 json（都是行业维度，作废）

运行前请先备份 data/app.db（已在重构流程里备份）。
运行：cd backend && .venv/bin/python -m scripts.cleanup_industry_skills
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from sqlalchemy import delete

from app.db.database import AsyncSessionLocal
from app.db.models import SkillVersion

# 要删除的 8 个行业绑定 skill（已归并到能力 skill 或现有核心/专业 skill）
INDUSTRY_SKILLS = [
    "dtc_ads",
    "cbe_ads",
    "dtc_private_traffic",
    "fb_franchise",
    "kitchen_channel",
    "saas_sales",
    "edu_compliance",
    "medbeauty_compliance",
]

CONFIGS_DIR = Path(__file__).parent.parent / "app" / "skills" / "configs"


def _cleanup_files() -> list[str]:
    removed: list[str] = []
    for key in INDUSTRY_SKILLS:
        candidates = [
            CONFIGS_DIR / f"{key}.json",
            CONFIGS_DIR / f"{key}.prompt.md",
            CONFIGS_DIR / "_tests" / f"{key}.json",
            CONFIGS_DIR / "_eval" / f"{key}.machine.json",
            CONFIGS_DIR / "_review" / f"{key}.json",
        ]
        for p in candidates:
            if p.exists():
                p.unlink()
                removed.append(str(p.relative_to(CONFIGS_DIR.parent)))
    # _research 全部清空（都是行业维度旧研究，作废）
    research_dir = CONFIGS_DIR / "_research"
    if research_dir.exists():
        for p in research_dir.glob("*.json"):
            p.unlink()
            removed.append(str(p.relative_to(CONFIGS_DIR.parent)))
    return removed


async def _cleanup_db() -> int:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            delete(SkillVersion).where(SkillVersion.module.in_(INDUSTRY_SKILLS))
        )
        await session.commit()
        return result.rowcount or 0


async def main() -> None:
    removed_files = _cleanup_files()
    deleted_rows = await _cleanup_db()
    print(f"删除文件 {len(removed_files)} 个：")
    for f in removed_files:
        print(f"  - {f}")
    print(f"删除 DB skillversion 记录 {deleted_rows} 条（{', '.join(INDUSTRY_SKILLS)}）")
    print("清理完成。")


if __name__ == "__main__":
    asyncio.run(main())
