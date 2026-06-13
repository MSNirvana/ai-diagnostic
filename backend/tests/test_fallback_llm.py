"""FallbackLLMClient：主失败自动切备用。"""
import pytest

from app.llm.fallback import FallbackLLMClient


class OKClient:
    def __init__(self, tag: str):
        self.tag = tag

    async def complete(self, system: str, prompt: str) -> str:
        return f"ok-{self.tag}"


class FailClient:
    async def complete(self, system: str, prompt: str) -> str:
        raise RuntimeError("模拟厂商挂了")


async def test_uses_primary_when_ok():
    c = FallbackLLMClient([OKClient("primary"), OKClient("backup")])
    assert await c.complete("s", "p") == "ok-primary"


async def test_falls_back_when_primary_fails():
    c = FallbackLLMClient([FailClient(), OKClient("backup")])
    assert await c.complete("s", "p") == "ok-backup"


async def test_raises_when_all_fail():
    c = FallbackLLMClient([FailClient(), FailClient()])
    with pytest.raises(RuntimeError):
        await c.complete("s", "p")


def test_empty_clients_rejected():
    with pytest.raises(ValueError):
        FallbackLLMClient([])
