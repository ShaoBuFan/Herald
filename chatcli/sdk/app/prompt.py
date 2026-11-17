"""可组合的 prompt section 注册表。

Prompt 由若干 section 拼成：system、工具目录、协议、示例……每个 section
有稳定的名字、排序号和可选的启用条件。适配器只负责把渲染结果作为
system 内容发送；新增或替换 prompt 片段不需要改适配器。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class PromptContext:
    """一次 prompt 渲染需要的输入。"""

    system: str = ""
    tools: list[dict[str, Any]] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def has_tools(self) -> bool:
        return bool(self.tools)


PromptRenderer = Callable[[PromptContext], str]
PromptCondition = Callable[[PromptContext], bool]


def _always_enabled(context: PromptContext) -> bool:
    return True


@dataclass(frozen=True)
class PromptSection:
    """一个可注册的 prompt 片段。"""

    name: str
    render: PromptRenderer
    order: int = 100
    enabled: PromptCondition = _always_enabled

    def __post_init__(self) -> None:
        if not self.name or not self.name.strip():
            raise ValueError("prompt section name must not be empty")
        if not callable(self.render):
            raise TypeError("prompt section render must be callable")
        if not callable(self.enabled):
            raise TypeError("prompt section enabled must be callable")


@dataclass(frozen=True)
class PromptPlugin:
    """一组一起注册的 section。"""

    name: str
    sections: tuple[PromptSection, ...]

    def __post_init__(self) -> None:
        if not self.name or not self.name.strip():
            raise ValueError("prompt plugin name must not be empty")
        if not self.sections:
            raise ValueError("prompt plugin must contain at least one section")


class PromptRegistry:
    """按 order 组合 prompt section 的注册表。"""

    def __init__(self, sections: tuple[PromptSection, ...] = ()) -> None:
        self._sections: dict[str, PromptSection] = {}
        for section in sections:
            self.register(section)

    def register(self, section: PromptSection, *, replace: bool = False) -> None:
        if section.name in self._sections and not replace:
            raise ValueError(
                f"prompt section already registered: {section.name}"
            )
        self._sections[section.name] = section

    def register_plugin(
        self, plugin: PromptPlugin, *, replace: bool = False
    ) -> None:
        names = [section.name for section in plugin.sections]
        if len(names) != len(set(names)):
            raise ValueError(
                f"prompt plugin has duplicate sections: {plugin.name}"
            )
        conflicts = [name for name in names if name in self._sections]
        if conflicts and not replace:
            raise ValueError(
                "prompt plugin conflicts with existing sections: "
                + ", ".join(conflicts)
            )
        for section in plugin.sections:
            self.register(section, replace=replace)

    def unregister(self, name: str) -> None:
        self._sections.pop(name, None)

    def sections(self) -> tuple[PromptSection, ...]:
        return tuple(
            sorted(
                self._sections.values(),
                key=lambda section: (section.order, section.name),
            )
        )

    def render(self, context: PromptContext, *, separator: str = "\n\n") -> str:
        parts: list[str] = []
        for section in self.sections():
            if not section.enabled(context):
                continue
            text = section.render(context).strip()
            if text:
                parts.append(text)
        return separator.join(parts)
