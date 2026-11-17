from __future__ import annotations

import time

from sdk.agent_sdk import Agent, AgentConfig

from .config import RESPONSE_PATH
from .display.console import console
from .prompt import PromptContext, PromptRegistry


_SPINNER_WORDS = ("Thinking", "Pondering", "Working", "Checking")


def send_to_ai(text, state, config, model, tools, store):
    def render(event):
        kind = event.type
        data = event.data

        if kind == "model_request":
            round_index = data.get("round", 1)
            word = _SPINNER_WORDS[(round_index - 1) % len(_SPINNER_WORDS)]
            console.start_spinner(f"{word}…")
            return

        console.stop_spinner()
        if kind == "parse_recovered":
            console.parse_recovered()
        elif kind == "thought":
            console.reasoning(data.get("content", ""))
        elif kind == "tool_call":
            console.tool_call(
                data.get("tool", ""),
                data.get("arguments") or {},
            )
        elif kind == "tool_result":
            console.tool_result(
                data.get("tool", ""),
                data.get("data"),
                data.get("error"),
            )
        elif kind == "retry":
            console.retry(
                data.get("attempt", 1),
                data.get("remaining", 0),
                data.get("code", "invalid_response"),
            )

    started_at = time.monotonic()
    agent = Agent(
        model,
        tools,
        store,
        AgentConfig(system_prompt=config.system_prompt),
        render,
    )
    try:
        result = agent.run(text)
    finally:
        console.stop_spinner()

    elapsed = time.monotonic() - started_at
    if not console.consume_streamed():
        console.ai_answer(result.final)
    console.summary(result.rounds, elapsed)
    RESPONSE_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESPONSE_PATH.write_text(result.final, encoding="utf-8")


def show_prompt(registry: PromptRegistry, tools, system: str) -> None:
    context = PromptContext(system=system, tools=tools.list_tools())
    console.heading("当前 system prompt", "🧩")

    shown = 0
    for section in registry.sections():
        if not section.enabled(context):
            continue
        text = section.render(context).strip()
        if not text:
            continue
        console.write(
            f"{console.GRAY}── {section.name} "
            f"(order={section.order}) ──{console.RESET}"
        )
        console.write(text)
        console.write()
        shown += 1

    rendered = registry.render(context)
    console.muted(f"{shown} sections · {len(rendered)} chars")


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
