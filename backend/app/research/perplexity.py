from __future__ import annotations

import json
import os
from typing import Any

import httpx

from .models import ResearchEvidenceItem, ResearchQuery


PPLX_BASE_URL = "https://api.perplexity.ai"
DEFAULT_TIMEOUT = 45.0


class PerplexityResearchClient:
    """Small wrapper around Perplexity search/chat endpoints.

    The code accepts multiple response shapes because Perplexity offers both
    Search and Sonar chat-style APIs. We normalize everything into auditable
    evidence items with URL/title/snippet/query.
    """

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
    ):
        self.api_key = api_key or os.environ.get("PERPLEXITY_API_KEY", "")
        self.base_url = (base_url or os.environ.get("PERPLEXITY_BASE_URL") or PPLX_BASE_URL).rstrip("/")
        self.model = model or os.environ.get("PERPLEXITY_MODEL", "sonar")
        self.timeout = timeout

    @property
    def enabled(self) -> bool:
        return bool(self.api_key.strip())

    async def search(self, query: ResearchQuery, *, max_results: int = 6) -> list[ResearchEvidenceItem]:
        if not self.enabled:
            return []
        payload = {
            "query": query.query,
            "max_results": max_results,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                resp = await client.post(f"{self.base_url}/search", headers=headers, json=payload)
                if resp.status_code == 404:
                    return await self._sonar_search(client, headers, query, max_results=max_results)
                resp.raise_for_status()
                data = resp.json()
            except Exception:
                return await self._sonar_search(client, headers, query, max_results=max_results)
        return _parse_search_response(data, query)

    async def _sonar_search(
        self,
        client: httpx.AsyncClient,
        headers: dict[str, str],
        query: ResearchQuery,
        *,
        max_results: int,
    ) -> list[ResearchEvidenceItem]:
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "你是企业咨询尽调研究员。请基于实时网页搜索回答，"
                        "必须给出可核验来源。"
                    ),
                },
                {"role": "user", "content": query.query},
            ],
            "return_citations": True,
        }
        try:
            resp = await client.post(f"{self.base_url}/chat/completions", headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
        except Exception:
            return []
        return _parse_sonar_response(data, query, max_results=max_results)


def _parse_search_response(data: dict[str, Any], query: ResearchQuery) -> list[ResearchEvidenceItem]:
    raw_results = data.get("results") or data.get("web_results") or []
    if isinstance(raw_results, dict):
        raw_results = raw_results.get("results") or []
    items: list[ResearchEvidenceItem] = []
    for raw in raw_results:
        if not isinstance(raw, dict):
            continue
        url = str(raw.get("url") or raw.get("link") or "").strip()
        title = str(raw.get("title") or raw.get("name") or url).strip()
        snippet = str(raw.get("snippet") or raw.get("text") or raw.get("summary") or "").strip()
        if not url and not snippet:
            continue
        items.append(
            ResearchEvidenceItem(
                module=query.module,
                query=query.query,
                title=title,
                url=url,
                snippet=snippet,
                source_type=_source_type(url),
                credibility=_credibility_for_url(url),
                provider="perplexity",
                raw=raw,
            )
        )
    return items


def _parse_sonar_response(
    data: dict[str, Any],
    query: ResearchQuery,
    *,
    max_results: int,
) -> list[ResearchEvidenceItem]:
    choices = data.get("choices") or []
    content = ""
    if choices and isinstance(choices[0], dict):
        message = choices[0].get("message") or {}
        content = str(message.get("content") or "")

    citations = data.get("citations") or data.get("search_results") or []
    items: list[ResearchEvidenceItem] = []
    for raw in citations[:max_results]:
        if isinstance(raw, str):
            url = raw
            title = raw
            snippet = content[:600]
            raw_dict = {"url": raw}
        elif isinstance(raw, dict):
            url = str(raw.get("url") or raw.get("link") or "").strip()
            title = str(raw.get("title") or raw.get("name") or url).strip()
            snippet = str(raw.get("snippet") or raw.get("text") or content[:600]).strip()
            raw_dict = raw
        else:
            continue
        if not url and not snippet:
            continue
        items.append(
            ResearchEvidenceItem(
                module=query.module,
                query=query.query,
                title=title,
                url=url,
                snippet=snippet,
                source_type=_source_type(url),
                credibility=_credibility_for_url(url),
                provider="perplexity",
                raw=raw_dict,
            )
        )
    if not items and content:
        items.append(
            ResearchEvidenceItem(
                module=query.module,
                query=query.query,
                title="Perplexity research summary",
                url="",
                snippet=content[:900],
                source_type="web_summary",
                credibility=0.45,
                provider="perplexity",
                raw={"content": content},
            )
        )
    return items


def _source_type(url: str) -> str:
    lowered = url.lower()
    if ".gov" in lowered or "gov.cn" in lowered:
        return "policy"
    if any(x in lowered for x in ("news", "36kr", "thepaper", "caixin", "reuters", "bloomberg")):
        return "news"
    if any(x in lowered for x in ("taobao", "tmall", "jd.com", "douyin", "xiaohongshu", "meituan")):
        return "platform"
    if url:
        return "web"
    return "web_summary"


def _credibility_for_url(url: str) -> float:
    lowered = url.lower()
    if ".gov" in lowered or "gov.cn" in lowered:
        return 0.9
    if any(x in lowered for x in ("edu", "org", "reuters", "bloomberg", "caixin")):
        return 0.78
    if url:
        return 0.62
    return 0.45


def evidence_raw_json(item: ResearchEvidenceItem) -> str:
    return json.dumps(item.raw, ensure_ascii=False)
