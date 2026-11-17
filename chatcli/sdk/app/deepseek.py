"""DeepSeek 直连入口：用 OpenAI 兼容适配器跑 chatCLI。

默认 CLI（``python -m sdk.app``）走 Mattermost；这个入口只用于本地快速
试验：读取 DEEPSEEK_API_KEY，把工具 schema 作为原生 tools 发送，不需要
Mattermost 配置。
"""

from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace

from sdk.app.adapters.chat_completions import ChatCompletionsModel
from sdk.app.commands import handle_save, handle_session, send_to_ai, show_prompt
from sdk.app.config import SESSIONS_DIR
from sdk.app.display.console import console
from sdk.app.main import read_input
from sdk.app.prompt import PromptRegistry, PromptSection
from sdk.app.session.store import SessionStore
from sdk.app.tools import create_file_tools

DEFAULT_BASE_URL = "https://api.deepseek.com/v1"
DEFAULT_MODEL = "deepseek-chat"

NATIVE_SYSTEM_PROMPT = (
    "你是一个在本地工作区里工作的编程 agent。"
    "你可以使用提供的工具读取、搜索、写入文件。"
    "先理解任务，再决定是否需要调用工具；可以多步推进。"
    "回答使用中文，除非用户要求其他语言。"
)


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def _build_prompt_registry() -> PromptRegistry:
    registry = PromptRegistry()
    registry.register(
        PromptSection(
            "app_system",
            lambda context: NATIVE_SYSTEM_PROMPT,
            order=100,
        )
    )
    return registry


def show_help() -> None:
    console.heading("命令说明")
    commands = (
        ("/help", "获得命令帮助"),
        ("/reload", "加载历史对话"),
        ("/clear", "清空对话历史"),
        ("/save", "保存对话"),
        ("/model", "查看当前模型"),
        ("/prompt", "查看 system prompt"),
        ("/exit", "退出"),
    )
    for command, description in commands:
        console.write(f"{command:<9} {description}")


def main() -> None:
    _load_dotenv(Path.cwd() / ".env")
    _load_dotenv(Path(__file__).resolve().parents[2] / ".env")

    api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        console.error("未找到 DEEPSEEK_API_KEY")
        console.info(
            "请在项目根目录的 .env 中填写 DEEPSEEK_API_KEY"
            "（可参考 .env.example），或 export DEEPSEEK_API_KEY=..."
        )
        return

    base_url = (
        os.environ.get("DEEPSEEK_BASE_URL", DEFAULT_BASE_URL).strip()
        or DEFAULT_BASE_URL
    )
    model_name = (
        os.environ.get("DEEPSEEK_MODEL", DEFAULT_MODEL).strip()
        or DEFAULT_MODEL
    )

    workspace = Path.cwd().resolve()
    model = ChatCompletionsModel(
        base_url=base_url,
        api_key=api_key,
        model=model_name,
    )
    tools = create_file_tools(workspace)
    store = SessionStore(SESSIONS_DIR)
    config = SimpleNamespace(system_prompt=NATIVE_SYSTEM_PROMPT)
    prompt_registry = _build_prompt_registry()

    console.print_box(
        [
            f"{console.ORANGE}✻{console.RESET} "
            f"{console.BOLD}chatCLI{console.RESET} · DeepSeek",
            f"model    {model_name}",
            f"base     {base_url}",
            f"cwd      {workspace}",
            f"tools    {len(tools.list_tools())}",
            "input    多行输入，空行发送",
            "",
            f"Type {console.YELLOW}/help{console.RESET} for commands",
        ]
    )

    while True:
        try:
            text = read_input()
            if not text:
                continue
            if text == "/exit":
                console.goodbye()
                return
            if text == "/help":
                show_help()
            elif text == "/clear":
                store.clear()
                console.success("对话历史已清空")
            elif text == "/save":
                handle_save(store)
            elif text == "/reload":
                handle_session(store)
            elif text == "/model":
                console.info(f"{model_name} @ {base_url}")
            elif text == "/prompt":
                show_prompt(prompt_registry, tools, NATIVE_SYSTEM_PROMPT)
            else:
                send_to_ai(text, None, config, model, tools, store)
        except (KeyboardInterrupt, EOFError):
            console.goodbye()
            return
        except Exception as exc:
            console.error(f"处理当前操作失败: {exc}")


if __name__ == "__main__":
    main()
