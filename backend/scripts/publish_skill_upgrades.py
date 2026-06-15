"""把代码中的新版 prompt 发布为 SkillVersion 新版本，并可选择激活。

运行：
cd backend && .venv/bin/python -m scripts.publish_skill_upgrades
"""
import asyncio
from datetime import datetime, timezone

from sqlalchemy import func, select

from app.db.database import AsyncSessionLocal, init_db
from app.db.models import SkillVersion
from app.skills.prompts import (
    FINANCE_DIAGNOSIS,
    MARKET_DIAGNOSIS,
    OPS_DIAGNOSIS,
    ORG_DIAGNOSIS,
    PRODUCT_DIAGNOSIS,
    QUESTIONNAIRE_AB_A,
    QUESTIONNAIRE_AB_B,
    SALES_DIAGNOSIS,
)


UPGRADES = [
    ("market", "diagnosis", "market-evidence", MARKET_DIAGNOSIS, "场景化市场诊断升级", "scenario_upgrade"),
    ("product", "diagnosis", "product-evidence", PRODUCT_DIAGNOSIS, "场景化产品诊断升级", "scenario_upgrade"),
    ("sales", "diagnosis", "funnel-evidence", SALES_DIAGNOSIS, "场景化销售诊断升级", "scenario_upgrade"),
    ("ops", "diagnosis", "operations-evidence", OPS_DIAGNOSIS, "场景化运营诊断升级", "scenario_upgrade"),
    ("org", "diagnosis", "organization-evidence", ORG_DIAGNOSIS, "场景化组织诊断升级", "scenario_upgrade"),
    ("finance", "diagnosis", "finance-evidence", FINANCE_DIAGNOSIS, "场景化财务诊断升级", "scenario_upgrade"),
    ("questionnaire_ab_a", "questionnaire", "coverage", QUESTIONNAIRE_AB_A, "全景采集版问卷升级", "questionnaire_upgrade"),
    ("questionnaire_ab_b", "questionnaire", "painpoint", QUESTIONNAIRE_AB_B, "核心问题深挖版问卷升级", "questionnaire_upgrade"),
]


async def _deactivate_all(session, module: str) -> None:
    stmt = select(SkillVersion).where(
        SkillVersion.module == module,
        SkillVersion.is_active == True,  # noqa: E712
    )
    for row in await session.scalars(stmt):
        row.is_active = False
        session.add(row)


async def publish() -> None:
    await init_db()
    async with AsyncSessionLocal() as session:
        for module, skill_type, method, prompt, reason, category in UPGRADES:
            current = await session.scalar(
                select(SkillVersion)
                .where(SkillVersion.module == module, SkillVersion.is_active == True)  # noqa: E712
                .order_by(SkillVersion.version.desc())
                .limit(1)
            )
            if current and current.system_prompt == prompt and current.method == method:
                print(f"{module} 当前激活版本已是最新，跳过")
                continue

            max_v = await session.scalar(
                select(func.max(SkillVersion.version)).where(SkillVersion.module == module)
            )
            next_v = (max_v or 0) + 1
            await _deactivate_all(session, module)
            ver = SkillVersion(
                module=module,
                skill_type=skill_type,
                version=next_v,
                system_prompt=prompt,
                method=method,
                is_active=True,
                change_reason=reason,
                change_category=category,
                reviewed_by="codex",
                reviewed_at=datetime.now(timezone.utc),
            )
            session.add(ver)
            await session.commit()
            print(f"已发布并激活 {module} v{next_v}")


if __name__ == "__main__":
    asyncio.run(publish())
