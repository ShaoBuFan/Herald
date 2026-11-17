import assert from "node:assert/strict";
import test from "node:test";

import {
  PromptContext,
  PromptPlugin,
  PromptRegistry,
  PromptSection,
  type PromptContext as PromptContextType,
} from "../src/app/prompt/registry.js";

test("sections render in order", () => {
  const registry = new PromptRegistry();
  registry.register(
    new PromptSection({
      name: "b",
      render: (_context: PromptContextType) => "B",
      order: 20,
    }),
  );
  registry.register(
    new PromptSection({
      name: "a",
      render: (_context: PromptContextType) => "A",
      order: 10,
    }),
  );

  assert.equal(registry.render(new PromptContext()), "A\n\nB");
});

test("disabled sections are skipped", () => {
  const registry = new PromptRegistry();
  registry.register(
    new PromptSection({
      name: "a",
      render: () => "A",
      order: 10,
    }),
  );
  registry.register(
    new PromptSection({
      name: "b",
      render: () => "B",
      order: 20,
      enabled: () => false,
    }),
  );

  assert.equal(registry.render(new PromptContext()), "A");
});

test("empty sections are skipped", () => {
  const registry = new PromptRegistry();
  registry.register(
    new PromptSection({
      name: "a",
      render: () => "  ",
      order: 10,
    }),
  );
  registry.register(
    new PromptSection({
      name: "b",
      render: () => "B",
      order: 20,
    }),
  );

  assert.equal(registry.render(new PromptContext()), "B");
});

test("duplicate registration requires replace", () => {
  const registry = new PromptRegistry();
  registry.register(
    new PromptSection({ name: "a", render: () => "A" }),
  );
  assert.throws(() =>
    registry.register(
      new PromptSection({ name: "a", render: () => "B" }),
    ),
  );

  registry.register(
    new PromptSection({ name: "a", render: () => "B" }),
    { replace: true },
  );
  assert.equal(registry.render(new PromptContext()), "B");
});

test("plugin registration is atomic on conflict", () => {
  const registry = new PromptRegistry();
  registry.register(
    new PromptSection({ name: "taken", render: () => "T" }),
  );
  const plugin = new PromptPlugin({
    name: "p",
    sections: [
      new PromptSection({ name: "new", render: () => "N" }),
      new PromptSection({ name: "taken", render: () => "T2" }),
    ],
  });

  assert.throws(() => registry.registerPlugin(plugin));

  assert.equal(
    registry.sections().some((section) => section.name === "new"),
    false,
  );
});

test("context exposes hasTools", () => {
  assert.equal(new PromptContext().hasTools, false);
  assert.equal(
    new PromptContext({
      tools: [
        {
          name: "x",
          description: "",
          parameters: { type: "object" },
        },
      ],
    }).hasTools,
    true,
  );
});

test("section and plugin validation", () => {
  assert.throws(
    () => new PromptSection({ name: "", render: () => "x" }),
  );
  assert.throws(
    () => new PromptPlugin({ name: "p", sections: [] }),
  );
});
