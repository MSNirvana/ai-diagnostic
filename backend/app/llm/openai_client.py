from openai import AsyncOpenAI
from app.llm.base import LLMClient


class OpenAIClient(LLMClient):
    def __init__(self, api_key: str, model: str, base_url: str | None = None):
        # base_url 为空时走 OpenAI 官方地址；传入则走自定义网关
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url or None)
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
