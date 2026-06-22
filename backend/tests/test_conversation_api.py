"""对话追问端点 + generate-ab 接受 summary 测试。"""
import json

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.conversation import run_chat_turn
from app.main import app
from app.config import get_llm_client
from app.db.models import SkillVersion, DiagnosisSession, Project, ProjectMemoryEntry

client = TestClient(app)


def _register(email: str) -> str:
    return client.post(
        "/auth/register", json={"email": email, "password": "secret123"}
    ).json()["access_token"]


class AskingLLM:
    """模拟还在追问的 AI。"""
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "done": False,
            "message": "这个获客成本上升是从什么时候开始的？",
            "summary": None,
        }, ensure_ascii=False)


class BrokenLLM:
    async def complete(self, system: str, prompt: str) -> str:
        raise TypeError("missing api key")


class DoneLLM:
    """模拟信息充分、输出完整 problem_map 的 AI。"""
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "phase": "done",
            "done": True,
            "message": "我已了解，将据此定制诊断。",
            "problem_map": {
                "core_problem": "获客成本翻倍但转化没涨",
                "context": "近半年投放预算翻倍",
                "impact": "近半年投放预算翻倍，ROI 从 1.2 降到 0.8",
                "suspected_cause": "渠道红利消失",
                "tried": "换过两个投放代理",
                "company_name": "星麦",
                "industry": "直播电商",
                "main_business": "达人带货",
                "business_model": "平台撮合",
                "scale": "85人",
                "stage": "成长期",
                "sub_problems": ["转化漏斗后段流失", "复购率偏低"],
                "goal": "三个月内把 ROI 拉回 1.2 以上",
                "constraints": "投放预算不能再加，团队暂时不扩编",
                "success_criteria": "ROI 大于 1.2 且月单量稳定",
                "data_readiness": "可提供投放账户报表、订单明细和客户复购数据",
                "diagnosis_focus": "sales",
            },
        }, ensure_ascii=False)


class FreeChatLLM:
    seen_system = ""
    seen_prompt = ""

    async def complete(self, system: str, prompt: str) -> str:
        FreeChatLLM.seen_system = system
        FreeChatLLM.seen_prompt = prompt
        return "当然，可以从你的增长目标开始聊。"


def test_chat_keeps_asking(db_session):
    app.dependency_overrides[get_llm_client] = lambda: AskingLLM()
    resp = client.post("/conversation/chat", json={
        "messages": [{"role": "user", "content": "我们获客成本越来越高"}]
    })
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 200
    body = resp.json()
    assert body["done"] is False
    assert "什么时候" in body["message"]
    assert body["summary"] is None


def test_free_chat_returns_plain_answer_without_project_records(db_session):
    app.dependency_overrides[get_llm_client] = lambda: FreeChatLLM()

    resp = client.post("/conversation/free-chat", json={
        "messages": [{"role": "user", "content": "帮我看看这个项目怎么提效"}]
    })
    app.dependency_overrides.pop(get_llm_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert "增长目标" in body["message"]
    assert "头脑风暴" in FreeChatLLM.seen_system
    assert "默认不绑定项目" in FreeChatLLM.seen_system

    import asyncio

    async def fetch_counts():
        async with db_session() as session:
            sessions = await session.scalars(select(DiagnosisSession))
            projects = await session.scalars(select(Project))
            return len(list(sessions)), len(list(projects))

    session_count, project_count = asyncio.get_event_loop().run_until_complete(fetch_counts())
    assert session_count == 0
    assert project_count == 0


def test_free_chat_uses_seedable_skill_prompt(db_session):
    app.dependency_overrides[get_llm_client] = lambda: FreeChatLLM()
    resp = client.post("/conversation/free-chat", json={"messages": []})
    app.dependency_overrides.pop(get_llm_client, None)

    assert resp.status_code == 200
    assert "头脑风暴" in FreeChatLLM.seen_system
    assert "普通文本" not in FreeChatLLM.seen_prompt


def test_free_chat_can_include_project_context(db_session):
    app.dependency_overrides[get_llm_client] = lambda: FreeChatLLM()
    resp = client.post("/conversation/free-chat", json={
        "project_context": "项目名称：星麦直播\n当前目标：降低获客成本",
        "messages": [{"role": "user", "content": "帮我推演一个低成本动作"}],
    })
    app.dependency_overrides.pop(get_llm_client, None)

    assert resp.status_code == 200
    assert "可参考的项目信息" in FreeChatLLM.seen_prompt
    assert "星麦直播" in FreeChatLLM.seen_prompt
    assert "帮我推演一个低成本动作" in FreeChatLLM.seen_prompt


async def test_free_chat_loads_project_context_from_database(db_session):
    token = _register("brainstorm-project@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    project_id = client.post("/project/", json={"name": "华火电火灶"}, headers=auth).json()["id"]

    async with db_session() as session:
        project = await session.get(Project, project_id)
        project.memory_summary = "核心业务：电火灶代理销售；当前卡点：终端动销不足。"
        session.add(ProjectMemoryEntry(
            project_id=project_id,
            user_id=project.user_id,
            entry_type="diagnosis",
            summary="诊断：客单价中游但转化率偏低，需要先做低成本获客验证。",
        ))
        await session.commit()

    app.dependency_overrides[get_llm_client] = lambda: FreeChatLLM()
    resp = client.post("/conversation/free-chat", json={
        "project_id": project_id,
        "use_project_context": True,
        "messages": [{"role": "user", "content": "基于当前项目推演一个低成本获客动作"}],
    }, headers=auth)
    app.dependency_overrides.pop(get_llm_client, None)

    assert resp.status_code == 200
    assert "华火电火灶" in FreeChatLLM.seen_prompt
    assert "电火灶代理销售" in FreeChatLLM.seen_prompt
    assert "终端动销不足" in FreeChatLLM.seen_prompt
    assert "项目上下文运行时规则" in FreeChatLLM.seen_system
    assert "用户已开启“带入项目信息思考”" in FreeChatLLM.seen_prompt
    assert "不要说不了解该项目" in FreeChatLLM.seen_prompt


async def test_free_chat_filters_stale_no_project_reply_when_context_is_loaded(db_session):
    token = _register("brainstorm-stale@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    project_id = client.post("/project/", json={"name": "华火电火灶"}, headers=auth).json()["id"]

    app.dependency_overrides[get_llm_client] = lambda: FreeChatLLM()
    resp = client.post("/conversation/free-chat", json={
        "project_id": project_id,
        "use_project_context": True,
        "messages": [
            {"role": "assistant", "content": "我现在没有绑定任何项目哦，这里是一张空白纸。"},
            {"role": "user", "content": "基于当前项目推演一个获客动作"},
        ],
    }, headers=auth)
    app.dependency_overrides.pop(get_llm_client, None)

    assert resp.status_code == 200
    assert "华火电火灶" in FreeChatLLM.seen_prompt
    assert "没有绑定任何项目" not in FreeChatLLM.seen_prompt
    assert "空白纸" not in FreeChatLLM.seen_prompt


async def test_free_chat_answers_project_identity_directly(db_session):
    token = _register("brainstorm-identity@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    project_id = client.post("/project/", json={"name": "华火电火灶"}, headers=auth).json()["id"]

    app.dependency_overrides[get_llm_client] = lambda: BrokenLLM()
    resp = client.post("/conversation/free-chat", json={
        "project_id": project_id,
        "use_project_context": True,
        "messages": [{"role": "user", "content": "当前是什么项目？"}],
    }, headers=auth)
    app.dependency_overrides.pop(get_llm_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert "华火电火灶" in body["message"]
    assert body["brainstorm_session_id"]


def test_free_chat_marks_missing_project_context_when_requested(db_session):
    app.dependency_overrides[get_llm_client] = lambda: FreeChatLLM()
    resp = client.post("/conversation/free-chat", json={
        "project_id": "missing-project",
        "use_project_context": True,
        "messages": [{"role": "user", "content": "结合项目帮我推演渠道动作"}],
    })
    app.dependency_overrides.pop(get_llm_client, None)

    assert resp.status_code == 200
    assert "没有找到当前账号可访问的项目档案" in FreeChatLLM.seen_prompt
    assert "结合项目帮我推演渠道动作" in FreeChatLLM.seen_prompt


async def test_project_brainstorm_session_is_persisted(db_session):
    token = _register("brainstorm-history@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    project_id = client.post("/project/", json={"name": "风暴留存项目"}, headers=auth).json()["id"]

    app.dependency_overrides[get_llm_client] = lambda: FreeChatLLM()
    resp = client.post("/conversation/free-chat", json={
        "project_id": project_id,
        "use_project_context": True,
        "messages": [{"role": "user", "content": "帮我推演一个渠道招商动作"}],
    }, headers=auth)
    app.dependency_overrides.pop(get_llm_client, None)

    assert resp.status_code == 200
    brainstorm_id = resp.json()["brainstorm_session_id"]
    assert brainstorm_id

    list_resp = client.get(f"/conversation/brainstorm-sessions?project_id={project_id}", headers=auth)
    assert list_resp.status_code == 200
    rows = list_resp.json()
    assert len(rows) == 1
    assert rows[0]["id"] == brainstorm_id
    assert rows[0]["title"] == "帮我推演一个渠道招商动作"

    detail_resp = client.get(f"/conversation/brainstorm-sessions/{brainstorm_id}", headers=auth)
    assert detail_resp.status_code == 200
    messages = detail_resp.json()["messages"]
    assert messages[0]["content"] == "帮我推演一个渠道招商动作"
    assert messages[-1]["role"] == "assistant"

    project_detail = client.get(f"/project/{project_id}", headers=auth).json()
    assert project_detail["brainstorm_sessions"][0]["id"] == brainstorm_id


def test_save_and_list_idea_cards(db_session):
    token = _register("idea-card@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    payload = {
        "card": {
            "title": "学校食堂电火灶改造",
            "one_liner": "给学校食堂做电火灶安全改造方案",
            "source_context": "新项目点子",
            "target_customer": "学校食堂",
            "pain_point": "明火和燃气安全风险",
            "value_proposition": "降低用火风险并提升监管可见度",
            "core_assumption": "学校食堂愿意为更安全的烹饪方案付费",
            "contrary_risk": "采购预算或改造周期过长",
            "validation_action": "7天内访谈3个后勤负责人并拿到试点意向",
            "next_step": "整理试点清单",
            "confidence": "可进入验证",
        },
        "messages": [
            {"role": "user", "content": "我想给学校食堂做电火灶安全改造方案"},
            {"role": "assistant", "content": "先验证后勤负责人是否愿意试点。"},
        ],
    }

    create_resp = client.post("/conversation/idea-cards", json=payload, headers=auth)
    assert create_resp.status_code == 201
    body = create_resp.json()
    assert body["id"]
    assert body["title"] == "学校食堂电火灶改造"
    assert body["status"] == "saved"

    list_resp = client.get("/conversation/idea-cards", headers=auth)
    assert list_resp.status_code == 200
    cards = list_resp.json()
    assert len(cards) == 1
    assert cards[0]["id"] == body["id"]
    assert cards[0]["target_customer"] == "学校食堂"


def test_chat_finishes_with_summary(db_session):
    app.dependency_overrides[get_llm_client] = lambda: DoneLLM()
    resp = client.post("/conversation/chat", json={
        "messages": [
            {"role": "user", "content": "获客成本越来越高"},
            {"role": "assistant", "content": "从什么时候开始？"},
            {"role": "user", "content": "近半年，预算翻倍但转化没涨"},
        ]
    })
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 200
    body = resp.json()
    assert body["done"] is True
    assert body["summary"]["core_problem"]
    assert body["summary"]["industry"] == "直播电商"


def test_session_can_be_pinned_renamed_and_hidden_from_project(db_session):
    token = _register("session-manage@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    project_id = client.post("/project/", json={"name": "星麦直播"}, headers=auth).json()["id"]

    first_id = client.post("/session/start", json={"project_id": project_id}, headers=auth).json()["session_id"]
    second_id = client.post("/session/start", json={"project_id": project_id}, headers=auth).json()["session_id"]

    app.dependency_overrides[get_llm_client] = lambda: DoneLLM()
    assert client.post(f"/session/{first_id}/chat", json={"message": "获客成本越来越高"}, headers=auth).status_code == 200
    assert client.post(f"/session/{second_id}/chat", json={"message": "复购率一直上不来"}, headers=auth).status_code == 200
    app.dependency_overrides.pop(get_llm_client, None)

    auto_detail = client.get(f"/project/{project_id}", headers=auth).json()
    auto_titles = {s["id"]: s["title"] for s in auto_detail["sessions"]}
    assert auto_titles[first_id] == "获客成本翻倍但转化没涨"
    assert auto_titles[second_id] == "获客成本翻倍但转化没涨"

    rename_resp = client.patch(
        f"/session/{first_id}",
        json={"title": "直播获客成本复盘", "is_pinned": True},
        headers=auth,
    )
    assert rename_resp.status_code == 200
    assert rename_resp.json()["title"] == "直播获客成本复盘"
    assert rename_resp.json()["is_pinned"] is True

    detail = client.get(f"/project/{project_id}", headers=auth).json()
    assert detail["sessions"][0]["id"] == first_id
    assert detail["sessions"][0]["title"] == "直播获客成本复盘"
    assert detail["sessions"][0]["is_pinned"] is True

    app.dependency_overrides[get_llm_client] = lambda: DoneLLM()
    assert client.post(f"/session/{first_id}/chat", json={"message": "补充一个信息"}, headers=auth).status_code == 200
    app.dependency_overrides.pop(get_llm_client, None)
    assert client.get(f"/session/{first_id}", headers=auth).json()["title"] == "直播获客成本复盘"

    delete_resp = client.delete(f"/session/{first_id}", headers=auth)
    assert delete_resp.status_code == 204
    detail_after_delete = client.get(f"/project/{project_id}", headers=auth).json()
    assert [s["id"] for s in detail_after_delete["sessions"]] == [second_id]

    assert client.get(f"/session/{first_id}", headers=auth).status_code == 404


def test_project_session_memory_can_be_toggled(db_session):
    token = _register("session-memory@b.com")
    auth = {"Authorization": f"Bearer {token}"}
    project_id = client.post("/project/", json={"name": "星麦直播"}, headers=auth).json()["id"]

    app.dependency_overrides[get_llm_client] = lambda: AskingLLM()
    on_id = client.post("/session/start", json={"project_id": project_id}, headers=auth).json()["session_id"]
    off_id = client.post(
        "/session/start",
        json={"project_id": project_id, "memory_enabled": False},
        headers=auth,
    ).json()["session_id"]
    assert client.post(f"/session/{on_id}/chat", json={"message": "今天直播间有2000人看，但每天只成交1到2单"}, headers=auth).status_code == 200
    assert client.post(f"/session/{off_id}/chat", json={"message": "这个信息不要进档案"}, headers=auth).status_code == 200
    app.dependency_overrides.pop(get_llm_client, None)

    import asyncio

    async def fetch_memory():
        async with db_session() as session:
            rows = list(await session.scalars(
                select(ProjectMemoryEntry).where(ProjectMemoryEntry.project_id == project_id)
            ))
            return rows

    rows = asyncio.get_event_loop().run_until_complete(fetch_memory())
    assert len(rows) == 1
    assert rows[0].entry_type == "conversation"
    assert rows[0].source_id == on_id
    assert "2000人看" in rows[0].summary or "每天只成交1到2单" in rows[0].summary


def test_chat_empty_start(db_session):
    app.dependency_overrides[get_llm_client] = lambda: AskingLLM()
    resp = client.post("/conversation/chat", json={"messages": []})
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 200
    assert resp.json()["done"] is False


def test_chat_returns_clear_error_when_llm_unavailable(db_session):
    app.dependency_overrides[get_llm_client] = lambda: BrokenLLM()
    resp = client.post("/conversation/chat", json={
        "messages": [{"role": "user", "content": "公司招聘一直招不到合适的人"}]
    })
    app.dependency_overrides.pop(get_llm_client, None)

    assert resp.status_code == 503
    assert "模型通道暂时不可用" in resp.json()["detail"]
    assert "没接住" not in resp.text


def test_generate_ab_accepts_summary(db_session):
    valid = {
        "modules": [{
            "key": "market", "label": "市场与客户", "subtitle": "x",
            "fields": [{"key": "f", "label": "f", "placeholder": "p", "accept_file": False}],
            "pains": ["p1"], "free_text_label": "补充",
        }]
    }

    class GenLLM:
        async def complete(self, system: str, prompt: str) -> str:
            # 断言 summary 的核心问题进了 prompt
            assert "获客成本" in prompt
            return json.dumps(valid, ensure_ascii=False)

    app.dependency_overrides[get_llm_client] = lambda: GenLLM()
    resp = client.post("/questionnaire/generate-ab", json={
        "summary": {
            "core_problem": "获客成本翻倍",
            "context": "近半年", "suspected_cause": "渠道红利消失", "tried": "换代理",
            "company_name": "", "industry": "直播电商", "main_business": "带货",
            "business_model": "撮合", "scale": "85人", "stage": "成长期",
        }
    })
    app.dependency_overrides.pop(get_llm_client, None)
    assert resp.status_code == 200
    assert resp.json()["option_a"]["modules"][0]["key"] == "market"


# ── phase 状态机（intake → confirm → done） ───────────────

class StatefulPhaseLLM:
    """按调用顺序返回 intake → confirm → done 三阶段输出。"""
    calls = 0

    PROBLEM_MAP = {
        "company_name": "星麦",
        "industry": "直播电商",
        "main_business": "达人带货",
        "business_model": "平台撮合",
        "scale": "85人",
        "stage": "成长期",
        "core_problem": "获客成本翻倍但转化没涨",
        "sub_problems": ["转化漏斗后段流失", "复购率偏低"],
        "goal": "三个月内把 ROI 拉回 1.2 以上",
        "constraints": "投放预算不能再加",
        "success_criteria": "ROI 大于 1.2 且月单量稳定",
        "context": "近半年预算翻倍",
        "suspected_cause": "渠道红利消失",
        "tried": "换过两个代理",
        "diagnosis_focus": "sales",
    }

    async def complete(self, system: str, prompt: str) -> str:
        StatefulPhaseLLM.calls += 1
        n = StatefulPhaseLLM.calls
        if n == 1:
            return json.dumps({
                "phase": "intake", "done": False,
                "message": "这个获客成本上升从什么时候开始？",
                "problem_map": None,
            }, ensure_ascii=False)
        if n == 2:
            return json.dumps({
                "phase": "confirm", "done": False,
                "message": "我这样理解……这样对吗？",
                "problem_map": self.PROBLEM_MAP,
            }, ensure_ascii=False)
        return json.dumps({
            "phase": "done", "done": True,
            "message": "好的，我已完整理解。",
            "problem_map": self.PROBLEM_MAP,
        }, ensure_ascii=False)


def test_chat_phase_intake_to_confirm_to_done(db_session):
    StatefulPhaseLLM.calls = 0
    app.dependency_overrides[get_llm_client] = lambda: StatefulPhaseLLM()

    r1 = client.post("/conversation/chat", json={
        "messages": [{"role": "user", "content": "获客越来越贵"}]
    }).json()
    assert r1["phase"] == "intake"
    assert r1["done"] is False
    assert r1["problem_map"] is None

    r2 = client.post("/conversation/chat", json={
        "messages": [
            {"role": "user", "content": "获客越来越贵"},
            {"role": "assistant", "content": r1["message"]},
            {"role": "user", "content": "近半年，预算翻倍但ROI掉了"},
        ]
    }).json()
    assert r2["phase"] == "confirm"
    assert r2["done"] is False
    assert r2["problem_map"]["core_problem"]
    assert r2["problem_map"]["diagnosis_focus"] == "sales"
    assert r2["problem_map"]["goal"]
    assert r2["problem_map"]["constraints"]

    r3 = client.post("/conversation/chat", json={"messages": []}).json()
    assert r3["phase"] == "done"
    assert r3["done"] is True
    assert r3["problem_map"]["core_problem"]
    assert r3["summary"]["industry"] == "直播电商"

    app.dependency_overrides.pop(get_llm_client, None)


# ── 信息完整度闸门：防止过早 confirm/done ───────────────

class PrematureConfirmLLM:
    """模拟 AI 太快收口：只拿到症状就想确认。"""
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "phase": "confirm",
            "done": False,
            "message": "我理解你们现在获客贵，这样对吗？",
            "problem_map": {
                "company_name": "星麦",
                "industry": "直播电商",
                "main_business": "达人带货",
                "business_model": "",
                "scale": "",
                "stage": "",
                "core_problem": "获客成本变高",
                "sub_problems": [],
                "goal": "",
                "constraints": "",
                "success_criteria": "",
                "context": "",
                "suspected_cause": "",
                "tried": "",
                "diagnosis_focus": "",
            },
        }, ensure_ascii=False)


class PrematureDoneLLM:
    """模拟用户未确认、地图也不完整时 AI 直接 done。"""
    async def complete(self, system: str, prompt: str) -> str:
        return json.dumps({
            "phase": "done",
            "done": True,
            "message": "好的，开始诊断。",
            "problem_map": {
                "core_problem": "库存很高",
                "industry": "消费品",
            },
        }, ensure_ascii=False)


def test_chat_blocks_premature_confirm_until_intake_is_complete(db_session):
    app.dependency_overrides[get_llm_client] = lambda: PrematureConfirmLLM()
    resp = client.post("/conversation/chat", json={
        "messages": [{"role": "user", "content": "我们获客成本越来越高"}]
    })
    app.dependency_overrides.pop(get_llm_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert body["phase"] == "intake"
    assert body["done"] is False
    assert body["problem_map"]["core_problem"] == "获客成本变高"
    assert body["problem_map"]["information_score"] < 70
    assert "目标" in body["problem_map"]["missing_fields"]
    assert "不要急着进入确认" in body["message"]


def test_chat_blocks_premature_done_without_complete_problem_map(db_session):
    app.dependency_overrides[get_llm_client] = lambda: PrematureDoneLLM()
    resp = client.post("/conversation/chat", json={
        "messages": [
            {"role": "user", "content": "库存很高"},
            {"role": "assistant", "content": "库存压力主要体现在哪里？"},
            {"role": "user", "content": "仓库快满了"},
        ]
    })
    app.dependency_overrides.pop(get_llm_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert body["phase"] == "intake"
    assert body["done"] is False
    assert body["summary"] is None
    assert body["problem_map"]["information_score"] < 70
    assert body["problem_map"]["missing_fields"]


async def test_chat_composes_intake_and_completeness_skill_versions(db_session):
    class PromptSpyLLM:
        seen_system = ""

        async def complete(self, system: str, prompt: str) -> str:
            PromptSpyLLM.seen_system = system
            return json.dumps({
                "phase": "intake",
                "done": False,
                "message": "请继续补充。",
                "problem_map": None,
            }, ensure_ascii=False)

    async with db_session() as session:
        session.add(SkillVersion(
            module="conversation_intake",
            skill_type="conversation",
            version=1,
            system_prompt="主对话 Skill",
            method="intake",
            is_active=True,
        ))
        session.add(SkillVersion(
            module="intake_completeness",
            skill_type="conversation",
            version=1,
            system_prompt="完整度闸门 Skill",
            method="quality_gate",
            is_active=True,
        ))
        await session.commit()

        await run_chat_turn(
            messages=[],
            llm=PromptSpyLLM(),
            session=session,
        )

    assert "主对话 Skill" in PromptSpyLLM.seen_system
    assert "完整度闸门 Skill" in PromptSpyLLM.seen_system
