"""Image tool task API: create, confirm, poll, list, and background job."""
import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app.billing.ledger import create_task, transition_task
from app.imaging.jobs import run_image_generation_job
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _disable_api_background_job(monkeypatch):
    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr("app.api.image_tool.run_image_generation_job", _noop)


def _register(email: str) -> str:
    return client.post(
        "/auth/register", json={"email": email, "password": "secret123"}
    ).json()["access_token"]


def _create_task(token: str, preset_id: str = "promo", **kwargs) -> dict:
    body = {"preset_id": preset_id, "user_intent": "测试生成", **kwargs}
    return client.post(
        "/image-tool/tasks",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
    )


def test_create_image_task_returns_202_with_quote(db_session, monkeypatch):
    monkeypatch.setenv(
        "BUILD_PRICING_JSON",
        json.dumps({"image": {"basic": {"default": 10}}}),
    )
    from app.billing.pricing import _reset_price_table_cache_for_tests

    _reset_price_table_cache_for_tests()

    token = _register("task-quote@b.com")
    resp = _create_task(token)
    assert resp.status_code == 202
    data = resp.json()
    assert data["status"] == "quoted"
    assert data["quote_points"] == 10


def test_template_catalog_exposes_business_choices_without_prompt_guidance(db_session):
    token = _register("template-catalog@b.com")
    resp = client.get("/image-tool/template-catalog", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    detail = next(item for item in data["templates"] if item["id"] == "ecommerce-detail")
    assert detail["recommended_ratio"] == "2:3"
    assert "prompt_guidance" not in detail


def test_create_image_task_persists_template_id_and_rejects_mismatched_template(db_session):
    token = _register("template-routing@b.com")
    resp = _create_task(token, preset_id="promo", template_id="promo-launch")
    assert resp.status_code == 202
    task = client.get(
        f"/image-tool/tasks/{resp.json()['task_id']}",
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    assert task["template_id"] == "promo-launch"

    invalid = _create_task(token, preset_id="promo", template_id="ecommerce-detail")
    assert invalid.status_code == 400


def test_create_image_task_returns_none_quote_when_unconfigured(db_session, monkeypatch):
    monkeypatch.delenv("BUILD_PRICING_JSON", raising=False)
    from app.billing.pricing import _reset_price_table_cache_for_tests

    _reset_price_table_cache_for_tests()

    token = _register("task-noquote@b.com")
    resp = _create_task(token)
    assert resp.status_code == 202
    assert resp.json()["quote_points"] is None


def test_create_image_task_rejects_unknown_preset(db_session):
    token = _register("task-badpreset@b.com")
    resp = _create_task(token, preset_id="unknown")
    assert resp.status_code == 400
    assert "未知" in resp.json()["detail"]


def test_image_capabilities_are_provider_configured(db_session, monkeypatch):
    monkeypatch.setenv(
        "GGOO_IMAGE_CAPABILITIES_JSON",
        json.dumps([{
            "model": "verified-image-v1",
            "label": "已确认模型",
            "sizes": [{"value": "1536x1024", "label": "横图"}],
            "aspect_ratios": [{"value": "3:2", "label": "横向"}],
            "qualities": [{"value": "high", "label": "高"}],
            "backgrounds": [{"value": "opaque", "label": "不透明"}],
            "generation_counts": [1, 3],
            "max_count": 3,
        }]),
    )
    token = _register("task-capabilities@b.com")
    resp = client.get("/image-tool/capabilities", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()[0]["generation_counts"] == [1, 3]


def test_create_image_task_persists_and_validates_image_specs(db_session, monkeypatch):
    monkeypatch.setenv(
        "GGOO_IMAGE_CAPABILITIES_JSON",
        json.dumps([{
            "model": "verified-image-v1",
            "label": "已确认模型",
            "sizes": [{"value": "1536x1024", "label": "横图"}],
            "aspect_ratios": [{"value": "3:2", "label": "横向"}],
            "qualities": [{"value": "high", "label": "高"}],
            "backgrounds": [{"value": "opaque", "label": "不透明"}],
            "generation_counts": [1, 3],
            "max_count": 3,
        }]),
    )
    token = _register("task-specs@b.com")
    resp = _create_task(
        token,
        model="verified-image-v1",
        model_version="verified-image-v1-2026-01",
        size="1536x1024",
        aspect_ratio="3:2",
        quality="high",
        background="opaque",
        generation_count=3,
    )
    assert resp.status_code == 202
    task = client.get(
        f"/image-tool/tasks/{resp.json()['task_id']}",
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    assert task["model"] == "verified-image-v1"
    assert task["model_version"] == "verified-image-v1-2026-01"
    assert task["size"] == "1536x1024"
    assert task["aspect_ratio"] == "3:2"
    assert task["quality"] == "high"
    assert task["generation_count"] == 3

    invalid = _create_task(token, model="verified-image-v1", generation_count=6)
    assert invalid.status_code == 400


def test_create_image_task_rejects_other_users_asset(db_session):
    token_a = _register("task-a@b.com")
    token_b = _register("task-b@b.com")

    import io

    asset_resp = client.post(
        "/image-assets/",
        files={"file": ("ref.png", io.BytesIO(b"fake"), "image/png")},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    asset_id = asset_resp.json()["id"]

    resp = _create_task(token_b, reference_asset_id=asset_id)
    assert resp.status_code == 404


def test_confirm_image_task_transitions_quoted_to_reserved(db_session):
    token = _register("task-confirm@b.com")
    task_id = _create_task(token).json()["task_id"]

    resp = client.post(
        f"/image-tool/tasks/{task_id}/confirm",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "reserved"


def test_confirm_image_task_is_idempotent(db_session):
    token = _register("task-idem@b.com")
    task_id = _create_task(token).json()["task_id"]

    client.post(
        f"/image-tool/tasks/{task_id}/confirm",
        headers={"Authorization": f"Bearer {token}"},
    )
    resp = client.post(
        f"/image-tool/tasks/{task_id}/confirm",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "reserved"


def test_get_image_task_returns_status(db_session):
    token = _register("task-get@b.com")
    task_id = _create_task(token).json()["task_id"]

    resp = client.get(
        f"/image-tool/tasks/{task_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == task_id
    assert data["status"] == "quoted"
    assert data["progress"] == 0


def test_get_image_task_404_for_other_user(db_session):
    token_a = _register("task-ga@b.com")
    token_b = _register("task-gb@b.com")
    task_id = _create_task(token_a).json()["task_id"]

    resp = client.get(
        f"/image-tool/tasks/{task_id}",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert resp.status_code == 404


def test_list_image_tasks_only_returns_own(db_session):
    token_a = _register("task-la@b.com")
    token_b = _register("task-lb@b.com")
    _create_task(token_a)
    _create_task(token_b)

    resp_a = client.get("/image-tool/tasks", headers={"Authorization": f"Bearer {token_a}"})
    assert len(resp_a.json()) == 1

    resp_b = client.get("/image-tool/tasks", headers={"Authorization": f"Bearer {token_b}"})
    assert len(resp_b.json()) == 1


def test_create_image_task_with_idempotency_key(db_session):
    token = _register("task-idemkey@b.com")
    resp1 = _create_task(token, idempotency_key="key-123")
    resp2 = _create_task(token, idempotency_key="key-123")
    assert resp1.json()["task_id"] == resp2.json()["task_id"]


def test_run_image_generation_job_succeeds(db_session, monkeypatch):
    token = _register("job-ok@b.com")
    task_id = _create_task(token).json()["task_id"]

    async def fake_generate(*args, **kwargs):
        return "https://img.example.com/result.png"

    monkeypatch.setattr(
        "app.imaging.jobs.GGOOImageClient.generate_image", fake_generate
    )

    async def fake_active_key(_token: str) -> str:
        return "sk-test"

    monkeypatch.setattr(
        "app.imaging.jobs.ggoo_client.get_or_create_active_key", fake_active_key
    )

    asyncio.get_event_loop().run_until_complete(
        run_image_generation_job(task_id, db_session, f"Bearer {token}")
    )

    resp = client.get(
        f"/image-tool/tasks/{task_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    data = resp.json()
    assert data["status"] == "succeeded"
    assert data["progress"] == 100
    assert data["result_image_url"] == "https://img.example.com/result.png"


def test_run_image_generation_job_fails_on_error(db_session, monkeypatch):
    token = _register("job-fail@b.com")
    task_id = _create_task(token).json()["task_id"]

    async def fake_generate(*args, **kwargs):
        raise RuntimeError("生成服务爆炸了")

    monkeypatch.setattr(
        "app.imaging.jobs.GGOOImageClient.generate_image", fake_generate
    )

    async def fake_active_key(_token: str) -> str:
        return "sk-test"

    monkeypatch.setattr(
        "app.imaging.jobs.ggoo_client.get_or_create_active_key", fake_active_key
    )

    asyncio.get_event_loop().run_until_complete(
        run_image_generation_job(task_id, db_session, f"Bearer {token}")
    )

    resp = client.get(
        f"/image-tool/tasks/{task_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    data = resp.json()
    assert data["status"] == "failed"
    assert "爆炸" in data["error"]
    assert data["result_image_url"] is None

def test_canvas_scene_save_and_load_versions(db_session):
    token = _register("canvas-scene@b.com")
    task_id = _create_task(token).json()["task_id"]
    first_scene = {
        "version": 1,
        "items": [{"id": "requirement", "kind": "requirement", "x": 40, "y": 40}],
        "edges": [],
        "groups": [],
        "viewport": {"x": 0, "y": 0, "scale": 1},
    }

    first = client.post(
        "/image-tool/scenes",
        json={"task_id": task_id, "name": "新品宣传套图", "scene": first_scene},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert first.status_code == 201
    assert first.json()["version"] == 1

    second_scene = {**first_scene, "items": [*first_scene["items"], {"id": "result", "kind": "result", "x": 300, "y": 40}]}
    second = client.post(
        "/image-tool/scenes",
        json={"task_id": task_id, "name": "新品宣传套图", "scene": second_scene},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert second.status_code == 201
    assert second.json()["version"] == 2

    latest = client.get(
        f"/image-tool/scenes/latest?task_id={task_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert latest.status_code == 200
    assert latest.json()["version"] == 2
    assert len(latest.json()["scene"]["items"]) == 2


def test_canvas_scene_isolation_and_missing_latest(db_session):
    token_a = _register("canvas-owner@b.com")
    token_b = _register("canvas-other@b.com")
    task_id = _create_task(token_a).json()["task_id"]
    scene = {
        "items": [],
        "edges": [],
        "groups": [],
        "viewport": {"x": 0, "y": 0, "scale": 1},
        "version": 1,
    }

    saved = client.post(
        "/image-tool/scenes",
        json={"task_id": task_id, "scene": scene},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    scene_id = saved.json()["id"]

    assert client.get(
        f"/image-tool/scenes/{scene_id}",
        headers={"Authorization": f"Bearer {token_b}"},
    ).status_code == 404
    assert client.get(
        f"/image-tool/scenes/latest?task_id={task_id}",
        headers={"Authorization": f"Bearer {token_b}"},
    ).status_code == 404
    assert client.post(
        "/image-tool/scenes",
        json={"task_id": task_id, "scene": scene},
        headers={"Authorization": f"Bearer {token_b}"},
    ).status_code == 404

    other_task_id = _create_task(token_a).json()["task_id"]
    assert client.get(
        f"/image-tool/scenes/latest?task_id={other_task_id}",
        headers={"Authorization": f"Bearer {token_a}"},
    ).status_code == 404
