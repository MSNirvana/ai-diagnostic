"""外部研究规划 skill + 快速诊断预研接入（best-effort，无 key 不阻断）。"""
import json

from app.models.questionnaire import ModuleAnswer, Questionnaire
from app.research.engine import gather_pre_research_evidence
from app.research.query_planner import plan_research_queries, plan_system_research_queries


_PROBLEM = {
    "industry": "预制菜", "main_business": "B2B 供应", "business_model": "直供",
    "core_problem": "获客成本高、回款慢", "company_name": "鲜厨",
}


class PlannerLLM:
    async def complete(self, system: str, prompt: str) -> str:
        if "外部研究规划脑子" in system:
            return json.dumps({"queries": [
                {"module": "market", "query": "预制菜 B2B 获客成本 行业基准 2024", "purpose": "对标获客"},
                {"module": "finance", "query": "预制菜 回款周期 现金流 行业", "purpose": "对标财务"},
                {"module": "", "query": "", "purpose": "空查询应被过滤"},
            ]}, ensure_ascii=False)
        return "{}"


def test_rule_planner_still_works():
    q = Questionnaire(answers=[ModuleAnswer(module="market", pains=["获客难"])], problem_map=_PROBLEM)
    qs = plan_system_research_queries(q)
    assert qs and all(x.query.strip() for x in qs)


async def test_llm_planner_overrides_and_filters_empty():
    q = Questionnaire(answers=[ModuleAnswer(module="market", pains=["获客难"])], problem_map=_PROBLEM)
    qs = await plan_research_queries(q, PlannerLLM(), session=None)
    queries = [x.query for x in qs]
    assert "预制菜 B2B 获客成本 行业基准 2024" in queries
    assert all(x.query.strip() for x in qs)   # 空查询被过滤
    assert len(qs) == 2


async def test_llm_planner_falls_back_without_core_problem():
    q = Questionnaire(answers=[ModuleAnswer(module="market")], problem_map={"industry": "x"})
    # 无核心问题 → 回退规则模板（不调 LLM）
    qs = await plan_research_queries(q, PlannerLLM(), session=None)
    assert qs == plan_system_research_queries(q)


async def test_gather_pre_research_returns_empty_without_api_key(db_session):
    # 没配 PERPLEXITY_API_KEY → 搜索未启用 → 返回 []，绝不抛错（不阻断诊断）
    q = Questionnaire(answers=[ModuleAnswer(module="market", pains=["x"])], problem_map=_PROBLEM)
    async with db_session() as session:
        ev = await gather_pre_research_evidence(
            session, q, job_id="t-job", project_id=None, llm=PlannerLLM()
        )
    assert ev == []
