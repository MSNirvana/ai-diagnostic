from abc import ABC, abstractmethod


class LLMClient(ABC):
    """所有模型实现的统一契约。业务层只依赖这个接口。"""

    @abstractmethod
    async def complete(self, system: str, prompt: str) -> str:
        """给定 system 指令和用户 prompt，返回模型文本输出。"""
        ...
