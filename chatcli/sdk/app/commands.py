from __future__ import annotations

from sdk.agent_sdk import Agent, AgentConfig

from .console import console
from .config import RESPONSE_PATH


def send_to_ai(text, state, config, model, tools, store):
    started = False

    def render(event):
        nonlocal started
        if event.type == "thought":
            console.reasoning(event.data["content"])
        elif event.type == "tool_call":
            if not started:
                # console.tool_calls_started()
                started = True
            console.tool_call(event.data["tool"], event.data["arguments"])

    agent = Agent(model, tools, store, AgentConfig(system_prompt=config.system_prompt), render)
    result = agent.run(text)
    console.ai_answer("", result.final)
    RESPONSE_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESPONSE_PATH.write_text(result.final, encoding="utf-8")


def choose_model(state, model):
    try:
        usage = model.get_usage() or {}
    except Exception as exc:
        console.error(f"获取模型信息失败: {exc}")
        return
    console.heading("可用模型列表", "🔬")
    counts = usage.get("modelUseCounts", {})
    for index, item in enumerate(state.config.models, 1):
        value = counts.get(item["MODEL_NAME"], "未找到用量")
        console.write(f"{index}. {item['NICKNAME']} ({value})")
    choice = console.ask("请输入数字选择模型, 或者回车取消: ").strip()
    if choice.isdigit() and 1 <= int(choice) <= len(state.config.models):
        state.current_model = state.config.models[int(choice) - 1]
        console.success(f"已切换到模型: {state.current_model_name}")


def handle_session(store):
    sessions = store.sessions()
    if not sessions:
        console.warning("未发现任何会话存档")
        return
    console.heading("已保存会话列表", "🗂️")
    for index, (_, title) in enumerate(sessions, 1):
        console.write(f"{index}. {title}")
    choice = console.ask("请输入序号 (回车取消): ").strip()
    if choice.isdigit() and 1 <= int(choice) <= len(sessions):
        console.success("会话已恢复" if store.load(sessions[int(choice) - 1][0]) else "会话恢复失败")


def handle_save(store):
    title = console.ask("请输入本次会话标题 (可留空): ").strip()
    console.success(f"会话已保存到: {store.save(title or None)}")
