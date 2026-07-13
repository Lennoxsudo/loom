import type { ToolCall, ToolResult } from '../../types/ai';
import type { ToolContext } from './types';
import { parseToolArguments } from './argsParser';
import { normalizeToolArgs } from './paramNormalizer';
// New merged tool names (short) + legacy merged names for backward compatibility
const MERGED_TOOL_NAMES = new Set(['term', 'finfo', 'search', 'git', 'terminal', 'file_info']);

type RoutedTool = {
  toolName: string;
  args: Record<string, unknown>;
};

const MERGED_TOOL_ROUTES: Record<string, (args: Record<string, unknown>) => RoutedTool | null> = {
  term: (args) => {
    const action = String(args.action ?? '').toLowerCase();
    if (action === 'run') return {
      toolName: 'run_command',
      args: {
        command: args.command,
        terminal_id: args.terminal_id ?? args.tid,
        working_dir: args.working_dir ?? args.cwd,
        shell: args.shell,
        timeout: args.timeout,
        description: args.description ?? args.desc,
        run_in_background: args.run_in_background ?? args.bg,
        no_output_expected: args.no_output_expected ?? args.quiet,
        max_lines: args.max_lines,
        script: args.script,
      },
    };
    if (action === 'read_output') return { toolName: 'read_terminal_output', args: { terminal_id: args.terminal_id ?? args.tid } };
    if (action === 'list_bg') return { toolName: 'list_bg_tasks', args: {} };
    if (action === 'kill') return { toolName: 'kill_bg_task', args: { terminal_id: args.terminal_id ?? args.tid } };
    return null;
  },
  finfo: (args) => {
    const action = String(args.action ?? '').toLowerCase();
    if (action === 'list') return { toolName: 'list_directory', args: { path: args.path, dirs_only: args.dirs_only } };
    if (action === 'tree') return { toolName: 'get_file_tree', args: { root_path: args.root_path ?? args.path, max_depth: args.max_depth ?? args.depth, dirs_only: args.dirs_only } };
    if (action === 'info' || action === 'stat') return { toolName: 'get_file_info', args: { path: args.path } };
    return null;
  },
  search: (args) => {
    const searchType = String(args.type ?? args.action ?? '').toLowerCase();
    if (searchType === 'files' || searchType === 'glob' || searchType === 'file') return { toolName: 'search_files', args: { pattern: args.pattern, folder_path: args.folder_path ?? args.dir, max_results: args.max_results ?? args.limit, exclude: args.exclude } };
    if (searchType === 'content' || searchType === 'grep' || searchType === 'text') return { toolName: 'search_content', args: { query: args.query ?? args.pattern, folder_path: args.folder_path ?? args.dir, case_sensitive: args.case_sensitive ?? args.cs, regex: args.regex, file_glob: args.file_glob ?? args.glob, max_results: args.max_results ?? args.limit, exclude: args.exclude, context_lines: args.context_lines } };
    if (searchType === 'both') return { toolName: 'search_both', args: { pattern: args.pattern, query: args.query ?? args.pattern, folder_path: args.folder_path ?? args.dir, case_sensitive: args.case_sensitive ?? args.cs, regex: args.regex, file_glob: args.file_glob ?? args.glob, max_results: args.max_results ?? args.limit, exclude: args.exclude, context_lines: args.context_lines } };
    return null;
  },
  git: (args) => {
    const action = String(args.action ?? '').toLowerCase();
    if (action === 'diff') return { toolName: 'get_git_diff', args: { repo_path: args.repo_path ?? args.repo, file_path: args.file_path ?? args.file, cached: args.cached, max_lines: args.max_lines ?? args.limit } };
    if (action === 'undo' || action === 'checkout' || action === 'restore') return { toolName: 'undo_changes', args: { repo_path: args.repo_path ?? args.repo, file_paths: args.file_paths ?? args.paths } };
    return null;
  },
  // Legacy merged names route to same handlers
  terminal: (args) => MERGED_TOOL_ROUTES.term(args),
  file_info: (args) => MERGED_TOOL_ROUTES.finfo(args),
};

export function isMergedToolName(name: string): boolean {
  return MERGED_TOOL_NAMES.has(name);
}

function routeMergedTool(name: string, args: Record<string, unknown>): RoutedTool | null {
  const router = MERGED_TOOL_ROUTES[name];
  if (!router) return null;
  return router(args);
}

export function resolveUnderlyingToolName(mergedName: string, args?: Record<string, unknown>): string {
  if (!isMergedToolName(mergedName)) return mergedName;
  if (!args) return mergedName;

  const routed = routeMergedTool(mergedName, args);
  return routed ? routed.toolName : mergedName;
}

export async function executeMergedToolCall(
  toolCall: ToolCall,
  context?: ToolContext
): Promise<ToolResult> {
  const { id, function: func } = toolCall;
  const { name, arguments: argsStr } = func;

  let args: Record<string, unknown>;
  try {
    args = parseToolArguments(typeof argsStr === 'string' ? argsStr : JSON.stringify(argsStr ?? {})) as Record<string, unknown>;
  } catch (parseError) {
    return { tool_call_id: id, output: '', error: `参数解析失败: ${parseError}` };
  }

  args = normalizeToolArgs(args, name);

  const routed = routeMergedTool(name, args);
  if (!routed) {
    return {
      tool_call_id: id,
      output: '',
      error: `合并工具 "${name}" 的 action 参数无效或缺失。请指定有效的 action。`,
    };
  }

  // Lazy import avoids registry ↔ handlers ↔ bootstrap ↔ settings ↔ toolRouter cycle.
  const { getToolHandler } = await import('./registry');
  const handler = getToolHandler(routed.toolName as never);
  if (!handler) {
    return { tool_call_id: id, output: '', error: `未找到处理器: ${routed.toolName}` };
  }

  const normalizedRoutedArgs = normalizeToolArgs(routed.args, routed.toolName);

  try {
    const result = await handler.execute(normalizedRoutedArgs as never, {
      ...context,
      toolCallId: id,
    });
    result.tool_call_id = id;

    return result;
  } catch (error) {
    return { tool_call_id: id, output: '', error: `工具执行失败: ${error}` };
  }
}
