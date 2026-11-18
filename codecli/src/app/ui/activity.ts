import {
  activityKindFor,
  formatDuration,
} from "./format.js";

export interface RunStats {
  read: number;
  write: number;
  command: number;
  search: number;
  todo: number;
}

export function emptyStats(): RunStats {
  return {
    read: 0,
    write: 0,
    command: 0,
    search: 0,
    todo: 0,
  };
}

export function countStats(
  stats: RunStats,
  tool: string,
  error: string | null,
): void {
  if (error) {
    return;
  }
  const kind = activityKindFor(tool);
  if (kind) {
    stats[kind] += 1;
  }
}

function plural(
  count: number,
  singular: string,
  pluralForm: string,
): string {
  return count === 1 ? singular : pluralForm;
}

export function activityText(
  stats: RunStats,
  elapsedMs: number,
): string {
  const parts = [`Thought for ${formatDuration(elapsedMs)}`];
  if (stats.read > 0) {
    parts.push(
      `read ${stats.read} ${plural(
        stats.read,
        "file",
        "files",
      )}`,
    );
  }
  if (stats.write > 0) {
    parts.push(
      `wrote ${stats.write} ${plural(
        stats.write,
        "file",
        "files",
      )}`,
    );
  }
  if (stats.search > 0) {
    parts.push(
      `searched ${stats.search} ${plural(
        stats.search,
        "time",
        "times",
      )}`,
    );
  }
  if (stats.command > 0) {
    parts.push(
      `ran ${stats.command} ${plural(
        stats.command,
        "command",
        "commands",
      )}`,
    );
  }
  if (stats.todo > 0) {
    parts.push("updated todo list");
  }
  return parts.join(" · ");
}
