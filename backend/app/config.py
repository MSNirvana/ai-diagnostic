import os

from fastapi import Header, HTTPException

from app.auth.jwt import _decode_user_id, legacy_local_auth_enabled
from app.integrations.ggoo import GGOOError, ggoo_client
from app.llm.base import LLMClient
from app.db.models import LLMConfig


def llm_config_debug_label(config: LLMConfig) -> str:
    base = (config.base_url or "default").strip() or "default"
    return f"{config.name}|{config.provider}:{config.model}@{base}"


async def get_llm_client(
    authorization: str | None = Header(default=None),
) -> LLMClient:
    """Build runtime always uses the current GGOO user's metered API key."""
    raw = authorization if isinstance(authorization, str) else None
    token = ""
    if raw:
        scheme, _, credentials = raw.strip().partition(" ")
        if scheme.lower() != "bearer" or not credentials.strip():
            raise HTTPException(status_code=401, detail="请先登录 GGOO")
        token = credentials.strip()
    else:
        token = os.environ.get("GGOO_SERVICE_API_KEY", "").strip()

    # 本地开发可用 BUILD_LEGACY_AUTH_ENABLED + JWT 登录工作台，但这个 JWT
    # 不是 GGOO 的模型凭证。若配置了离线服务 key，避免把本地 JWT 误送到
    # GGOO；离线 key 只用于让上传、画布保存等本地流程继续工作，真实模型
    # 调用仍由 GGOO 网关按正常失败语义返回。
    if os.environ.get("BUILD_TEST_API_BYPASS", "").strip().lower() == "true":
        token = os.environ.get("GGOO_SERVICE_API_KEY", "").strip()
    elif raw and legacy_local_auth_enabled():
        try:
            _decode_user_id(token)
        except HTTPException:
            pass
        else:
            token = os.environ.get("GGOO_SERVICE_API_KEY", "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="请先登录 GGOO")
    try:
        return await ggoo_client.make_llm_client(token)
    except GGOOError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
