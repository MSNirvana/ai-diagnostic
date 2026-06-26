from __future__ import annotations

import re
from collections.abc import Iterable


TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._/\-]{1,}|[\u4e00-\u9fff]{2,}")
PARENS_RE = re.compile(r"[（(【\[].*?[】\])）]")

NOISE_TOKENS = {
    "行业",
    "市场",
    "公司",
    "企业",
    "项目",
    "情况",
    "问题",
    "资料",
    "信息",
    "公开",
    "公开信息",
    "官网",
    "官方",
    "数据",
    "中国",
    "国内",
    "全球",
}

BENCHMARK_TERMS = ("行业基准", "行业趋势", "市场规模", "行业报告", "benchmark", "trend")
POLICY_TERMS = ("政策", "监管", "处罚", "通报", "准入", "合规", "资质", "法规", "policy", "regulation")
REPUTATION_TERMS = ("口碑", "评价", "投诉", "review", "reviews", "rating")
COMPETITION_TERMS = ("竞品", "对标", "可比案例", "案例", "competitor", "comparison")
OFFICIAL_TERMS = ("官网", "官方", "产品页", "招商页", "official", "website")


def normalize_text(value: str) -> str:
    return re.sub(r"[\s\u3000]+", "", str(value)).lower()


def clean_text(value: str) -> str:
    return " ".join(str(value).split()).strip()


def term_variants(value: str) -> list[str]:
    clean = clean_text(value)
    if not clean:
        return []
    variants = [clean]
    stripped = clean_text(PARENS_RE.sub("", clean)).strip("-_/|")
    if stripped and stripped not in variants:
        variants.append(stripped)
    for part in re.split(r"[、/|,，;；]+", stripped):
        chunk = clean_text(part)
        if chunk and chunk not in variants:
            variants.append(chunk)
    return variants


def significant_tokens(text: str) -> list[str]:
    tokens: list[str] = []
    seen: set[str] = set()
    for raw in TOKEN_RE.findall(str(text)):
        token = normalize_text(raw)
        if len(token) < 2 or token in NOISE_TOKENS or token in seen:
            continue
        seen.add(token)
        tokens.append(token)
    return tokens


def contains_term(text: str, term: str) -> bool:
    haystack = normalize_text(text)
    return any(normalize_text(candidate) in haystack for candidate in term_variants(term))


def contains_any_term(text: str, terms: Iterable[str]) -> bool:
    haystack = normalize_text(text)
    for term in terms:
        for candidate in term_variants(term):
            normalized = normalize_text(candidate)
            if normalized and normalized in haystack:
                return True
    return False


def overlap_terms(text: str, terms: Iterable[str]) -> list[str]:
    matched: list[str] = []
    seen: set[str] = set()
    haystack = normalize_text(text)
    for term in terms:
        for candidate in term_variants(term):
            normalized = normalize_text(candidate)
            if not normalized or normalized in seen:
                continue
            if normalized in haystack:
                seen.add(normalized)
                matched.append(candidate)
                break
    return matched


def infer_query_intents(query: str) -> set[str]:
    normalized = normalize_text(query)
    intents: set[str] = set()
    if any(term in normalized for term in map(normalize_text, BENCHMARK_TERMS)):
        intents.add("benchmark")
    if any(term in normalized for term in map(normalize_text, POLICY_TERMS)):
        intents.add("policy")
    if any(term in normalized for term in map(normalize_text, REPUTATION_TERMS)):
        intents.add("reputation")
    if any(term in normalized for term in map(normalize_text, COMPETITION_TERMS)):
        intents.add("competition")
    if any(term in normalized for term in map(normalize_text, OFFICIAL_TERMS)):
        intents.add("official")
    return intents or {"general"}


def is_short_latin_term(term: str) -> bool:
    clean = clean_text(term)
    return bool(clean) and bool(re.fullmatch(r"[A-Za-z0-9._\-]{2,8}", clean))


def merge_query_parts(parts: Iterable[str], *, max_len: int = 180) -> str:
    unique: list[str] = []
    seen: set[str] = set()
    for part in parts:
        clean = clean_text(part)
        normalized = normalize_text(clean)
        if not clean or not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique.append(clean)
    while len(" ".join(unique)) > max_len and len(unique) > 1:
        unique.pop()
    text = " ".join(unique)
    return text[:max_len] if len(text) > max_len else text
