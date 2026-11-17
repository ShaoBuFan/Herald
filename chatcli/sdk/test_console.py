import io
import time
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from sdk.app.display.console import Console
from sdk.app.display.spinner import Spinner


class ConsoleHelperTests(unittest.TestCase):
    def setUp(self):
        self.console = Console()

    def test_display_width_counts_cjk_and_ignores_ansi(self):
        self.assertEqual(4, self.console.display_width("中文"))
        self.assertEqual(
            2, self.console.display_width("\033[31mab\033[0m")
        )

    def test_format_size(self):
        self.assertEqual("512 B", self.console._format_size(512))
        self.assertEqual("1.0 KB", self.console._format_size(1024))
        self.assertEqual(
            "1.0 MB", self.console._format_size(1024 * 1024)
        )

    def test_truncate_respects_display_width(self):
        self.assertEqual("中…", self.console._truncate("中文", 3))
        self.assertEqual("abc", self.console._truncate("abc", 5))

    def test_read_file_result_detail(self):
        detail = self.console._tool_result_detail(
            "read_file",
            {
                "path": "README.md",
                "content": "line1\nline2",
                "truncated": False,
            },
        )
        self.assertEqual("Read 2 lines (11 B)", detail)

    def test_list_files_result_detail(self):
        detail = self.console._tool_result_detail(
            "list_files",
            {"files": ["a", "b"], "directories": ["c"]},
        )
        self.assertEqual("List 2 files, 1 directory", detail)

    def test_search_text_result_detail(self):
        detail = self.console._tool_result_detail(
            "search_text", {"results": [{}, {}, {}]}
        )
        self.assertEqual("Search 3 matches", detail)

    def test_write_file_result_detail(self):
        detail = self.console._tool_result_detail(
            "write_file",
            {"status": True, "path": "a.txt", "bytes_written": 12},
        )
        self.assertEqual("Wrote a.txt (12 B)", detail)

    def test_truncated_content_is_marked(self):
        detail = self.console._tool_result_detail(
            "read_file",
            {"content": "a\nb", "truncated": True},
        )
        self.assertEqual("Read 2 lines (3 B, truncated)", detail)

    def test_tool_call_args_prefers_path(self):
        text = self.console._tool_call_args(
            "write_file", {"path": "a.txt", "content": "x" * 100}
        )
        self.assertEqual("a.txt", text)

    def test_tool_call_args_formats_unknown_tools(self):
        text = self.console._tool_call_args(
            "custom", {"value": "x" * 100}
        )
        self.assertTrue(text.startswith("value='"))
        self.assertTrue(text.endswith("…'"))

    def test_render_markdown_styles_headings_and_code(self):
        lines = self.console.render_markdown(
            "## 标题\n**bold** 和 `code`\n- item\n```py\nx = 1\n```"
        )
        plain = [
            self.console._ANSI_RE.sub("", line) for line in lines
        ]
        self.assertEqual(
            ["标题", "bold 和 code", "• item", "```py", "x = 1", "```"],
            plain,
        )

    def test_tool_result_marks_data_error(self):
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            self.console.tool_result(
                "read_file", {"error": "File does not exist"}, None
            )

        output = buffer.getvalue()
        self.assertIn("⎿", output)
        self.assertIn("Error: File does not exist", output)

    def test_streamed_flag_is_consumed(self):
        with redirect_stdout(io.StringIO()):
            self.console.stream_delta("hi")

        self.assertTrue(self.console.consume_streamed())
        self.assertFalse(self.console.consume_streamed())


class FakeTTY(io.StringIO):
    def isatty(self) -> bool:
        return True


class SpinnerTests(unittest.TestCase):
    def test_spinner_writes_and_clears_when_tty(self):
        fake = FakeTTY()
        spinner = Spinner()
        with patch("sys.stdout", fake):
            spinner.start("Thinking…")
            time.sleep(0.25)
            spinner.stop()

        output = fake.getvalue()
        self.assertIn("Thinking", output)
        self.assertIn("\r", output)

    def test_spinner_is_silent_without_tty(self):
        fake = io.StringIO()
        spinner = Spinner()
        with patch("sys.stdout", fake):
            spinner.start("Thinking…")
            spinner.stop()

        self.assertEqual("", fake.getvalue())


if __name__ == "__main__":
    unittest.main()
