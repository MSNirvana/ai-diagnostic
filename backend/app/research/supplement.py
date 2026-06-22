from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from .models import ResearchEvidenceItem, ResearchQuery
from .perplexity import PerplexityResearchClient
from .store import save_research_evidence


SUPPLEMENTAL_STAGE = "expert_supplemental_research"
DEFAULT_SUPPLEMENTAL_MAX_QUESTIONS = 12
DEFAULT_SUPPLEMENTAL_CONCURRENCY = 3


@dataclass(frozen=True)
class ExpertResearchQuestion:
    module: str
    query: str


def collect_expert_research_questions(results) -> list[ResearchQuery]:
    questions: list[ResearchQuery] = []
    seen: set[tuple[str, str]] = set()
    for result in results:
        for question in getattr(result, "research_questions", []) or []:
            query = " ".join(str(question).split())
            if not query:
                continue
            key = (result.module, query)
            if key in seen:
                continue
            seen.add(key)
            questions.append(
                ResearchQuery(
                    module=result.module,
                    query=query[:180],
                    purpose="专家认为证据不足后的补充搜索",
                )
            )
    return questions[:_max_questions()]


async def run_expert_supplemental_research(
    session: AsyncSession,
    *,
    job_id: str,
    project_id: str | None,
    research_questions: list[ResearchQuery],
    client: PerplexityResearchClient | None = None,
):
    client = client or PerplexityResearchClient()
    if not client.enabled or not research_questions:
        return []

    evidence = await _run_queries(client, research_questions)
    evidence = _dedupe_evidence(evidence)
    return await save_research_evidence(
        session,
        job_id=job_id,
        project_id=project_id,
        items=evidence,
        source_stage=SUPPLEMENTAL_STAGE,
    )


async def _run_queries(
    client: PerplexityResearchClient,
    queries: list[ResearchQuery],
) -> list[ResearchEvidenceItem]:
    semaphore = asyncio.Semaphore(_concurrency())

    async def one(query: ResearchQuery) -> list[ResearchEvidenceItem]:
        async with semaphore:
            return await client.search(query, max_results=4)

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


def _max_questions() -> int:
    return int(os.environ.get("RESEARCH_SUPPLEMENTAL_MAX_QUESTIONS", DEFAULT_SUPPLEMENTAL_MAX_QUESTIONS))


def _concurrency() -> int:
    return int(os.environ.get("RESEARCH_SUPPLEMENTAL_CONCURRENCY", DEFAULT_SUPPLEMENTAL_CONCURRENCY))
