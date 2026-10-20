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

    common = {"type": "object", "properties": {"path": {"type": "string"}}}
    registry = ToolRegistry()
    registry.register(Tool("list_files", "列出项目文件", common, list_files))
    registry.register(Tool("read_file", "读取文本文件", common, read_file))
    registry.register(Tool("search_text", "搜索文本", common, search_text))
    registry.register(Tool("write_file", "写入文本文件", common, write_file))
    return registry
