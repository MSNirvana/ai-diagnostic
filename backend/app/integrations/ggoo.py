from __future__ import annotations

import asyncio
import base64
import os
import time

from dataclasses import dataclass
from typing import Any

import httpx

from app.llm.base import LLMClient


RETRYABLE_STATUS_CODES = {429, 502, 503, 504}


class GGOOError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


class GGOOAuthenticationError(GGOOError):
    def __init__(self, message: str = "GGOO 登录状态已失效，请重新登录"):
        super().__init__(message, status_code=401)


@dataclass(frozen=True)
class GGOORemoteUser:
    id: int
    uuid: str
    email: str | None
    nickname: str


class _TTLCache:
    def __init__(self) -> None:
        self._store: dict[str, tuple[Any, float]] = {}

    def get(self, key: str) -> Any | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if time.monotonic() >= expires_at:
            self._store.pop(key, None)
            return None
        return value

    def set(self, key: str, value: Any, ttl_seconds: float) -> None:
        self._store[key] = (value, time.monotonic() + ttl_seconds)

    def invalidate(self, key: str) -> None:
        self._store.pop(key, None)


class GGOOLLMClient(LLMClient):
    """OpenAI-compatible client backed by the current user's GGOO API key."""

    def __init__(
        self,
        *,
        client: httpx.AsyncClient,
        api_key: str,
        model: str,
        gateway_base_url: str,
    ) -> None:
        self._client = client
        self._api_key = api_key
        self._model = model
        self._gateway_base_url = gateway_base_url.rstrip("/")

    @property
    def debug_label(self) -> str:
        return f"ggoo:{self._model}"

    async def complete(self, system: str, prompt: str) -> str:
        return await self._complete([
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ])

    async def describe_image(
        self,
        system: str,
        prompt: str,
        image_bytes: bytes,
        media_type: str,
    ) -> str:
        image_b64 = base64.b64encode(image_bytes).decode("ascii")
        return await self._complete([
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{media_type};base64,{image_b64}"},
                    },
                ],
            },
        ])

    async def _complete(self, messages: list[dict[str, Any]]) -> str:
        response = await self._client.post(
            f"{self._gateway_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            json={"model": self._model, "messages": messages},
        )
        if response.status_code >= 400:
            message = _response_message(response)
            if response.status_code in (401, 403):
                raise GGOOAuthenticationError(message or "GGOO API Key 已失效，请重新登录")
            if response.status_code == 402:
                raise GGOOError("GGOO 积分不足，请充值后重试", status_code=402)
            if response.status_code == 429:
                raise GGOOError("模型请求过于频繁，请稍后重试", status_code=429)
            raise GGOOError(message or "GGOO 模型服务暂时不可用", status_code=response.status_code)

        try:
            payload = response.json()
        except ValueError as exc:
            raise GGOOError("GGOO 模型返回格式异常") from exc

        choices = payload.get("choices") or []
        if not choices or not isinstance(choices[0], dict):
            raise GGOOError("GGOO 模型没有返回可用内容")
        content = (choices[0].get("message") or {}).get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return "".join(
                str(part.get("text") or "")
                for part in content
                if isinstance(part, dict) and part.get("type") in ("text", "output_text")
            )
        return ""


class GGOOClient:
    VERIFY_USER_TTL = 60.0
    ACTIVE_KEY_TTL = 300.0
    MAX_RETRIES = 2

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=180.0, write=60.0, pool=10.0),
            follow_redirects=True,
            trust_env=False,
        )
        self._owns_client = client is None
        self._verify_cache = _TTLCache()
        self._active_key_cache = _TTLCache()

    @staticmethod
    def api_base_url() -> str:
        return os.environ.get("GGOO_API_BASE_URL", "https://api.ggoo.ai").rstrip("/")

    @classmethod
    def gateway_base_url(cls) -> str:
        return os.environ.get("GGOO_GATEWAY_BASE_URL", f"{cls.api_base_url()}/v1").rstrip("/")

    @staticmethod
    def model() -> str:
        return os.environ.get("GGOO_MODEL", "auto").strip() or "auto"

    async def verify_user(self, token: str) -> GGOORemoteUser:
        cached = self._verify_cache.get(token)
        if cached is not None:
            return cached

        payload = await self._request_json(
            "GET",
            f"{self.api_base_url()}/api/v1/sys/users/me",
            token=token,
        )
        data = payload.get("data") or {}
        try:
            user = GGOORemoteUser(
                id=int(data["id"]),
                uuid=str(data["uuid"]),
                email=str(data["email"]).strip().lower() if data.get("email") else None,
                nickname=str(data.get("nickname") or data.get("username") or "GGOO User"),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise GGOOAuthenticationError("GGOO 返回的用户身份无效") from exc
        self._verify_cache.set(token, user, self.VERIFY_USER_TTL)
        return user

    async def get_or_create_active_key(self, token: str) -> str:
        if token.startswith("sk-"):
            return token
        cached = self._active_key_cache.get(token)
        if cached is not None:
            return str(cached)

        payload = await self._request_json(
            "GET",
            f"{self.api_base_url()}/api/v1/platform/api-keys/active-key",
            token=token,
        )
        key = str((payload.get("data") or {}).get("key") or "").strip()
        if not key:
            payload = await self._request_json(
                "POST",
                f"{self.api_base_url()}/api/v1/platform/api-keys",
                token=token,
                json={"name": "Build GGOO AI"},
            )
            key = str((payload.get("data") or {}).get("key") or "").strip()
        if not key:
            raise GGOOError("无法创建 GGOO API Key，请前往 GGOO API 页面检查账户")
        self._active_key_cache.set(token, key, self.ACTIVE_KEY_TTL)
        return key

    async def make_llm_client(self, token: str) -> GGOOLLMClient:
        api_key = await self.get_or_create_active_key(token)
        return GGOOLLMClient(
            client=self._client,
            api_key=api_key,
            model=self.model(),
            gateway_base_url=self.gateway_base_url(),
        )

    async def _request_json(
        self,
        method: str,
        url: str,
        *,
        token: str,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        for attempt in range(self.MAX_RETRIES + 1):
            try:
                response = await self._client.request(
                    method,
                    url,
                    headers={"Authorization": f"Bearer {token}"},
                    json=json,
                )
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                if attempt < self.MAX_RETRIES:
                    await asyncio.sleep(0.4 * (attempt + 1))
                    continue
                raise GGOOError("连接 GGOO 服务失败，请稍后重试") from exc

            if response.status_code in RETRYABLE_STATUS_CODES and attempt < self.MAX_RETRIES:
                await asyncio.sleep(0.4 * (attempt + 1))
                continue
            if response.status_code in (401, 403):
                self._verify_cache.invalidate(token)
                self._active_key_cache.invalidate(token)
                message = _response_message(response)
                raise GGOOAuthenticationError(message) if message else GGOOAuthenticationError()
            if response.status_code >= 400:
                raise GGOOError(
                    _response_message(response) or "GGOO 服务请求失败",
                    status_code=response.status_code,
                )
            try:
                payload = response.json()
            except ValueError as exc:
                raise GGOOError("GGOO 服务返回格式异常") from exc
            if not isinstance(payload, dict):
                raise GGOOError("GGOO 服务返回格式异常")
            code = payload.get("code")
            if code not in (None, 0, 200):
                status_code = int(code) if isinstance(code, int) and 400 <= code <= 599 else 400
                if status_code in (401, 403):
                    raise GGOOAuthenticationError(str(payload.get("msg") or ""))
                raise GGOOError(str(payload.get("msg") or "GGOO 服务请求失败"), status_code=status_code)
            return payload
        raise GGOOError("GGOO 服务暂时不可用")

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()


def _response_message(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return ""
    if not isinstance(payload, dict):
        return ""
    error = payload.get("error")
    if isinstance(error, dict) and error.get("message"):
        return str(error["message"])
    detail = payload.get("detail")
    if isinstance(detail, str):
        return detail
    return str(payload.get("msg") or payload.get("message") or "")


ggoo_client = GGOOClient()
