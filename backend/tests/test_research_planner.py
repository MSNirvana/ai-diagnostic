"""外部研究规划与相关性门控。"""
import json

from app.db.models import Project
from app.models.questionnaire import ModuleAnswer, Questionnaire
from app.research.engine import _filter_relevant_evidence, gather_pre_research_evidence
from app.research.models import ResearchEvidenceItem, ResearchQuery
from app.research.query_planner import (
    ResearchScope,
    build_research_scope,
    plan_research_queries,
    plan_system_research_queries,
    rewrite_query_for_scope,
)
from app.research.supplement import run_expert_supplemental_research


_PROBLEM = {
    "industry": "新能源厨电",
    "main_business": "电火灶招商",
    "business_model": "渠道招商",
    "core_problem": "招商获客成本高、转化差",
    "company_name": "GGOO",
}


class PlannerLLM:
    async def complete(self, system: str, prompt: str) -> str:
        if "外部研究规划脑子" in system:
            return json.dumps(
                {
                    "queries": [
                        {"module": "market", "query": "招商回本周期 风险", "purpose": "泛查询，系统应补锚点"},
                        {"module": "policy", "query": "新能源厨电 合规 监管政策", "purpose": "政策上下文"},
                        {"module": "", "query": "", "purpose": "空查询应被过滤"},
                    ]
                },
                ensure_ascii=False,
            )
        return "{}"


class CountingLLM:
    def __init__(self):
        self.calls = 0

    async def complete(self, system: str, prompt: str) -> str:
        self.calls += 1
        return "{}"


class RecordingClient:
    enabled = True

    def __init__(self):
        self.queries: list[str] = []

    async def search(self, query: ResearchQuery, *, max_results: int = 6) -> list[ResearchEvidenceItem]:
        self.queries.append(query.query)
        return []


def test_rule_planner_still_works():
    q = Questionnaire(answers=[ModuleAnswer(module="market", pains=["获客难"])], problem_map=_PROBLEM)
    qs = plan_system_research_queries(q)
    assert qs and all(x.query.strip() for x in qs)
    assert any("电火灶招商" in x.query for x in qs)


async def test_llm_planner_rewrites_generic_queries_with_scope():
    q = Questionnaire(answers=[ModuleAnswer(module="channel_franchise", pains=["招商难"])], problem_map=_PROBLEM)
    qs = await plan_research_queries(q, PlannerLLM(), session=None)
    assert qs
    assert all(x.query.strip() for x in qs)
    assert any("GGOO" in x.query for x in qs if x.module == "market")
    assert any("电火灶招商" in x.query for x in qs)


async def test_llm_planner_skips_llm_without_core_problem():
    llm = CountingLLM()
    q = Questionnaire(answers=[ModuleAnswer(module="market")], problem_map={"industry": "x"})
    await plan_research_queries(q, llm, session=None)
    assert llm.calls == 0


async def test_gather_pre_research_returns_empty_without_api_key(db_session, monkeypatch):
    monkeypatch.delenv("PERPLEXITY_API_KEY", raising=False)
    q = Questionnaire(answers=[ModuleAnswer(module="market", pains=["x"])], problem_map=_PROBLEM)
    async with db_session() as session:
        ev = await gather_pre_research_evidence(
            session, q, job_id="t-job", project_id=None, llm=PlannerLLM()
        )
    assert ev == []


async def test_build_scope_uses_project_alias_and_business_terms(db_session):
    async with db_session() as session:
        project = Project(
            user_id="u1",
            name="华火新能源（搜索闭环测试）",
            profile_json=json.dumps(
                {
                    "company_name": "华火新能源",
                    "main_business": "电火灶招商",
                    "industry": "新能源厨电",
                },
                ensure_ascii=False,
            ),
        )
        session.add(project)
        await session.commit()
        scope = await build_research_scope(
            Questionnaire(
                answers=[ModuleAnswer(module="market", pains=["招商"])],
                project_id=project.id,
                problem_map={"company_name": "华火新能源", "core_problem": "招商线索不准"},
            ),
            session,
        )
    assert "华火新能源" in scope.entity_terms
    assert "华火新能源（搜索闭环测试）" in scope.entity_terms
    assert "招商线索不准" in scope.problem_terms


def test_rewrite_query_for_scope_adds_business_anchor_for_short_latin_brand():
    scope = ResearchScope(
        project_name="GGOO",
        entity_terms=("GGOO",),
        business_terms=("电火灶招商", "新能源厨电"),
        problem_terms=("招商转化差",),
    )
    query = rewrite_query_for_scope("回本周期 政策 风险", "channel_franchise", scope)
    assert "电火灶招商" in query
    assert "回本周期" in query


def test_filter_relevant_evidence_drops_off_topic_rows():
    scope = ResearchScope(
        project_name="GGOO",
        anchor_terms=("GGOO", "电火灶"),
        entity_terms=("GGOO",),
        business_terms=("电火灶",),
        problem_terms=("招商",),
    )
    rows = [
        ResearchEvidenceItem(
            module="market",
            query="GGOO 电火灶 招商 官网",
            title="GGOO 电火灶 招商页",
            snippet="GGOO 电火灶 招商信息",
            url="https://example.com/a",
        ),
        ResearchEvidenceItem(
            module="market",
            query="GGOO 电火灶 招商 官网",
            title="汽车行业报告",
            snippet="汽车行业趋势",
            url="https://example.com/b",
        ),
    ]
    filtered = _filter_relevant_evidence(rows, scope)
    assert len(filtered) == 1
    assert filtered[0].title == "GGOO 电火灶 招商页"


def test_filter_relevant_evidence_keeps_policy_context_when_problem_aligned():
    scope = ResearchScope(
        project_name="华火新能源",
        anchor_terms=("华火新能源", "新能源厨电", "电火灶"),
        entity_terms=("华火新能源",),
        business_terms=("新能源厨电", "电火灶"),
        problem_terms=("合规资质",),
    )
    rows = [
        ResearchEvidenceItem(
            module="policy",
            query="新能源厨电 电火灶 合规 监管政策",
            title="商用电灶产品监管政策解读",
            snippet="针对新能源厨电与商用电灶的准入和监管要求",
            url="https://gov.cn/policy/a",
            source_type="policy",
            credibility=0.9,
        ),
        ResearchEvidenceItem(
            module="policy",
            query="新能源厨电 电火灶 合规 监管政策",
            title="汽车充电桩补贴政策",
            snippet="汽车行业补贴政策摘要",
            url="https://gov.cn/policy/b",
            source_type="policy",
            credibility=0.9,
        ),
    ]
    filtered = _filter_relevant_evidence(rows, scope)
    assert len(filtered) == 1
    assert filtered[0].title == "商用电灶产品监管政策解读"


async def test_expert_supplemental_research_rewrites_generic_question(db_session):
    q = Questionnaire(
        answers=[ModuleAnswer(module="market", pains=["招商难"])],
        problem_map=_PROBLEM,
    )
    client = RecordingClient()
    async with db_session() as session:
        await run_expert_supplemental_research(
            session,
            job_id="job-1",
            project_id=None,
            research_questions=[ResearchQuery(module="market", query="公开评价 风险", purpose="补搜")],
            questionnaire=q,
            client=client,
        )
    assert client.queries
    assert any("GGOO" in query or "电火灶招商" in query for query in client.queries)
