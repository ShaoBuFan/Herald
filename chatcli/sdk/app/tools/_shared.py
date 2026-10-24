"""包内共享的路径围栏与遍历助手。"""

from __future__ import annotations

import fnmatch
import os
from pathlib import Path

IGNORED = {".git", "__pycache__", ".venv", "venv", "node_modules", "dist", "build", ".idea", ".vscode"}


def safe_path(root: Path, relative: str) -> Path:
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError(f"Path escapes project root: {relative}") from exc
    return candidate


def walk(base: Path, recursive: bool, pattern: str):
    if base.is_file():
        if fnmatch.fnmatchcase(base.name, pattern):
            yield base
        return
    for current, dirs, files in os.walk(base):
        dirs[:] = [name for name in dirs if name not in IGNORED]
        current_path = Path(current)
        for name in dirs + files:
            path = current_path / name
            if fnmatch.fnmatchcase(path.name, pattern):
                yield path
        if not recursive:
            break
