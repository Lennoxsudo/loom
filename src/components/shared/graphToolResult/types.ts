export type GraphToolName = 'graph_index' | 'graph_query' | 'graph_trace';

export interface GraphToolResultTable {
  headers: string[];
  rows: string[][];
  total: number;
}

export interface GraphToolResultCodeBlock {
  lang: string;
  code: string;
  file?: string;
  range?: string;
  qualifiedName?: string;
}

export interface GraphToolResultSection {
  title: string;
  items: string[];
}

export interface GraphToolResultStat {
  label: string;
  value: string;
}

export interface GraphToolResultViewModel {
  tool: GraphToolName;
  action: string;
  isError: boolean;
  summary: string;
  panelMeta?: string;
  isEmpty?: boolean;
  stats?: GraphToolResultStat[];
  table?: GraphToolResultTable;
  codeBlock?: GraphToolResultCodeBlock;
  sections?: GraphToolResultSection[];
  rawBody?: string;
}

export interface ParseGraphToolResultInput {
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  text: string;
  isError?: boolean;
}

export const GRAPH_TOOL_NAMES = new Set<GraphToolName>([
  'graph_index',
  'graph_query',
  'graph_trace',
]);

export function isGraphToolName(name: string | undefined): name is GraphToolName {
  return Boolean(name && GRAPH_TOOL_NAMES.has(name as GraphToolName));
}
