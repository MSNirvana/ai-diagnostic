from __future__ import annotations

import asyncio
import json
import os

from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.base import LLMClient
from app.models.questionnaire import Questionnaire
from app.system_config import research_config_values

from .models import ResearchBrief, ResearchEvidenceItem, ResearchQuery
from .perplexity import PerplexityResearchClient
from .query_planner import ResearchScope, build_research_scope, plan_research_queries
from .utils import contains_any_term, infer_query_intents, overlap_terms, significant_tokens
from .store import list_job_evidence, render_evidence_for_prompt, save_research_evidence


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
    llm: LLMClient | None = None,
) -> ResearchBrief:
    scope = await build_research_scope(questionnaire, session)
    runtime_config = await research_config_values(session)
    queries = (await plan_research_queries(questionnaire, llm, session, scope=scope))[:_max_queries(runtime_config)]
    client = client or _configured_research_client(runtime_config)
    if not client.enabled or not queries:
        return ResearchBrief(queries=queries, evidence=[], summary="外部研究未启用或无可执行查询。")

    raw_evidence = await _run_queries(client, queries, runtime_config=runtime_config)
    evidence = _filter_relevant_evidence(raw_evidence, scope)
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
        summary=(
            f"完成 {len(queries)} 个研究问题，原始命中 {len(raw_evidence)} 条，"
            f"保留 {len(evidence)} 条强相关外部证据。"
        ),
    )


async def gather_pre_research_evidence(
    session: AsyncSession,
    questionnaire: Questionnaire,
    *,
    job_id: str,
    project_id: str | None,
    llm: LLMClient | None = None,
) -> list[dict]:
    """快速诊断用：best-effort 跑外部预研，返回可喂进 prompt 的证据。

    无 PERPLEXITY_API_KEY / 无核心问题 / 任何失败 → 返回 []，诊断照常进行（不阻断）。
    证据按 job_id + project_id 落库，出 record 后可 attach 到记录作为来源留痕。
    """
    try:
        scope = await build_research_scope(questionnaire, session)
        await run_system_pre_research(
            session,
            job_id=job_id,
            project_id=project_id,
            questionnaire=questionnaire,
            llm=llm,
        )
        rows = await list_job_evidence(session, job_id, limit=120)
        return render_evidence_for_prompt(_filter_rows_by_scope(rows, scope))
    except Exception:  # noqa: BLE001 — 外部研究不可用绝不阻断诊断
        return []


async def _run_queries(
    client: PerplexityResearchClient,
    queries: list[ResearchQuery],
    *,
    runtime_config: dict[str, str] | None = None,
) -> list[ResearchEvidenceItem]:
    config = runtime_config or {}
    semaphore = asyncio.Semaphore(_concurrency(config))
    max_results = _results_per_query(config)

    async def one(query: ResearchQuery) -> list[ResearchEvidenceItem]:
        async with semaphore:
            return await client.search(query, max_results=max_results)

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


def _filter_relevant_evidence(items: list[ResearchEvidenceItem], scope: ResearchScope) -> list[ResearchEvidenceItem]:
    if not items:
        return []
    direct: list[ResearchEvidenceItem] = []
    contextual: list[ResearchEvidenceItem] = []
    for item in items:
        score, bucket, reason = _assess_evidence(item, scope)
        if bucket == "off_topic":
            continue
        annotated = item.model_copy(
            update={
                "raw": {
                    **(item.raw or {}),
                    "relevance_score": score,
                    "relevance_bucket": bucket,
                    "relevance_reason": reason,
                }
            }
        )
        if bucket == "project_direct":
            direct.append(annotated)
        else:
            contextual.append(annotated)
    direct = _sort_evidence_by_relevance(direct)
    contextual = _sort_evidence_by_relevance(contextual)
    if direct:
        return direct[:10] + contextual[: max(0, 8 - min(len(direct), 8))]
    return contextual[:8]


def _filter_rows_by_scope(rows, scope: ResearchScope):
    filtered = [row for row in rows if _row_relevance_score(row, scope) >= 5]
    return filtered


def _evidence_relevance_score(item: ResearchEvidenceItem, scope: ResearchScope) -> int:
    score, _bucket, _reason = _assess_evidence(item, scope)
    return score


def _row_relevance_score(row, scope: ResearchScope) -> int:
    score, _bucket, _reason = _assess_row(row, scope)
    return score


def _assess_evidence(item: ResearchEvidenceItem, scope: ResearchScope) -> tuple[int, str, str]:
    haystack = " ".join([item.title, item.snippet, item.url, item.module])
    query_text = item.query or ""
    intents = infer_query_intents(query_text)
    query_terms = significant_tokens(query_text)
    entity_hits = overlap_terms(haystack, scope.entity_terms[:6])
    business_hits = overlap_terms(haystack, scope.business_terms[:6] or scope.anchor_terms[:6])
    problem_hits = overlap_terms(haystack, scope.problem_terms[:4])
    module_hits = overlap_terms(haystack, _module_terms(item.module))
    query_hits = overlap_terms(haystack, query_terms[:8])
    expects_entity = contains_any_term(query_text, scope.entity_terms[:6]) and not (intents & {"benchmark", "policy", "competition"})

    score = 0
    if entity_hits:
        score += 5
    if business_hits:
        score += 3
    if problem_hits:
        score += 2
    if module_hits:
        score += 2
    score += min(len(query_hits), 3) * 2
    if item.source_type in {"policy", "platform"}:
        score += 1
    if expects_entity and not entity_hits:
        score -= 4
    if not query_hits:
        score -= 4
    if not (entity_hits or business_hits or problem_hits or module_hits):
        score -= 6

    if entity_hits and (business_hits or problem_hits or len(query_hits) >= 2):
        bucket = "project_direct"
    elif "policy" in intents and (business_hits or problem_hits) and (module_hits or len(query_hits) >= 2):
        bucket = "policy_context"
    elif "reputation" in intents and (entity_hits or business_hits):
        bucket = "reputation_context"
    elif business_hits and (problem_hits or module_hits or len(query_hits) >= 2):
        bucket = "industry_context"
    else:
        bucket = "off_topic"

    if bucket == "off_topic" and score >= 5 and (business_hits or module_hits):
        bucket = "industry_context"
    reason_parts = []
    if entity_hits:
        reason_parts.append(f"命中项目实体：{' / '.join(entity_hits[:2])}")
    if business_hits:
        reason_parts.append(f"命中业务锚点：{' / '.join(business_hits[:2])}")
    if problem_hits:
        reason_parts.append(f"命中问题焦点：{' / '.join(problem_hits[:2])}")
    if module_hits:
        reason_parts.append(f"命中领域主题：{' / '.join(module_hits[:2])}")
    if not reason_parts:
        reason_parts.append("未命中足够的项目/问题锚点")
    return score, bucket, "；".join(reason_parts)


def _assess_row(row, scope: ResearchScope) -> tuple[int, str, str]:
    item = ResearchEvidenceItem(
        module=getattr(row, "module", ""),
        query=getattr(row, "query", ""),
        title=getattr(row, "title", ""),
        url=getattr(row, "url", ""),
        snippet=getattr(row, "snippet", ""),
        source_type=getattr(row, "source_type", "web"),
        credibility=float(getattr(row, "credibility", 0.5) or 0.5),
        provider=getattr(row, "provider", ""),
        raw=_raw_for_row(row),
    )
    return _assess_evidence(item, scope)


def _sort_evidence_by_relevance(items: list[ResearchEvidenceItem]) -> list[ResearchEvidenceItem]:
    return sorted(
        items,
        key=lambda item: (
            float((item.raw or {}).get("relevance_score", 0)),
            item.credibility,
        ),
        reverse=True,
    )


def _module_terms(module: str) -> tuple[str, ...]:
    return {
        "market": ("招商", "客户", "口碑", "竞品"),
        "sales": ("转化", "线索", "成交", "回款"),
        "product": ("产品", "服务", "体验", "评价"),
        "ops": ("交付", "供应链", "产能", "库存"),
        "org": ("组织", "团队", "人效", "激励"),
        "finance": ("毛利", "现金流", "回本周期", "利润"),
        "legal_compliance": ("资质", "合规", "广告法", "合同"),
        "tax": ("发票", "税务", "申报", "抵扣"),
        "policy": ("政策", "补贴", "监管", "准入"),
        "ip": ("商标", "专利", "知识产权", "侵权"),
        "supply_chain": ("供应商", "交付", "库存", "成本"),
        "channel_franchise": ("加盟", "招商", "单店模型", "回本周期"),
        "data_systems": ("CRM", "ERP", "看板", "指标口径"),
    }.get(module, ())


def _normalize(value: str) -> str:
    return "".join(str(value).split()).lower()


def _raw_for_row(row) -> dict:
    raw_json = getattr(row, "raw_json", "") or ""
    if not raw_json:
        return {}
    try:
        payload = json.loads(raw_json)
    except Exception:  # noqa: BLE001
        return {}
    return payload if isinstance(payload, dict) else {}


def _configured_research_client(values: dict[str, str]) -> PerplexityResearchClient:
    return PerplexityResearchClient(
        api_key=values.get("PERPLEXITY_API_KEY") or None,
        base_url=values.get("PERPLEXITY_BASE_URL") or None,
        model=values.get("PERPLEXITY_MODEL") or None,
    )


def _config_int(values: dict[str, str], key: str, default: int) -> int:
    raw = values.get(key) or os.environ.get(key) or str(default)
    try:
        return max(1, int(raw))
    except (TypeError, ValueError):
        return default


def _max_queries(values: dict[str, str] | None = None) -> int:
    return _config_int(values or {}, "RESEARCH_MAX_QUERIES", DEFAULT_MAX_QUERIES)


def _results_per_query(values: dict[str, str] | None = None) -> int:
    return _config_int(values or {}, "RESEARCH_RESULTS_PER_QUERY", DEFAULT_RESULTS_PER_QUERY)


def _concurrency(values: dict[str, str] | None = None) -> int:
    return _config_int(values or {}, "RESEARCH_CONCURRENCY", DEFAULT_CONCURRENCY)
