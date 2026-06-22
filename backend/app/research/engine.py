from __future__ import annotations

import asyncio
import os

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.questionnaire import Questionnaire

from .models import ResearchBrief, ResearchEvidenceItem, ResearchQuery
from .perplexity import PerplexityResearchClient
from .query_planner import plan_system_research_queries
from .store import save_research_evidence


DEFAULT_MAX_QUERIES = 24
DEFAULT_RESULTS_PER_QUERY = 5
DEFAULT_CONCURRENCY = 4


async def run_system_pre_research(
    session: AsyncSession,
    *,
    job_id: str,
    project_id: str | None,
    questionnaire: Questionnaire,
    client: PerplexityResearchClient | None = None,
) -> ResearchBrief:
    queries = plan_system_research_queries(questionnaire)[:_max_queries()]
    client = client or PerplexityResearchClient()
    if not client.enabled or not queries:
        return ResearchBrief(queries=queries, evidence=[], summary="外部研究未启用或无可执行查询。")

    evidence = await _run_queries(client, queries)
    evidence = _dedupe_evidence(evidence)
    await save_research_evidence(
        session,
        job_id=job_id,
        project_id=project_id,
        items=evidence,
        source_stage="system_pre_research",
    )
    return ResearchBrief(
        queries=queries,
        evidence=evidence,
        summary=f"完成 {len(queries)} 个研究问题，沉淀 {len(evidence)} 条外部证据。",
    )


async def _run_queries(
    client: PerplexityResearchClient,
    queries: list[ResearchQuery],
) -> list[ResearchEvidenceItem]:
    semaphore = asyncio.Semaphore(_concurrency())

    async def one(query: ResearchQuery) -> list[ResearchEvidenceItem]:
        async with semaphore:
            return await client.search(query, max_results=_results_per_query())

    batches = await asyncio.gather(*(one(query) for query in queries), return_exceptions=True)
    evidence: list[ResearchEvidenceItem] = []
    for batch in batches:
        if isinstance(batch, Exception):
            continue
        evidence.extend(batch)
    return evidence


def _dedupe_evidence(items: list[ResearchEvidenceItem]) -> list[ResearchEvidenceItem]:
    seen: set[tuple[str, str, str]] = set()
    out: list[ResearchEvidenceItem] = []
    for item in items:
        key = (item.module, item.url, item.snippet[:120])
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return sorted(out, key=lambda item: item.credibility, reverse=True)


def _max_queries() -> int:
    return int(os.environ.get("RESEARCH_MAX_QUERIES", DEFAULT_MAX_QUERIES))


def _results_per_query() -> int:
    return int(os.environ.get("RESEARCH_RESULTS_PER_QUERY", DEFAULT_RESULTS_PER_QUERY))


def _concurrency() -> int:
    return int(os.environ.get("RESEARCH_CONCURRENCY", DEFAULT_CONCURRENCY))
