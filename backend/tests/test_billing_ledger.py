"""Task ledger state machine and pricing lookup (billing scaffolding)."""
import pytest

from app.billing import pricing
from app.billing.ledger import LedgerTransitionError, create_task, list_tasks, transition_task
from app.db.models import User


async def _make_user(db_session) -> str:
    async with db_session() as session:
        user = User(email="ledger@b.com", hashed_password="x")
        session.add(user)
        await session.commit()
        return user.id


@pytest.mark.asyncio
async def test_create_task_starts_in_quoted_status(db_session):
    user_id = await _make_user(db_session)
    async with db_session() as session:
        task = await create_task(session, user_id=user_id, tool="image", mode="basic", quote_points=10)
    assert task.status == "quoted"
    assert task.source == "build"
    assert task.quote_points == 10


@pytest.mark.asyncio
async def test_create_task_is_idempotent_on_repeat_key(db_session):
    user_id = await _make_user(db_session)
    async with db_session() as session:
        first = await create_task(
            session, user_id=user_id, tool="image", mode="basic", idempotency_key="dup-1"
        )
        second = await create_task(
            session, user_id=user_id, tool="image", mode="basic", idempotency_key="dup-1"
        )
    assert first.id == second.id

    async with db_session() as session:
        rows = await list_tasks(session, user_id)
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_full_success_transition_chain_and_actual_points(db_session):
    user_id = await _make_user(db_session)
    async with db_session() as session:
        task = await create_task(session, user_id=user_id, tool="image", mode="basic", quote_points=10)
        task = await transition_task(session, task, "reserved")
        task = await transition_task(session, task, "running")
        task = await transition_task(session, task, "succeeded", actual_points=8)
    assert task.status == "succeeded"
    assert task.actual_points == 8


@pytest.mark.asyncio
async def test_failed_task_can_be_refunded(db_session):
    user_id = await _make_user(db_session)
    async with db_session() as session:
        task = await create_task(session, user_id=user_id, tool="image", mode="basic")
        task = await transition_task(session, task, "reserved")
        task = await transition_task(session, task, "running")
        task = await transition_task(session, task, "failed", error_message="模型超时")
        task = await transition_task(session, task, "refunded")
    assert task.status == "refunded"
    assert task.error_message == "模型超时"


@pytest.mark.asyncio
async def test_illegal_transition_is_rejected(db_session):
    user_id = await _make_user(db_session)
    async with db_session() as session:
        task = await create_task(session, user_id=user_id, tool="image", mode="basic")
        with pytest.raises(LedgerTransitionError):
            await transition_task(session, task, "succeeded")


@pytest.mark.asyncio
async def test_terminal_status_cannot_transition_again(db_session):
    user_id = await _make_user(db_session)
    async with db_session() as session:
        task = await create_task(session, user_id=user_id, tool="image", mode="basic")
        task = await transition_task(session, task, "reserved")
        task = await transition_task(session, task, "running")
        task = await transition_task(session, task, "succeeded", actual_points=5)
        with pytest.raises(LedgerTransitionError):
            await transition_task(session, task, "refunded")


@pytest.mark.asyncio
async def test_list_tasks_filters_by_tool_and_user(db_session):
    user_a = await _make_user(db_session)
    async with db_session() as session:
        other = User(email="other@b.com", hashed_password="x")
        session.add(other)
        await session.commit()
        user_b = other.id

    async with db_session() as session:
        await create_task(session, user_id=user_a, tool="image", mode="basic")
        await create_task(session, user_id=user_a, tool="diagnostic", mode="api")
        await create_task(session, user_id=user_b, tool="image", mode="basic")

    async with db_session() as session:
        image_only = await list_tasks(session, user_a, tool="image")
        all_for_a = await list_tasks(session, user_a)

    assert len(image_only) == 1
    assert image_only[0].tool == "image"
    assert len(all_for_a) == 2


def test_pricing_falls_back_through_defaults(monkeypatch):
    monkeypatch.setenv(
        "BUILD_PRICING_JSON",
        '{"image": {"basic": {"model-a": 5, "default": 8}, "default": 3}, "default": 1}',
    )
    pricing._price_table.cache_clear()
    assert pricing.estimate_points("image", "basic", "model-a") == 5
    assert pricing.estimate_points("image", "basic", "unknown-model") == 8
    assert pricing.estimate_points("image", "canvas") == 3
    assert pricing.estimate_points("diagnostic") == 1
    pricing._price_table.cache_clear()


def test_pricing_returns_none_without_configuration(monkeypatch):
    monkeypatch.delenv("BUILD_PRICING_JSON", raising=False)
    pricing._price_table.cache_clear()
    assert pricing.estimate_points("image", "basic", "any-model") is None
    pricing._price_table.cache_clear()
