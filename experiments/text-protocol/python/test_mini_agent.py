"""mini_agent 的离线测试：协议判别、参数校验、最小循环（chat 被打桩，不联网）。

注意：临时工作区放在实验目录下（`.tmp/`），不用系统临时目录——
DSH 沙箱允许写工作区，但不保证允许写系统临时目录。
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import unittest
import uuid
from pathlib import Path
from typing import Callable, Iterator
from unittest import mock

import mini_agent as agent

TMP_ROOT = Path(__file__).resolve().parent / ".tmp"


@contextlib.contextmanager
def workspace_dir() -> Iterator[Path]:
    """工作区内的临时目录（测试结束后自动删除）。

    不要用 tempfile / mkdir(mode=0o700)：本机沙箱下这类目录会变得不可访问，
    用默认权限手写创建即可。
    """
    TMP_ROOT.mkdir(parents=True, exist_ok=True)
    root = TMP_ROOT / f"ws-{uuid.uuid4().hex[:8]}"
    root.mkdir()
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


def run(func: Callable[[], int]) -> int:
    """执行实际实现并吞掉它的控制台输出。"""
    with contextlib.redirect_stdout(io.StringIO()):
        return func()


class ClassifyTest(unittest.TestCase):
    def test_single_action(self) -> None:
        raw = (
            "thought: 先读文件\n"
            '```json\n{"calls": [{"tool": "read_file", "args": {"path": "README.md"}}]}\n```'
        )
        result = agent.classify(raw, 4)
        self.assertEqual(result["kind"], "action")
        self.assertEqual(result["calls"][0]["tool"], "read_file")

    def test_multi_action(self) -> None:
        raw = (
            "thought: 同时读两个文件\n"
            "```json\n"
            '{"calls": [{"tool": "read_file", "args": {"path": "a.md"}},'
            ' {"tool": "list_files", "args": {"path": "."}}]}\n'
            "```"
        )
        result = agent.classify(raw, 4)
        self.assertEqual(result["kind"], "action")
        self.assertEqual(len(result["calls"]), 2)

    def test_final(self) -> None:
        raw = "thought: 信息够了\nfinal: 这个项目是一个 agent harness。"
        result = agent.classify(raw, 4)
        self.assertEqual(result["kind"], "final")
        self.assertEqual(result["text"], "这个项目是一个 agent harness。")

    def test_final_can_contain_code_fences(self) -> None:
        raw = 'thought: 信息够了\nfinal: 结果如下：\n```json\n{"x": 1}\n```'
        result = agent.classify(raw, 4)
        self.assertEqual(result["kind"], "final")
        self.assertIn("```json", result["text"])

    def test_case_insensitive_markers(self) -> None:
        self.assertEqual(agent.classify("Thought: ok\nFINAL: done", 4)["kind"], "final")

    def test_prose_only_is_protocol_error(self) -> None:
        result = agent.classify("我来看看文件。", 4)
        self.assertEqual(result["kind"], "protocol_error")
        self.assertIn("没有 payload", result["reason"])

    def test_missing_thought_is_protocol_error(self) -> None:
        raw = '```json\n{"calls": [{"tool": "list_files", "args": {"path": "."}}]}\n```'
        result = agent.classify(raw, 4)
        self.assertEqual(result["kind"], "protocol_error")
        self.assertIn("thought", result["reason"])

    def test_bad_json_is_protocol_error(self) -> None:
        raw = 'thought: 试试\n```json\n{"calls": [\n```'
        result = agent.classify(raw, 4)
        self.assertEqual(result["kind"], "protocol_error")
        self.assertIn("JSON 语法错", result["reason"])

    def test_unclosed_fence_is_truncation(self) -> None:
        raw = 'thought: 试试\n```json\n{"calls": []}'
        result = agent.classify(raw, 4)
        self.assertEqual(result["kind"], "protocol_error")
        self.assertIn("截断", result["reason"])

    def test_calls_over_limit(self) -> None:
        calls = [{"tool": "list_files", "args": {"path": "."}} for _ in range(5)]
        raw = "thought: 五个\n```json\n" + json.dumps({"calls": calls}) + "\n```"
        result = agent.classify(raw, 4)
        self.assertEqual(result["kind"], "protocol_error")
        self.assertIn("超过上限", result["reason"])

    def test_trailing_after_fence_is_recorded(self) -> None:
        raw = (
            "thought: 先列目录\n"
            '```json\n{"calls": [{"tool": "list_files", "args": {"path": "."}}]}\n```\n'
            "以上就是我的动作。"
        )
        result = agent.classify(raw, 4)
        self.assertEqual(result["kind"], "action")
        self.assertTrue(result["trailing"])


class ValidateCallsTest(unittest.TestCase):
    def test_unknown_tool(self) -> None:
        problem = agent.validate_calls([{"tool": "read_fil", "args": {"path": "x"}}])
        self.assertIsNotNone(problem)
        assert problem is not None
        self.assertIn("未知工具", problem[1])

    def test_missing_arg(self) -> None:
        problem = agent.validate_calls([{"tool": "read_file", "args": {}}])
        assert problem is not None
        self.assertIn("缺少参数", problem[1])

    def test_extra_arg(self) -> None:
        problem = agent.validate_calls(
            [{"tool": "read_file", "args": {"path": "x", "encoding": "utf-8"}}]
        )
        assert problem is not None
        self.assertIn("多余参数", problem[1])

    def test_wrong_type(self) -> None:
        problem = agent.validate_calls([{"tool": "read_file", "args": {"path": 42}}])
        assert problem is not None
        self.assertIn("必须是 string", problem[1])

    def test_valid(self) -> None:
        self.assertIsNone(
            agent.validate_calls([{"tool": "read_file", "args": {"path": "README.md"}}])
        )


class SandboxTest(unittest.TestCase):
    def test_escape_is_rejected(self) -> None:
        with workspace_dir() as root:
            sandbox = agent.Sandbox(root)
            with self.assertRaises(agent.ToolError):
                sandbox.resolve("../outside.txt")

    def test_absolute_path_is_rejected(self) -> None:
        with workspace_dir() as root:
            sandbox = agent.Sandbox(root)
            with self.assertRaises(agent.ToolError):
                sandbox.resolve(str(root / "README.md"))


class RunAgentTest(unittest.TestCase):
    def test_action_then_final(self) -> None:
        with workspace_dir() as root:
            (root / "README.md").write_text("你好，我是 README", encoding="utf-8")
            sandbox = agent.Sandbox(root)
            replies = [
                (
                    "thought: 先读 README\n"
                    '```json\n{"calls": [{"tool": "read_file", "args": {"path": "README.md"}}]}\n```',
                    {},
                ),
                ("thought: 读到了\nfinal: README 说：你好。", {}),
            ]
            with mock.patch.object(agent, "chat", side_effect=replies) as fake_chat:
                code = run(lambda: agent.run_agent("读 README 并总结", sandbox, max_steps=5))
            self.assertEqual(code, 0)
            self.assertEqual(fake_chat.call_count, 2)
            second_messages = fake_chat.call_args_list[1].args[0]
            observation = second_messages[-1]
            self.assertEqual(observation["role"], "user")
            self.assertIn('tool="read_file" status="ok"', observation["content"])
            self.assertIn("你好，我是 README", observation["content"])

    def test_protocol_error_then_final(self) -> None:
        with workspace_dir() as root:
            sandbox = agent.Sandbox(root)
            replies = [
                ("我来看看文件。", {}),
                ("thought: 好的\nfinal: 完成。", {}),
            ]
            with mock.patch.object(agent, "chat", side_effect=replies) as fake_chat:
                code = run(lambda: agent.run_agent("任务", sandbox, max_steps=5))
            self.assertEqual(code, 0)
            self.assertEqual(fake_chat.call_count, 2)
            second_messages = fake_chat.call_args_list[1].args[0]
            self.assertIn("[protocol error]", second_messages[-1]["content"])

    def test_invalid_batch_is_not_executed(self) -> None:
        with workspace_dir() as root:
            (root / "README.md").write_text("x", encoding="utf-8")
            sandbox = agent.Sandbox(root)
            replies = [
                (
                    "thought: 读两个文件\n"
                    '```json\n{"calls": ['
                    '{"tool": "read_file", "args": {"path": "README.md"}},'
                    ' {"tool": "read_fil", "args": {"path": "README.md"}}]}\n```',
                    {},
                ),
                ("thought: 收到\nfinal: 结束。", {}),
            ]
            with mock.patch.object(agent, "chat", side_effect=replies) as fake_chat:
                code = run(lambda: agent.run_agent("任务", sandbox, max_steps=5))
            self.assertEqual(code, 0)
            second_messages = fake_chat.call_args_list[1].args[0]
            observation = second_messages[-1]["content"]
            self.assertIn("未知工具", observation)
            self.assertIn("整批未执行", observation)

    def test_protocol_error_budget_exceeded(self) -> None:
        with workspace_dir() as root:
            sandbox = agent.Sandbox(root)
            replies = [("只有散文。", {})] * 4
            with mock.patch.object(agent, "chat", side_effect=replies):
                code = run(lambda: agent.run_agent("任务", sandbox, max_steps=10))
            self.assertEqual(code, 1)


class TranscriptTest(unittest.TestCase):
    def test_records_requests_responses_and_end(self) -> None:
        with workspace_dir() as root:
            (root / "README.md").write_text("hello", encoding="utf-8")
            sandbox = agent.Sandbox(root)
            log_path = root / "run.jsonl"
            replies = [
                (
                    "thought: 先读文件\n"
                    '```json\n{"calls": [{"tool": "read_file", "args": {"path": "README.md"}}]}\n```',
                    {"prompt_tokens": 10, "completion_tokens": 5},
                ),
                ("thought: 读到了\nfinal: 完成。", {"prompt_tokens": 20, "completion_tokens": 6}),
            ]
            writer = agent.TranscriptWriter(log_path)
            with mock.patch.object(agent, "chat", side_effect=replies):
                code = run(lambda: agent.run_agent("任务", sandbox, max_steps=4, transcript=writer))
            self.assertEqual(code, 0)

            records = [
                json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(records[0]["type"], "run_start")
            self.assertIn("thought:", records[0]["system_prompt"])
            steps = [record for record in records if record["type"] == "step"]
            self.assertEqual(len(steps), 2)
            self.assertEqual(steps[0]["request"][0]["role"], "system")
            self.assertIn("```json", steps[0]["response"])
            self.assertEqual(steps[0]["classification"]["kind"], "action")
            self.assertEqual(steps[0]["usage"]["prompt_tokens"], 10)
            tool_results = next(
                record for record in records if record["type"] == "tool_results"
            )
            self.assertEqual(tool_results["results"][0]["status"], "ok")
            self.assertIn("hello", tool_results["results"][0]["output"])
            self.assertEqual(records[-1]["type"], "run_end")
            self.assertEqual(records[-1]["status"], "final")
            self.assertIn("完成", records[-1]["final_text"])

    def test_protocol_error_is_recorded(self) -> None:
        with workspace_dir() as root:
            sandbox = agent.Sandbox(root)
            log_path = root / "run.jsonl"
            replies = [("只有散文。", {}), ("thought: 好的\nfinal: 完成。", {})]
            writer = agent.TranscriptWriter(log_path)
            with mock.patch.object(agent, "chat", side_effect=replies):
                code = run(lambda: agent.run_agent("任务", sandbox, max_steps=4, transcript=writer))
            self.assertEqual(code, 0)
            records = [
                json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()
            ]
            protocol_errors = [
                record for record in records if record["type"] == "protocol_error"
            ]
            self.assertEqual(len(protocol_errors), 1)
            self.assertIn("没有 payload", protocol_errors[0]["reason"])
            self.assertIn("[protocol error]", protocol_errors[0]["feedback"])


class DotEnvTest(unittest.TestCase):
    def test_parse_key_value_and_quotes(self) -> None:
        with workspace_dir() as root:
            env_file = root / ".env"
            env_file.write_text(
                '# 注释\nFOO_TEST_KEY="abc"\nBAR_TEST_KEY=\'def\'\nEMPTY_TEST_KEY=\n',
                encoding="utf-8",
            )
            for name in ("FOO_TEST_KEY", "BAR_TEST_KEY", "EMPTY_TEST_KEY"):
                os.environ.pop(name, None)
            agent._load_dotenv(env_file)
            try:
                self.assertEqual(os.environ.get("FOO_TEST_KEY"), "abc")
                self.assertEqual(os.environ.get("BAR_TEST_KEY"), "def")
                self.assertEqual(os.environ.get("EMPTY_TEST_KEY"), "")
            finally:
                for name in ("FOO_TEST_KEY", "BAR_TEST_KEY", "EMPTY_TEST_KEY"):
                    os.environ.pop(name, None)

    def test_existing_env_var_wins(self) -> None:
        with workspace_dir() as root:
            env_file = root / ".env"
            env_file.write_text("EXISTING_TEST_KEY=from-file\n", encoding="utf-8")
            os.environ["EXISTING_TEST_KEY"] = "from-env"
            try:
                agent._load_dotenv(env_file)
                self.assertEqual(os.environ["EXISTING_TEST_KEY"], "from-env")
            finally:
                os.environ.pop("EXISTING_TEST_KEY", None)

    def test_missing_file_is_noop(self) -> None:
        with workspace_dir() as root:
            agent._load_dotenv(root / "nope.env")  # 不抛错即可


if __name__ == "__main__":
    unittest.main()
