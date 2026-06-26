"""作战室反馈闭环：历次反馈汇成上下文，喂进下一轮诊断（脑子据此调整、别重复无效动作）。"""
import json

from app.db.models import Project, WarRoomFeedbackEvent
from app.models.questionnaire import ModuleAnswer, Questionnaire
from app.orchestrator.dispatcher import diagnose_all
from app.warroom.history import build_feedback_digest


class FbLLM:
    """scout 不加角度；诊断调用捕获 prompt 并返回合规结论。"""
    seen_prompt = ""

    async def complete(self, system: str, prompt: str) -> str:
        if "诊断调度脑子" in system:
            return json.dumps({"angles": []}, ensure_ascii=False)
        FbLLM.seen_prompt = prompt
        return json.dumps({
            "signal": "red", "conclusion": "x",
            "evidence": [{"text": "a", "source": "b"}], "actions": ["核验"],
            "drilldown": {"data_points": [], "comparisons": []},
        }, ensure_ascii=False)


async def test_build_feedback_digest(db_session):
    async with db_session() as s:
        proj = Project(user_id="u", name="P")
        s.add(proj)
        await s.commit()
        s.add(WarRoomFeedbackEvent(
            project_id=proj.id, war_room_plan_id="wr1", card_type="action",
            card_id="market-action-1", card_title="收窄客群与放弃错配用户",
            adoption_status="adopted", feedback_result="no_change",
            note="改了首屏但没起色", owner="市场负责人",
        ))
        await s.commit()
        digest = await build_feedback_digest(s, proj.id)
    assert "收窄客群" in digest
    assert "已采纳" in digest and "无明显变化" in digest
    assert "改了首屏但没起色" in digest


async def test_no_feedback_digest_is_empty(db_session):
    async with db_session() as s:
        proj = Project(user_id="u", name="空项目")
        s.add(proj)
        await s.commit()
        assert await build_feedback_digest(s, proj.id) == ""
    assert await build_feedback_digest(None, None) == ""   # 无 session/project 也不炸


async def test_diagnose_all_injects_prior_feedback(db_session):
    async with db_session() as s:
        proj = Project(user_id="u", name="P")
        s.add(proj)
        await s.commit()
        s.add(WarRoomFeedbackEvent(
            project_id=proj.id, war_room_plan_id="wr1", card_type="action",
            card_id="market-action-1", card_title="收窄客群",
            adoption_status="adopted", feedback_result="no_change", note="试过没用",
        ))
        await s.commit()
        q = Questionnaire(
            answers=[ModuleAnswer(module="market", facts={"行业": "SaaS"}, pains=["获客难"])],
            problem_map={"core_problem": "获客成本高", "industry": "SaaS"},
            project_id=proj.id,
        )
        await diagnose_all(q, FbLLM(), session=s)
    # 上一轮反馈进了诊断 prompt —— 脑子能看到「试过什么、结果如何」
    assert "无明显变化" in FbLLM.seen_prompt
    assert "收窄客群" in FbLLM.seen_prompt
