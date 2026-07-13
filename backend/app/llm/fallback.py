"""主备容错的 LLM 客户端。

按顺序持有多个 LLMClient，complete 时主失败自动试下一个。
因为业务层只依赖 LLMClient 接口，包一层 fallback 后所有调用点零改动获得容错。
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from threading import Lock

from app.llm.base import LLMClient


class FallbackLLMError(RuntimeError):
    """全部通道失败时，把每条通道的失败摘要一起带出来。"""

    def __init__(self, failures: list[str]):
        self.failures = failures
        summary = "；".join(failures[:3])
        if len(failures) > 3:
            summary = f"{summary}；其余 {len(failures) - 3} 条失败已省略"
        super().__init__(summary or "无可用 LLM")


@dataclass
class ChannelRuntimeState:
    failure_count: int = 0
    success_count: int = 0
    last_error: str = ""
    last_error_type: str = ""
    last_failure_at: float = 0.0
    last_success_at: float = 0.0
    unavailable_until: float = 0.0


_CHANNEL_STATES: dict[str, ChannelRuntimeState] = {}
_CHANNEL_STATE_LOCK = Lock()
_FAILURE_THRESHOLD = max(1, int(os.environ.get("LLM_CHANNEL_FAILURE_THRESHOLD", "1")))
_COOLDOWN_SECONDS = max(15, int(os.environ.get("LLM_CHANNEL_COOLDOWN_SECONDS", "90")))


class FallbackLLMClient(LLMClient):
    def __init__(self, clients: list[LLMClient]):
        if not clients:
            raise ValueError("FallbackLLMClient 需要至少一个 client")
        self._clients = clients

    async def complete(self, system: str, prompt: str) -> str:
        last_err: Exception | None = None
        failures: list[str] = []
        for c in _ordered_clients(self._clients):
            try:
                result = await c.complete(system, prompt)
                _register_success(c.debug_label)
                return result
            except Exception as e:  # 主失败试下一个备用
                last_err = e
                _register_failure(c.debug_label, e)
                failures.append(_format_failure(c, e))
                continue
        if failures:
            raise FallbackLLMError(failures) from last_err
        raise last_err or RuntimeError("无可用 LLM")

    async def describe_image(self, system: str, prompt: str, image_bytes: bytes, media_type: str) -> str:
        last_err: Exception | None = None
        failures: list[str] = []
        for c in _ordered_clients(self._clients):
            try:
                result = await c.describe_image(system, prompt, image_bytes, media_type)
                _register_success(c.debug_label)
                return result
            except Exception as e:
                last_err = e
                _register_failure(c.debug_label, e)
                failures.append(_format_failure(c, e))
                continue
        if failures:
            raise FallbackLLMError(failures) from last_err
        raise last_err or RuntimeError("无可用 LLM")


def _format_failure(client: LLMClient, err: Exception) -> str:
    status = getattr(err, "status_code", None)
    status_text = f"[{status}]" if status is not None else ""
    message = str(err).replace("\n", " ").strip()
    if len(message) > 180:
        message = f"{message[:180]}..."
    return f"{client.debug_label}{status_text} {message}".strip()


def get_channel_runtime_state(label: str) -> dict[str, object]:
    now = time.time()
    with _CHANNEL_STATE_LOCK:
        state = _CHANNEL_STATES.get(label, ChannelRuntimeState())
        unavailable_until = state.unavailable_until
        cooldown_remaining = max(0, int(unavailable_until - now))
        if cooldown_remaining > 0:
            runtime = "cooldown"
        elif state.last_success_at > 0 and state.last_success_at >= state.last_failure_at:
            runtime = "healthy"
        elif state.last_failure_at > 0:
            runtime = "degraded"
        else:
            runtime = "unknown"
        return {
            "runtime_status": runtime,
            "cooldown_remaining_seconds": cooldown_remaining,
            "last_error": state.last_error,
            "last_error_type": state.last_error_type,
            "failure_count": state.failure_count,
            "success_count": state.success_count,
        }


def _ordered_clients(clients: list[LLMClient]) -> list[LLMClient]:
    if not clients:
        return []
    available: list[LLMClient] = []
    cooling: list[tuple[float, LLMClient]] = []
    now = time.time()
    with _CHANNEL_STATE_LOCK:
        for client in clients:
            state = _CHANNEL_STATES.get(client.debug_label)
            unavailable_until = state.unavailable_until if state else 0.0
            if unavailable_until > now:
                cooling.append((unavailable_until, client))
            else:
                available.append(client)
    if available:
        return available
    return [client for _until, client in sorted(cooling, key=lambda item: item[0])]


def _register_success(label: str) -> None:
    now = time.time()
    with _CHANNEL_STATE_LOCK:
        state = _CHANNEL_STATES.setdefault(label, ChannelRuntimeState())
        state.success_count += 1
        state.failure_count = 0
        state.last_success_at = now
        state.unavailable_until = 0.0
        state.last_error = ""
        state.last_error_type = ""


def _register_failure(label: str, err: Exception) -> None:
    now = time.time()
    with _CHANNEL_STATE_LOCK:
        state = _CHANNEL_STATES.setdefault(label, ChannelRuntimeState())
        state.failure_count += 1
        state.last_failure_at = now
        state.last_error_type = err.__class__.__name__
        message = str(err).replace("\n", " ").strip()
        state.last_error = message[:220] + ("..." if len(message) > 220 else "")
        if state.failure_count >= _FAILURE_THRESHOLD:
            state.unavailable_until = now + _COOLDOWN_SECONDS
