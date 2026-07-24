"""GGOO account authentication and Build-local ownership mapping.

Build keeps independent project data and local ownership IDs, while GGOO is
the only production identity provider. Legacy JWT helpers remain behind an
explicit test/migration flag and are disabled by default.
"""
import os
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, Header, HTTPException
from jose import JWTError, jwt
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_session
from app.db.models import User
from app.integrations.ggoo import GGOOAuthenticationError, GGOOError, GGOORemoteUser, ggoo_client

SECRET_KEY = os.environ.get("JWT_SECRET", "dev-secret-change-in-prod")
ALGORITHM = "HS256"
EXPIRE_HOURS = 72


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except ValueError:
        return False


def create_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=EXPIRE_HOURS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _decode_user_id(token: str) -> str:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="无效的登录凭证")
    if not user_id:
        raise HTTPException(status_code=401, detail="无效的登录凭证")
    return user_id


async def get_current_user(
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> User:
    # Local-only test mode: the frontend can use a provider API key directly
    # without opening the GGOO login flow. This is deliberately opt-in and
    # must never be enabled in a deployed environment.
    if test_api_bypass_enabled():
        token = _extract_optional_bearer_token(authorization)
        return await _get_or_create_test_user(session)

    if not authorization:
        raise HTTPException(status_code=401, detail="请先登录 GGOO")
    token = _extract_bearer_token(authorization)

    if legacy_local_auth_enabled():
        try:
            user_id = _decode_user_id(token)
        except HTTPException:
            pass
        else:
            user = await session.get(User, user_id)
            if user is not None:
                return user

    try:
        remote_user = await ggoo_client.verify_user(token)
    except GGOOAuthenticationError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except GGOOError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return await _sync_ggoo_user(session, remote_user)


async def get_optional_user(
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> User | None:
    """可选认证：无 token 返回 None，有 token 但无效则报 401。"""
    if not authorization:
        return None
    return await get_current_user(authorization, session)


def admin_email_set() -> set[str]:
    """ADMIN_EMAILS 环境变量（逗号分隔，小写）；'*' = 所有人都是管理员。"""
    raw = os.environ.get("ADMIN_EMAILS", "")
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def is_admin_email(email: str) -> bool:
    emails = admin_email_set()
    return "*" in emails or email.strip().lower() in emails


def legacy_local_auth_enabled() -> bool:
    return os.environ.get("BUILD_LEGACY_AUTH_ENABLED", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def test_api_bypass_enabled() -> bool:
    return os.environ.get("BUILD_TEST_API_BYPASS", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


async def _get_or_create_test_user(session: AsyncSession) -> User:
    email = os.environ.get("BUILD_TEST_USER_EMAIL", "local-image-test@ggoo.local").strip()
    user = await session.scalar(select(User).where(func.lower(User.email) == email.lower()))
    if user is None:
        user = User(email=email, hashed_password="!local-test-only", is_admin=True)
        session.add(user)
        await session.commit()
        await session.refresh(user)
    return user


def _extract_optional_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.strip().partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="无效的测试 API 凭据")
    return token.strip()


def _extract_bearer_token(authorization: str) -> str:
    scheme, _, token = authorization.strip().partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="请先登录 GGOO")
    return token.strip()


async def _sync_ggoo_user(session: AsyncSession, remote: GGOORemoteUser) -> User:
    user = await session.scalar(select(User).where(User.ggoo_user_id == remote.id))
    if user is None and remote.uuid:
        user = await session.scalar(select(User).where(User.ggoo_uuid == remote.uuid))

    normalized_email = remote.email.strip().lower() if remote.email else None
    if user is None and normalized_email:
        candidate = await session.scalar(
            select(User).where(func.lower(User.email) == normalized_email)
        )
        if candidate is not None and candidate.ggoo_user_id in (None, remote.id):
            user = candidate

    if user is None:
        email = await _available_email(session, normalized_email, remote.id)
        user = User(
            email=email,
            hashed_password="!ggoo-sso-only",
            is_admin=is_admin_email(email),
            ggoo_user_id=remote.id,
            ggoo_uuid=remote.uuid,
        )
    else:
        user.ggoo_user_id = remote.id
        user.ggoo_uuid = remote.uuid
        if normalized_email and normalized_email != user.email.lower():
            email_owner = await session.scalar(
                select(User).where(func.lower(User.email) == normalized_email)
            )
            if email_owner is None or email_owner.id == user.id:
                user.email = normalized_email
        if is_admin_email(user.email):
            user.is_admin = True

    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        # A first SSO page load can issue several authenticated requests at
        # once. Another request may create this mapping after our lookup but
        # before our commit; recover the winning row instead of returning 500.
        await session.rollback()
        user = await session.scalar(select(User).where(User.ggoo_user_id == remote.id))
        if user is None and remote.uuid:
            user = await session.scalar(select(User).where(User.ggoo_uuid == remote.uuid))
        if user is None:
            raise
    await session.refresh(user)
    return user


async def _available_email(
    session: AsyncSession,
    preferred: str | None,
    ggoo_user_id: int,
) -> str:
    if preferred:
        existing = await session.scalar(select(User).where(func.lower(User.email) == preferred))
        if existing is None:
            return preferred
    return f"ggoo-{ggoo_user_id}@users.ggoo.local"


async def require_admin(user: User = Depends(get_current_user)) -> User:
    """运营后台门：仅 is_admin 用户可过；其余 403。

    兜底：即便 is_admin 列还没回填，只要邮箱命中 ADMIN_EMAILS 也放行，
    避免新库/新进程时间窗里把自己锁在外面。
    """
    if user.is_admin or is_admin_email(user.email):
        return user
    raise HTTPException(status_code=403, detail="需要管理员权限")
