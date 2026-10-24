from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from sdk.agent_sdk import InMemoryMessageStore


SCHEMA_VERSION = 2


def _as_text(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _try_json(value: Any) -> Any:
    if not isinstance(value, str):
        return None
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


def _migrate_history(history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert legacy text-protocol messages into the semantic transcript."""
    migrated: list[dict[str, Any]] = []
    for message in history:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        content = message.get("content", "")
        if role == "system":
            continue
        if role == "user":
            payload = _try_json(content)
            if isinstance(payload, dict) and payload.get("type") == "tool_result":
                for item in payload.get("results", []):
                    if not isinstance(item, dict):
                        continue
                    migrated.append(
                        {
                            "role": "tool",
                            "tool_call_id": str(item.get("id", "")),
                            "name": str(item.get("tool", "")),
                            "data": item.get("data"),
                            "error": item.get("error"),
                        }
                    )
                continue
            migrated.append({"role": "user", "content": _as_text(content)})
        elif role == "assistant":
            payload = _try_json(content)
            if isinstance(payload, dict) and (
                "final" in payload or "tool_calls" in payload
            ):
                thought = str(payload.get("thought", "") or "")
                if "tool_calls" in payload:
                    calls = []
                    for index, call in enumerate(payload.get("tool_calls") or []):
                        if not isinstance(call, dict):
                            continue
                        calls.append(
                            {
                                "id": str(call.get("id", index)),
                                "name": str(call.get("tool", "")),
                                "arguments": call.get("arguments") or {},
                            }
                        )
                    migrated.append(
                        {
                            "role": "assistant",
                            "content": "",
                            "thought": thought,
                            "tool_calls": calls,
                        }
                    )
                else:
                    migrated.append(
                        {
                            "role": "assistant",
                            "content": str(payload.get("final", "")),
                            "thought": thought,
                            "tool_calls": [],
                        }
                    )
            else:
                migrated.append(
                    {
                        "role": "assistant",
                        "content": _as_text(content),
                        "thought": "",
                        "tool_calls": [],
                        "raw": True,
                    }
                )
        elif role == "tool":
            migrated.append(message)
    return migrated


class SessionStore(InMemoryMessageStore):
    def __init__(self, directory: Path):
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        self.current_file: Path | None = None
        self.title = "未命名"
        super().__init__()

    def clear(self) -> None:
        self.current_file = None
        self.title = "未命名"
        self.replace_messages([])

    def save(self, title: str | None = None) -> Path:
        if title:
            self.title = title
        if self.current_file is None:
            safe_title = self.title.replace(" ", "_").replace("/", "_")
            self.current_file = (
                self.directory
                / f"conversation_{int(time.time())}_{safe_title}.json"
            )
        payload = {
            "version": SCHEMA_VERSION,
            "title": self.title,
            "history": self.get_messages(),
        }
        self.current_file.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return self.current_file

    def sessions(self):
        result = []
        for path in sorted(self.directory.glob("conversation_*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                result.append((path, data.get("title", path.stem)))
            except (OSError, ValueError):
                result.append((path, path.stem))
        return result

    def load(self, path: Path) -> bool:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            history = data.get("history", [])
            if data.get("version", 1) < SCHEMA_VERSION:
                history = _migrate_history(history)
            self.replace_messages(history)
            self.title = data.get("title", path.stem)
            self.current_file = path
            return True
        except (OSError, ValueError, TypeError):
            return False
