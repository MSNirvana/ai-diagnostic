"""运营后台门：非管理员 403、ADMIN_EMAILS 管理员放行、/auth/me 暴露 is_admin。

注意：conftest 的 autouse fixture 默认放行后台门，让历史用例零改动；
这里要验真门，所以每个用例先 pop 掉那个覆盖。
"""
from fastapi.testclient import TestClient

from app.auth.jwt import require_admin
from app.main import app

client = TestClient(app)


def _register(email: str) -> str:
    return client.post(
        "/auth/register", json={"email": email, "password": "secret123"}
    ).json()["access_token"]


def test_non_admin_blocked_from_admin_endpoints(db_session, monkeypatch):
    monkeypatch.delenv("ADMIN_EMAILS", raising=False)
    app.dependency_overrides.pop(require_admin, None)  # 关掉默认放行，验真门
    token = _register("plainuser@b.com")
    auth = {"Authorization": f"Bearer {token}"}

    # 无 token → 被拒（缺 Authorization 头，FastAPI 返回 422）
    assert client.get("/admin/review/queue").status_code in (401, 422)
    # 普通登录用户 → 403（这是门的核心：登录了但不是管理员）
    assert client.get("/admin/review/queue", headers=auth).status_code == 403
    # /auth/me 暴露为非管理员
    me = client.get("/auth/me", headers=auth).json()
    assert me["is_admin"] is False


def test_admin_email_allowed(db_session, monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "boss@b.com, ops@b.com")
    app.dependency_overrides.pop(require_admin, None)
    token = _register("boss@b.com")   # 注册即 is_admin（命中白名单）
    auth = {"Authorization": f"Bearer {token}"}

    assert client.get("/admin/review/queue", headers=auth).status_code == 200
    me = client.get("/auth/me", headers=auth).json()
    assert me["is_admin"] is True


def test_login_promotes_existing_user_when_email_whitelisted(db_session, monkeypatch):
    # 先建号（无白名单）→ 非管理员；之后配上白名单再登录 → 兜底提权。
    monkeypatch.delenv("ADMIN_EMAILS", raising=False)
    app.dependency_overrides.pop(require_admin, None)
    _register("late-admin@b.com")
    me_before = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {_login('late-admin@b.com')}"},
    ).json()
    assert me_before["is_admin"] is False

    monkeypatch.setenv("ADMIN_EMAILS", "late-admin@b.com")
    token = _login("late-admin@b.com")   # 登录时兜底提权
    auth = {"Authorization": f"Bearer {token}"}
    assert client.get("/auth/me", headers=auth).json()["is_admin"] is True
    assert client.get("/admin/review/queue", headers=auth).status_code == 200


def _login(email: str) -> str:
    return client.post(
        "/auth/login", json={"email": email, "password": "secret123"}
    ).json()["access_token"]
