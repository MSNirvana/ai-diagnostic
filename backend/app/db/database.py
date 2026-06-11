import os
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
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


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
