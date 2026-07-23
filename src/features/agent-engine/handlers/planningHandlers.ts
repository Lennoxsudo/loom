import type { ToolResult } from '../../../types/ai';
import type { ToolHandler, ToolContext } from '../types';
import type { ExitPlanModeArgs, TodoWriteArgs, UpdatePlanArgs } from '../toolArgs';
import { ToolError, handleToolError } from '../errors';
import { formatTodos, setTodos, type TodoWriteInputItem } from '../todoStore';
import { formatPlanDocumentBlock, inferPlanTitle, peekPlan, setPlan } from '../planStore';

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
            throw ToolError.invalidParam(
              'todos[].status',
              'must be pending | in_progress | completed'
            );
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

class UpdatePlanHandler implements ToolHandler<'update_plan'> {
  name = 'update_plan' as const;

  async execute(args: UpdatePlanArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      if (typeof args.plan !== 'string' || !args.plan.trim()) {
        throw ToolError.invalidParam('plan', 'must be a non-empty string');
      }

      const conversationId = context?.conversationId || '';
      if (!conversationId) {
        throw ToolError.invalidParam(
          'conversationId',
          'conversationId is required for update_plan'
        );
      }

      const existing = peekPlan(conversationId);
      const explicitTitle = typeof args.title === 'string' ? args.title.trim() : '';
      const title = explicitTitle || existing.title.trim() || inferPlanTitle(args.plan) || '';

      const saved = setPlan(conversationId, {
        content: args.plan,
        title,
        status: 'draft',
      });

      return {
        tool_call_id: '',
        output: [
          'Plan document updated in the editable plan panel.',
          `Title: ${saved.title || '(none)'}`,
          `Length: ${saved.content.length} chars`,
          'Continue researching, call update_plan again to revise, or call exit_plan_mode when ready for user review.',
        ].join('\n'),
      };
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

/**
 * Present plan for human review and end the agent turn (non-blocking).
 * The host shows the plan panel; the user Accept/Reject later outside this tool call.
 */
class ExitPlanModeHandler implements ToolHandler<'exit_plan_mode'> {
  name = 'exit_plan_mode' as const;

  async execute(args: ExitPlanModeArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      const conversationId = context?.conversationId || '';
      if (!conversationId) {
        throw ToolError.invalidParam(
          'conversationId',
          'conversationId is required for exit_plan_mode'
        );
      }

      const existing = peekPlan(conversationId);
      const planContent =
        (typeof args.plan === 'string' && args.plan.trim()) || existing.content.trim();
      if (!planContent) {
        throw ToolError.invalidParam(
          'plan',
          'plan content is required — pass plan= or call update_plan first'
        );
      }

      const title =
        (typeof args.title === 'string' && args.title.trim()) ||
        existing.title.trim() ||
        inferPlanTitle(planContent) ||
        '';

      setPlan(conversationId, {
        content: planContent,
        title,
        status: 'pending_review',
      });

      // Fire-and-forget: open the review UI, but do NOT block the tool loop.
      if (context?.onExitPlanMode) {
        try {
          void Promise.resolve(
            context.onExitPlanMode({
              conversationId,
              agentId: context.agentId,
              plan: planContent,
              title: title || undefined,
            })
          ).catch(() => {
            // Host errors must not fail the tool
          });
        } catch {
          // ignore sync host errors
        }
      }

      const block = formatPlanDocumentBlock({ content: planContent, title });
      return {
        tool_call_id: '',
        output: [
          'Plan submitted for human review. The conversation turn ENDS here.',
          'Do NOT call more tools. Do NOT start implementing.',
          'The user will accept or revise the plan in the UI; execution continues only after they accept.',
          '',
          block,
        ].join('\n'),
      };
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

export const planningHandlers: ToolHandler[] = [
  new TodoWriteHandler(),
  new UpdatePlanHandler(),
  new ExitPlanModeHandler(),
];
