from anthropic import AsyncAnthropic
from app.llm.base import LLMClient


class AnthropicClient(LLMClient):
    def __init__(self, api_key: str, model: str, base_url: str | None = None):
        # base_url 为空时走 Anthropic 官方地址；传入则走自定义网关
        self._client = AsyncAnthropic(api_key=api_key, base_url=base_url or None)
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
