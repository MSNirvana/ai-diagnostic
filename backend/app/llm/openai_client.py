from openai import AsyncOpenAI
import httpx
from app.llm.base import LLMClient
from app.llm.base_url import normalize_openai_base_url


class OpenAIClient(LLMClient):
    def __init__(self, api_key: str, model: str, base_url: str | None = None):
        # OpenAI SDK 以 /chat/completions 拼接，兼容网关根地址或 /v1 地址。
        normalized_base_url = normalize_openai_base_url(base_url)
        self._client = AsyncOpenAI(
            api_key=api_key,
            base_url=normalized_base_url,
        )
        self._api_key = api_key
        self._model = model
        self._base_url = normalized_base_url or "https://api.openai.com/v1"

    @property
    def debug_label(self) -> str:
        return f"openai:{self._model}@{self._base_url}"

    async def complete(self, system: str, prompt: str) -> str:
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        }
        try:
            resp = await self._client.chat.completions.create(**payload)
            return resp.choices[0].message.content or ""
        except Exception as exc:
            if not _should_fallback_to_http(exc):
                raise
        return await self._complete_via_http(payload)

    async def _complete_via_http(self, payload: dict) -> str:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self._base_url.rstrip('/')}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
        return _extract_text(data)


def _should_fallback_to_http(exc: Exception) -> bool:
    status = getattr(exc, "status_code", None)
    message = str(exc)
    return status == 403 and "blocked" in message.lower()


def _extract_text(data: dict) -> str:
    choices = data.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content")
    return content if isinstance(content, str) else ""
