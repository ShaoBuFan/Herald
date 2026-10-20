from __future__ import annotations

import json
import os
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SDK_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = Path.cwd().resolve()
SOURCE_ROOT = SDK_DIR.parent.resolve()

if getattr(sys, "frozen", False):
    RESOURCE_DIR = Path(sys.executable).resolve().parent
else:
    RESOURCE_DIR = SOURCE_ROOT

APP_DATA_DIR = Path(os.environ.get("APPDATA") or (Path.home() / ".local" / "share")) / "chat-cli"
CONFIG_PATH = APP_DATA_DIR / "data" / "config.json"
SESSIONS_DIR = APP_DATA_DIR / "sessions"
RESPONSE_PATH = APP_DATA_DIR / "response.md"
LOG_DIR = APP_DATA_DIR / "logs"
PROMPT_PATH = RESOURCE_DIR / "data" / "prompt.json"


def _load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"JSON object expected: {path}")
    return value


def load_config() -> "AppConfig":
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not CONFIG_PATH.exists():
        legacy = SOURCE_ROOT / "data" / "config.json"
        if legacy.exists():
            shutil.copy2(legacy, CONFIG_PATH)
        if not CONFIG_PATH.exists():
            raise FileNotFoundError(f"配置文件不存在: {CONFIG_PATH}")
    data = _load_json(CONFIG_PATH)
    prompt = ""
    if PROMPT_PATH.exists():
        prompt = json.dumps(_load_json(PROMPT_PATH), ensure_ascii=False, separators=(",", ":"))
    return AppConfig(
        base_url=str(data["BASE_URL"]).rstrip("/"),
        accounts=list(data["ACCOUNT"]),
        models=list(data["MODEL_LIST"]),
        system_prompt=prompt,
    )


@dataclass
class AppConfig:
    base_url: str
    accounts: list[dict[str, Any]]
    models: list[dict[str, Any]]
    system_prompt: str = ""


class AppState:
    def __init__(self, config: AppConfig):
        if not config.accounts or not config.models:
            raise ValueError("配置中必须至少包含一个账户和一个模型")
        self.config = config
        self.current_account = config.accounts[0]
        self.current_model = config.models[0]

    @property
    def current_model_key(self) -> str:
        return self.current_model["MODEL_KEY"]

    @property
    def current_model_name(self) -> str:
        return self.current_model["MODEL_NAME"]
