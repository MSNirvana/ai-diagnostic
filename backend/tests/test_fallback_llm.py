"""FallbackLLMClient：主失败自动切备用。"""
import pytest

from app.llm.fallback import FallbackLLMClient, get_channel_runtime_state


class OKClient:
    def __init__(self, tag: str):
        self.tag = tag

    @property
    def debug_label(self) -> str:
        return f"ok-{self.tag}"

    async def complete(self, system: str, prompt: str) -> str:
        return f"ok-{self.tag}"


class FailClient:
    def __init__(self, tag: str):
        self.tag = tag

    @property
    def debug_label(self) -> str:
        return f"fail-{self.tag}"

    async def complete(self, system: str, prompt: str) -> str:
        raise RuntimeError("模拟厂商挂了")


async def test_uses_primary_when_ok():
    c = FallbackLLMClient([OKClient("primary"), OKClient("backup")])
    assert await c.complete("s", "p") == "ok-primary"


async def test_falls_back_when_primary_fails():
    c = FallbackLLMClient([FailClient("primary"), OKClient("backup")])
    assert await c.complete("s", "p") == "ok-backup"


async def test_raises_when_all_fail():
    c = FallbackLLMClient([FailClient("primary"), FailClient("backup")])
    with pytest.raises(RuntimeError):
        await c.complete("s", "p")


def test_empty_clients_rejected():
    with pytest.raises(ValueError):
        FallbackLLMClient([])


async def test_failed_primary_enters_cooldown_and_next_call_skips_it():
    c = FallbackLLMClient([FailClient("cooldown-primary"), OKClient("cooldown-backup")])

    assert await c.complete("s", "p") == "ok-cooldown-backup"
    runtime = get_channel_runtime_state("fail-cooldown-primary")
    assert runtime["runtime_status"] == "cooldown"
    assert runtime["failure_count"] >= 1

    assert await c.complete("s", "p") == "ok-cooldown-backup"
