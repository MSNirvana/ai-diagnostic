"""主备容错的 LLM 客户端。

按顺序持有多个 LLMClient，complete 时主失败自动试下一个。
因为业务层只依赖 LLMClient 接口，包一层 fallback 后所有调用点零改动获得容错。
"""
from app.llm.base import LLMClient


class FallbackLLMClient(LLMClient):
    def __init__(self, clients: list[LLMClient]):
        if not clients:
            raise ValueError("FallbackLLMClient 需要至少一个 client")
        self._clients = clients

    async def complete(self, system: str, prompt: str) -> str:
        last_err: Exception | None = None
        for c in self._clients:
            try:
                return await c.complete(system, prompt)
            except Exception as e:  # 主失败试下一个备用
                last_err = e
                continue
        raise last_err or RuntimeError("无可用 LLM")
