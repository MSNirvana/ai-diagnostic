"""问卷生成端点：正常生成 + LLM 畸形输出降级。"""
import json

from fastapi.testclient import TestClient

from app.main import app
from app.config import get_llm_client

client = TestClient(app)

_PROFILE = {
    "profile": {
        "company_name": "测试直播公司",
        "industry": "直播电商",
        "main_business": "达人带货",
        "business_model": "平台撮合",
        "scale": "80人",
        "stage": "成长期",
    }
}

def _gate_module(key: str, label: str) -> dict:
    """造一个能过质量门的模块：≥4 字段、≥2 痛点。"""
    return {
        "key": key,
        "label": label,
        "subtitle": f"{label}诊断",
        "fields": [
            {"key": f"{key}_f{i}", "label": f"{label}字段{i}", "placeholder": "如 xxx", "accept_file": i == 0}
            for i in range(4)
        ],
        "pains": [f"{label}痛点1", f"{label}痛点2"],
        "free_text_label": "补充说明",
    }


_VALID = {
    "modules": [
        # 首个模块带 accept_file 字段，供断言；其余补足到 4 模块过质量门
        {
            "key": "market",
            "label": "市场与客户",
            "subtitle": "市场地位",
            "fields": [
                {"key": "GMV", "label": "月GMV", "placeholder": "如 500万", "accept_file": True},
                {"key": "cac", "label": "获客成本", "placeholder": "如 200元", "accept_file": False},
                {"key": "roi", "label": "投产比", "placeholder": "如 1.2", "accept_file": False},
                {"key": "refund", "label": "退货率", "placeholder": "如 8%", "accept_file": False},
            ],
            "pains": ["流量见顶", "退货率高"],
            "free_text_label": "补充说明",
        },
        _gate_module("sales", "销售与转化"),
        _gate_module("ops", "运营与供应链"),
        _gate_module("finance", "财务与资本"),
    ]
}


class ValidLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps(_VALID, ensure_ascii=False)


class PlaceholderFieldLLM:
    async def complete(self, system: str, prompt: str) -> str:
        if "available_skills" not in prompt:
            return json.dumps({"passed": True, "score": 88}, ensure_ascii=False)
        data = json.loads(json.dumps(_VALID, ensure_ascii=False))
        data["modules"][0] = {
            "key": "data_systems",
            "label": "数据与系统",
            "subtitle": "核验数据口径与系统连接",
            "fields": [
                {
                    "key": "system_map",
                    "label": "系统与数据流向图",
                    "placeholder": "补充当前使用的 CRM、ERP、财务、广告、客服系统和数据流转方式。",
                    "accept_file": True,
                },
                {
                    "key": "metric_definitions",
                    "label": "核心指标口径",
                    "placeholder": "上传经营指标口径表、报表截图、看板字段或数据字典。",
                    "accept_file": True,
                },
                {
                    "key": "id_mapping",
                    "label": "客户/订单/线索 ID 对齐方式",
                    "placeholder": "说明广告线索、CRM 客户、订单、合同、回款之间是否有统一 ID 或匹配规则。",
                    "accept_file": False,
                },
                {
                    "key": "dashboard_usage",
                    "label": "经营看板与使用频率",
                    "placeholder": "上传当前经营看板截图，或说明老板/部门每周查看哪些指标、由谁维护。",
                    "accept_file": False,
                },
            ],
            "pains": ["口径不一致", "系统割裂"],
            "free_text_label": "补充数据系统背景",
        }
        return json.dumps(data, ensure_ascii=False)


class BadPlaceholderFieldLLM(PlaceholderFieldLLM):
    async def complete(self, system: str, prompt: str) -> str:
        if "available_skills" not in prompt:
            return json.dumps({"passed": True, "score": 88}, ensure_ascii=False)
        data = json.loads(await super().complete(system, prompt))
        data["modules"][0]["fields"][2] = {
            "key": "cover_data_systems_5",
            "label": "数据与系统关键指标5",
            "placeholder": "例如：近90天按周趋势、渠道拆分、区域拆分",
            "accept_file": False,
        }
        data["modules"][0]["fields"][3] = {
            "key": "cover_data_systems_6",
            "label": "数据与系统关键指标6",
            "placeholder": "例如：近90天按周趋势、渠道拆分、区域拆分",
            "accept_file": False,
        }
        return json.dumps(data, ensure_ascii=False)


class GarbageLLM:
    async def complete(self, system: str, prompt: str) -> str:
        return "这不是 JSON，模型抽风了"


class SkillContextLLM:
    seen_prompt = ""

    async def complete(self, system: str, prompt: str) -> str:
        # 质量评审调用：prompt 是评审 payload（无 available_skills），直接放行
        if "available_skills" not in prompt:
            return json.dumps({"passed": True, "score": 90}, ensure_ascii=False)
        # 生成调用：捕获 prompt 供断言
        SkillContextLLM.seen_prompt = prompt
        assert "recommended_skills" in prompt
        assert "legal_compliance" in prompt
        return json.dumps({
            "modules": [
                {
                    "key": "legal_compliance",
                    "label": "法务合规",
                    "subtitle": "核验宣传、资质与合同风险",
                    "fields": [
                        {"key": "ad_materials", "label": "广告素材", "placeholder": "上传近期投放素材", "accept_file": True},
                        {"key": "license", "label": "资质认证", "placeholder": "上传资质文件", "accept_file": True},
                        {"key": "contract", "label": "加盟合同条款", "placeholder": "关键条款", "accept_file": False},
                        {"key": "promise", "label": "宣传承诺口径", "placeholder": "对外承诺", "accept_file": False},
                    ],
                    "pains": ["广告合规风险", "合同责任不清"],
                    "free_text_label": "补充合规背景",
                },
                _gate_module("sales", "招商投放"),
                _gate_module("product", "产品与交付"),
                _gate_module("finance", "财务测算"),
            ]
        }, ensure_ascii=False)


def test_generate_returns_valid_questionnaire(db_session):
    app.dependency_overrides[get_llm_client] = lambda: ValidLLM()
    resp = client.post("/questionnaire/generate", json={**_PROFILE, "problem_map": {
        "company_name": "测试直播公司",
        "industry": "直播电商",
        "main_business": "达人带货",
        "business_model": "平台撮合",
        "scale": "80人",
        "stage": "成长期",
        "core_problem": "获客成本高",
        "goal": "把投产比拉回 1.2",
        "constraints": "预算不能加",
        "success_criteria": "ROI 达标",
        "impact": "近3个月获客成本上升30%",
        "data_readiness": "有投放报表",
        "diagnosis_focus": "sales",
    }})
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 200
    body = resp.json()
    assert body["modules"][0]["key"] == "market"
    assert body["modules"][0]["fields"][0]["accept_file"] is True
    assert 4 <= len(body["modules"][0]["fields"]) <= 6


def test_generate_does_not_pad_placeholder_key_metrics(db_session):
    app.dependency_overrides[get_llm_client] = lambda: PlaceholderFieldLLM()
    resp = client.post("/questionnaire/generate", json={**_PROFILE, "problem_map": {
        "company_name": "测试公司",
        "industry": "企业服务",
        "main_business": "多渠道销售",
        "business_model": "B2B 服务",
        "scale": "60人",
        "stage": "成长期",
        "core_problem": "系统数据口径不一致，经营会无法判断投放与销售责任",
        "goal": "统一经营指标和复盘看板",
        "data_readiness": "有 CRM 和财务报表",
        "diagnosis_focus": "数据与系统",
    }})
    app.dependency_overrides.pop(get_llm_client, None)

    assert resp.status_code == 200
    fields = resp.json()["modules"][0]["fields"]
    labels = [field["label"] for field in fields]
    assert "数据与系统关键指标5" not in labels
    assert "数据与系统关键指标6" not in labels
    assert len(fields) == 4
    assert "系统与数据流向图" in labels
    assert "核心指标口径" in labels


def test_generate_rejects_placeholder_key_metrics(db_session):
    app.dependency_overrides[get_llm_client] = lambda: BadPlaceholderFieldLLM()
    resp = client.post("/questionnaire/generate", json={**_PROFILE, "problem_map": {
        "company_name": "测试公司",
        "industry": "企业服务",
        "main_business": "多渠道销售",
        "business_model": "B2B 服务",
        "scale": "60人",
        "stage": "成长期",
        "core_problem": "系统数据口径不一致",
        "goal": "统一经营指标和复盘看板",
        "data_readiness": "有 CRM 和财务报表",
        "diagnosis_focus": "数据与系统",
    }})
    app.dependency_overrides.pop(get_llm_client, None)

    assert resp.status_code == 422
    # 占位字段是质量硬伤，必须拒（与字段数量无关）
    assert "占位字段" in resp.json()["detail"]


def test_generate_malformed_output_returns_422(db_session):
    app.dependency_overrides[get_llm_client] = lambda: GarbageLLM()
    resp = client.post("/questionnaire/generate", json=_PROFILE)
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 422


class ThinLLM:
    """总返回单薄问卷（1 模块 2 字段），应被质量门拦截。"""
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "modules": [{
                "key": "market", "label": "市场", "subtitle": "x",
                "fields": [
                    {"key": "a", "label": "字段A", "placeholder": "p", "accept_file": False},
                    {"key": "b", "label": "字段B", "placeholder": "p", "accept_file": False},
                ],
                "pains": ["痛点1"],
                "free_text_label": "补充",
            }]
        }, ensure_ascii=False)


def test_generate_thin_output_fails_quality_gate(db_session):
    """质量门：单薄问卷（模块少/字段少）重试后仍不达标 → 422，不降级。"""
    app.dependency_overrides[get_llm_client] = lambda: ThinLLM()
    resp = client.post("/questionnaire/generate", json=_PROFILE)
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 422
    assert "质量未达标" in resp.json()["detail"]


class MissingDataHandleLLM:
    """结构达标（过规则门），但 LLM 评审判缺数据入口 → 应被 LLM 把关拦下。"""
    async def complete(self, system: str, prompt: str) -> str:
        if "available_skills" not in prompt:
            # 质量评审调用：判不通过，缺直播间/商品链接
            return json.dumps({
                "passed": False,
                "score": 55,
                "missing_data_handles": ["直播间链接", "商品链接"],
                "improvements": ["补充直播间与商品链接字段，供顾问做外部核验"],
            }, ensure_ascii=False)
        # 生成调用：返回结构达标的问卷（过规则门）
        return json.dumps(_VALID, ensure_ascii=False)


def test_generate_blocked_when_missing_data_handles(db_session):
    """LLM 质量评审：问卷缺真实数据入口（直播间/商品链接）→ 422，不放行。"""
    app.dependency_overrides[get_llm_client] = lambda: MissingDataHandleLLM()
    resp = client.post("/questionnaire/generate", json=_PROFILE)
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 422
    assert "数据入口" in resp.json()["detail"]


def test_generate_injects_extensible_skill_network_context(db_session):
    app.dependency_overrides[get_llm_client] = lambda: SkillContextLLM()
    resp = client.post("/questionnaire/generate", json={**_PROFILE, "problem_map": {
        "company_name": "华火新能源",
        "industry": "新能源厨电",
        "main_business": "电火灶招商加盟",
        "business_model": "经销加盟",
        "scale": "50人",
        "stage": "成长期",
        "core_problem": "加盟招商投放不错，但广告合规、资质认证和合同风险没有核清",
        "goal": "建立可复制招商模型",
        "constraints": "不能触碰合规红线",
        "success_criteria": "投放转化提升且合同风险可控",
        "impact": "线索增加但签约推进慢",
        "data_readiness": "可上传广告素材和加盟协议",
        "diagnosis_focus": "法务合规",
    }})
    app.dependency_overrides.pop(get_llm_client, None)

    assert resp.status_code == 200
    body = resp.json()
    keys = [module["key"] for module in body["modules"]]
    # 改1：问卷由 LLM 主导生成，不再用关键词召回硬塞模块。
    # 1) 用户明确指定的 diagnosis_focus 必须被保证覆盖
    assert "legal_compliance" in keys
    # 2) skill 数据契约（available_skills/recommended_skills）仍注入 prompt 供 LLM 参考对齐字段
    assert "available_skills" in SkillContextLLM.seen_prompt
    assert "recommended_skills" in SkillContextLLM.seen_prompt
    # 3) 不再出现"靠关键词从问题文本召回、但 LLM 并未生成"的模块（旧行为已移除）
    assert "channel_franchise" not in keys
