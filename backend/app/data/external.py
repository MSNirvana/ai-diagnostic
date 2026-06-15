async def fetch_industry_benchmark(
    module: str,
    keywords: list[str],
    *,
    scenario_key: str = "",
    scenario_label: str = "",
    evidence_lens: list[str] | None = None,
) -> dict:
    """抓外部行业基准/竞品数据。第一版返回桩数据，后续接真实数据源。"""
    return {
        "module": module,
        "keywords": keywords,
        "scenario_key": scenario_key,
        "scenario_label": scenario_label,
        "evidence_lens": evidence_lens or [],
        "benchmark": {"note": "external benchmark placeholder"},
    }
