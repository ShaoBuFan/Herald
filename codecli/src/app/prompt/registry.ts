import type { ToolSchema } from "../../core/models.js";

/**
 * 由命名片段拼装的 prompt。每个片段有稳定的名字、顺序和可选的启用条件。
 * 适配器只负责渲染最终字符串；新增或替换 prompt 片段时不需要改适配器。
 */
export interface PromptContextInit {
  system?: string;
  tools?: ToolSchema[];
  extra?: Record<string, unknown>;
}

export class PromptContext {
  readonly system: string;
  readonly tools: ToolSchema[];
  readonly extra: Record<string, unknown>;

  constructor(init: PromptContextInit = {}) {
    this.system = init.system ?? "";
    this.tools = init.tools ?? [];
    this.extra = init.extra ?? {};
  }

  get hasTools(): boolean {
    return this.tools.length > 0;
  }
}

export type PromptRenderer = (context: PromptContext) => string;
export type PromptCondition = (context: PromptContext) => boolean;

function alwaysEnabled(_context: PromptContext): boolean {
  return true;
}

export interface PromptSectionInit {
  name: string;
  render: PromptRenderer;
  order?: number;
  enabled?: PromptCondition;
}

export class PromptSection {
  readonly name: string;
  readonly render: PromptRenderer;
  readonly order: number;
  readonly enabled: PromptCondition;

  constructor(init: PromptSectionInit) {
    if (!init.name.trim()) {
      throw new Error("prompt section name must not be empty");
    }
    if (typeof init.render !== "function") {
      throw new TypeError("prompt section render must be callable");
    }
    const enabled = init.enabled ?? alwaysEnabled;
    if (typeof enabled !== "function") {
      throw new TypeError("prompt section enabled must be callable");
    }
    this.name = init.name;
    this.render = init.render;
    this.order = init.order ?? 100;
    this.enabled = enabled;
  }
}

export interface PromptPluginInit {
  name: string;
  sections: readonly PromptSection[];
}

export class PromptPlugin {
  readonly name: string;
  readonly sections: readonly PromptSection[];

  constructor(init: PromptPluginInit) {
    if (!init.name.trim()) {
      throw new Error("prompt plugin name must not be empty");
    }
    if (init.sections.length === 0) {
      throw new Error("prompt plugin must contain at least one section");
    }
    this.name = init.name;
    this.sections = [...init.sections];
  }
}

export interface RegisterOptions {
  replace?: boolean;
}

export class PromptRegistry {
  private readonly sectionsByName = new Map<string, PromptSection>();

  constructor(sections: readonly PromptSection[] = []) {
    for (const section of sections) {
      this.register(section);
    }
  }

  register(
    section: PromptSection,
    options: RegisterOptions = {},
  ): void {
    if (
      this.sectionsByName.has(section.name) &&
      !options.replace
    ) {
      throw new Error(
        `prompt section already registered: ${section.name}`,
      );
    }
    this.sectionsByName.set(section.name, section);
  }

  registerPlugin(
    plugin: PromptPlugin,
    options: RegisterOptions = {},
  ): void {
    const names = plugin.sections.map((section) => section.name);
    if (new Set(names).size !== names.length) {
      throw new Error(
        `prompt plugin has duplicate sections: ${plugin.name}`,
      );
    }

    const conflicts = names.filter((name) =>
      this.sectionsByName.has(name),
    );
    if (conflicts.length > 0 && !options.replace) {
      throw new Error(
        "prompt plugin conflicts with existing sections: " +
          conflicts.join(", "),
      );
    }

    for (const section of plugin.sections) {
      this.register(section, options);
    }
  }

  unregister(name: string): void {
    this.sectionsByName.delete(name);
  }

  sections(): PromptSection[] {
    return [...this.sectionsByName.values()].sort((a, b) => {
      if (a.order !== b.order) {
        return a.order - b.order;
      }
      return a.name.localeCompare(b.name);
    });
  }

  render(
    context: PromptContext,
    options: { separator?: string } = {},
  ): string {
    const parts: string[] = [];
    for (const section of this.sections()) {
      if (!section.enabled(context)) {
        continue;
      }
      const text = section.render(context).trim();
      if (text) {
        parts.push(text);
      }
    }
    return parts.join(options.separator ?? "\n\n");
  }
}
