"""Provider-aware base URL normalization for SDK clients."""


def normalize_anthropic_base_url(base_url: str | None) -> str | None:
    """Anthropic SDK appends /v1/messages, so gateway roots must not end in /v1."""
    cleaned = _clean(base_url)
    if not cleaned:
        return None
    return _strip_trailing_v1(cleaned)


def normalize_openai_base_url(base_url: str | None) -> str | None:
    """OpenAI SDK expects the configured base URL to include /v1."""
    cleaned = _clean(base_url)
    if not cleaned:
        return None
    if _ends_with_v1(cleaned):
        return cleaned
    return f"{cleaned}/v1"


def _clean(base_url: str | None) -> str:
    return (base_url or "").strip().rstrip("/")


def _ends_with_v1(url: str) -> bool:
    return url.rstrip("/").lower().endswith("/v1")


def _strip_trailing_v1(url: str) -> str:
    return url[:-3].rstrip("/") if _ends_with_v1(url) else url
