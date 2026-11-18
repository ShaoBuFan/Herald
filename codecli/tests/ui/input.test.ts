import assert from "node:assert/strict";
import test from "node:test";

import {
  INPUT_HINTS,
  parseCommand,
  sanitizeInput,
} from "../../src/app/ui/input.js";

test("sanitizeInput strips bracketed paste and ANSI sequences", () => {
  assert.equal(
    sanitizeInput("\x1b[200~hello\x1b[201~"),
    "hello",
  );
  assert.equal(
    sanitizeInput("\x1b[31mred\x1b[0m"),
    "red",
  );
});

test("sanitizeInput normalizes line endings and tabs", () => {
  assert.equal(sanitizeInput("a\r\nb\rc"), "a\nb\nc");
  assert.equal(sanitizeInput("a\tb"), "a    b");
});

test("sanitizeInput removes control characters but keeps newlines", () => {
  assert.equal(
    sanitizeInput("a\x00b\x07c\nd\x7f"),
    "abc\nd",
  );
});

test("parseCommand parses slash commands", () => {
  assert.deepEqual(parseCommand("/help"), {
    name: "help",
    argument: "",
  });
  assert.deepEqual(parseCommand("/HELP"), {
    name: "help",
    argument: "",
  });
  assert.deepEqual(parseCommand("  /save  my session  "), {
    name: "save",
    argument: "my session",
  });
  assert.deepEqual(parseCommand("/model 2"), {
    name: "model",
    argument: "2",
  });
  assert.deepEqual(parseCommand("/reload a\nb"), {
    name: "reload",
    argument: "a\nb",
  });
});

test("parseCommand rejects non-commands", () => {
  assert.equal(parseCommand("hello"), null);
  assert.equal(parseCommand("/"), null);
  assert.equal(parseCommand("  "), null);
});

test("input hints document double-Enter and mode switching", () => {
  const text = INPUT_HINTS.join("\n");
  assert.match(text, /双击 Enter/);
  assert.match(text, /Shift\+Tab/);
  assert.match(text, /Esc/);
  assert.match(text, /\/help/);
});
