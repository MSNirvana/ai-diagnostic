"""列出 configs/ 下所有 skill 的状态：approved（已人审上线）/ draft（草稿）。

供 /factory-batch 幂等去重用，也可手动跑看清当前 skill 库状态：
  python -m app.skills.skill_status
"""
from __future__ import annotations

import json
from pathlib import Path

from app.skills.config_loader import CONFIGS_DIR, list_config_keys

REVIEW_DIR = CONFIGS_DIR / "_review"


def skill_status(key: str) -> str:
    """返回 approved | draft。_review/<key>.json 里 review_status==approved 才算上线。"""
    review_path = REVIEW_DIR / f"{key}.json"
    if not review_path.exists():
        return "draft"
    try:
        data = json.loads(review_path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return "draft"
    return "approved" if data.get("review_status") == "approved" else "draft"


def all_status() -> dict[str, str]:
    return {key: skill_status(key) for key in list_config_keys()}


def main() -> None:
    statuses = all_status()
    approved = [k for k, s in statuses.items() if s == "approved"]
    draft = [k for k, s in statuses.items() if s == "draft"]
    print(f"已上线(approved) {len(approved)} 个：{approved}")
    print(f"草稿(draft) {len(draft)} 个：{draft}")
    print("\n/factory-batch 默认会跳过 approved，draft 需 --force 才重造。")


if __name__ == "__main__":
    main()
