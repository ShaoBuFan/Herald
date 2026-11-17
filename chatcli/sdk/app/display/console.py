from __future__ import annotations

import json
import re
import shutil
import unicodedata
from typing import Any

from .spinner import Spinner


class Console:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    ORANGE = "\033[38;2;255;221;127m"
    CYAN = "\033[96m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    GRAY = "\033[90m"
    _ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
    _TOOL_NAMES = {
        "read_file": "Read",
        "write_file": "Write",
        "list_files": "List",
        "search_text": "Search",
    }

    def __init__(self) -> None:
        self.spinner = Spinner()
        self._streamed = False

    def write(self, text: object = "", end: str = "\n", flush: bool = False) -> None:
        print(str(text), end=end, flush=flush)

    def ask(self, prompt: str) -> str:
        return input(prompt)

    def read_line(self) -> str:
        return input()

    def user_prompt(self) -> None:
        width = self._rule_width()
        self.write(
            f"\n{self.GRAY}╭─ {self.ORANGE}You{self.RESET}"
            f"{self.GRAY} {'─' * (width - 8)}╮{self.RESET}"
        )
        self.write(f"{self.ORANGE}>{self.RESET} ", end="", flush=True)

    def continuation_prompt(self) -> None:
        self.write(f"{self.ORANGE}>{self.RESET} ", end="", flush=True)

    def input_box_end(self) -> None:
        width = self._rule_width()
        self.write(
            f"{self.GRAY}╰{'─' * (width - 2)}╯{self.RESET}"
        )

    def heading(self, title: str, icon: str = "") -> None:
        self.write()
        self.write(f"{icon} {title}".strip())

    def info(self, message: str) -> None:
        self.write(f"\n  {message}")

    def success(self, message: str) -> None:
        self.write(f"{self.GREEN}✓ {message}{self.RESET}")

    def warning(self, message: str) -> None:
        self.write(f"{self.YELLOW}⚠ {message}{self.RESET}")

    def error(self, message: str) -> None:
        self.write(f"{self.RED}✗ {message}{self.RESET}")

    def muted(self, message: str) -> None:
        self.write(f"{self.GRAY}{message}{self.RESET}")

    def goodbye(self) -> None:
        self.write("\n👋 再见！")

    def cancelled(self, leading_newline: bool = False) -> None:
        self.write(
            ("\n" if leading_newline else "")
            + f"{self.YELLOW}本次请求已取消，可以继续输入新的问题。{self.RESET}"
        )

    def start_spinner(self, message: str) -> None:
        self.spinner.start(message)

    def stop_spinner(self) -> None:
        self.spinner.stop()

    def reasoning(self, message: str) -> None:
        for index, line in enumerate(str(message).splitlines() or [""]):
            prefix = f"{self.CYAN}✻{self.RESET} " if index == 0 else "  "
            self.write(f"{prefix}{self.GRAY}{line}{self.RESET}")

    def retry(self, attempt: int, remaining: int, code: str) -> None:
        self.write(
            f"  {self.YELLOW}↻ 回复格式错误（{code}），"
            f"重试 {attempt}（剩余 {remaining}）{self.RESET}"
        )

    def parse_recovered(self) -> None:
        self.write(
            f"  {self.GRAY}↻ 已容错解析（非 canonical 格式）{self.RESET}"
        )

    def ai_answer(self, final: str) -> None:
        self.write()
        raw_lines = str(final).splitlines() or [""]
        first_raw = raw_lines[0].strip() if raw_lines else ""
        lines = self.render_markdown(final) or [""]

        own_line = first_raw.startswith("#") or first_raw.startswith("```")
        if own_line:
            self.write(f"{self.GREEN}⏺{self.RESET}")
            for line in lines:
                self.write(f"  {line}")
        else:
            self.write(f"{self.GREEN}⏺{self.RESET} {lines[0]}")
            for line in lines[1:]:
                self.write(f"  {line}")

    def summary(self, rounds: int, elapsed: float) -> None:
        self.write()
        word = "round" if rounds == 1 else "rounds"
        self.write(
            f"{self.GRAY}✻ {rounds} {word} · {elapsed:.1f}s{self.RESET}"
        )

    def stream_delta(self, text: str) -> None:
        self.stop_spinner()
        self._streamed = True
        self.write(text, end="", flush=True)

    def stream_reasoning_delta(self, text: str) -> None:
        self.stop_spinner()
        self.write(f"{self.GRAY}{text}{self.RESET}", end="", flush=True)

    def consume_streamed(self) -> bool:
        streamed = self._streamed
        self._streamed = False
        return streamed

    def tool_call(self, name: str, arguments: dict) -> None:
        display = self._TOOL_NAMES.get(name, name)
        args = self._tool_call_args(name, arguments)
        suffix = f"({args})" if args else "()"
        self.write(
            f"{self.GREEN}⏺{self.RESET} {self.BOLD}{display}{self.RESET}"
            f"{self.GRAY}{suffix}{self.RESET}"
        )

    def tool_result(
        self,
        name: str,
        data: Any,
        error: str | None = None,
    ) -> None:
        if not error and isinstance(data, dict):
            data_error = data.get("error")
            if data_error and not isinstance(data.get("content"), str):
                error = str(data_error)

        if error:
            detail = f"Error: {self._truncate(str(error), 100)}"
            self.write(
                f"  {self.GRAY}⎿{self.RESET} {self.RED}{detail}{self.RESET}"
            )
            return

        detail = self._truncate(self._tool_result_detail(name, data), 120)
        self.write(f"  {self.GRAY}⎿{self.RESET} {self.GRAY}{detail}{self.RESET}")

    def render_markdown(self, text: str) -> list[str]:
        rendered: list[str] = []
        in_code = False
        for raw_line in str(text).splitlines():
            stripped = raw_line.strip()
            if stripped.startswith("```"):
                in_code = not in_code
                rendered.append(f"{self.GRAY}{raw_line}{self.RESET}")
                continue
            if in_code:
                rendered.append(f"{self.GRAY}{raw_line}{self.RESET}")
                continue

            line = raw_line
            if stripped.startswith("#"):
                level = len(stripped) - len(stripped.lstrip("#"))
                content = stripped[level:].strip()
                if content:
                    rendered.append(
                        f"{self.BOLD}{self.CYAN}{content}{self.RESET}"
                    )
                    continue

            if stripped.startswith(("- ", "* ")):
                line = line.replace("- ", "• ", 1).replace("* ", "• ", 1)

            line = re.sub(
                r"`([^`]+)`",
                lambda match: f"{self.CYAN}{match.group(1)}{self.RESET}",
                line,
            )
            line = re.sub(
                r"\*\*([^*]+)\*\*",
                lambda match: f"{self.BOLD}{match.group(1)}{self.RESET}",
                line,
            )
            rendered.append(line)
        return rendered

    def _tool_call_args(self, name: str, arguments: Any) -> str:
        if not isinstance(arguments, dict):
            return self._truncate(repr(arguments), 60)

        preferred = {
            "read_file": ("path",),
            "write_file": ("path",),
            "list_files": ("path", "pattern"),
            "search_text": ("keyword", "path"),
        }.get(name, ())
        values = [
            str(arguments[key])
            for key in preferred
            if key in arguments and arguments[key] not in (None, "")
        ]
        if values:
            return self._truncate(", ".join(values), 60)
        if not arguments:
            return ""

        parts = [
            f"{key}={self._format_value(value, limit=30)}"
            for key, value in arguments.items()
        ]
        return self._truncate(", ".join(parts), 60)

    def _format_value(self, value: Any, limit: int = 40) -> str:
        if isinstance(value, str):
            text = value if len(value) <= limit else value[: limit - 1] + "…"
            return repr(text)
        text = repr(value)
        return text if len(text) <= limit else text[: limit - 1] + "…"

    def _tool_result_detail(self, name: str, data: Any) -> str:
        display = self._TOOL_NAMES.get(name, name)

        if isinstance(data, dict):
            content = data.get("content")
            if isinstance(content, str):
                lines = content.count("\n") + 1 if content else 0
                size = self._format_size(len(content.encode("utf-8")))
                truncated = ", truncated" if data.get("truncated") else ""
                word = "line" if lines == 1 else "lines"
                return f"{display} {lines} {word} ({size}{truncated})"

            files = data.get("files")
            directories = data.get("directories")
            if isinstance(files, list) or isinstance(directories, list):
                file_count = len(files or [])
                directory_count = len(directories or [])
                truncated = ", truncated" if data.get("truncated") else ""
                file_word = "file" if file_count == 1 else "files"
                directory_word = (
                    "directory" if directory_count == 1 else "directories"
                )
                return (
                    f"{display} {file_count} {file_word}, "
                    f"{directory_count} {directory_word}{truncated}"
                )

            results = data.get("results")
            if isinstance(results, list):
                count = len(results)
                truncated = ", truncated" if data.get("truncated") else ""
                word = "match" if count == 1 else "matches"
                return f"{display} {count} {word}{truncated}"

            if data.get("path") and data.get("bytes_written") is not None:
                size = self._format_size(int(data["bytes_written"]))
                return f"Wrote {data['path']} ({size})"

            compact = json.dumps(data, ensure_ascii=False)
            return f"{display}: {self._truncate(compact, 100)}"

        if isinstance(data, str):
            preview = data.replace("\n", " ")
            return f"{display}: {self._truncate(preview, 100)}"

        if data is None:
            return "Done"

        return f"{display}: {self._truncate(str(data), 100)}"

    @staticmethod
    def _format_size(size: int) -> str:
        if size < 1024:
            return f"{size} B"
        if size < 1024 * 1024:
            return f"{size / 1024:.1f} KB"
        return f"{size / (1024 * 1024):.1f} MB"

    def _truncate(self, text: str, limit: int) -> str:
        text = str(text)
        if limit <= 0:
            return ""
        if self.display_width(text) <= limit:
            return text

        result: list[str] = []
        width = 0
        for char in text:
            char_width = (
                2
                if unicodedata.east_asian_width(char) in ("F", "W")
                else 1
            )
            if width + char_width > limit - 1:
                break
            result.append(char)
            width += char_width
        return "".join(result) + "…"

    def print_box(self, lines: list[str]) -> None:
        if not lines:
            return
        width = max(self.display_width(line) for line in lines) + 2
        self.write(f"{self.CYAN}╭{'─' * width}{self.RESET}")
        for line in lines:
            padding = " " * max(0, width - 2 - self.display_width(line))
            self.write(
                f"{self.CYAN}│ {self.RESET}{line}{padding}"
                f"{self.CYAN} │{self.RESET}"
            )
        self.write(f"{self.CYAN}╰{'─' * width}{self.RESET}")

    @staticmethod
    def _rule_width() -> int:
        columns = shutil.get_terminal_size((80, 20)).columns
        return max(20, min(columns - 1, 72))

    @classmethod
    def display_width(cls, text: str) -> int:
        clean = cls._ANSI_RE.sub("", str(text))
        return sum(
            2 if unicodedata.east_asian_width(c) in ("F", "W") else 1
            for c in clean
        )


console = Console()
