import type { SessionMode } from "../modes.js";

export interface ModePresentation {
  readonly label: string;
  readonly statusLabel: string;
  readonly color: string;
}

export const MODE_PRESENTATIONS: Record<
  SessionMode,
  ModePresentation
> = {
  manual: {
    label: "Manual",
    statusLabel: "manual mode on",
    color: "green",
  },
  accept: {
    label: "Accept edits",
    statusLabel: "accept edits on",
    color: "cyan",
  },
  plan: {
    label: "Plan",
    statusLabel: "plan mode on",
    color: "yellow",
  },
  auto: {
    label: "Auto",
    statusLabel: "auto mode on",
    color: "magenta",
  },
};
