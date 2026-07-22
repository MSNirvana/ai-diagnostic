"""Background job for image generation tasks.

Runs after the API returns 202; transitions the ToolTask through
running -> succeeded/failed with billing ledger integration.
"""
import json
import os
from pathlib import Path

import httpx

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.billing.ledger import transition_task
from app.db.models import ImageAsset, ToolTask
from app.imaging.client import GGOOImageClient
from app.imaging.ecommerce_skill import build_ecommerce_prompt
from app.imaging.prompts import build_generate_prompt
from app.imaging.presets import get_preset
from app.imaging.template_catalog import get_template
from app.integrations.ggoo import ggoo_client


def _build_reference_url(asset_id: str) -> str | None:
    """Build a publicly-reachable URL for an image asset.

    Uses env `IMAGE_PUBLIC_BASE_URL` as the host prefix. If unset, returns None
    (image2image mode cannot run without a public URL — callers should fall back
    to text2image). The path follows the `/image-assets/{id}/file` route.
    """
    base = os.environ.get("IMAGE_PUBLIC_BASE_URL", "").strip().rstrip("/")
    if not base:
        return None
    return f"{base}/image-assets/{asset_id}/file"


async def _persist_generated_asset(
    session: AsyncSession,
    user_id: str,
    image_url: str,
    index: int,
) -> str | None:
    """Best-effort materialization of a provider result into a platform asset."""
    if not image_url.startswith(("http://", "https://")):
        return None
    try:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            response = await client.get(image_url)
            response.raise_for_status()
        content_type = response.headers.get("content-type", "image/png").split(";", 1)[0]
        if not content_type.startswith("image/"):
            return None
        suffix = {"image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}.get(content_type, ".png")
        asset = ImageAsset(
            user_id=user_id,
            stored_path="",
            original_name=f"生成结果-{index + 1}{suffix}",
            content_type=content_type,
            vision_status="not_requested",
        )
        session.add(asset)
        await session.flush()
        upload_dir = Path("data/image-assets") / user_id
        upload_dir.mkdir(parents=True, exist_ok=True)
        path = upload_dir / f"{asset.id}_generated{suffix}"
        path.write_bytes(response.content)
        asset.stored_path = str(path)
        return asset.id
    except Exception:
        return None


async def run_image_generation_job(
    task_id: str,
    session_factory: async_sessionmaker[AsyncSession],
    authorization: str,
) -> None:
    async with session_factory() as session:
        task = await session.get(ToolTask, task_id)
        if task is None:
            return

        try:
            if task.status == "quoted":
                await transition_task(session, task, "reserved")
            await transition_task(session, task, "running")
            payload = json.loads(task.payload_json) if task.payload_json else {}
            preset = get_preset(payload.get("preset_id", ""))
            if preset is None:
                raise ValueError(f"未知的预设类型: {payload.get('preset_id')}")
            template = get_template(payload.get("template_id"), payload.get("preset_id"))

            anchor_description = ""
            reference_asset_id = payload.get("reference_asset_id")
            asset = None
            if reference_asset_id:
                asset = await session.get(ImageAsset, reference_asset_id)
                if asset is not None:
                    anchor_description = asset.vision_description

            # Prefer user-edited reverse prompt as the anchor when provided.
            edited = payload.get("edited_description")
            if edited:
                anchor_description = edited
            payload["reverse_prompt"] = anchor_description

            if payload.get("preset_id") == "ecommerce":
                display_prompt, prompt_components = build_ecommerce_prompt(
                    anchor_description=anchor_description,
                    user_intent=payload.get("user_intent", ""),
                    size=payload.get("size", preset.default_size),
                    scene_id=payload.get("scene_id"),
                    conversion_driver=payload.get("conversion_driver"),
                    product_category=payload.get("product_category"),
                    market_scope=payload.get("market_scope"),
                    style_variant=payload.get("style_variant"),
                )
                prompt = f"{display_prompt}\nTemplate guidance: {template.prompt_guidance}"
                prompt_components["template_id"] = template.id
                payload["prompt_components"] = prompt_components
            else:
                display_prompt = build_generate_prompt(
                    anchor_description=anchor_description,
                    user_intent=payload.get("user_intent", ""),
                    style=payload.get("style", preset.default_style),
                    size=payload.get("size", preset.default_size),
                    prompt_skeleton=preset.prompt_skeleton,
                )
                prompt = f"{display_prompt}\nTemplate guidance: {template.prompt_guidance}"
            # Keep the user-editable prompt separate from private model guidance.
            payload["assembled_prompt"] = display_prompt

            mode = payload.get("generation_mode", "text2image")
            reference_image_url: str | None = None
            if mode == "image2image" and reference_asset_id:
                reference_image_url = _build_reference_url(reference_asset_id)
                if reference_image_url is None:
                    # No public base URL configured — fall back to text2image.
                    mode = "text2image"
                    payload["generation_mode"] = mode
                    payload["fallback_reason"] = "image2image_unavailable_no_public_url"

            api_key = await ggoo_client.get_or_create_active_key(authorization)
            image_client = GGOOImageClient(
                client=ggoo_client._client,
                api_key=api_key,
                gateway_base_url=ggoo_client.gateway_base_url(),
            )
            image_result = await image_client.generate_image(
                prompt=prompt,
                size=payload.get("size", preset.default_size),
                model=payload.get("model"),
                n=int(payload.get("generation_count") or 1),
                quality=payload.get("quality"),
                background=payload.get("background"),
                reference_image_url=reference_image_url if mode == "image2image" else None,
            )

            image_urls = image_result if isinstance(image_result, list) else [image_result]
            payload["result_image_urls"] = image_urls
            payload["result_image_url"] = image_urls[0] if image_urls else None
            result_asset_ids: list[str] = []
            for index, image_url in enumerate(image_urls):
                asset_id = await _persist_generated_asset(session, task.user_id, image_url, index)
                if asset_id:
                    result_asset_ids.append(asset_id)
            payload["result_asset_ids"] = result_asset_ids
            payload["progress"] = 100
            task.payload_json = json.dumps(payload, ensure_ascii=False)
            await transition_task(
                session, task, "succeeded", actual_points=task.quote_points
            )
        except Exception as exc:
            await transition_task(session, task, "failed", error_message=str(exc))
