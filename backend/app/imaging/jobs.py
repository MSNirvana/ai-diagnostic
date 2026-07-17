"""Background job for image generation tasks.

Runs after the API returns 202; transitions the ToolTask through
running -> succeeded/failed with billing ledger integration.
"""
import json

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.billing.ledger import transition_task
from app.db.models import ImageAsset, ToolTask
from app.imaging.client import GGOOImageClient
from app.imaging.prompts import build_generate_prompt
from app.imaging.presets import get_preset
from app.integrations.ggoo import ggoo_client


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

            anchor_description = ""
            reference_asset_id = payload.get("reference_asset_id")
            if reference_asset_id:
                asset = await session.get(ImageAsset, reference_asset_id)
                if asset is not None:
                    anchor_description = asset.vision_description

            prompt = build_generate_prompt(
                anchor_description=anchor_description,
                user_intent=payload.get("user_intent", ""),
                style=payload.get("style", preset.default_style),
                size=payload.get("size", preset.default_size),
                prompt_skeleton=preset.prompt_skeleton,
            )

            api_key = await ggoo_client.get_or_create_active_key(authorization)
            image_client = GGOOImageClient(
                client=ggoo_client._client,
                api_key=api_key,
                gateway_base_url=ggoo_client.gateway_base_url(),
            )
            image_url = await image_client.generate_image(
                prompt=prompt,
                size=payload.get("size", preset.default_size),
            )

            payload["result_image_url"] = image_url
            payload["progress"] = 100
            task.payload_json = json.dumps(payload, ensure_ascii=False)
            await transition_task(
                session, task, "succeeded", actual_points=task.quote_points
            )
        except Exception as exc:
            await transition_task(session, task, "failed", error_message=str(exc))
