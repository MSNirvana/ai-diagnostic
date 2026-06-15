import os
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import text
from sqlmodel import SQLModel

# 数据库文件路径可用环境变量覆盖（测试用内存库）
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "sqlite+aiosqlite:///./data/app.db"
)

async_engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(
    async_engine, class_=AsyncSession, expire_on_commit=False
)


async def init_db() -> None:
    """建表。导入 models 确保表已注册到 metadata。"""
    from app.db import models  # noqa: F401

    # 文件型 SQLite 需要确保目录存在
    if DATABASE_URL.startswith("sqlite+aiosqlite:///./"):
        os.makedirs("data", exist_ok=True)
    async with async_engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
        if DATABASE_URL.startswith("sqlite+aiosqlite:///"):
            await _ensure_sqlite_columns(conn)


async def _ensure_sqlite_columns(conn) -> None:
    diagnosis_result = await conn.execute(text("PRAGMA table_info(diagnosisrecord)"))
    diagnosis_columns = {row[1] for row in diagnosis_result.fetchall()}
    if "war_room_plan_json" not in diagnosis_columns:
        await conn.execute(text("ALTER TABLE diagnosisrecord ADD COLUMN war_room_plan_json TEXT"))

    project_result = await conn.execute(text("PRAGMA table_info(project)"))
    project_columns = {row[1] for row in project_result.fetchall()}
    if "war_room_plan_json" not in project_columns:
        await conn.execute(text("ALTER TABLE project ADD COLUMN war_room_plan_json TEXT"))


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
