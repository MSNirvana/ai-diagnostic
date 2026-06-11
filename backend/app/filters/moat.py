import re
from app.models.result import ModuleResult

BANNED_TERMS = [
    "假设", "敏感性分析", "框架", "方法论", "波特五力",
    "BCG", "MECE", "金字塔原理", "建模", "指标体检",
]

_PATTERN = re.compile("|".join(re.escape(t) for t in BANNED_TERMS))


def _scrub(text: str) -> str:
    parts = re.split(r"[，。；]", text)
    kept = [p for p in parts if p and not _PATTERN.search(p)]
    return "，".join(kept) if kept else text


def scrub_method_language(result: ModuleResult) -> ModuleResult:
    """离开后端前最后一道过滤：清洗面向老板的文案，不动事实数据。"""
    return result.model_copy(update={
        "conclusion": _scrub(result.conclusion),
        "actions": [_scrub(a) for a in result.actions],
    })
