export interface ProgressSnapshot {
  readonly content: string;
  readonly reasoningChars: number;
  readonly outputChars: number;
  readonly usage: Record<string, unknown> | null;
}

const EMPTY: ProgressSnapshot = Object.freeze({
  content: "",
  reasoningChars: 0,
  outputChars: 0,
  usage: null,
});

const MAX_PREVIEW_CHARS = 20_000;

/**
 * 流式模型与 Ink 之间的桥。模型回调只写这里，UI 通过
 * useSyncExternalStore 订阅；50ms 节流避免每个 token 触发一次渲染。
 */
export class LiveProgress {
  private snapshotValue: ProgressSnapshot = EMPTY;
  private readonly listeners = new Set<() => void>();
  private timer: NodeJS.Timeout | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ProgressSnapshot => this.snapshotValue;

  reset(): void {
    this.clearTimer();
    this.snapshotValue = EMPTY;
    this.notifyNow();
  }

  delta(text: string): void {
    if (!text) {
      return;
    }
    const content =
      (this.snapshotValue.content + text).slice(
        -MAX_PREVIEW_CHARS,
      );
    this.snapshotValue = {
      ...this.snapshotValue,
      content,
      outputChars:
        this.snapshotValue.outputChars + text.length,
    };
    this.schedule();
  }

  reasoning(text: string): void {
    if (!text) {
      return;
    }
    this.snapshotValue = {
      ...this.snapshotValue,
      reasoningChars:
        this.snapshotValue.reasoningChars + text.length,
    };
    this.schedule();
  }

  setUsage(usage: Record<string, unknown> | null): void {
    if (!usage) {
      return;
    }
    this.snapshotValue = {
      ...this.snapshotValue,
      usage,
    };
    this.schedule();
  }

  finish(): void {
    this.clearTimer();
    this.snapshotValue = {
      ...this.snapshotValue,
      content: "",
    };
    this.notifyNow();
  }

  flush(): void {
    this.clearTimer();
    this.notifyNow();
  }

  private schedule(): void {
    if (this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.notifyNow();
    }, 50);
    this.timer.unref();
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private notifyNow(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function approxTokens(
  snapshot: ProgressSnapshot,
): number {
  return Math.ceil(
    (snapshot.outputChars + snapshot.reasoningChars) / 4,
  );
}

export function usageTokens(
  snapshot: ProgressSnapshot,
): number | null {
  const usage = snapshot.usage;
  if (!usage) {
    return null;
  }
  const candidates = [
    usage["completion_tokens"],
    usage["output_tokens"],
    usage["total_tokens"],
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.round(value));
    }
  }
  return null;
}
