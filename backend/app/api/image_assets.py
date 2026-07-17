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

router = APIRouter(prefix="/image-assets", tags=["image-tool"])

UPLOAD_ROOT = "data/image-assets"
MAX_IMAGE_SIZE = 12 * 1024 * 1024


class ImageAssetOut(BaseModel):
    id: str
    original_name: str
    content_type: str
    vision_description: str
    vision_status: str
    created_at: str


def _to_out(asset: ImageAsset) -> ImageAssetOut:
    return ImageAssetOut(
        id=asset.id,
        original_name=asset.original_name,
        content_type=asset.content_type,
        vision_description=asset.vision_description,
        vision_status=asset.vision_status,
        created_at=asset.created_at.isoformat(),
    )


@router.post("/", response_model=ImageAssetOut, status_code=201)
async def upload_image_asset(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
) -> ImageAssetOut:
    content_type = file.content_type or ""
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="只支持图片文件")

    content = await file.read()
    if len(content) > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=400, detail="图片超过 12MB 上限")

    asset = ImageAsset(
        user_id=user.id,
        stored_path="",
        original_name=file.filename or "unnamed",
        content_type=content_type,
    )
    session.add(asset)
    await session.flush()

    upload_dir = Path(UPLOAD_ROOT) / user.id
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_name = f"{asset.id}_{asset.original_name}"
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
        .where(ImageAsset.user_id == user.id)
        .order_by(ImageAsset.created_at.desc())
    )
    return [_to_out(a) for a in result.scalars().all()]


@router.get("/{asset_id}/file")
async def get_image_asset_file(
    asset_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FileResponse:
    asset = await session.get(ImageAsset, asset_id)
    if asset is None or asset.user_id != user.id:
        raise HTTPException(status_code=404, detail="素材不存在")
    path = Path(asset.stored_path)
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
    if asset is None or asset.user_id != user.id:
        raise HTTPException(status_code=404, detail="素材不存在")
    path = Path(asset.stored_path)
    if path.exists():
        os.remove(path)
    await session.delete(asset)
    await session.commit()
