"""Image tool task API: create, confirm, poll, and list generation tasks.

Follows the same async-task + polling pattern as diagnosis_jobs.py,
with billing ledger integration via app/billing/ledger.py.
"""
import json

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import get_current_user
from app.billing.ledger import create_task, list_tasks, transition_task
from app.billing.pricing import estimate_points
from app.db.database import AsyncSessionLocal, get_session
from app.db.models import CanvasScene, ImageAsset, ToolTask, User, _now
from app.imaging.capabilities import list_image_model_capabilities
from app.imaging.ecommerce_skill import (
    SKILL_ID,
    SKILL_VERSION,
    get_category_tip,
    get_market_scope,
    get_conversion_driver,
    get_scene,
    get_style_variant,
    skill_catalog,
)
from app.imaging.template_catalog import get_template, template_catalog
from app.imaging.jobs import run_image_generation_job
from app.imaging.presets import get_preset

router = APIRouter(prefix="/image-tool", tags=["image-tool"])



class SaveCanvasSceneRequest(BaseModel):
    task_id: str | None = None
    name: str = "未命名画布"
    scene: dict[str, object]


class CanvasSceneResponse(BaseModel):
    id: str
    task_id: str | None
    name: str
    version: int
    scene: dict[str, object]
    created_at: str
    updated_at: str


def _scene_response(scene: CanvasScene) -> CanvasSceneResponse:
    return CanvasSceneResponse(
        id=scene.id,
        task_id=scene.task_id,
        name=scene.name,
        version=scene.version,
        scene=json.loads(scene.scene_json) if scene.scene_json else {},
        created_at=scene.created_at.isoformat(),
        updated_at=scene.updated_at.isoformat(),
    )


@router.post("/scenes", response_model=CanvasSceneResponse, status_code=201)
async def save_canvas_scene(
    req: SaveCanvasSceneRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CanvasSceneResponse:
    if req.task_id:
        task = await session.get(ToolTask, req.task_id)
        if task is None or task.user_id != user.id:
            raise HTTPException(status_code=404, detail="任务不存在")

    latest = None
    if req.task_id:
        latest = await session.scalar(
            select(CanvasScene)
            .where(CanvasScene.user_id == user.id, CanvasScene.task_id == req.task_id)
            .order_by(CanvasScene.version.desc())
        )
    version = (latest.version + 1) if latest else 1
    scene = CanvasScene(
        user_id=user.id,
        task_id=req.task_id,
        name=req.name.strip() or "未命名画布",
        version=version,
        scene_json=json.dumps(req.scene, ensure_ascii=False),
        updated_at=_now(),
    )
    session.add(scene)
    await session.commit()
    await session.refresh(scene)
    return _scene_response(scene)


@router.get("/scenes/latest", response_model=CanvasSceneResponse)
async def get_latest_canvas_scene(
    task_id: str = Query(...),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CanvasSceneResponse:
    scene = await session.scalar(
        select(CanvasScene)
        .where(CanvasScene.user_id == user.id, CanvasScene.task_id == task_id)
        .order_by(CanvasScene.version.desc())
    )
    if scene is None:
        raise HTTPException(status_code=404, detail="画布不存在")
    return _scene_response(scene)


@router.get("/scenes/{scene_id}", response_model=CanvasSceneResponse)
async def get_canvas_scene(
    scene_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CanvasSceneResponse:
    scene = await session.get(CanvasScene, scene_id)
    if scene is None or scene.user_id != user.id:
        raise HTTPException(status_code=404, detail="画布不存在")
    return _scene_response(scene)


@router.get("/capabilities")
async def get_image_model_capabilities(
    user: User = Depends(get_current_user),
) -> list[dict[str, object]]:
    """Return provider-configured image capabilities without inventing options."""
    return list_image_model_capabilities()


@router.get("/skill-catalog")
async def get_ecommerce_skill_catalog(
    user: User = Depends(get_current_user),
) -> dict[str, object]:
    return skill_catalog()


@router.get("/template-catalog")
async def get_image_template_catalog(
    user: User = Depends(get_current_user),
) -> dict[str, object]:
    """Return business template metadata; private prompt guidance stays backend-only."""
    return template_catalog()

class CreateImageTaskRequest(BaseModel):
    preset_id: str
    user_intent: str
    template_id: str | None = None
    reference_asset_id: str | None = None
    style: str | None = None
    size: str | None = None
    model: str | None = None
    aspect_ratio: str | None = None
    quality: str | None = None
    background: str | None = None
    generation_count: int = 1
    model_version: str | None = None
    generation_mode: str | None = None  # "text2image" | "image2image"
    edited_description: str | None = None  # user-edited reverse-prompt
    scene_id: str | None = None
    conversion_driver: str | None = None
    product_category: str | None = None
    market_scope: str | None = None
    style_variant: str | None = None
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
    result_image_urls: list[str] = []
    result_asset_ids: list[str] = []
    created_at: str
    updated_at: str
    # Canvas-relevant payload fields (optional; populated after job runs).
    preset_id: str | None = None
    template_id: str | None = None
    user_intent: str | None = None
    reference_asset_id: str | None = None
    reverse_prompt: str | None = None
    assembled_prompt: str | None = None
    generation_mode: str | None = None
    model: str | None = None
    model_version: str | None = None
    aspect_ratio: str | None = None
    size: str | None = None
    quality: str | None = None
    background: str | None = None
    generation_count: int | None = None


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
        result_image_urls=payload.get("result_image_urls") or [],
        result_asset_ids=payload.get("result_asset_ids") or [],
        created_at=task.created_at.isoformat(),
        updated_at=task.updated_at.isoformat(),
        preset_id=payload.get("preset_id"),
        template_id=payload.get("template_id"),
        user_intent=payload.get("user_intent"),
        reference_asset_id=payload.get("reference_asset_id"),
        reverse_prompt=payload.get("reverse_prompt") or payload.get("edited_description"),
        assembled_prompt=payload.get("assembled_prompt"),
        generation_mode=payload.get("generation_mode"),
        model=payload.get("model"),
        model_version=payload.get("model_version") or payload.get("model"),
        aspect_ratio=payload.get("aspect_ratio"),
        size=payload.get("size"),
        quality=payload.get("quality"),
        background=payload.get("background"),
        generation_count=payload.get("generation_count"),
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

    try:
        template = get_template(req.template_id, req.preset_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if req.preset_id == "ecommerce":
        try:
            get_scene(req.scene_id)
            get_conversion_driver(req.conversion_driver)
            get_category_tip(req.product_category)
            get_market_scope(req.market_scope)
            get_style_variant(req.style_variant)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    if req.reference_asset_id:
        asset = await session.get(ImageAsset, req.reference_asset_id)
        if asset is None or asset.user_id != user.id:
            raise HTTPException(status_code=404, detail="参考素材不存在")

    capabilities = list_image_model_capabilities()
    selected_capability = next(
        (item for item in capabilities if item.get("model") == req.model),
        capabilities[0] if capabilities else None,
    )
    if selected_capability is None:
        raise HTTPException(status_code=503, detail="当前没有可用的图片模型")

    def ensure_supported(field: str, value: str | None) -> None:
        if value is None:
            return
        options = selected_capability.get(field) or []
        supported = {item.get("value") for item in options if isinstance(item, dict)}
        if value not in supported:
            raise HTTPException(status_code=400, detail=f"当前模型不支持该规格选项")

    resolved_size = req.size
    if req.aspect_ratio and req.aspect_ratio != "auto":
        size_options = [item for item in (selected_capability.get("sizes") or []) if isinstance(item, dict)]
        if resolved_size:
            selected_size = next((item for item in size_options if item.get("value") == resolved_size), None)
            selected_ratio = selected_size.get("aspect_ratio") if selected_size else None
            if resolved_size != "auto" and selected_ratio not in (None, "auto", req.aspect_ratio):
                raise HTTPException(status_code=400, detail="所选比例与分辨率不匹配，请重新选择分辨率")
        else:
            resolved_size = next(
                (item.get("value") for item in size_options if item.get("aspect_ratio") in (req.aspect_ratio, "auto")),
                None,
            )

    ensure_supported("sizes", resolved_size)
    ensure_supported("aspect_ratios", req.aspect_ratio)
    ensure_supported("qualities", req.quality)
    ensure_supported("backgrounds", req.background)
    generation_counts = selected_capability.get("generation_counts") or [1]
    max_count = int(selected_capability.get("max_count") or max(generation_counts))
    if req.generation_count not in generation_counts or req.generation_count > max_count:
        raise HTTPException(status_code=400, detail="当前模型不支持该生成数量")

    quote = estimate_points("image", "basic")
    # Normalize generation mode: image2image requires a reference asset.
    mode = req.generation_mode or ("image2image" if req.reference_asset_id else "text2image")
    payload = {
        "preset_id": req.preset_id,
        "template_id": template.id,
        "user_intent": req.user_intent,
        "reference_asset_id": req.reference_asset_id,
        "style": req.style or preset.default_style,
        "size": resolved_size or preset.default_size,
        "model": req.model or selected_capability.get("model"),
        "model_version": req.model_version or req.model or selected_capability.get("model"),
        "aspect_ratio": req.aspect_ratio,
        "quality": req.quality,
        "background": req.background,
        "generation_count": req.generation_count,
        "generation_counts": generation_counts,
        "style_preset_version": "builtin-v1",
        "prompt_version": "image-prompt-v1",
        "generation_mode": mode,
        "edited_description": req.edited_description,
        "skill_id": SKILL_ID if req.preset_id == "ecommerce" else None,
        "skill_version": SKILL_VERSION if req.preset_id == "ecommerce" else None,
        "scene_id": req.scene_id,
        "conversion_driver": req.conversion_driver,
        "product_category": req.product_category,
        "market_scope": req.market_scope or "domestic",
        "style_variant": req.style_variant,
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
