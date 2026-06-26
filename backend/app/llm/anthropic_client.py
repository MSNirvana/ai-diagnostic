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
            # 16384:富结构化输出(如 AI 改造方案的多主题+对比表+分周路径)4096 会被截断
            # 导致 JSON 不完整、解析失败而降级;调高上限,实际用量由模型按需决定。
            max_tokens=16384,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        # 取第一个文本块：开了 extended thinking 的模型会先返回 thinking 块，
        # 不能假设 content[0] 一定是文本。
        for block in resp.content:
            if getattr(block, "type", None) == "text":
                return block.text
        return ""
