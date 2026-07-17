"""Image asset upload, list, delete, and file access."""
import io

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _register(email: str) -> str:
    return client.post(
        "/auth/register", json={"email": email, "password": "secret123"}
    ).json()["access_token"]


def _upload_image(token: str, filename: str = "test.png", content: bytes = b"fake-png") -> dict:
    return client.post(
        "/image-assets/",
        files={"file": (filename, io.BytesIO(content), "image/png")},
        headers={"Authorization": f"Bearer {token}"},
    )


def test_upload_image_asset_success(db_session):
    token = _register("asset-ok@b.com")
    resp = _upload_image(token)
    assert resp.status_code == 201
    data = resp.json()
    assert data["original_name"] == "test.png"
    assert data["content_type"] == "image/png"
    assert data["vision_status"] == "parsed"
    assert data["vision_description"] == "测试图片摘要"


def test_upload_image_asset_rejects_non_image(db_session):
    token = _register("asset-nonimage@b.com")
    resp = client.post(
        "/image-assets/",
        files={"file": ("test.txt", io.BytesIO(b"hello"), "text/plain")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400
    assert "只支持图片" in resp.json()["detail"]


def test_upload_image_asset_rejects_oversized(db_session):
    token = _register("asset-big@b.com")
    big_content = b"x" * (12 * 1024 * 1024 + 1)
    resp = client.post(
        "/image-assets/",
        files={"file": ("big.png", io.BytesIO(big_content), "image/png")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400
    assert "12MB" in resp.json()["detail"]


def test_list_image_assets_only_returns_own(db_session):
    token_a = _register("asset-a@b.com")
    token_b = _register("asset-b@b.com")
    _upload_image(token_a, "a.png")
    _upload_image(token_b, "b.png")

    resp_a = client.get("/image-assets/", headers={"Authorization": f"Bearer {token_a}"})
    assert len(resp_a.json()) == 1
    assert resp_a.json()[0]["original_name"] == "a.png"

    resp_b = client.get("/image-assets/", headers={"Authorization": f"Bearer {token_b}"})
    assert len(resp_b.json()) == 1
    assert resp_b.json()[0]["original_name"] == "b.png"


def test_get_image_asset_file(db_session):
    token = _register("asset-file@b.com")
    upload_resp = _upload_image(token)
    asset_id = upload_resp.json()["id"]

    resp = client.get(
        f"/image-assets/{asset_id}/file",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.content == b"fake-png"


def test_get_image_asset_file_404_for_other_user(db_session):
    token_a = _register("asset-fa@b.com")
    token_b = _register("asset-fb@b.com")
    asset_id = _upload_image(token_a).json()["id"]

    resp = client.get(
        f"/image-assets/{asset_id}/file",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert resp.status_code == 404


def test_delete_image_asset(db_session):
    token = _register("asset-del@b.com")
    asset_id = _upload_image(token).json()["id"]

    resp = client.delete(
        f"/image-assets/{asset_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 204

    resp = client.get("/image-assets/", headers={"Authorization": f"Bearer {token}"})
    assert len(resp.json()) == 0


def test_delete_image_asset_404_for_other_user(db_session):
    token_a = _register("asset-da@b.com")
    token_b = _register("asset-db@b.com")
    asset_id = _upload_image(token_a).json()["id"]

    resp = client.delete(
        f"/image-assets/{asset_id}",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert resp.status_code == 404


def test_upload_requires_login(db_session, monkeypatch):
    from app.integrations.ggoo import GGOOAuthenticationError

    async def fake_verify(_token: str):
        raise GGOOAuthenticationError()

    monkeypatch.setattr("app.auth.jwt.ggoo_client.verify_user", fake_verify)
    resp = client.post(
        "/image-assets/",
        files={"file": ("test.png", io.BytesIO(b"fake"), "image/png")},
        headers={"Authorization": "Bearer bad-token"},
    )
    assert resp.status_code == 401
