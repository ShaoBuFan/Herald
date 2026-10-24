"""search_text 工具：在项目内文本文件中按关键字搜索。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from sdk.agent_sdk import Tool

from ._shared import safe_path, walk

PARAMETERS = {
    "type": "object",
    "properties": {
        "keyword": {"type": "string", "description": "要搜索的文本关键字"},
        "path": {"type": "string", "description": "相对项目根目录的起始路径，默认 ."},
        "limit": {"type": "integer", "description": "最多返回的匹配行数，默认 100"},
    },
    "required": ["keyword"],
}


def search_text(root: Path, args: dict[str, Any]):
    keyword = str(args["keyword"])
    base = safe_path(root, args.get("path") or ".")
    results = []
    for path in walk(base, True, "*"):
        if not path.is_file() or len(results) >= int(args.get("limit", 100)):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        for line_no, line in enumerate(text.splitlines(), 1):
            if keyword in line:
                results.append({"path": str(path.relative_to(root)), "line": line_no, "text": line.strip()})
                if len(results) >= int(args.get("limit", 100)):
                    break
    return {"results": results, "truncated": len(results) >= int(args.get("limit", 100))}


def build(root: Path) -> Tool:
    return Tool(
        "search_text",
        "在项目内文本文件中按关键字搜索，返回匹配行。",
        PARAMETERS,
        lambda args: search_text(root, args),
    )
