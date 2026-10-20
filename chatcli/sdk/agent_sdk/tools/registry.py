from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Callable

from ..errors import ToolExecutionError


@dataclass(frozen=True)
class Tool:
    """A host-provided tool that can be invoked by the agent."""

    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[[dict[str, Any]], Any]

    def __post_init__(self) -> None:
        if not self.name or not self.name.strip():
            raise ValueError("tool name must not be empty")
        if not callable(self.handler):
            raise TypeError("tool handler must be callable")

    def schema(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": deepcopy(self.parameters),
        }


class ToolRegistry:
    """Registry and execution boundary for model-requested tools."""

    def __init__(self, tools: list[Tool] | None = None):
        self._tools: dict[str, Tool] = {}
        for tool in tools or []:
            self.register(tool)

    def register(self, tool: Tool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"tool already registered: {tool.name}")
        self._tools[tool.name] = tool

    def unregister(self, name: str) -> None:
        self._tools.pop(name, None)

    def get(self, name: str) -> Tool:
        try:
            return self._tools[name]
        except KeyError as exc:
            raise ToolExecutionError(f"unknown tool: {name}") from exc

    def list_tools(self) -> list[dict[str, Any]]:
        return [tool.schema() for tool in self._tools.values()]

    def execute(self, name: str, arguments: dict[str, Any]) -> Any:
        if not isinstance(arguments, dict):
            raise ToolExecutionError("tool arguments must be an object")

        tool = self.get(name)
        try:
            return tool.handler(arguments)
        except ToolExecutionError:
            raise
        except Exception as exc:
            raise ToolExecutionError(
                f"tool execution failed for {name}: {exc}"
            ) from exc
