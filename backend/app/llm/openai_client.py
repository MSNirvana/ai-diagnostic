from openai import AsyncOpenAI
from app.llm.base import LLMClient
from app.llm.base_url import normalize_openai_base_url


class OpenAIClient(LLMClient):
    def __init__(self, api_key: str, model: str, base_url: str | None = None):
        # OpenAI SDK 以 /chat/completions 拼接，兼容网关根地址或 /v1 地址。
        self._client = AsyncOpenAI(
            api_key=api_key,
            base_url=normalize_openai_base_url(base_url),
        )
        self._model = model

    async def complete(self, system: str, prompt: str) -> str:
        resp = await self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        )
        return resp.choices[0].message.content or ""
