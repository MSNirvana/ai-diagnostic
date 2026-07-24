"""测试共享 fixture：每个测试用独立的内存 SQLite，建表 + 注入 get_session。"""
import os

# Historical API tests use locally issued tokens. Production defaults to false;
# dedicated GGOO auth tests explicitly disable this compatibility switch.
os.environ["BUILD_LEGACY_AUTH_ENABLED"] = "true"

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel

from app.db import models  # noqa: F401  确保表注册
from app.db.database import get_session
from app.main import app


class _DefaultTestLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return "{}"

    async def describe_image(self, system: str, prompt: str, image_bytes: bytes, media_type: str) -> str:
        return "测试图片摘要"


@pytest.fixture(autouse=True)
def _bypass_ggoo_model_gateway():
    """Business tests use a deterministic model unless they install a richer fake."""
    from app.config import get_llm_client

    fallback = lambda: _DefaultTestLLM()
    app.dependency_overrides[get_llm_client] = fallback
    yield
    if app.dependency_overrides.get(get_llm_client) is fallback:
        app.dependency_overrides.pop(get_llm_client, None)


@pytest.fixture(autouse=True)
def _disable_local_api_bypass(monkeypatch):
    """Keep API tests user-isolated even when the developer .env enables local UI bypass."""
    monkeypatch.setenv("BUILD_TEST_API_BYPASS", "false")


@pytest.fixture(autouse=True)
def _bypass_admin_gate():
    """默认放行运营后台门，让历史 /admin 用例零改动通过。

    依赖覆盖整体替换 require_admin（内部 get_current_user 不再执行），
    所以"无 token 调 /admin"的旧用例照常工作。门本身的测试在用例内
    pop 掉这个覆盖来验真（非 admin 403 / admin 200）。
    """
    from app.auth.jwt import require_admin

    app.dependency_overrides[require_admin] = lambda: None
    yield
    app.dependency_overrides.pop(require_admin, None)


@pytest_asyncio.fixture
async def db_session():
    # 每个测试一个独立内存库，StaticPool 让同一连接复用以便表持久
    from sqlalchemy.pool import StaticPool

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def _override():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_session] = _override
    yield maker
    app.dependency_overrides.pop(get_session, None)
    await engine.dispose()
