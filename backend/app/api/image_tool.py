"""Image tool task API: create, confirm, poll, and list generation tasks.

Follows the same async-task + polling pattern as diagnosis_jobs.py,
with billing ledger integration via app/billing/ledger.py.
"""
import json

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import get_current_user
from app.billing.ledger import create_task, list_tasks, transition_task
from app.billing.pricing import estimate_points
from app.db.database import AsyncSessionLocal, get_session
from app.db.models import ImageAsset, ToolTask, User
from app.imaging.jobs import run_image_generation_job
from app.imaging.presets import get_preset

router = APIRouter(prefix="/image-tool", tags=["image-tool"])


class CreateImageTaskRequest(BaseModel):
    preset_id: str
    user_intent: str
    reference_asset_id: str | None = None
    style: str | None = None
    size: str | None = None
    idempotency_key: str | None = None


class CreateImageTaskResponse(BaseModel):
    task_id: str
    status: str
    quote_points: int | None


class ImageTaskStatus(BaseModel):
    id: str
    status: str
    progress: int
    quote_points: int | None
    actual_points: int | None
    error: str | None
    result_image_url: str | None
    created_at: str
    updated_at: str


def _task_status(task: ToolTask) -> ImageTaskStatus:
    payload = json.loads(task.payload_json) if task.payload_json else {}
    return ImageTaskStatus(
        id=task.id,
        status=task.status,
        progress=payload.get("progress", 0),
        quote_points=task.quote_points,
        actual_points=task.actual_points,
        error=task.error_message or None,
        result_image_url=payload.get("result_image_url"),
        created_at=task.created_at.isoformat(),
        updated_at=task.updated_at.isoformat(),
    )


@router.post("/tasks", response_model=CreateImageTaskResponse, status_code=202)
async def create_image_task(
    req: CreateImageTaskRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    authorization: str = Header(...),
    session: AsyncSession = Depends(get_session),
) -> CreateImageTaskResponse:
    preset = get_preset(req.preset_id)
    if preset is None:
        raise HTTPException(status_code=400, detail="未知的预设类型")

    if req.reference_asset_id:
        asset = await session.get(ImageAsset, req.reference_asset_id)
        if asset is None or asset.user_id != user.id:
            raise HTTPException(status_code=404, detail="参考素材不存在")

    quote = estimate_points("image", "basic")
    payload = {
        "preset_id": req.preset_id,
        "user_intent": req.user_intent,
        "reference_asset_id": req.reference_asset_id,
        "style": req.style or preset.default_style,
        "size": req.size or preset.default_size,
        "progress": 0,
    }
    task = await create_task(
        session,
        user_id=user.id,
        tool="image",
        mode="basic",
        quote_points=quote,
        payload_json=json.dumps(payload, ensure_ascii=False),
        idempotency_key=req.idempotency_key,
    )
    background_tasks.add_task(
        run_image_generation_job, task.id, AsyncSessionLocal, authorization
    )
    return CreateImageTaskResponse(
        task_id=task.id, status=task.status, quote_points=task.quote_points
    )


@router.post("/tasks/{task_id}/confirm", response_model=ImageTaskStatus)
async def confirm_image_task(
    task_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ImageTaskStatus:
    task = await session.get(ToolTask, task_id)
    if task is None or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status == "quoted":
        task = await transition_task(session, task, "reserved")
    return _task_status(task)


@router.get("/tasks/{task_id}", response_model=ImageTaskStatus)
async def get_image_task(
    task_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ImageTaskStatus:
    task = await session.get(ToolTask, task_id)
    if task is None or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="任务不存在")
    return _task_status(task)


@router.get("/tasks", response_model=list[ImageTaskStatus])
async def list_image_tasks(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    limit: int = 50,
) -> list[ImageTaskStatus]:
    tasks = await list_tasks(session, user.id, tool="image", limit=limit)
    return [_task_status(t) for t in tasks]
