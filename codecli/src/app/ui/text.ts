export type TextAlign = "left" | "center" | "right";

const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
];

const ZERO_WIDTH_RANGES: ReadonlyArray<
  readonly [number, number]
> = [
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f],
];

function codePointWidth(codePoint: number): number {
  if (codePoint === 0x200d) {
    return 0;
  }
  for (const [start, end] of ZERO_WIDTH_RANGES) {
    if (codePoint >= start && codePoint <= end) {
      return 0;
    }
  }
  for (const [start, end] of WIDE_RANGES) {
    if (codePoint >= start && codePoint <= end) {
      return 2;
    }
  }
  return 1;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    width += codePointWidth(codePoint);
  }
  return width;
}

export function padDisplay(
  text: string,
  width: number,
  align: TextAlign = "left",
): string {
  const remaining = Math.max(0, width - displayWidth(text));
  if (align === "right") {
    return " ".repeat(remaining) + text;
  }
  if (align === "center") {
    const left = Math.floor(remaining / 2);
    return (
      " ".repeat(left) +
      text +
      " ".repeat(remaining - left)
    );
  }
  return text + " ".repeat(remaining);
}

/**
 * 按终端显示宽度换行。英文尽量在空格处断开，CJK 没有空格时
 * 按字符断开；不处理 ANSI 颜色序列。
 */
export function wrapDisplay(
  text: string,
  width: number,
): string[] {
  const limit = Math.max(1, width);
  const clean = text.replace(/\r?\n/g, " ");
  if (!clean) {
    return [""];
  }

  const characters = [...clean];
  const lines: string[] = [];

  while (characters.length > 0) {
    let lineCharacters: string[] = [];
    let lineWidth = 0;
    let lastSpace = -1;

    for (const character of characters) {
      const characterWidth =
        codePointWidth(character.codePointAt(0) ?? 0);
      if (
        lineWidth + characterWidth > limit &&
        lineCharacters.length > 0
      ) {
        break;
      }
      lineCharacters.push(character);
      lineWidth += characterWidth;
      if (character === " ") {
        lastSpace = lineCharacters.length - 1;
      }
      if (lineWidth >= limit) {
        break;
      }
    }

    if (lineCharacters.length === 0) {
      lineCharacters = [characters[0]!];
    }

    if (lineCharacters.length === characters.length) {
      lines.push(lineCharacters.join("").trimEnd());
      break;
    }

    let cut = lineCharacters.length;
    if (
      lastSpace > 0 &&
      lastSpace < lineCharacters.length - 1
    ) {
      cut = lastSpace;
    }

    const line = lineCharacters
      .slice(0, cut)
      .join("")
      .trimEnd();
    lines.push(line);

    const consumed =
      cut === lastSpace ? cut + 1 : cut;
    characters.splice(0, consumed);
    while (characters[0] === " ") {
      characters.shift();
    }
  }

  return lines.length > 0 ? lines : [""];
}
