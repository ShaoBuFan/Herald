import { Tool } from "../../core/tools/registry.js";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  content: string;
  status: TodoStatus;
  activeForm?: string;
}

export interface TodoCounts {
  pending: number;
  in_progress: number;
  completed: number;
}

const STATUSES: readonly TodoStatus[] = [
  "pending",
  "in_progress",
  "completed",
];

export const TODO_WRITE_PARAMETERS = {
  type: "object",
  properties: {
    todos: {
      type: "array",
      description: "当前任务清单，最多 50 项",
      items: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "任务描述",
          },
          status: {
            type: "string",
            enum: STATUSES,
            description: "任务状态",
          },
          activeForm: {
            type: "string",
            description: "进行中的任务显示文案",
          },
        },
        required: ["content", "status"],
      },
    },
  },
  required: ["todos"],
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function normalizeTodos(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) {
    throw new Error("todos must be an array");
  }
  if (value.length > 50) {
    throw new Error("todos must contain at most 50 items");
  }

  const todos: TodoItem[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      throw new Error(`todos[${index}] must be an object`);
    }
    const content = item["content"];
    if (typeof content !== "string" || !content.trim()) {
      throw new Error(
        `todos[${index}].content must be a non-empty string`,
      );
    }
    const status = item["status"];
    if (
      typeof status !== "string" ||
      !STATUSES.includes(status as TodoStatus)
    ) {
      throw new Error(
        `todos[${index}].status must be pending, in_progress or completed`,
      );
    }
    const activeForm = item["activeForm"];
    if (activeForm !== undefined && typeof activeForm !== "string") {
      throw new Error(
        `todos[${index}].activeForm must be a string`,
      );
    }
    todos.push({
      content: content.trim(),
      status: status as TodoStatus,
      ...(typeof activeForm === "string"
        ? { activeForm }
        : {}),
    });
  }

  const inProgress = todos.filter(
    (todo) => todo.status === "in_progress",
  ).length;
  if (inProgress > 1) {
    throw new Error("at most one todo may be in_progress");
  }
  return todos;
}

export function countTodos(todos: TodoItem[]): TodoCounts {
  const counts: TodoCounts = {
    pending: 0,
    in_progress: 0,
    completed: 0,
  };
  for (const todo of todos) {
    counts[todo.status] += 1;
  }
  return counts;
}

/**
 * 从 todo_write 的 tool result 中读取 checklist。UI 不再自己解析
 * 原始 tool payload。
 */
export function todosFromToolResult(
  data: unknown,
): TodoItem[] | null {
  if (!isRecord(data) || !Array.isArray(data["todos"])) {
    return null;
  }
  const todos: TodoItem[] = [];
  for (const item of data["todos"]) {
    if (!isRecord(item)) {
      continue;
    }
    const content = item["content"];
    const status = item["status"];
    if (
      typeof content !== "string" ||
      (status !== "pending" &&
        status !== "in_progress" &&
        status !== "completed")
    ) {
      continue;
    }
    todos.push({
      content,
      status,
      ...(typeof item["activeForm"] === "string"
        ? { activeForm: item["activeForm"] }
        : {}),
    });
  }
  return todos;
}

export function writeTodos(
  arguments_: Record<string, unknown>,
): Record<string, unknown> {
  const todos = normalizeTodos(arguments_["todos"]);
  return {
    todos,
    counts: countTodos(todos),
  };
}

export function buildTodoWriteTool(): Tool {
  return new Tool(
    "todo_write",
    "创建或更新当前任务的 checklist；任务开始、推进或完成时调用。",
    TODO_WRITE_PARAMETERS,
    (arguments_) => writeTodos(arguments_),
    "meta",
  );
}
