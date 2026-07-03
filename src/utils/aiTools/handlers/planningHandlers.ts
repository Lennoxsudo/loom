import type { ToolResult } from '../../../types/ai';
import type { ToolHandler, ToolContext } from '../types';
import type { TodoWriteArgs } from '../toolArgs';
import { ToolError, handleToolError } from '../errors';
import { formatTodos, setTodos, type TodoWriteInputItem } from '../todoStore';
function isValidTodoStatus(status: unknown): boolean {
  return (
    status === 'pending' ||
    status === 'in_progress' ||
    status === 'completed' ||
    status === 'in-progress' ||
    status === 'inprogress'
  );
}

function normalizeTodoItems(todos: TodoWriteArgs['todos'] = []): TodoWriteInputItem[] {
  return todos
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: item.id,
      content: item.content,
      status: item.status,
    }));
}

class TodoWriteHandler implements ToolHandler<'todo'> {
  name = 'todo' as const;

  async execute(args: TodoWriteArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      const shouldClear = args.clear === true;
      if (!shouldClear && !Array.isArray(args.todos)) {
        throw ToolError.missingParam('todos');
      }
      if (!shouldClear) {
        const todos = args.todos || [];
        for (const item of todos) {
          if (!item || typeof item.content !== 'string' || item.content.trim().length === 0) {
            throw ToolError.invalidParam('todos[].content', 'must be non-empty string');
          }
          if (!isValidTodoStatus(item.status)) {
            throw ToolError.invalidParam('todos[].status', 'must be pending | in_progress | completed');
          }
        }
      }

      const conversationId = context?.conversationId || '';
      if (!conversationId) {
        throw ToolError.invalidParam('conversationId', 'conversationId is required for TodoWrite');
      }

      const saved = setTodos(conversationId, normalizeTodoItems(args.todos || []));
      return {
        tool_call_id: '',
        output: formatTodos(saved),
      };
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

export const planningHandlers: ToolHandler[] = [new TodoWriteHandler()];
