"""Agent 工具：模型可调用的宿主工具集，每工具一个文件。"""

from __future__ import annotations

from pathlib import Path

from sdk.agent_sdk import ToolRegistry

from .list_files import build as build_list_files
from .read_file import build as build_read_file
from .search_text import build as build_search_text
from .write_file import build as build_write_file


def create_file_tools(root: Path) -> ToolRegistry:
    """装配文件工具集。"""
    registry = ToolRegistry()
    for build in (
        build_list_files,
        build_read_file,
        build_search_text,
        build_write_file,
    ):
        registry.register(build(root))
    return registry
