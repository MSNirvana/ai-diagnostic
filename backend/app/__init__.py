"""Application package bootstrap."""
from __future__ import annotations

import os
from pathlib import Path


def _load_local_env() -> None:
    """Load backend/.env for local development without overriding real env vars.

    The app previously read only process environment variables. That made local
    research credentials easy to miss: uvicorn could start successfully while
    Perplexity stayed disabled. Keep this tiny loader dependency-free so the
    existing runtime does not need python-dotenv.
    """
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_local_env()
