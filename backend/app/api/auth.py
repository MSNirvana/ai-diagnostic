import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import (
    create_token,
    get_current_user,
    hash_password,
    is_admin_email,
    legacy_local_auth_enabled,
    verify_password,
)
from app.db.database import get_session
from app.db.models import User

router = APIRouter(prefix="/auth")

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RegisterRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _EMAIL_RE.match(v):
            raise ValueError("邮箱格式不正确")
        return v

    @field_validator("password")
    @classmethod
    def _valid_password(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("密码至少 6 位")
        return v


class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeResponse(BaseModel):
    id: str
    email: str
    is_admin: bool


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(
    body: RegisterRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    if not legacy_local_auth_enabled():
        raise HTTPException(
            status_code=410,
            detail="Build 已使用 GGOO 统一账号，请通过 GGOO 登录或注册",
        )
    existing = await session.scalar(select(User).where(User.email == body.email))
    if existing is not None:
        raise HTTPException(status_code=409, detail="该邮箱已注册")
    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        is_admin=is_admin_email(body.email),   # ADMIN_EMAILS 命中即建为管理员
    )
    session.add(user)
    await session.commit()
    return TokenResponse(access_token=create_token(user.id))


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    if not legacy_local_auth_enabled():
        raise HTTPException(
            status_code=410,
            detail="Build 已使用 GGOO 统一账号，请通过 GGOO 登录",
        )
    user = await session.scalar(select(User).where(User.email == body.email))
    if user is None or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="邮箱或密码错误")
    # 存量账号登录时按 ADMIN_EMAILS 兜底提权（解决"建号在前、配白名单在后"）。
    if is_admin_email(user.email) and not user.is_admin:
        user.is_admin = True
        session.add(user)
        await session.commit()
    return TokenResponse(access_token=create_token(user.id))


@router.get("/me", response_model=MeResponse)
async def me(user: User = Depends(get_current_user)) -> MeResponse:
    return MeResponse(id=user.id, email=user.email, is_admin=user.is_admin)
