"""Credit balance display and cross-tool task ledger endpoints.

Scope (handover doc step 4): read-only balance display + a queryable task
ledger. Writing ledger rows (create/transition) is done by tool code, not
exposed as a generic public API yet — the image tool (step 6) will be the
first real writer.
"""
from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import get_current_user
from app.billing.ledger import list_tasks
from app.db.database import get_session
from app.db.models import User
from app.integrations.ggoo import GGOOError, ggoo_client

router = APIRouter(prefix="/billing", tags=["billing"])


class CreditsBalanceResponse(BaseModel):
    available: bool
    points: float | None = None


class ToolTaskOut(BaseModel):
    id: str
    tool: str
    mode: str
    model: str
    source: str
    status: str
    quote_points: int | None
    actual_points: int | None
    project_id: str | None
    created_at: str
    updated_at: str


@router.get("/balance", response_model=CreditsBalanceResponse)
async def get_balance(
    user: User = Depends(get_current_user),
    authorization: str = Header(...),
) -> CreditsBalanceResponse:
    """Best-effort credit balance for the nav bar.

    Never raises: a missing/unconfirmed GGOO balance endpoint should hide
    the display, not break navigation. See GGOOClient.get_credit_balance.
    """
    _scheme, _, token = authorization.strip().partition(" ")
    token = token.strip()
    try:
        points = await ggoo_client.get_credit_balance(token)
    except GGOOError:
        return CreditsBalanceResponse(available=False, points=None)
    if points is None:
        return CreditsBalanceResponse(available=False, points=None)
    return CreditsBalanceResponse(available=True, points=points)


@router.get("/tasks", response_model=list[ToolTaskOut])
async def get_tasks(
    tool: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ToolTaskOut]:
    tasks = await list_tasks(session, user.id, tool=tool, limit=limit)
    return [
        ToolTaskOut(
            id=task.id,
            tool=task.tool,
            mode=task.mode,
            model=task.model,
            source=task.source,
            status=task.status,
            quote_points=task.quote_points,
            actual_points=task.actual_points,
            project_id=task.project_id,
            created_at=task.created_at.isoformat(),
            updated_at=task.updated_at.isoformat(),
        )
        for task in tasks
    ]
