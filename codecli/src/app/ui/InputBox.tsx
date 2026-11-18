import {
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Box,
  Text,
  useCursor,
  type DOMElement,
} from "ink";

import { displayWidth } from "./text.js";

export interface InputBoxProps {
  value: string;
  busy: boolean;
}

function absolutePosition(
  node: DOMElement,
): { x: number; y: number } {
  let current: DOMElement | undefined = node;
  let x = 0;
  let y = 0;

  while (current) {
    const yoga = current.yogaNode;
    if (yoga) {
      x += yoga.getComputedLeft();
      y += yoga.getComputedTop();
    }
    current = current.parentNode;
  }

  return { x, y };
}

export function InputBox({ value, busy }: InputBoxProps) {
  const lines = value.split("\n");
  const ref = useRef<DOMElement>(null);
  const [, setLayoutTick] = useState(0);
  const { setCursorPosition } = useCursor();

  useLayoutEffect(() => {
    // 首次布局完成后触发一次重渲染，让 Yoga 坐标可用于原生光标。
    setLayoutTick((tick) => tick + 1);
  }, [value, busy]);

  if (!busy && ref.current?.yogaNode) {
    const position = absolutePosition(ref.current);
    const line = lines[lines.length - 1] ?? "";
    setCursorPosition({
      x: position.x + 2 + displayWidth(line),
      y: position.y + lines.length - 1,
    });
  } else {
    setCursorPosition(undefined);
  }

  return (
    <Box flexDirection="column" ref={ref} width="100%">
      {lines.map((line, index) => (
        <Box key={index}>
          <Text color="gray">
            {index === 0 ? (busy ? "…" : ">") : " "}{" "}
          </Text>
          <Text>{line}</Text>
        </Box>
      ))}
    </Box>
  );
}
