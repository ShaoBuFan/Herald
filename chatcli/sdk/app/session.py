from __future__ import annotations

import json
import time
from pathlib import Path

from sdk.agent_sdk import InMemoryMessageStore


class SessionStore(InMemoryMessageStore):
    def __init__(self, directory: Path, system_prompt: str):
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        self.current_file: Path | None = None
        self.title = "未命名"
        super().__init__([{"role": "system", "content": system_prompt}] if system_prompt else [])

    def clear(self, system_prompt: str = "") -> None:
        self.current_file = None
        self.title = "未命名"
        self.replace_messages([{"role": "system", "content": system_prompt}] if system_prompt else [])

    def save(self, title: str | None = None) -> Path:
        if title:
            self.title = title
        if self.current_file is None:
            self.current_file = self.directory / f"conversation_{int(time.time())}_{self.title.replace(' ', '_').replace('/', '_')}.json"
        payload = {"title": self.title, "history": self.get_messages()}
        self.current_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
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
            self.replace_messages(data.get("history", []))
            self.title = data.get("title", path.stem)
            self.current_file = path
            return True
        except (OSError, ValueError, TypeError):
            return False
