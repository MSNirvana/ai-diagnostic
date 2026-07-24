"""GGOO image generation client.

Calls the GGOO OpenAI-compatible gateway's images/generations endpoint.
The exact API shape is not yet confirmed by GGOO, so this follows the same
"adaptive probe + never fabricate" pattern as `GGOOClient.get_credit_balance`:
- Default POST to `{gateway_base_url}/images/generations` with OpenAI-style body
- Env vars override path/model/response field without code changes
- On failure or unparseable response, raise GGOOError — never return a fake URL
"""
from __future__ import annotations

import base64
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
        reference_image_url: str | None = None,
        reference_image_urls: list[str] | None = None,
        quality: str | None = None,
        background: str | None = None,
    ) -> str | list[str]:
        """Generate an image and return its URL.

        When a reference image is provided, runs in image-to-image mode:
        - Uses the edit endpoint path (env `GGOO_IMAGE_EDIT_PATH`, defaults to
          `GGOO_IMAGE_GENERATIONS_PATH` value)
        - Sends one image as a string, or multiple images as a list, under the
          field named by env `GGOO_IMAGE_REFERENCE_FIELD` (default `image`).

        Raises GGOOError subclasses on failure; never returns a fake URL.
        """
        reference_urls = [url for url in (reference_image_urls or []) if url]
        if reference_image_url and reference_image_url not in reference_urls:
            reference_urls.insert(0, reference_image_url)
        if reference_urls:
            default_path = os.environ.get("GGOO_IMAGE_GENERATIONS_PATH", "/images/generations").strip()
            path = os.environ.get("GGOO_IMAGE_EDIT_PATH", default_path).strip()
        else:
            path = os.environ.get("GGOO_IMAGE_GENERATIONS_PATH", "/images/generations").strip()
        if not path.startswith("/"):
            path = f"/{path}"
        url = f"{self._gateway_base_url}{path}"

        resolved_model = model or os.environ.get("GGOO_IMAGE_MODEL", "gpt-image-2").strip()
        body: dict[str, Any] = {
            "model": resolved_model,
            "prompt": prompt,
            "size": size,
            "n": n,
        }
        if reference_urls:
            ref_field = os.environ.get("GGOO_IMAGE_REFERENCE_FIELD", "image").strip() or "image"
            reference_format = os.environ.get("GGOO_IMAGE_REFERENCE_FORMAT", "list").strip().lower()
            body[ref_field] = reference_urls[0] if reference_format == "single" else (
                reference_urls[0] if len(reference_urls) == 1 else reference_urls
            )
        if quality:
            body["quality"] = quality
        if background:
            body["background"] = background

        try:
            response = await self._client.post(
                url,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
        except httpx.TimeoutException as exc:
            raise GGOOError("连接 GGOO 图片接口超时，请稍后重试", status_code=504) from exc
        except httpx.NetworkError as exc:
            raise GGOOError(
                "无法连接 GGOO 图片接口，请检查网络或稍后重试",
                status_code=503,
            ) from exc
        except httpx.HTTPError as exc:
            raise GGOOError("GGOO 图片接口连接异常，请稍后重试", status_code=502) from exc

        provider_detail = _provider_error_detail(response)
        if response.status_code == 401:
            message = "图片 API Key 未被 GGOO 接受"
            if provider_detail:
                message = f"{message}：{provider_detail}"
            raise GGOOAuthenticationError(message)
        if response.status_code == 403:
            message = "GGOO 拒绝了当前图片模型或接口权限"
            if provider_detail:
                message = f"{message}：{provider_detail}"
            raise GGOOError(message, status_code=403)
        if response.status_code == 402:
            raise GGOOError("积分不足，请前往 GGOO 充值", status_code=402)
        if response.status_code == 429:
            raise GGOOError("请求过于频繁，请稍后再试", status_code=429)
        if response.status_code >= 400:
            detail = f"：{provider_detail}" if provider_detail else ""
            raise GGOOError(
                f"图片生成服务暂时不可用（HTTP {response.status_code}）{detail}",
                status_code=response.status_code,
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise GGOOError("图片生成结果格式异常", status_code=502) from exc

        field = os.environ.get("GGOO_IMAGE_RESPONSE_URL_FIELD", "data.0.url").strip()
        field_parts = field.split(".")
        list_path = ".".join(field_parts[:-2]) if len(field_parts) >= 3 else ""
        urls_value = _lookup_dotted(payload, list_path) if n > 1 and list_path else None
        if isinstance(urls_value, list):
            values = urls_value
        else:
            values = [
                _lookup_dotted(payload, field),
                *(_lookup_dotted(payload, "data.0.b64_json"),),
            ]
        urls = []
        if isinstance(urls_value, list):
            for item in values:
                if not isinstance(item, dict):
                    continue
                value = item.get("url") or item.get("b64_json")
                normalized = _normalize_image_value(value)
                if normalized:
                    urls.append(normalized)
        else:
            for value in values:
                normalized = _normalize_image_value(value)
                if normalized:
                    urls.append(normalized)
        if not urls:
            raise GGOOError("图片生成结果格式异常", status_code=502)
        return urls[0] if n == 1 else urls


def _normalize_image_value(value: Any) -> str | None:
    """Return provider URLs unchanged and convert Base64 results to data URLs."""
    if not isinstance(value, str) or not value.strip():
        return None
    value = value.strip()
    if value.startswith(("http://", "https://", "data:image/")):
        return value
    try:
        decoded = base64.b64decode(value, validate=True)
    except (ValueError, TypeError):
        return None
    if decoded.startswith(b"\x89PNG"):
        media_type = "image/png"
    elif decoded.startswith(b"\xff\xd8\xff"):
        media_type = "image/jpeg"
    elif decoded.startswith(b"RIFF") and decoded[8:12] == b"WEBP":
        media_type = "image/webp"
    else:
        return None
    return f"data:{media_type};base64,{value}"


def _provider_error_detail(response: httpx.Response) -> str:
    """Extract a short provider error without ever echoing request headers."""
    try:
        payload = response.json()
    except ValueError:
        return ""
    if not isinstance(payload, dict):
        return ""
    error = payload.get("error")
    if isinstance(error, dict):
        for key in ("message", "detail", "code"):
            value = error.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:240]
    elif isinstance(error, str) and error.strip():
        return error.strip()[:240]
    for key in ("message", "detail"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:240]
    return ""


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
