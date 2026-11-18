export interface ToolResultDetail {
  text: string;
  error: boolean;
}

export type ToolActivityKind =
  | "read"
  | "write"
  | "search"
  | "command"
  | "todo";

interface ToolPresentation {
  displayName: string;
  activeVerb: string;
  doneVerb: string;
  activity?: ToolActivityKind;
  formatArguments(arguments_: Record<string, unknown>): string;
  subject(arguments_: Record<string, unknown>): string;
  command?(arguments_: Record<string, unknown>): string | undefined;
  detail(data: unknown, error: string | null): ToolResultDetail;
  summary(data: unknown, error: string | null): string;
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

export function formatDuration(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 10_000) {
    return `${(safe / 1000).toFixed(1)}s`;
  }
  if (safe < 60_000) {
    return `${Math.round(safe / 1000)}s`;
  }
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.round((safe % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) {
    return String(tokens);
  }
  if (tokens < 10_000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return `${Math.round(tokens / 1000)}k`;
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

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function plural(
  count: number,
  singular: string,
  pluralForm: string,
): string {
  return count === 1 ? singular : pluralForm;
}

function lineCount(text: string): number {
  return text ? text.split(/\r\n|\r|\n/).length : 0;
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

function joinArguments(
  arguments_: Record<string, unknown>,
  keys: string[],
): string {
  const values: string[] = [];
  for (const key of keys) {
    const value = arguments_[key];
    if (value !== undefined && value !== null && value !== "") {
      values.push(String(value));
    }
  }
  return truncate(values.join(", "), 70);
}

function genericArguments(
  arguments_: Record<string, unknown>,
): string {
  if (Object.keys(arguments_).length === 0) {
    return "";
  }
  return truncate(
    Object.entries(arguments_)
      .map(([key, value]) => `${key}=${formatValue(value)}`)
      .join(", "),
    70,
  );
}

function failureDetail(
  data: unknown,
  error: string | null,
): ToolResultDetail | null {
  const dataFailure =
    isRecord(data) &&
    data["error"] &&
    typeof data["content"] !== "string"
      ? String(data["error"])
      : null;
  const failure = error ?? dataFailure;
  if (!failure) {
    return null;
  }
  if (failure.includes("permission denied")) {
    return { text: "Not run · denied", error: true };
  }
  return {
    text: `Error: ${truncate(failure, 140)}`,
    error: true,
  };
}

function fallbackDetail(
  data: unknown,
): ToolResultDetail {
  if (data === null || data === undefined) {
    return { text: "Done", error: false };
  }
  if (typeof data === "string") {
    return {
      text: truncate(data.replace(/\n/g, " "), 140),
      error: false,
    };
  }
  if (isRecord(data)) {
    return {
      text: truncate(JSON.stringify(data) ?? "", 140),
      error: false,
    };
  }
  return { text: truncate(String(data), 140), error: false };
}

function readDetail(
  data: unknown,
  error: string | null,
): ToolResultDetail {
  const failure = failureDetail(data, error);
  if (failure) {
    return failure;
  }
  if (isRecord(data) && typeof data["content"] === "string") {
    const content = data["content"];
    const lines = lineCount(content);
    const size = formatSize(
      new TextEncoder().encode(content).length,
    );
    return {
      text:
        `${lines} ${plural(lines, "line", "lines")} (${size}` +
        `${data["truncated"] ? ", truncated" : ""})`,
      error: false,
    };
  }
  return fallbackDetail(data);
}

function writeDetail(
  data: unknown,
  error: string | null,
): ToolResultDetail {
  const failure = failureDetail(data, error);
  if (failure) {
    return failure;
  }
  if (
    isRecord(data) &&
    typeof data["path"] === "string" &&
    typeof data["bytes_written"] === "number"
  ) {
    return {
      text: formatSize(data["bytes_written"]),
      error: false,
    };
  }
  return fallbackDetail(data);
}

function editDetail(
  data: unknown,
  error: string | null,
): ToolResultDetail {
  const failure = failureDetail(data, error);
  if (failure) {
    return failure;
  }
  if (isRecord(data) && typeof data["replacements"] === "number") {
    const count = data["replacements"];
    return {
      text:
        `${count} ${plural(
          count,
          "replacement",
          "replacements",
        )}` +
        (typeof data["bytes_written"] === "number"
          ? ` · ${formatSize(data["bytes_written"])}`
          : ""),
      error: false,
    };
  }
  return fallbackDetail(data);
}

function listDetail(
  data: unknown,
  error: string | null,
): ToolResultDetail {
  const failure = failureDetail(data, error);
  if (failure) {
    return failure;
  }
  if (isRecord(data)) {
    const files = Array.isArray(data["files"])
      ? data["files"].length
      : 0;
    const directories = Array.isArray(data["directories"])
      ? data["directories"].length
      : 0;
    if (
      Array.isArray(data["files"]) ||
      Array.isArray(data["directories"])
    ) {
      return {
        text:
          `${files} ${plural(files, "file", "files")}, ` +
          `${directories} ${plural(
            directories,
            "directory",
            "directories",
          )}${data["truncated"] ? ", truncated" : ""}`,
        error: false,
      };
    }
  }
  return fallbackDetail(data);
}

function searchDetail(
  data: unknown,
  error: string | null,
): ToolResultDetail {
  const failure = failureDetail(data, error);
  if (failure) {
    return failure;
  }
  if (isRecord(data) && Array.isArray(data["results"])) {
    const count = data["results"].length;
    return {
      text:
        `${count} ${plural(count, "match", "matches")}` +
        `${data["truncated"] ? ", truncated" : ""}`,
      error: false,
    };
  }
  return fallbackDetail(data);
}

function globDetail(
  data: unknown,
  error: string | null,
): ToolResultDetail {
  const failure = failureDetail(data, error);
  if (failure) {
    return failure;
  }
  if (isRecord(data) && Array.isArray(data["files"])) {
    const count = data["files"].length;
    return {
      text:
        `${count} ${plural(count, "file", "files")}` +
        `${data["truncated"] ? ", truncated" : ""}`,
      error: false,
    };
  }
  return fallbackDetail(data);
}

function bashDetail(
  data: unknown,
  error: string | null,
): ToolResultDetail {
  const failure = failureDetail(data, error);
  if (failure) {
    return failure;
  }
  if (!isRecord(data)) {
    return fallbackDetail(data);
  }
  if (data["timed_out"]) {
    return { text: "Timed out", error: false };
  }
  if (data["aborted"]) {
    return { text: "Aborted", error: false };
  }
  if (typeof data["exit_code"] === "number") {
    const stdout =
      typeof data["stdout"] === "string" ? data["stdout"] : "";
    const lines = lineCount(stdout);
    return {
      text:
        `exit ${data["exit_code"]} · ${lines} ${plural(
          lines,
          "line",
          "lines",
        )}${data["truncated"] ? ", truncated" : ""}`,
      error: false,
    };
  }
  return fallbackDetail(data);
}

function todoDetail(
  data: unknown,
  error: string | null,
): ToolResultDetail {
  const failure = failureDetail(data, error);
  if (failure) {
    return failure;
  }
  if (isRecord(data) && Array.isArray(data["todos"])) {
    const todos = data["todos"].filter(isRecord);
    const completed = todos.filter(
      (todo) => todo["status"] === "completed",
    ).length;
    const inProgress = todos.filter(
      (todo) => todo["status"] === "in_progress",
    ).length;
    return {
      text:
        `${completed}/${todos.length} done` +
        (inProgress ? ` · ${inProgress} in progress` : ""),
      error: false,
    };
  }
  return fallbackDetail(data);
}

function prefixedSummary(
  prefix: string,
  detail: ToolResultDetail,
  data: unknown,
): string {
  if (detail.error || data === null || data === undefined) {
    return detail.text;
  }
  return `${prefix} ${detail.text}`;
}

const PRESENTATIONS: Record<string, ToolPresentation> = {
  read_file: {
    displayName: "Read",
    activeVerb: "Reading",
    doneVerb: "Read",
    activity: "read",
    formatArguments: (arguments_) =>
      joinArguments(arguments_, ["path"]),
    subject: (arguments_) =>
      typeof arguments_["path"] === "string" &&
      arguments_["path"]
        ? arguments_["path"]
        : "file",
    detail: readDetail,
    summary: (data, error) =>
      prefixedSummary("Read", readDetail(data, error), data),
  },
  write_file: {
    displayName: "Write",
    activeVerb: "Writing",
    doneVerb: "Wrote",
    activity: "write",
    formatArguments: (arguments_) =>
      joinArguments(arguments_, ["path"]),
    subject: (arguments_) =>
      typeof arguments_["path"] === "string" &&
      arguments_["path"]
        ? arguments_["path"]
        : "file",
    detail: writeDetail,
    summary: (data, error) => {
      const detail = writeDetail(data, error);
      if (detail.error || data === null || data === undefined) {
        return detail.text;
      }
      const filePath =
        isRecord(data) && typeof data["path"] === "string"
          ? data["path"]
          : "file";
      return `Wrote ${filePath} (${detail.text})`;
    },
  },
  edit: {
    displayName: "Update",
    activeVerb: "Updating",
    doneVerb: "Updated",
    activity: "write",
    formatArguments: (arguments_) =>
      joinArguments(arguments_, ["path"]),
    subject: (arguments_) =>
      typeof arguments_["path"] === "string" &&
      arguments_["path"]
        ? arguments_["path"]
        : "file",
    detail: editDetail,
    summary: (data, error) =>
      prefixedSummary("Updated", editDetail(data, error), data),
  },
  list_files: {
    displayName: "List",
    activeVerb: "Listing",
    doneVerb: "Listed",
    activity: "read",
    formatArguments: (arguments_) =>
      joinArguments(arguments_, ["path", "pattern"]),
    subject: (arguments_) =>
      typeof arguments_["path"] === "string" &&
      arguments_["path"]
        ? arguments_["path"]
        : ".",
    detail: listDetail,
    summary: (data, error) =>
      prefixedSummary("List", listDetail(data, error), data),
  },
  search_text: {
    displayName: "Grep",
    activeVerb: "Searching",
    doneVerb: "Searched",
    activity: "search",
    formatArguments: (arguments_) =>
      joinArguments(arguments_, ["keyword", "path"]),
    subject: (arguments_) => {
      const keyword = arguments_["keyword"];
      return typeof keyword === "string" && keyword
        ? `for "${keyword}"`
        : "text";
    },
    detail: searchDetail,
    summary: (data, error) =>
      prefixedSummary("Grep", searchDetail(data, error), data),
  },
  glob: {
    displayName: "Glob",
    activeVerb: "Searching",
    doneVerb: "Searched",
    activity: "search",
    formatArguments: (arguments_) =>
      joinArguments(arguments_, ["pattern", "path"]),
    subject: (arguments_) =>
      typeof arguments_["pattern"] === "string" &&
      arguments_["pattern"]
        ? arguments_["pattern"]
        : "files",
    detail: globDetail,
    summary: (data, error) =>
      prefixedSummary("Glob", globDetail(data, error), data),
  },
  bash: {
    displayName: "Bash",
    activeVerb: "Running command",
    doneVerb: "Ran command",
    activity: "command",
    formatArguments: (arguments_) =>
      joinArguments(arguments_, ["command"]),
    subject: () => "",
    command: (arguments_) => {
      const command = arguments_["command"];
      return typeof command === "string" && command
        ? `$ ${truncate(command, 200)}`
        : undefined;
    },
    detail: bashDetail,
    summary: (data, error) =>
      prefixedSummary("Bash", bashDetail(data, error), data),
  },
  todo_write: {
    displayName: "Todo",
    activeVerb: "Updating todo list",
    doneVerb: "Updated todo list",
    activity: "todo",
    formatArguments: (arguments_) => {
      const todos = arguments_["todos"];
      return Array.isArray(todos) ? `${todos.length} tasks` : "";
    },
    subject: () => "",
    detail: todoDetail,
    summary: (data, error) =>
      prefixedSummary("Todo", todoDetail(data, error), data),
  },
};

export const TOOL_NAMES: Record<string, string> =
  Object.fromEntries(
    Object.entries(PRESENTATIONS).map(([name, presentation]) => [
      name,
      presentation.displayName,
    ]),
  );

const unknownPresentations = new Map<string, ToolPresentation>();

function getPresentation(name: string): ToolPresentation {
  const known = PRESENTATIONS[name];
  if (known) {
    return known;
  }
  let unknown = unknownPresentations.get(name);
  if (!unknown) {
    unknown = {
      displayName: name,
      activeVerb: "",
      doneVerb: "",
      formatArguments: genericArguments,
      subject: () => "",
      detail: fallbackDetail,
      summary: (data, error) => {
        const detail = fallbackDetail(data);
        return detail.error ? detail.text : detail.text;
      },
    };
    unknownPresentations.set(name, unknown);
  }
  return unknown;
}

export function displayToolName(name: string): string {
  return getPresentation(name).displayName;
}

export function activityKindFor(
  name: string,
): ToolActivityKind | null {
  return PRESENTATIONS[name]?.activity ?? null;
}

export function formatToolCallArguments(
  name: string,
  arguments_: Record<string, unknown>,
): string {
  return getPresentation(name).formatArguments(arguments_);
}

export interface ToolCallPresentation {
  action: string;
  command?: string;
}

export function presentToolCall(
  name: string,
  arguments_: Record<string, unknown>,
  status: "active" | "done",
): ToolCallPresentation {
  const presentation = getPresentation(name);
  const subject = presentation.subject(arguments_);
  const verb =
    status === "active"
      ? presentation.activeVerb
      : presentation.doneVerb;

  if (!verb) {
    const detail = presentation.formatArguments(arguments_);
    return {
      action: `${presentation.displayName}${
        detail ? ` ${detail}` : ""
      }`,
    };
  }

  const command = presentation.command?.(arguments_);
  return {
    action: subject ? `${verb} ${subject}` : verb,
    ...(command ? { command } : {}),
  };
}

export function toolResultDetail(
  name: string,
  data: unknown,
  error: string | null,
): ToolResultDetail {
  return getPresentation(name).detail(data, error);
}

export function summarizeToolResult(
  name: string,
  data: unknown,
  error: string | null,
): ToolResultDetail {
  const detail = getPresentation(name).detail(data, error);
  if (detail.error) {
    return detail;
  }
  return {
    text: getPresentation(name).summary(data, error),
    error: false,
  };
}
