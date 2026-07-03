import type { I18nMessages } from '../../../i18n/types';
import type { GraphToolResultLabels } from './GraphToolResultView';
import type { GraphToolName } from './types';

export function buildGraphToolResultLabels(t: I18nMessages): GraphToolResultLabels {
  const { graphToolResult } = t;
  return {
    category: graphToolResult.category,
    completed: graphToolResult.completed,
    failed: graphToolResult.failed,
    empty: graphToolResult.empty,
    moreRows: (count) => graphToolResult.moreRows.replace('{count}', String(count)),
    toolLabel: (tool) => {
      if (tool === 'graph_index') return graphToolResult.tools.graph_index;
      if (tool === 'graph_query') return graphToolResult.tools.graph_query;
      return graphToolResult.tools.graph_trace;
    },
    actionLabel: (action) => {
      const key = action as keyof typeof graphToolResult.actions;
      return graphToolResult.actions[key] ?? action;
    },
  };
}

export function isGraphToolMessage(toolName: string | undefined): toolName is GraphToolName {
  return toolName === 'graph_index' || toolName === 'graph_query' || toolName === 'graph_trace';
}
