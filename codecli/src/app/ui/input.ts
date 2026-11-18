export function sanitizeInput(text: string): string {
  return text
    // 括号粘贴标记
    .replace(/\x1b\[20[01]~/g, "")
    // ANSI 转义序列
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    // Windows / 旧 Mac 换行
    .replace(/\r\n?/g, "\n")
    // Tab 会破坏输入框的宽度计算
    .replace(/\t/g, "    ")
    // 其余 C0 控制字符，保留 \n
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

export interface ParsedCommand {
  name: string;
  argument: string;
}

export function parseCommand(
  text: string,
): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) {
    return null;
  }
  return {
    name: (match[1] ?? "").toLowerCase(),
    argument: (match[2] ?? "").trim(),
  };
}

export const INPUT_HINTS = [
  "Enter 换行 · 双击 Enter 发送",
  "Shift+Tab 切换模式 · Esc 中断 · /help 查看命令",
] as const;
