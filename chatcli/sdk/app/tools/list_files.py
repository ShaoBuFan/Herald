"""list_files 工具：列出项目内的文件与目录。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from sdk.agent_sdk import Tool

from ._shared import safe_path, walk

PARAMETERS = {
    "type": "object",
    "properties": {
        "path": {"type": "string", "description": "相对项目根目录的起始路径，默认 ."},
        "pattern": {"type": "string", "description": "文件名通配符，默认 *"},
        "recursive": {"type": "boolean", "description": "是否递归子目录，默认 true"},
        "limit": {"type": "integer", "description": "最多返回条目数，默认 200"},
    },
}


def list_files(root: Path, args: dict[str, Any]):
    base = safe_path(root, args.get("path") or ".")
    if not base.exists():
        return {"error": "Path does not exist"}
    pattern = args.get("pattern") or "*"
    recursive = args.get("recursive", True)
    recursive = recursive if isinstance(recursive, bool) else str(recursive).lower() == "true"
    limit = int(args.get("limit", 200))
    files, directories = [], []
    for path in walk(base, recursive, pattern):
        if len(files) + len(directories) >= limit:
            break
        relative = str(path.relative_to(root))
        (directories if path.is_dir() else files).append(relative)
    return {"files": files, "directories": directories, "file_count": len(files), "directory_count": len(directories), "truncated": len(files) + len(directories) >= limit}


def build(root: Path) -> Tool:
    return Tool(
        "list_files",
        "列出项目内的文件与目录，用于了解项目结构。",
        PARAMETERS,
        lambda args: list_files(root, args),
    )
