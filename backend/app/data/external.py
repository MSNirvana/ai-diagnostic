async def fetch_industry_benchmark(module: str, keywords: list[str]) -> dict:
    """抓外部行业基准/竞品数据。第一版返回桩数据，后续接真实数据源。"""
    return {
        "module": module,
        "keywords": keywords,
        "benchmark": {"note": "external benchmark placeholder"},
    }
