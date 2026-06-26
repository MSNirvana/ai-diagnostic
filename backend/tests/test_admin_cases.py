"""运营后台案例库：跨用户台账 + 详情 + 脱敏洞察聚合。

conftest 的 autouse fixture 默认放行后台门，所以这里直接调 /admin/cases/*。
"""
import json
import re

from fastapi.testclient import TestClient

from app.config import get_llm_client
from app.main import app

client = TestClient(app)


class DiagLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "signal": "red",
            "conclusion": "获客成本过高是核心问题",
            "evidence": [{"text": "x", "source": "y"}],
            "actions": ["降本"],
            "drilldown": {"data_points": [], "comparisons": []},
        }, ensure_ascii=False)


class ClusterLLM:
    """模拟产品归一脑子：只解析「项目列表」段，按关键词把签名归到同一产品。"""
    async def complete(self, system: str, prompt: str) -> str:
        if "归一成一个标准产品名" not in prompt:
            return "{}"
        block = prompt.split("项目列表：", 1)[-1].split("只输出", 1)[0]
        assignments = []
        for line in block.splitlines():
            m = re.match(r"\s*(\d+)\.\s*(.+)", line)
            if not m:
                continue
            idx, text = int(m.group(1)), m.group(2)
            if "电火灶" in text or "厨电" in text:
                prod = "电火灶"
            elif "SaaS" in text or "企业服务" in text:
                prod = "企业服务SaaS"
            else:
                prod = "其他"
            assignments.append({"index": idx, "product": prod})
        return json.dumps({"assignments": assignments}, ensure_ascii=False)


def _register(email: str) -> dict:
    token = client.post(
        "/auth/register", json={"email": email, "password": "secret123"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _project(auth: dict, name: str) -> str:
    return client.post("/project/", json={"name": name}, headers=auth).json()["id"]


def _diagnose(auth: dict, pid: str, industry: str, core: str) -> dict:
    r = client.post(
        "/diagnose",
        json={
            "answers": [{"module": "market", "facts": {}, "pains": ["获客贵"]}],
            "project_id": pid,
            "problem_map": {
                "industry": industry,
                "main_business": "招商",
                "core_problem": core,
                "diagnosis_focus": "market",
            },
        },
        headers=auth,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _seed_two_industries(db_session):
    app.dependency_overrides[get_llm_client] = lambda: DiagLLM()
    auth_a = _register("case-a@b.com")
    pa = _project(auth_a, "A 项目")
    _diagnose(auth_a, pa, "SaaS", "获客成本过高")
    auth_b = _register("case-b@b.com")
    pb = _project(auth_b, "B 项目")
    _diagnose(auth_b, pb, "餐饮", "复购太低")
    app.dependency_overrides.pop(get_llm_client, None)
    return pa, pb


def test_ledger_lists_cross_user_projects_and_filters(db_session):
    pa, _ = _seed_two_industries(db_session)

    page = client.get("/admin/cases/projects").json()
    names = {i["name"] for i in page["items"]}
    assert {"A 项目", "B 项目"} <= names              # 跨用户都能看到
    assert "SaaS" in page["industries"] and "餐饮" in page["industries"]

    a_item = next(i for i in page["items"] if i["id"] == pa)
    assert a_item["industry"] == "SaaS"
    assert a_item["user_email"] == "case-a@b.com"
    assert a_item["latest_signal"] == "red"
    assert a_item["primary_module"] == "market"
    assert a_item["diagnosis_count"] >= 1
    assert a_item["review_status"] == "approved"      # 默认即出（审核可选）

    # 按行业筛选
    saas = client.get("/admin/cases/projects", params={"industry": "SaaS"}).json()
    assert saas["items"] and all(i["industry"] == "SaaS" for i in saas["items"])
    assert all(i["name"] != "B 项目" for i in saas["items"])


def test_project_detail_exposes_signals(db_session):
    pa, _ = _seed_two_industries(db_session)
    detail = client.get(f"/admin/cases/projects/{pa}").json()
    assert detail["industry"] == "SaaS"
    assert detail["core_problem"] == "获客成本过高"
    assert detail["user_email"] == "case-a@b.com"
    assert detail["records"]
    sigs = detail["records"][0]["signals"]
    assert any(s["module"] == "market" and s["signal"] == "red" for s in sigs)


def test_detail_404_for_unknown_project(db_session):
    assert client.get("/admin/cases/projects/nope").status_code == 404


def test_product_groups_clusters_same_product_via_brain(db_session):
    from app.api.admin_cases import _PRODUCT_CACHE
    _PRODUCT_CACHE.clear()
    # 4 个项目：3 个其实是电火灶（行业写法各异），1 个企业服务 SaaS
    app.dependency_overrides[get_llm_client] = lambda: DiagLLM()
    auth = _register("case-kitchen@b.com")
    for i, ind in enumerate([
        "新能源厨电",
        "新能源厨电 / 电火灶（等离子电生明火）",
        "新兴厨电 / 电火灶 / 区域代理分销",
        "企业服务 / SaaS",
    ]):
        pid = _project(auth, f"K{i}")
        _diagnose(auth, pid, ind, "获客难")
    app.dependency_overrides.pop(get_llm_client, None)

    app.dependency_overrides[get_llm_client] = lambda: ClusterLLM()
    resp = client.get("/admin/cases/product-groups").json()
    app.dependency_overrides.pop(get_llm_client, None)

    by_product = {g["product"]: g for g in resp["groups"]}
    assert "电火灶" in by_product
    stove = by_product["电火灶"]
    assert stove["count"] == 3                       # 三种行业写法合并成同一产品
    assert stove["modules"][0]["module"] == "market"  # 二级按诊断域
    assert stove["modules"][0]["count"] == 3
    assert by_product["企业服务SaaS"]["count"] == 1
    assert "新能源厨电" in resp["industries"]          # 行业清单仍是原始写法（供筛选）


def test_product_groups_falls_back_without_llm(db_session):
    from app.api.admin_cases import _PRODUCT_CACHE
    _PRODUCT_CACHE.clear()
    app.dependency_overrides[get_llm_client] = lambda: DiagLLM()
    auth = _register("case-fallback@b.com")
    pid = _project(auth, "兜底项目")
    _diagnose(auth, pid, "新能源厨电 / 电火灶（等离子电生明火）", "获客难")
    app.dependency_overrides.pop(get_llm_client, None)

    class DeadLLM:
        async def complete(self, system: str, prompt: str) -> str:
            raise RuntimeError("llm down")

    app.dependency_overrides[get_llm_client] = lambda: DeadLLM()
    resp = client.get("/admin/cases/product-groups").json()
    app.dependency_overrides.pop(get_llm_client, None)

    # LLM 挂了也要出分组（规则兜底：取首段、去括号注解）
    assert resp["total"] >= 1
    assert "新能源厨电" in {g["product"] for g in resp["groups"]}


def test_insights_aggregates_desensitized_cases(db_session):
    _seed_two_industries(db_session)
    ins = client.get("/admin/cases/insights").json()
    assert ins["total_cases"] >= 2
    industries = {d["label"] for d in ins["industry_dist"]}
    assert {"SaaS", "餐饮"} <= industries
    assert any(d["label"] == "red" and d["count"] >= 2 for d in ins["signal_dist"])
    assert any(d["label"] == "market" for d in ins["module_dist"])
