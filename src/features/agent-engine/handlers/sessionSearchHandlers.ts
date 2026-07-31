/**
 * session_search tool — on-demand recall over past Agent conversations.
 */

import type { ToolResult } from '../../../types/ai';
import type { ToolHandler } from '../types';
import type { SessionSearchArgs } from '../toolArgs';
import { ToolError, handleToolError } from '../errors';
import {
  formatSessionSearchOutput,
  searchAgentSessions,
} from '../../../utils/sessionSearch';
import { useSettingsStore } from '../../../stores/useSettingsStore';

class SessionSearchHandler implements ToolHandler<'session_search'> {
  name = 'session_search' as const;

  async execute(args: SessionSearchArgs): Promise<ToolResult> {
    try {
      if (!useSettingsStore.getState().enableAgentSessionSearch) {
        return {
          tool_call_id: '',
          output: '',
          error: 'Session search is disabled in settings',
        };
      }

      const query = args.query?.trim() ?? '';
      if (!query) throw ToolError.missingParam('query');

      const result = await searchAgentSessions({
        query,
        projectPath: args.project_path,
        conversationId: args.conversation_id,
        limit: args.limit,
        offset: args.offset,
      });

      if (!result.ok) {
        return {
          tool_call_id: '',
          output: '',
          error: result.error ?? 'session_search failed',
        };
      }

      return {
        tool_call_id: '',
        output: formatSessionSearchOutput(result, query),
      };
    } catch (error) {
      if (error instanceof ToolError) {
        return error.toToolResult();
      }
      return handleToolError(error);
    }
  }
}

export const sessionSearchHandlers: ToolHandler[] = [new SessionSearchHandler()];
