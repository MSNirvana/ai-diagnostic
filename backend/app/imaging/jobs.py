"""Background job for image generation tasks.

Runs after the API returns 202; transitions the ToolTask through
running -> succeeded/failed with billing ledger integration.
"""
import base64
import json
from pathlib import Path

import httpx

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlmodel import select

from app.billing.ledger import transition_task
from app.db.models import ImageAsset, ToolTask
from app.api.image_assets import MAX_GENERATED_ASSETS, MAX_GENERATED_BYTES
from app.imaging.client import GGOOImageClient
from app.imaging.ecommerce_skill import build_ecommerce_prompt, get_style_variant
from app.imaging.prompts import build_generate_prompt
from app.imaging.presets import get_preset
from app.imaging.template_catalog import get_template
from app.integrations.ggoo import ggoo_client
from app.storage import image_asset_root, resolve_storage_path


def _bearer_token(authorization: str) -> str:
    """Strip the HTTP auth scheme before handing a provider key to GGOO."""
    scheme, _, token = authorization.strip().partition(" ")
    if scheme.lower() == "bearer" and token.strip():
        return token.strip()
    return authorization.strip()


def _build_local_reference_data_url(asset: ImageAsset | None) -> str | None:
    """Embed the stored upload so the provider receives the actual image bytes.

    Asset URLs are protected by the user's session and cannot be fetched by
    the upstream image provider. A data URL keeps the reference private and
    makes image-to-image behavior deterministic in production.
    """
    if asset is None or not asset.stored_path:
        return None
    path = resolve_storage_path(asset.stored_path)
    if not path.exists():
        return None
    try:
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    except OSError:
        return None
    content_type = asset.content_type or "image/png"
    return f"data:{content_type};base64,{encoded}"


async def _persist_generated_asset(
    session: AsyncSession,
    user_id: str,
    image_url: str,
    index: int,
) -> str | None:
    """Best-effort materialization of a provider result into a platform asset."""
    try:
        if image_url.startswith("data:image/"):
            header, encoded = image_url.split(",", 1)
            content_type = header[5:].split(";", 1)[0]
            content = base64.b64decode(encoded, validate=True)
        elif image_url.startswith(("http://", "https://")):
            async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
                response = await client.get(image_url)
                response.raise_for_status()
            content_type = response.headers.get("content-type", "image/png").split(";", 1)[0]
            content = response.content
        else:
            return None
        if not content_type.startswith("image/"):
            return None
        suffix = {"image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}.get(content_type, ".png")
        existing_result = await session.execute(
            select(ImageAsset).where(
                ImageAsset.user_id == user_id,
                ImageAsset.asset_kind == "generated",
                ImageAsset.deleted_at.is_(None),
            )
        )
        generated_assets = existing_result.scalars().all()
        generated_bytes = sum(
            resolve_storage_path(item.stored_path).stat().st_size
            for item in generated_assets
            if item.stored_path and resolve_storage_path(item.stored_path).exists()
        )
        if len(generated_assets) >= MAX_GENERATED_ASSETS or generated_bytes + len(content) > MAX_GENERATED_BYTES:
            return None
        asset = ImageAsset(
            user_id=user_id,
            stored_path="",
            original_name=f"生成结果-{index + 1}{suffix}",
            content_type=content_type,
            vision_status="not_requested",
            asset_kind="generated",
        )
        session.add(asset)
        await session.flush()
        upload_dir = image_asset_root() / user_id
        upload_dir.mkdir(parents=True, exist_ok=True)
        path = upload_dir / f"{asset.id}_generated{suffix}"
        path.write_bytes(content)
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
            reference_asset_ids = payload.get("reference_asset_ids") or ([reference_asset_id] if reference_asset_id else [])
            asset = None
            if reference_asset_id:
                asset = await session.get(ImageAsset, reference_asset_id)
                if asset is not None:
                    anchor_description = asset.vision_description

            # Keep the relationship between secondary references and their
            # roles in the task snapshot while forwarding every selected image
            # to the configured multi-reference gateway field.
            secondary_facts: list[str] = []
            for asset_id in reference_asset_ids[1:]:
                secondary = await session.get(ImageAsset, asset_id)
                if secondary is not None and secondary.vision_description:
                    role = next(
                        (
                            item.get("role", "辅助参考图")
                            for item in payload.get("reference_assets", [])
                            if item.get("asset_id") == asset_id
                        ),
                        "辅助参考图",
                    )
                    secondary_facts.append(f"{role}: {secondary.vision_description}")
            if secondary_facts:
                anchor_description = "\n".join(
                    part for part in [anchor_description, *secondary_facts] if part
                )

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
                style = payload.get("style", preset.default_style)
                style_variant = payload.get("style_variant")
                if style_variant:
                    style = f"{style}; {get_style_variant(style_variant)['prompt']}"
                display_prompt = build_generate_prompt(
                    anchor_description=anchor_description,
                    user_intent=payload.get("user_intent", ""),
                    style=style,
                    size=payload.get("size", preset.default_size),
                    prompt_skeleton=preset.prompt_skeleton,
                )
                prompt = f"{display_prompt}\nTemplate guidance: {template.prompt_guidance}"
            # Keep the user-editable prompt separate from private model guidance.
            payload["assembled_prompt"] = display_prompt

            mode = payload.get("generation_mode", "text2image")
            reference_image_urls: list[str] = []
            if mode == "image2image" and reference_asset_ids:
                for asset_id in reference_asset_ids:
                    reference = await session.get(ImageAsset, asset_id)
                    reference_url = _build_local_reference_data_url(reference)
                    if reference_url is None:
                        raise ValueError("参考图片文件不可用，无法执行图片二次创作")
                    reference_image_urls.append(reference_url)
                if not reference_image_urls:
                    raise ValueError("参考图片文件不可用，无法执行图片二次创作")

            user_token = _bearer_token(authorization)
            api_key = await ggoo_client.get_or_create_active_key(user_token)
            gateway_base_url = ggoo_client.gateway_base_url()
            image_client = GGOOImageClient(
                client=ggoo_client._client,
                api_key=api_key,
                gateway_base_url=gateway_base_url,
            )
            requested_count = max(1, int(payload.get("generation_count") or 1))
            image_urls: list[str] = []
            for _ in range(requested_count):
                image_result = await image_client.generate_image(
                    prompt=prompt,
                    size=payload.get("size", preset.default_size),
                    model=payload.get("model"),
                    # GGOO deployments may expose only one-image requests;
                    # independent calls keep multi-candidate behavior stable.
                    n=1,
                    quality=payload.get("quality"),
                    background=payload.get("background"),
                    reference_image_urls=reference_image_urls if mode == "image2image" else None,
                )
                image_urls.extend(image_result if isinstance(image_result, list) else [image_result])
            image_urls = image_urls[:requested_count]
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
