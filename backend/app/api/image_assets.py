"""Image asset upload and management for the image tool.

Separate from the diagnostic tool's UploadedFile: platform-level assets
not bound to any diagnosis session.
"""
import os
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.jwt import get_current_user
from app.config import get_llm_client
from app.db.database import get_session
from app.db.models import ImageAsset, User
from app.imaging.prompts import IMAGE_ANCHOR_PROMPT, IMAGE_ANCHOR_SYSTEM
from app.llm.base import LLMClient
from app.storage import image_asset_root, resolve_storage_path

router = APIRouter(prefix="/image-assets", tags=["image-tool"])

UPLOAD_ROOT = image_asset_root()
MAX_IMAGE_SIZE = 10 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_REFERENCE_ASSETS = 50
MAX_REFERENCE_BYTES = 500 * 1024 * 1024
MAX_GENERATED_ASSETS = 100
MAX_GENERATED_BYTES = 1024 * 1024 * 1024


class ImageAssetOut(BaseModel):
    id: str
    original_name: str
    content_type: str
    vision_description: str
    vision_status: str
    created_at: str
    size_bytes: int
    file_url: str
    asset_kind: str = "reference"


class ImageAssetUsage(BaseModel):
    reference_count: int
    reference_bytes: int
    reference_count_limit: int
    reference_bytes_limit: int
    generated_count: int
    generated_bytes: int
    generated_count_limit: int
    generated_bytes_limit: int
    warning: bool


def _to_out(asset: ImageAsset) -> ImageAssetOut:
    return ImageAssetOut(
        id=asset.id,
        original_name=asset.original_name,
        content_type=asset.content_type,
        vision_description=asset.vision_description,
        vision_status=asset.vision_status,
        created_at=asset.created_at.isoformat(),
        size_bytes=(
            resolve_storage_path(asset.stored_path).stat().st_size
            if asset.stored_path and resolve_storage_path(asset.stored_path).exists()
            else 0
        ),
        file_url=f"/image-assets/{asset.id}/file",
        asset_kind=asset.asset_kind,
    )


async def _usage_for_user(session: AsyncSession, user_id: str) -> ImageAssetUsage:
    result = await session.execute(
        select(ImageAsset).where(ImageAsset.user_id == user_id, ImageAsset.deleted_at.is_(None))
    )
    reference_count = reference_bytes = generated_count = generated_bytes = 0
    for asset in result.scalars().all():
        resolved_path = resolve_storage_path(asset.stored_path) if asset.stored_path else None
        size = resolved_path.stat().st_size if resolved_path and resolved_path.exists() else 0
        if asset.asset_kind == "generated":
            generated_count += 1
            generated_bytes += size
        else:
            reference_count += 1
            reference_bytes += size
    return ImageAssetUsage(
        reference_count=reference_count,
        reference_bytes=reference_bytes,
        reference_count_limit=MAX_REFERENCE_ASSETS,
        reference_bytes_limit=MAX_REFERENCE_BYTES,
        generated_count=generated_count,
        generated_bytes=generated_bytes,
        generated_count_limit=MAX_GENERATED_ASSETS,
        generated_bytes_limit=MAX_GENERATED_BYTES,
        warning=(reference_count / MAX_REFERENCE_ASSETS >= 0.8
                 or reference_bytes / MAX_REFERENCE_BYTES >= 0.8
                 or generated_count / MAX_GENERATED_ASSETS >= 0.8
                 or generated_bytes / MAX_GENERATED_BYTES >= 0.8),
    )


@router.post("/", response_model=ImageAssetOut, status_code=201)
async def upload_image_asset(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
) -> ImageAssetOut:
    content_type = file.content_type or ""
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="仅支持 PNG、JPEG 或 WebP 图片")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="不能上传空文件")
    if len(content) > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=400, detail="图片不得超过 10MB")

    usage = await _usage_for_user(session, user.id)
    if usage.reference_count >= MAX_REFERENCE_ASSETS:
        raise HTTPException(status_code=409, detail=f"参考图片最多保存 {MAX_REFERENCE_ASSETS} 张，请先删除不需要的素材")
    if usage.reference_bytes + len(content) > MAX_REFERENCE_BYTES:
        raise HTTPException(status_code=409, detail="参考图片素材库容量已达到 500MB，请先删除不需要的素材")

    asset = ImageAsset(
        user_id=user.id,
        stored_path="",
        original_name=file.filename or "unnamed",
        content_type=content_type,
        asset_kind="reference",
    )
    session.add(asset)
    await session.flush()

    upload_dir = UPLOAD_ROOT / user.id
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_name = f"{asset.id}_{Path(asset.original_name).name or 'unnamed'}"
    stored_path = upload_dir / safe_name
    stored_path.write_bytes(content)
    asset.stored_path = str(stored_path)

    vision_status = "pending"
    vision_description = ""
    try:
        vision_description = (
            await llm.describe_image(
                IMAGE_ANCHOR_SYSTEM,
                IMAGE_ANCHOR_PROMPT,
                content,
                content_type,
            )
        ).strip()
        vision_status = "parsed" if vision_description else "empty"
    except Exception:
        vision_status = "failed"

    asset.vision_description = vision_description
    asset.vision_status = vision_status
    await session.commit()
    return _to_out(asset)


@router.get("/", response_model=list[ImageAssetOut])
async def list_image_assets(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ImageAssetOut]:
    result = await session.execute(
        select(ImageAsset)
        .where(ImageAsset.user_id == user.id, ImageAsset.deleted_at.is_(None))
        .order_by(ImageAsset.created_at.desc())
    )
    return [_to_out(a) for a in result.scalars().all()]


@router.get("/usage", response_model=ImageAssetUsage)
async def get_image_asset_usage(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ImageAssetUsage:
    return await _usage_for_user(session, user.id)


@router.get("/{asset_id}/file")
async def get_image_asset_file(
    asset_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FileResponse:
    asset = await session.get(ImageAsset, asset_id)
    if asset is None or asset.user_id != user.id or asset.deleted_at is not None:
        raise HTTPException(status_code=404, detail="素材不存在")
    path = resolve_storage_path(asset.stored_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="素材文件已丢失")
    return FileResponse(path, media_type=asset.content_type)


@router.delete("/{asset_id}", status_code=204)
async def delete_image_asset(
    asset_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    asset = await session.get(ImageAsset, asset_id)
    if asset is None or asset.user_id != user.id or asset.deleted_at is not None:
        raise HTTPException(status_code=404, detail="素材不存在")
    path = resolve_storage_path(asset.stored_path)
    if path.exists():
        os.remove(path)
    await session.delete(asset)
    await session.commit()
