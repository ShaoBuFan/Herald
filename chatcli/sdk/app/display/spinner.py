from __future__ import annotations

import os
import sys
import threading
import time


class Spinner:
    """A single-line, in-place spinner for the current terminal.

    Disabled when stdout is not a TTY or ``CHATCLI_NO_SPINNER`` is set, so
    redirected output and tests never see control sequences.
    """

    FRAMES = ("✻", "✢", "✳", "✶")

    def __init__(self) -> None:
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._message = ""
        self._started = 0.0

    def start(self, message: str) -> None:
        if not self._enabled():
            return
        self.stop()
        self._message = message
        self._stop.clear()
        self._started = time.monotonic()
        self._thread = threading.Thread(
            target=self._run, name="chatcli-spinner", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        thread = self._thread
        if thread is None:
            return
        self._stop.set()
        thread.join(timeout=0.5)
        self._thread = None
        self._clear()

    def _run(self) -> None:
        index = 0
        while not self._stop.wait(0.1):
            elapsed = time.monotonic() - self._started
            frame = self.FRAMES[index % len(self.FRAMES)]
            index += 1
            with self._lock:
                sys.stdout.write(
                    f"\r\033[2K  \033[96m{frame}\033[0m "
                    f"\033[90m{self._message} ({elapsed:.1f}s)\033[0m"
                )
                sys.stdout.flush()
        self._clear()

    def _clear(self) -> None:
        with self._lock:
            sys.stdout.write("\r\033[2K")
            sys.stdout.flush()

    @staticmethod
    def _enabled() -> bool:
        if os.environ.get("CHATCLI_NO_SPINNER"):
            return False
        return bool(getattr(sys.stdout, "isatty", lambda: False)())
