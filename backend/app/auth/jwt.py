"""密码哈希 + JWT 签发/校验 + FastAPI 认证依赖。

密码用 bcrypt 直接哈希（不经 passlib，避开 passlib 1.7 与 bcrypt 5 的兼容问题）。
JWT 用 python-jose，HS256，72 小时有效期。
"""
import os
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, Header, HTTPException
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_session
from app.db.models import User

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
    authorization: str = Header(...),
    session: AsyncSession = Depends(get_session),
) -> User:
    token = authorization.removeprefix("Bearer ").strip()
    user_id = _decode_user_id(token)
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="用户不存在")
    return user


async def get_optional_user(
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> User | None:
    """可选认证：无 token 返回 None，有 token 但无效则报 401。"""
    if not authorization:
        return None
    return await get_current_user(authorization, session)
