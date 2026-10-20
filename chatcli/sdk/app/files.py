from __future__ import annotations

import fnmatch
import os
from pathlib import Path
from typing import Any

from sdk.agent_sdk import Tool, ToolRegistry

IGNORED = {".git", "__pycache__", ".venv", "venv", "node_modules", "dist", "build", ".idea", ".vscode"}


def _safe_path(root: Path, relative: str) -> Path:
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError(f"Path escapes project root: {relative}") from exc
    return candidate


def _paths(base: Path, recursive: bool, pattern: str):
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


def create_file_tools(root: Path) -> ToolRegistry:
    def list_files(args: dict[str, Any]):
        base = _safe_path(root, args.get("path") or ".")
        if not base.exists():
            return {"error": "Path does not exist"}
        pattern = args.get("pattern") or "*"
        recursive = args.get("recursive", True)
        recursive = recursive if isinstance(recursive, bool) else str(recursive).lower() == "true"
        limit = int(args.get("limit", 200))
        files, directories = [], []
        for path in _paths(base, recursive, pattern):
            if len(files) + len(directories) >= limit:
                break
            relative = str(path.relative_to(root))
            (directories if path.is_dir() else files).append(relative)
        return {"files": files, "directories": directories, "file_count": len(files), "directory_count": len(directories), "truncated": len(files) + len(directories) >= limit}

    def read_file(args: dict[str, Any]):
        path = _safe_path(root, args["path"])
        if not path.is_file():
            return {"error": "File does not exist"}
        max_bytes = int(args.get("max_bytes", 100000))
        data = path.read_bytes()
        truncated = len(data) > max_bytes
        return {"path": str(path.relative_to(root)), "content": data[:max_bytes].decode("utf-8", errors="replace"), "truncated": truncated}

    def search_text(args: dict[str, Any]):
        keyword = str(args["keyword"])
        base = _safe_path(root, args.get("path") or ".")
        results = []
        for path in _paths(base, True, "*"):
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

    def write_file(args: dict[str, Any]):
        path = _safe_path(root, args["path"])
        if path.exists() and not args.get("overwrite", False):
            return {"status": False, "error": "File already exists; set overwrite=true"}
        content = args.get("content")
        if not isinstance(content, str):
            raise ValueError("content must be a string")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return {"status": True, "path": str(path.relative_to(root)), "bytes_written": len(content.encode())}

    list_files_parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "相对项目根目录的起始路径，默认 ."},
            "pattern": {"type": "string", "description": "文件名通配符，默认 *"},
            "recursive": {"type": "boolean", "description": "是否递归子目录，默认 true"},
            "limit": {"type": "integer", "description": "最多返回条目数，默认 200"},
        },
    }
    read_file_parameters = {
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
    search_text_parameters = {
        "type": "object",
        "properties": {
            "keyword": {"type": "string", "description": "要搜索的文本关键字"},
            "path": {"type": "string", "description": "相对项目根目录的起始路径，默认 ."},
            "limit": {"type": "integer", "description": "最多返回的匹配行数，默认 100"},
        },
        "required": ["keyword"],
    }
    write_file_parameters = {
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

    registry = ToolRegistry()
    registry.register(
        Tool(
            "list_files",
            "列出项目内的文件与目录，用于了解项目结构。",
            list_files_parameters,
            list_files,
        )
    )
    registry.register(
        Tool(
            "read_file",
            "读取项目内文本文件的内容。查看源码或文档时使用。",
            read_file_parameters,
            read_file,
        )
    )
    registry.register(
        Tool(
            "search_text",
            "在项目内文本文件中按关键字搜索，返回匹配行。",
            search_text_parameters,
            search_text,
        )
    )
    registry.register(
        Tool(
            "write_file",
            "写入或覆盖项目内的文本文件。只在确实需要修改文件时使用。",
            write_file_parameters,
            write_file,
        )
    )
    return registry
