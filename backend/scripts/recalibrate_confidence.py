"""Re-score persisted evidence confidence for all historical projects.

Run:
cd backend && .venv/bin/python -m scripts.recalibrate_confidence
"""
import asyncio

from app.db.database import AsyncSessionLocal, init_db
from app.evidence_recalibration import recalibrate_all_confidence


async def main() -> None:
    await init_db()
    async with AsyncSessionLocal() as session:
        summary = await recalibrate_all_confidence(session)
        print("可信度重审完成")
        print(f"扫描诊断记录: {summary.records_seen}")
        print(f"更新诊断记录: {summary.records_updated}")
        print(f"重算专家结论: {summary.results_recalibrated}")
        print(f"更新记录作战室: {summary.war_room_records_updated}")
        print(f"更新项目档案: {summary.memory_entries_updated}")
        print(f"重建项目作战室: {summary.projects_rebuilt}")
        if summary.changed_records:
            print("记录: " + ", ".join(summary.changed_records))
        if summary.changed_projects:
            print("项目: " + ", ".join(summary.changed_projects))


if __name__ == "__main__":
    asyncio.run(main())
