import unittest

from sdk.app.prompt import (
    PromptContext,
    PromptPlugin,
    PromptRegistry,
    PromptSection,
)


class PromptRegistryTests(unittest.TestCase):
    def test_sections_render_in_order(self):
        registry = PromptRegistry()
        registry.register(PromptSection("b", lambda context: "B", order=20))
        registry.register(PromptSection("a", lambda context: "A", order=10))

        self.assertEqual("A\n\nB", registry.render(PromptContext()))

    def test_disabled_sections_are_skipped(self):
        registry = PromptRegistry()
        registry.register(PromptSection("a", lambda context: "A", order=10))
        registry.register(
            PromptSection(
                "b",
                lambda context: "B",
                order=20,
                enabled=lambda context: False,
            )
        )

        self.assertEqual("A", registry.render(PromptContext()))

    def test_empty_sections_are_skipped(self):
        registry = PromptRegistry()
        registry.register(PromptSection("a", lambda context: "  ", order=10))
        registry.register(PromptSection("b", lambda context: "B", order=20))

        self.assertEqual("B", registry.render(PromptContext()))

    def test_duplicate_registration_requires_replace(self):
        registry = PromptRegistry()
        registry.register(PromptSection("a", lambda context: "A"))
        with self.assertRaises(ValueError):
            registry.register(PromptSection("a", lambda context: "B"))

        registry.register(PromptSection("a", lambda context: "B"), replace=True)
        self.assertEqual("B", registry.render(PromptContext()))

    def test_plugin_registration_is_atomic_on_conflict(self):
        registry = PromptRegistry()
        registry.register(PromptSection("taken", lambda context: "T"))
        plugin = PromptPlugin(
            "p",
            (
                PromptSection("new", lambda context: "N"),
                PromptSection("taken", lambda context: "T2"),
            ),
        )

        with self.assertRaises(ValueError):
            registry.register_plugin(plugin)

        self.assertNotIn(
            "new", [section.name for section in registry.sections()]
        )

    def test_context_exposes_has_tools(self):
        self.assertFalse(PromptContext().has_tools)
        self.assertTrue(PromptContext(tools=[{"name": "x"}]).has_tools)

    def test_section_and_plugin_validation(self):
        with self.assertRaises(ValueError):
            PromptSection("", lambda context: "x")
        with self.assertRaises(ValueError):
            PromptPlugin("p", ())


if __name__ == "__main__":
    unittest.main()
