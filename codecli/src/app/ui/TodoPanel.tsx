import { Box, Text } from "ink";

import type { TodoItem } from "../tools/todo.js";

export interface TodoPanelProps {
  todos: TodoItem[];
}

function icon(status: TodoItem["status"]): string {
  if (status === "completed") {
    return "✔";
  }
  if (status === "in_progress") {
    return "◐";
  }
  return "☐";
}

function color(status: TodoItem["status"]): string {
  if (status === "completed") {
    return "green";
  }
  if (status === "in_progress") {
    return "yellow";
  }
  return "gray";
}

export function TodoPanel({ todos }: TodoPanelProps) {
  if (todos.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold dimColor>
        Tasks
      </Text>
      {todos.map((todo, index) => (
        <Box key={index}>
          <Text color={color(todo.status)}>
            {icon(todo.status)}{" "}
          </Text>
          <Text dimColor={todo.status === "completed"}>
            {todo.status === "in_progress"
              ? todo.activeForm || todo.content
              : todo.content}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
