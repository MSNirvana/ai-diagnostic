"""从 configs/ 目录加载 skill 配置 —— Loop 1 产出的 skill 落地为可执行 ExpertConfig。

配置格式（纯 stdlib，无需 yaml）：
  configs/<key>.json          元数据（module/method/label/data_requirements/...）
  configs/<key>.prompt.md     system_prompt 正文（多行可读）

这样起草 agent 产出的 skill 不用改任何 Python 代码即可进 registry，
真正实现"Loop 跑出来的 skill 直接上线"。
"""
from __future__ import annotations

import json
from pathlib import Path

from app.skills.configured import DataRequirement, ExpertConfig

CONFIGS_DIR = Path(__file__).parent / "configs"


def _load_prompt(key: str, inline: str | None) -> str:
    """优先读 <key>.prompt.md，没有则用 json 里的 inline 字段。"""
    prompt_path = CONFIGS_DIR / f"{key}.prompt.md"
    if prompt_path.exists():
        return prompt_path.read_text(encoding="utf-8").strip()
    return (inline or "").strip()


def load_config(key: str) -> ExpertConfig:
    """加载单个 skill 配置为 ExpertConfig。"""
    meta_path = CONFIGS_DIR / f"{key}.json"
    if not meta_path.exists():
        raise FileNotFoundError(f"skill config not found: {meta_path}")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))

    requirements = tuple(
        DataRequirement(
            key=req["key"],
            label=req["label"],
            reason=req.get("reason", ""),
            source_hint=req.get("source_hint", ""),
            keywords=tuple(req.get("keywords", ())),
            required=req.get("required", True),
        )
        for req in meta.get("data_requirements", [])
    )

    return ExpertConfig(
        module=meta["module"],
        method=meta.get("method", "configured-evidence"),
        label=meta.get("label", meta["module"]),
        fallback_prompt=_load_prompt(meta["module"], meta.get("system_prompt")),
        data_requirements=requirements,
        scenarios=tuple(meta.get("scenarios", ())),
        industry_kpis=tuple(meta.get("industry_kpis", ())),
        judgment_hints=tuple(meta.get("judgment_hints", ())),
    )


def load_config_meta(key: str) -> dict:
    """加载原始 json 元数据（含 industry_kpis 等评测用字段）。"""
    meta_path = CONFIGS_DIR / f"{key}.json"
    return json.loads(meta_path.read_text(encoding="utf-8"))


def list_config_keys() -> list[str]:
    """列出 configs/ 下所有 skill key（按 .json 文件名，排除 _ 开头的工作目录）。"""
    if not CONFIGS_DIR.exists():
        return []
    return sorted(
        p.stem
        for p in CONFIGS_DIR.glob("*.json")
        if not p.stem.startswith("_")
    )
