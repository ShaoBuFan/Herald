"""write_file 工具：写入或覆盖项目内的文本文件。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from sdk.agent_sdk import Tool

from ._shared import safe_path

PARAMETERS = {
    "type": "object",
    "properties": {
        "path": {"type": "string", "description": "相对项目根目录的文件路径"},
        "content": {"type": "string", "description": "要写入的完整文本内容"},
        "overwrite": {
            "type": "boolean",
            "description": "文件已存在时是否覆盖，默认 false",
        },
    },
    "required": ["path", "content"],
}


def write_file(root: Path, args: dict[str, Any]):
    path = safe_path(root, args["path"])
    if path.exists() and not args.get("overwrite", False):
        return {"status": False, "error": "File already exists; set overwrite=true"}
    content = args.get("content")
    if not isinstance(content, str):
        raise ValueError("content must be a string")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return {"status": True, "path": str(path.relative_to(root)), "bytes_written": len(content.encode())}


def build(root: Path) -> Tool:
    return Tool(
        "write_file",
        "写入或覆盖项目内的文本文件。只在确实需要修改文件时使用。",
        PARAMETERS,
        lambda args: write_file(root, args),
    )
