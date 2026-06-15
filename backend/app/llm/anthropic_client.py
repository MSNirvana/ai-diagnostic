from anthropic import AsyncAnthropic
from app.llm.base import LLMClient
from app.llm.base_url import normalize_anthropic_base_url


class AnthropicClient(LLMClient):
    def __init__(self, api_key: str, model: str, base_url: str | None = None):
        # Anthropic SDK 会自行拼 /v1/messages；自定义网关填到 /v1 时要剥掉。
        self._client = AsyncAnthropic(
            api_key=api_key,
            base_url=normalize_anthropic_base_url(base_url),
        )
        self._model = model

    async def complete(self, system: str, prompt: str) -> str:
        resp = await self._client.messages.create(
            model=self._model,
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        # 取第一个文本块：开了 extended thinking 的模型会先返回 thinking 块，
        # 不能假设 content[0] 一定是文本。
        for block in resp.content:
            if getattr(block, "type", None) == "text":
                return block.text
        return ""
