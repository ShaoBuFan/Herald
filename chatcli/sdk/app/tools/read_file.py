"""read_file 工具：读取项目内文本文件的内容。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from sdk.agent_sdk import Tool

from ._shared import safe_path

PARAMETERS = {
    "type": "object",
    "properties": {
        "path": {"type": "string", "description": "相对项目根目录的文件路径"},
        "max_bytes": {
            "type": "integer",
            "description": "最多读取的字节数，默认 100000",
        },
    },
    "required": ["path"],
}


def read_file(root: Path, args: dict[str, Any]):
    path = safe_path(root, args["path"])
    if not path.is_file():
        return {"error": "File does not exist"}
    max_bytes = int(args.get("max_bytes", 100000))
    data = path.read_bytes()
    truncated = len(data) > max_bytes
    return {"path": str(path.relative_to(root)), "content": data[:max_bytes].decode("utf-8", errors="replace"), "truncated": truncated}


def build(root: Path) -> Tool:
    return Tool(
        "read_file",
        "读取项目内文本文件的内容。查看源码或文档时使用。",
        PARAMETERS,
        lambda args: read_file(root, args),
    )
