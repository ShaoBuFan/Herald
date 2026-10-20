from __future__ import annotations

import re
import sys
import unicodedata


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

    def write(self, text: object = "", end: str = "\n", flush: bool = False) -> None:
        print(str(text), end=end, flush=flush)

    def ask(self, prompt: str) -> str:
        return input(prompt)

    def read_line(self) -> str:
        return input()

    def user_prompt(self) -> None:
        self.write(f"\n{self.ORANGE}You{self.RESET} > ", end="", flush=True)

    def ai_prompt(self) -> None:
        self.write(f"{self.CYAN} AI{self.RESET} > ", end="", flush=True)

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
        self.write(("\n" if leading_newline else "") + f"{self.YELLOW}本次请求已取消，可以继续输入新的问题。{self.RESET}")

    def reasoning(self, message: str) -> None:
        for index, line in enumerate(str(message).splitlines() or [""]):
            prefix = f"  {self.GREEN}•{self.RESET} " if index == 0 else "  "
            self.write(f"{prefix}{self.GRAY}{line}{self.RESET}")

    def ai_answer(self, thought: str, final: str) -> None:
        if thought:
            self.reasoning(thought)
        for line in str(final).splitlines() or [""]:
            self.write(f"  {line}")

    def stream_delta(self, text: str) -> None:
        self.write(text, end="", flush=True)

    def stream_reasoning_delta(self, text: str) -> None:
        self.write(f"{self.GRAY}{text}{self.RESET}", end="", flush=True)

    def tool_calls_started(self) -> None:
        self.write(f"  {self.ORANGE}─ 工具调用{self.RESET}")

    def tool_call(self, name: str, arguments: dict, last: bool = False) -> None:
        branch = "└" if last else "├"
        args = ", ".join(f"{key}={value!r}" for key, value in arguments.items())[:60]
        self.write(f"  {self.CYAN}{branch} •{self.RESET} {name}{args}")

    def print_box(self, lines: list[str]) -> None:
        if not lines:
            return
        width = max(self.display_width(line) for line in lines) + 2
        self.write(f"{self.CYAN}╭{'─' * width}{self.RESET}")
        for line in lines:
            padding = " " * max(0, width - 2 - self.display_width(line))
            self.write(f"{self.CYAN}│ {self.RESET}{line}{padding}{self.CYAN} │{self.RESET}")
        self.write(f"{self.CYAN}╰{'─' * width}{self.RESET}")

    @classmethod
    def display_width(cls, text: str) -> int:
        clean = cls._ANSI_RE.sub("", str(text))
        return sum(2 if unicodedata.east_asian_width(c) in ("F", "W") else 1 for c in clean)


console = Console()
