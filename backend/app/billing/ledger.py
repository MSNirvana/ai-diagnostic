"""Task ledger state machine.

One row per billable task across tools (image generation, diagnostic model
calls, ...). This module only manages the *local* bookkeeping state; the
actual GGOO credit reservation/settlement API is not confirmed yet (see
handover doc section 16), so `reserved`/`refunded` here record intent and
will be wired to a real GGOO call once that endpoint exists.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ToolTask, _now


class LedgerError(RuntimeError):
    pass


class LedgerTransitionError(LedgerError):
    def __init__(self, current: str, target: str):
        super().__init__(f"不能从任务状态 {current} 迁移到 {target}")
        self.current = current
        self.target = target


# Allowed status transitions. Keys are the *current* status, values are the
# set of statuses it may move to. `succeeded` and `refunded` are terminal.
_TRANSITIONS: dict[str, set[str]] = {
    "quoted": {"reserved", "cancelled"},
    "reserved": {"running", "cancelled", "refunded"},
    "running": {"succeeded", "failed", "cancelled"},
    "failed": {"refunded"},
    "cancelled": {"refunded"},
    "succeeded": set(),
    "refunded": set(),
}

ALL_STATUSES = frozenset(_TRANSITIONS)


async def create_task(
    session: AsyncSession,
    *,
    user_id: str,
    tool: str,
    mode: str = "",
    model: str = "",
    source: str = "build",
    project_id: str | None = None,
    workflow_id: str | None = None,
    quote_points: int | None = None,
    payload_json: str = "{}",
    idempotency_key: str | None = None,
) -> ToolTask:
    """Create a new ledger row in `quoted` status.

    Idempotent when `idempotency_key` is given: a repeat call with the same
    key returns the existing row instead of creating a duplicate, so retried
    "create task" requests (double click, client timeout + retry) don't
    double-book a quote.
    """
    if idempotency_key:
        existing = await session.scalar(
            select(ToolTask).where(ToolTask.idempotency_key == idempotency_key)
        )
        if existing is not None:
            return existing

    task = ToolTask(
        user_id=user_id,
        tool=tool,
        mode=mode,
        model=model,
        source=source,
        project_id=project_id,
        workflow_id=workflow_id,
        quote_points=quote_points,
        payload_json=payload_json,
        idempotency_key=idempotency_key,
    )
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task


async def transition_task(
    session: AsyncSession,
    task: ToolTask,
    status: str,
    *,
    actual_points: int | None = None,
    error_message: str = "",
) -> ToolTask:
    """Move `task` to `status`, enforcing the ledger state machine.

    Raises `LedgerTransitionError` on an illegal move instead of silently
    overwriting status, so a double-settle or a bad retry surfaces loudly.
    """
    allowed = _TRANSITIONS.get(task.status, set())
    if status not in allowed:
        raise LedgerTransitionError(task.status, status)

    task.status = status
    task.updated_at = _now()
    if status == "succeeded" and actual_points is not None:
        task.actual_points = actual_points
    if error_message:
        task.error_message = error_message

    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task


async def list_tasks(
    session: AsyncSession,
    user_id: str,
    *,
    tool: str | None = None,
    limit: int = 50,
) -> list[ToolTask]:
    query = select(ToolTask).where(ToolTask.user_id == user_id)
    if tool:
        query = query.where(ToolTask.tool == tool)
    query = query.order_by(ToolTask.created_at.desc()).limit(limit)
    result = await session.scalars(query)
    return list(result.all())
