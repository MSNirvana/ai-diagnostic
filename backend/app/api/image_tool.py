"""Image tool task API: create, confirm, poll, and list generation tasks.

Follows the same async-task + polling pattern as diagnosis_jobs.py,
with billing ledger integration via app/billing/ledger.py.
"""
import json
from pathlib import Path
from numbers import Real

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Literal
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import get_current_user
from app.billing.ledger import create_task, list_tasks, transition_task
from app.billing.pricing import estimate_points
from app.db.database import AsyncSessionLocal, get_session
from app.db.models import CanvasExecution, CanvasScene, ImageAsset, ToolTask, User, _now
from app.config import get_llm_client
from app.imaging.prompts import IMAGE_ANCHOR_PROMPT, IMAGE_ANCHOR_SYSTEM
from app.llm.base import LLMClient
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

REFERENCE_ROLES = {
    "product", "detail", "style", "scene", "brand", "parameter", "layout", "copy", "other", "辅助参考图",
}
SCENE_SCHEMA_VERSION = "image-workbench.project.v1"
SCENE_MAX_BYTES = 2 * 1024 * 1024
SCENE_MAX_ITEMS = 200
SCENE_MAX_EDGES = 400
SCENE_DATA_TYPES = {"image", "prompt", "requirement", "model-config", "bundle", "result"}



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


class CanvasProjectExport(BaseModel):
    schema_version: str = SCENE_SCHEMA_VERSION
    exported_at: str
    name: str
    task_id: str | None = None
    scene: dict[str, object]


class CanvasProjectImportRequest(BaseModel):
    schema_version: str = SCENE_SCHEMA_VERSION
    name: str = "导入的图片工作流"
    task_id: str | None = None
    scene: dict[str, object]


class CanvasExecutionRequest(BaseModel):
    """执行一个 AI 节点时提交的前端草稿快照。"""

    node_id: str = Field(min_length=1, max_length=128)
    operation: Literal["reverse_prompt", "generate", "edit", "copy"]
    scene: dict[str, object]
    scene_id: str | None = None
    task_id: str | None = None
    input_asset_ids: list[str] = Field(default_factory=list, max_length=8)
    input: dict[str, object] = Field(default_factory=dict)


class CanvasExecutionResponse(BaseModel):
    execution_id: str
    scene_id: str
    scene_version: int
    node_id: str
    operation: str
    status: str
    result: dict[str, object] = Field(default_factory=dict)
    error: str | None = None
    created_at: str
    updated_at: str


def _execution_response(execution: CanvasExecution, scene: CanvasScene) -> CanvasExecutionResponse:
    return CanvasExecutionResponse(
        execution_id=execution.id,
        scene_id=scene.id,
        scene_version=scene.version,
        node_id=execution.node_id,
        operation=execution.operation,
        status=execution.status,
        result=json.loads(execution.output_json) if execution.output_json else {},
        error=execution.error_message or None,
        created_at=execution.created_at.isoformat(),
        updated_at=execution.updated_at.isoformat(),
    )


def _validate_scene(scene: dict[str, object], user_id: str, session: AsyncSession) -> None:
    """Validate the transport envelope before persisting a canvas snapshot."""
    if not isinstance(scene, dict):
        raise HTTPException(status_code=400, detail="画布数据必须是 JSON 对象")
    try:
        encoded = json.dumps(scene, ensure_ascii=False)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="画布数据不是有效 JSON") from exc
    if len(encoded.encode("utf-8")) > SCENE_MAX_BYTES:
        raise HTTPException(status_code=400, detail="画布 JSON 不得超过 2MB")
    for field in ("items", "edges", "groups"):
        value = scene.get(field)
        if value is not None and not isinstance(value, list):
            raise HTTPException(status_code=400, detail=f"画布字段 {field} 必须是数组")
    items = scene.get("items") or []
    edges = scene.get("edges") or []
    groups = scene.get("groups") or []
    if len(items) > SCENE_MAX_ITEMS:
        raise HTTPException(status_code=400, detail="画布节点数量不得超过 200 个")
    if len(edges) > SCENE_MAX_EDGES:
        raise HTTPException(status_code=400, detail="画布连线数量不得超过 400 条")

    item_ids: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="画布节点必须是对象")
        item_id = item.get("id")
        if not isinstance(item_id, str) or not item_id.strip():
            raise HTTPException(status_code=400, detail="画布节点缺少有效 ID")
        if item_id in item_ids:
            raise HTTPException(status_code=400, detail="画布节点 ID 不能重复")
        item_ids.add(item_id)

    edge_ids: set[str] = set()
    for edge in edges:
        if not isinstance(edge, dict):
            raise HTTPException(status_code=400, detail="画布连线必须是对象")
        edge_id = edge.get("id")
        if edge_id is not None:
            if not isinstance(edge_id, str) or not edge_id.strip() or edge_id in edge_ids:
                raise HTTPException(status_code=400, detail="画布连线 ID 无效或重复")
            edge_ids.add(edge_id)
        from_id, to_id = edge.get("fromId"), edge.get("toId")
        if not isinstance(from_id, str) or not isinstance(to_id, str):
            raise HTTPException(status_code=400, detail="画布连线缺少起点或终点")
        if item_ids and (from_id not in item_ids or to_id not in item_ids):
            raise HTTPException(status_code=400, detail="画布连线引用了不存在的节点")
        for port_key in ("fromPort", "toPort"):
            port = edge.get(port_key)
            if port is not None and (not isinstance(port, str) or not port.strip()):
                raise HTTPException(status_code=400, detail="画布端口名称无效")
        data_type = edge.get("dataType")
        if data_type is not None and data_type not in SCENE_DATA_TYPES:
            raise HTTPException(status_code=400, detail="画布连线数据类型不受支持")

    group_ids: set[str] = set()
    for group in groups:
        if not isinstance(group, dict):
            raise HTTPException(status_code=400, detail="画布分组必须是对象")
        group_id = group.get("id")
        if not isinstance(group_id, str) or not group_id.strip() or group_id in group_ids:
            raise HTTPException(status_code=400, detail="画布分组 ID 无效或重复")
        group_ids.add(group_id)
        member_ids = group.get("itemIds", [])
        if not isinstance(member_ids, list) or any(
            not isinstance(item_id, str) or item_id not in item_ids for item_id in member_ids
        ):
            raise HTTPException(status_code=400, detail="画布分组引用了不存在的节点")
    viewport = scene.get("viewport")
    if viewport is not None and not isinstance(viewport, dict):
        raise HTTPException(status_code=400, detail="画布 viewport 必须是对象")
    if isinstance(viewport, dict):
        scale = viewport.get("scale", 1)
        if not isinstance(scale, Real) or isinstance(scale, bool) or not 0.1 <= scale <= 10:
            raise HTTPException(status_code=400, detail="画布缩放比例必须在 0.1 到 10 之间")


def _scene_asset_ids(scene: object) -> set[str]:
    """Collect asset references without trusting arbitrary nested metadata."""
    found: set[str] = set()
    if isinstance(scene, dict):
        for key, value in scene.items():
            if key in {
                "asset_id", "assetId", "source_asset_id", "sourceAssetId",
                "reference_asset_id", "referenceAssetId",
            } and isinstance(value, str):
                if value.strip():
                    found.add(value.strip())
            elif key in {
                "asset_ids", "assetIds", "reference_asset_ids", "referenceAssetIds",
                "result_asset_ids", "resultAssetIds", "source_asset_ids", "sourceAssetIds",
            } and isinstance(value, list):
                found.update(item.strip() for item in value if isinstance(item, str) and item.strip())
            else:
                found.update(_scene_asset_ids(value))
    elif isinstance(scene, list):
        for item in scene:
            found.update(_scene_asset_ids(item))
    return found


async def _validate_scene_assets(scene: dict[str, object], user_id: str, session: AsyncSession) -> None:
    for asset_id in _scene_asset_ids(scene):
        asset = await session.get(ImageAsset, asset_id)
        if asset is None or asset.user_id != user_id:
            raise HTTPException(status_code=404, detail="画布引用的素材不存在")


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
    _validate_scene(req.scene, user.id, session)
    await _validate_scene_assets(req.scene, user.id, session)
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


@router.get("/projects/{scene_id}", response_model=CanvasProjectExport)
async def export_canvas_project(
    scene_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CanvasProjectExport:
    scene = await session.get(CanvasScene, scene_id)
    if scene is None or scene.user_id != user.id:
        raise HTTPException(status_code=404, detail="画布不存在")
    return CanvasProjectExport(
        exported_at=_now().isoformat(),
        name=scene.name,
        task_id=scene.task_id,
        scene=json.loads(scene.scene_json) if scene.scene_json else {},
    )


@router.post("/projects/import", response_model=CanvasSceneResponse, status_code=201)
async def import_canvas_project(
    req: CanvasProjectImportRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CanvasSceneResponse:
    if req.schema_version != SCENE_SCHEMA_VERSION:
        raise HTTPException(status_code=400, detail="不支持的画布 JSON 版本")
    _validate_scene(req.scene, user.id, session)
    await _validate_scene_assets(req.scene, user.id, session)
    if req.task_id:
        task = await session.get(ToolTask, req.task_id)
        if task is None or task.user_id != user.id:
            raise HTTPException(status_code=404, detail="任务不存在")
    scene = CanvasScene(
        user_id=user.id,
        task_id=req.task_id,
        name=req.name.strip() or "导入的图片工作流",
        version=1,
        scene_json=json.dumps(req.scene, ensure_ascii=False),
        updated_at=_now(),
    )
    session.add(scene)
    await session.commit()
    await session.refresh(scene)
    return _scene_response(scene)


@router.post("/executions", response_model=CanvasExecutionResponse, status_code=201)
async def execute_canvas_node(
    req: CanvasExecutionRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
) -> CanvasExecutionResponse:
    """保存执行时快照并执行 AI 节点。

    该接口接收前端尚未手动保存的 draft scene，因此拖动过程无需请求后端。
    当前先落地反推提示词；其它 operation 保留统一契约，后续接入各自任务执行器。
    """
    _validate_scene(req.scene, user.id, session)
    await _validate_scene_assets(req.scene, user.id, session)

    base_scene = None
    if req.scene_id:
        base_scene = await session.get(CanvasScene, req.scene_id)
        if base_scene is None or base_scene.user_id != user.id:
            raise HTTPException(status_code=404, detail="画布不存在")
        if req.task_id and base_scene.task_id not in (None, req.task_id):
            raise HTTPException(status_code=400, detail="执行任务与画布不匹配")

    snapshot_task_id = req.task_id or (base_scene.task_id if base_scene else None)

    if req.task_id:
        task = await session.get(ToolTask, req.task_id)
        if task is None or task.user_id != user.id:
            raise HTTPException(status_code=404, detail="任务不存在")

    asset_ids = list(dict.fromkeys(item.strip() for item in req.input_asset_ids if item.strip()))
    for asset_id in asset_ids:
        asset = await session.get(ImageAsset, asset_id)
        if asset is None or asset.user_id != user.id or asset.deleted_at is not None:
            raise HTTPException(status_code=404, detail="执行节点引用的素材不存在")

    latest = await session.scalar(
        select(CanvasScene)
        .where(CanvasScene.user_id == user.id, CanvasScene.task_id == snapshot_task_id)
        .order_by(CanvasScene.version.desc())
    )
    scene = CanvasScene(
        user_id=user.id,
        task_id=snapshot_task_id,
        name=(latest.name if latest else (base_scene.name if base_scene else "未命名画布")),
        version=(latest.version + 1 if latest else 1),
        scene_json=json.dumps(req.scene, ensure_ascii=False),
        updated_at=_now(),
    )
    session.add(scene)
    await session.flush()

    execution = CanvasExecution(
        user_id=user.id,
        scene_id=scene.id,
        node_id=req.node_id,
        operation=req.operation,
        status="running",
        input_asset_ids_json=json.dumps(asset_ids, ensure_ascii=False),
        scene_snapshot_json=json.dumps(req.scene, ensure_ascii=False),
        input_json=json.dumps(req.input, ensure_ascii=False),
    )
    session.add(execution)
    await session.flush()

    try:
        if req.operation != "reverse_prompt":
            raise HTTPException(status_code=501, detail=f"暂未接入 {req.operation} 节点执行器")
        if len(asset_ids) != 1:
            raise HTTPException(status_code=400, detail="AI 反推提示词节点需要且只能需要一张参考图片")
        asset = await session.get(ImageAsset, asset_ids[0])
        path = Path(asset.stored_path) if asset else None
        if asset is None or path is None or not path.exists():
            raise HTTPException(status_code=404, detail="参考图片文件不可用")
        description = (
            await llm.describe_image(
                IMAGE_ANCHOR_SYSTEM,
                IMAGE_ANCHOR_PROMPT,
                path.read_bytes(),
                asset.content_type,
            )
        ).strip()
        if not description:
            raise HTTPException(status_code=502, detail="图片识别接口没有返回有效提示词")
        execution.status = "succeeded"
        execution.output_json = json.dumps({"reverse_prompt": description}, ensure_ascii=False)
        execution.updated_at = _now()
        asset.last_used_at = _now()
        await session.commit()
        await session.refresh(execution)
        await session.refresh(scene)
        return _execution_response(execution, scene)
    except HTTPException as exc:
        execution.status = "failed"
        execution.error_message = str(exc.detail)
        execution.updated_at = _now()
        await session.commit()
        raise
    except Exception as exc:
        execution.status = "failed"
        execution.error_message = str(exc)
        execution.updated_at = _now()
        await session.commit()
        raise HTTPException(status_code=502, detail="图片识别接口调用失败，请稍后重试") from exc


@router.get("/executions/{execution_id}", response_model=CanvasExecutionResponse)
async def get_canvas_execution(
    execution_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CanvasExecutionResponse:
    execution = await session.get(CanvasExecution, execution_id)
    if execution is None or execution.user_id != user.id or execution.scene_id is None:
        raise HTTPException(status_code=404, detail="画布执行记录不存在")
    scene = await session.get(CanvasScene, execution.scene_id)
    if scene is None or scene.user_id != user.id:
        raise HTTPException(status_code=404, detail="执行记录关联的画布不存在")
    return _execution_response(execution, scene)


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

class ReferenceAssetRequest(BaseModel):
    """A typed reference-material binding used by both basic and canvas mode."""

    asset_id: str = Field(min_length=1, max_length=128)
    role: Literal[
        "product", "detail", "style", "scene", "brand", "parameter", "layout", "copy", "other", "辅助参考图",
    ] = "辅助参考图"


class CreateImageTaskRequest(BaseModel):
    preset_id: str = Field(min_length=1, max_length=64)
    user_intent: str = Field(min_length=1, max_length=4000)
    template_id: str | None = None
    reference_asset_id: str | None = None
    reference_asset_ids: list[str] = Field(default_factory=list)
    reference_assets: list[ReferenceAssetRequest] = Field(default_factory=list, max_length=8)
    workspace_mode: Literal["basic", "canvas"] = "basic"
    style: str | None = Field(default=None, max_length=200)
    size: str | None = Field(default=None, max_length=32)
    model: str | None = Field(default=None, max_length=128)
    aspect_ratio: str | None = Field(default=None, max_length=16)
    quality: str | None = Field(default=None, max_length=32)
    background: str | None = Field(default=None, max_length=32)
    generation_count: int = Field(default=1, ge=1, le=8)
    model_version: str | None = Field(default=None, max_length=128)
    generation_mode: Literal["text2image", "image2image"] | None = None
    edited_description: str | None = Field(default=None, max_length=4000)
    scene_id: str | None = None
    conversion_driver: str | None = Field(default=None, max_length=64)
    product_category: str | None = Field(default=None, max_length=64)
    market_scope: str | None = Field(default=None, max_length=64)
    style_variant: str | None = Field(default=None, max_length=64)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=128)


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
    result_image_urls: list[str] = Field(default_factory=list)
    result_asset_ids: list[str] = Field(default_factory=list)
    result_asset_urls: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str
    # Canvas-relevant payload fields (optional; populated after job runs).
    preset_id: str | None = None
    template_id: str | None = None
    user_intent: str | None = None
    reference_asset_id: str | None = None
    reference_asset_ids: list[str] = Field(default_factory=list)
    reference_assets: list[dict[str, str]] = Field(default_factory=list)
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
    workspace_mode: str | None = None


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
        result_asset_urls=[
            f"/image-assets/{asset_id}/file"
            for asset_id in (payload.get("result_asset_ids") or [])
            if isinstance(asset_id, str) and asset_id
        ],
        created_at=task.created_at.isoformat(),
        updated_at=task.updated_at.isoformat(),
        preset_id=payload.get("preset_id"),
        template_id=payload.get("template_id"),
        user_intent=payload.get("user_intent"),
        reference_asset_id=payload.get("reference_asset_id"),
        reference_asset_ids=payload.get("reference_asset_ids") or [],
        reference_assets=payload.get("reference_assets") or [],
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
        workspace_mode=payload.get("workspace_mode"),
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
    else:
        try:
            get_style_variant(req.style_variant)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    if req.workspace_mode not in {"basic", "canvas"}:
        raise HTTPException(status_code=400, detail="未知的工作台模式")
    references = [item.model_dump() for item in req.reference_assets]
    for asset_id in req.reference_asset_ids:
        if not any(item.get("asset_id") == asset_id for item in references):
            references.append({"asset_id": asset_id, "role": "辅助参考图"})
    if req.reference_asset_id and not any(item.get("asset_id") == req.reference_asset_id for item in references):
        references.insert(0, {"asset_id": req.reference_asset_id, "role": "product"})
    if len(references) > (2 if req.workspace_mode == "basic" else 8):
        limit = 2 if req.workspace_mode == "basic" else 8
        raise HTTPException(status_code=400, detail=f"当前模式最多选择 {limit} 张参考图片")
    reference_ids = [item.get("asset_id", "").strip() for item in references]
    if any(not asset_id for asset_id in reference_ids) or len(set(reference_ids)) != len(reference_ids):
        raise HTTPException(status_code=400, detail="参考图片列表包含无效或重复素材")
    if any(item.get("role", "product") not in REFERENCE_ROLES for item in references):
        raise HTTPException(status_code=400, detail="参考图片用途不受支持")
    for asset_id in reference_ids:
        asset = await session.get(ImageAsset, asset_id)
        if asset is None or asset.user_id != user.id:
            raise HTTPException(status_code=404, detail="参考素材不存在")

    capabilities = list_image_model_capabilities()
    if req.model:
        selected_capability = next(
            (item for item in capabilities if item.get("model") == req.model),
            None,
        )
    else:
        selected_capability = capabilities[0] if capabilities else None
    if selected_capability is None:
        if req.model and capabilities:
            raise HTTPException(status_code=400, detail="当前未配置该图片模型")
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

    if resolved_size is None:
        resolved_size = next(
            (item.get("value") for item in (selected_capability.get("sizes") or []) if isinstance(item, dict)),
            None,
        )
    ensure_supported("sizes", resolved_size)
    ensure_supported("aspect_ratios", req.aspect_ratio)
    if req.aspect_ratio and req.aspect_ratio != "auto" and resolved_size:
        selected_size = next(
            (
                item for item in (selected_capability.get("sizes") or [])
                if isinstance(item, dict) and item.get("value") == resolved_size
            ),
            None,
        )
        selected_ratio = selected_size.get("aspect_ratio") if selected_size else None
        if selected_ratio not in (None, "auto", req.aspect_ratio):
            raise HTTPException(status_code=400, detail="所选比例与分辨率不匹配，请重新选择分辨率")
    ensure_supported("qualities", req.quality)
    ensure_supported("backgrounds", req.background)
    generation_counts = selected_capability.get("generation_counts") or [1]
    max_count = int(selected_capability.get("max_count") or max(generation_counts))
    if req.generation_count not in generation_counts or req.generation_count > max_count:
        raise HTTPException(status_code=400, detail="当前模型不支持该生成数量")

    quote = estimate_points("image", "basic")
    # Normalize generation mode: image2image requires a reference asset.
    primary_reference_id = reference_ids[0] if reference_ids else None
    mode = req.generation_mode or ("image2image" if primary_reference_id else "text2image")
    if mode == "image2image" and not primary_reference_id:
        raise HTTPException(status_code=400, detail="图片二次创作至少需要一张参考图片")
    if mode == "text2image" and primary_reference_id:
        raise HTTPException(status_code=400, detail="选择参考图片后请使用图片二次创作模式")
    payload = {
        "preset_id": req.preset_id,
        "template_id": template.id,
        "user_intent": req.user_intent,
        "reference_asset_id": primary_reference_id,
        "reference_asset_ids": reference_ids,
        "reference_assets": references,
        "style": req.style or preset.default_style,
        "size": resolved_size or preset.default_size,
        "model": req.model or selected_capability.get("model"),
        "model_version": req.model_version or req.model or selected_capability.get("model"),
        "aspect_ratio": req.aspect_ratio or next(
            (item.get("aspect_ratio") for item in (selected_capability.get("sizes") or [])
             if isinstance(item, dict) and item.get("value") == resolved_size),
            None,
        ),
        "quality": req.quality,
        "background": req.background,
        "generation_count": req.generation_count,
        "workspace_mode": req.workspace_mode,
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
        mode=req.workspace_mode if req.workspace_mode in {"basic", "canvas"} else "basic",
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
