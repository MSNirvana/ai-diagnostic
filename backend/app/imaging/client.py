"""GGOO image generation client.

Calls the GGOO OpenAI-compatible gateway's images/generations endpoint.
The exact API shape is not yet confirmed by GGOO, so this follows the same
"adaptive probe + never fabricate" pattern as `GGOOClient.get_credit_balance`:
- Default POST to `{gateway_base_url}/images/generations` with OpenAI-style body
- Env vars override path/model/response field without code changes
- On failure or unparseable response, raise GGOOError — never return a fake URL
"""
from __future__ import annotations

import os
from typing import Any

import httpx

from app.integrations.ggoo import GGOOAuthenticationError, GGOOError


class GGOOImageClient:
    """Client for GGOO's image generation gateway."""

    def __init__(
        self,
        *,
        client: httpx.AsyncClient,
        api_key: str,
        gateway_base_url: str,
    ) -> None:
        self._client = client
        self._api_key = api_key
        self._gateway_base_url = gateway_base_url.rstrip("/")

    async def generate_image(
        self,
        *,
        prompt: str,
        size: str,
        model: str | None = None,
        n: int = 1,
    ) -> str:
        """Generate an image and return its URL.

        Raises GGOOError subclasses on failure; never returns a fake URL.
        """
        path = os.environ.get("GGOO_IMAGE_GENERATIONS_PATH", "/images/generations").strip()
        if not path.startswith("/"):
            path = f"/{path}"
        url = f"{self._gateway_base_url}{path}"

        resolved_model = model or os.environ.get("GGOO_IMAGE_MODEL", "image2.0").strip()
        body: dict[str, Any] = {
            "model": resolved_model,
            "prompt": prompt,
            "size": size,
            "n": n,
        }

        response = await self._client.post(
            url,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            json=body,
        )

        if response.status_code in (401, 403):
            raise GGOOAuthenticationError()
        if response.status_code == 402:
            raise GGOOError("积分不足，请前往 GGOO 充值", status_code=402)
        if response.status_code == 429:
            raise GGOOError("请求过于频繁，请稍后再试", status_code=429)
        if response.status_code >= 400:
            raise GGOOError(
                f"图片生成服务暂时不可用（HTTP {response.status_code}）",
                status_code=response.status_code,
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise GGOOError("图片生成结果格式异常", status_code=502) from exc

        field = os.environ.get("GGOO_IMAGE_RESPONSE_URL_FIELD", "data.0.url").strip()
        image_url = _lookup_dotted(payload, field)
        if not isinstance(image_url, str) or not image_url.strip():
            raise GGOOError("图片生成结果格式异常", status_code=502)
        return image_url.strip()


def _lookup_dotted(data: Any, dotted: str) -> Any:
    """Resolve a dotted path like 'data.0.url' against nested dicts/lists."""
    current = data
    for part in dotted.split("."):
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list):
            try:
                current = current[int(part)]
            except (ValueError, IndexError):
                return None
        else:
            return None
        if current is None:
            return None
    return current
