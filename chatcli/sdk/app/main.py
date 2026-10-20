from __future__ import annotations

from sdk.agent_sdk import TextProtocolAdapter

from .commands import choose_model, handle_save, handle_session, send_to_ai
from .config import APP_DATA_DIR, PROJECT_ROOT, SESSIONS_DIR, AppState, load_config
from .console import console
from .files import create_file_tools
from .model import MattermostModel
from .session import SessionStore


def show_help():
    console.heading("命令说明")
    for command, description in (("/help", "获得命令帮助"), ("/reload", "加载历史对话"), ("/clear", "清空对话历史"), ("/save", "保存对话"), ("/model", "切换模型"), ("/usage", "查看用量"), ("/user", "查看用户"), ("/exit", "退出")):
        console.write(f"{command:<9} {description}")


def read_input():
    console.user_prompt()
    first = console.read_line()
    if first.startswith("/"):
        return first
    lines = [first]
    while True:
        line = console.read_line()
        if not line.strip():
            break
        lines.append(line)
    return "\n".join(lines)


def main():
    config = load_config()
    state = AppState(config)
    mattermost = MattermostModel(state, config)
    model = TextProtocolAdapter(mattermost)
    tools = create_file_tools(PROJECT_ROOT)
    store = SessionStore(SESSIONS_DIR)
    console.print_box([f"{console.ORANGE}chatCLI SDK{console.RESET}", f"model    {state.current_model_name}", f"workspace {PROJECT_ROOT.name}", "", f"Type {console.YELLOW}/help{console.RESET} for commands"])
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
                choose_model(state, mattermost)
            elif text == "/usage":
                console.info(str(mattermost.get_usage()))
            elif text == "/user":
                console.info(str(mattermost.get_me()))
            else:
                # console.ai_prompt()
                send_to_ai(text, state, config, model, tools, store)
        except (KeyboardInterrupt, EOFError):
            console.goodbye()
            return
        except Exception as exc:
            console.error(f"处理当前操作失败: {exc}")


if __name__ == "__main__":
    main()
