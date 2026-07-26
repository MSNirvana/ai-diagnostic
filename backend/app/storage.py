"""Filesystem helpers for assets stored by the standalone image service."""
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def resolve_storage_path(stored_path: str | Path) -> Path:
    """Resolve both legacy relative paths and paths created by new workers."""
    path = Path(stored_path)
    if path.is_absolute():
        return path
    working_directory_path = Path.cwd() / path
    if working_directory_path.exists():
        return working_directory_path
    return BACKEND_ROOT / path


def image_asset_root() -> Path:
    return BACKEND_ROOT / "data" / "image-assets"
