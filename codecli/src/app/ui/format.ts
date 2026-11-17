export const TOOL_NAMES: Record<string, string> = {
  read_file: "Read",
  write_file: "Write",
  list_files: "List",
  search_text: "Search",
};

export function displayToolName(name: string): string {
  return TOOL_NAMES[name] ?? name;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function truncate(text: string, limit: number): string {
  if (limit <= 0) {
    return "";
  }
  const characters = [...text];
  if (characters.length <= limit) {
    return text;
  }
  return characters.slice(0, limit - 1).join("") + "…";
}

function formatValue(value: unknown, limit = 30): string {
  if (typeof value === "string") {
    return JSON.stringify(
      [...value].length <= limit
        ? value
        : [...value].slice(0, limit - 1).join("") + "…",
    );
  }
  const text = JSON.stringify(value) ?? String(value);
  return truncate(text, limit);
}

export function formatToolCallArguments(
  name: string,
  arguments_: Record<string, unknown>,
): string {
  const preferred =
    {
      read_file: ["path"],
      write_file: ["path"],
      list_files: ["path", "pattern"],
      search_text: ["keyword", "path"],
    }[name] ?? [];

  const values: string[] = [];
  for (const key of preferred) {
    const value = arguments_[key];
    if (value !== undefined && value !== null && value !== "") {
      values.push(String(value));
    }
  }
  if (values.length > 0) {
    return truncate(values.join(", "), 60);
  }
  if (Object.keys(arguments_).length === 0) {
    return "";
  }

  const parts = Object.entries(arguments_).map(
    ([key, value]) => `${key}=${formatValue(value)}`,
  );
  return truncate(parts.join(", "), 60);
}

export interface ToolResultSummary {
  text: string;
  error: boolean;
}

function plural(
  count: number,
  singular: string,
  pluralForm: string,
): string {
  return count === 1 ? singular : pluralForm;
}

export function summarizeToolResult(
  name: string,
  data: unknown,
  error: string | null,
): ToolResultSummary {
  const display = displayToolName(name);

  if (!error && typeof data === "object" && data !== null && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    const dataError = record["error"];
    if (
      dataError &&
      typeof record["content"] !== "string"
    ) {
      error = String(dataError);
    }
  }

  if (error) {
    return {
      text: `Error: ${truncate(String(error), 100)}`,
      error: true,
    };
  }

  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    const content = record["content"];
    if (typeof content === "string") {
      const lines = content ? content.split(/\r\n|\r|\n/).length : 0;
      const size = formatSize(
        new TextEncoder().encode(content).length,
      );
      const truncated = record["truncated"]
        ? ", truncated"
        : "";
      return {
        text: `${display} ${lines} ${plural(
          lines,
          "line",
          "lines",
        )} (${size}${truncated})`,
        error: false,
      };
    }

    const files = record["files"];
    const directories = record["directories"];
    if (Array.isArray(files) || Array.isArray(directories)) {
      const fileCount = Array.isArray(files)
        ? files.length
        : 0;
      const directoryCount = Array.isArray(directories)
        ? directories.length
        : 0;
      const truncated = record["truncated"]
        ? ", truncated"
        : "";
      return {
        text:
          `${display} ${fileCount} ${plural(
            fileCount,
            "file",
            "files",
          )}, ` +
          `${directoryCount} ${plural(
            directoryCount,
            "directory",
            "directories",
          )}${truncated}`,
        error: false,
      };
    }

    const results = record["results"];
    if (Array.isArray(results)) {
      const count = results.length;
      const truncated = record["truncated"]
        ? ", truncated"
        : "";
      return {
        text: `${display} ${count} ${plural(
          count,
          "match",
          "matches",
        )}${truncated}`,
        error: false,
      };
    }

    if (
      typeof record["path"] === "string" &&
      typeof record["bytes_written"] === "number"
    ) {
      return {
        text: `Wrote ${record["path"]} (${formatSize(
          record["bytes_written"],
        )})`,
        error: false,
      };
    }

    return {
      text: `${display}: ${truncate(
        JSON.stringify(record) ?? "",
        100,
      )}`,
      error: false,
    };
  }

  if (typeof data === "string") {
    return {
      text: `${display}: ${truncate(
        data.replace(/\n/g, " "),
        100,
      )}`,
      error: false,
    };
  }

  if (data === null || data === undefined) {
    return { text: "Done", error: false };
  }

  return {
    text: `${display}: ${truncate(String(data), 100)}`,
    error: false,
  };
}
