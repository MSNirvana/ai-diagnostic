from anthropic import AsyncAnthropic
from app.llm.base import LLMClient


class AnthropicClient(LLMClient):
    def __init__(self, api_key: str, model: str):
        self._client = AsyncAnthropic(api_key=api_key)
        self._model = model

    async def complete(self, system: str, prompt: str) -> str:
        resp = await self._client.messages.create(
            model=self._model,
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.content[0].text
