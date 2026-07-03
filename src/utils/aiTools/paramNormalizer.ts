/**
 * 参数规范化模块
 *
 * 本模块提供工具参数名称的规范化能力，解决不同命名风格带来的兼容问题：
 * - camelCase: `filePath`, `terminalId`
 * - snake_case: `file_path`, `terminal_id`
 * - 其他变体: `path`, `folderPath`, `directoryPath`
 *
 * 主要功能：
 * - `normalizeToolArgs`: 规范化所有参数名
 *
 * @module aiTools/paramNormalizer
 *
 * @example
 * ```typescript
 * // 规范化参数
 * const args = { filePath: '/test/file.txt', maxResults: 50 };
 * const normalized = normalizeToolArgs(args);
 * // 结果: { path: '/test/file.txt', max_results: 50, filePath: '/test/file.txt', maxResults: 50 }
 *
 * ```
 */

import { normalizeGraphQueryArgs } from './graphQueryNormalize';

type ParamAliasConfig = {
  canonical: string;
  aliases: string[];
  description?: string;
};

const PARAM_ALIASES: ParamAliasConfig[] = [
  {
    canonical: 'old_string',
    aliases: ['old_string', 'oldString', 'old_text', 'old'],
    description: 'Text to find and replace',
  },
  {
    canonical: 'new_string',
    aliases: ['new_string', 'newString', 'new_text', 'new'],
    description: 'Replacement text',
  },
  {
    canonical: 'output_id',
    aliases: ['output_id', 'outputId', 'oid'],
    description: 'Output identifier for truncated results',
  },
  {
    canonical: 'line_number',
    aliases: ['line_number', 'lineNumber', 'line'],
    description: 'Line number hint',
  },
  {
    canonical: 'folder_path',
    aliases: ['folder_path', 'folderPath', 'dir', 'directory'],
    description: 'Directory path for search',
  },
  {
    canonical: 'path',
    aliases: ['path', 'filePath', 'file_path', 'directoryPath', 'directory_path', 'folderPath', 'folder_path'],
    description: 'File or directory path',
  },
  {
    canonical: 'terminal_id',
    aliases: ['terminal_id', 'terminalId', 'terminal', 'tid'],
    description: 'Terminal identifier',
  },
  {
    canonical: 'working_dir',
    aliases: ['working_dir', 'workingDir', 'cwd'],
    description: 'Working directory',
  },
  {
    canonical: 'root_path',
    aliases: ['root_path', 'rootPath', 'folder_path', 'folderPath', 'project_path', 'projectPath'],
    description: 'Root path for operations',
  },
  {
    canonical: 'file_paths',
    aliases: ['file_paths', 'filePaths', 'paths'],
    description: 'List of file paths',
  },
  {
    canonical: 'max_results',
    aliases: ['max_results', 'maxResults', 'limit', 'max_count'],
    description: 'Maximum number of results',
  },
  {
    canonical: 'max_lines',
    aliases: ['max_lines', 'maxLines', 'line_limit', 'limit', 'max_output_lines'],
    description: 'Maximum number of lines to read or output',
  },
  {
    canonical: 'max_bytes',
    aliases: ['max_bytes', 'maxBytes', 'byte_limit', 'maxb'],
    description: 'Maximum bytes to read',
  },
  {
    canonical: 'start_line',
    aliases: ['start_line', 'startLine', 'line_offset', 'from'],
    description: 'Starting line number',
  },
  {
    canonical: 'case_sensitive',
    aliases: ['case_sensitive', 'caseSensitive', 'caseSensitiveSearch', 'cs'],
    description: 'Whether search is case sensitive',
  },
  {
    canonical: 'file_glob',
    aliases: ['file_glob', 'fileGlob', 'glob', 'include', 'file_filter'],
    description: 'Glob pattern to filter files in content search',
  },
  {
    canonical: 'replace_all',
    aliases: ['replace_all', 'replaceAll', 'replace_all_occurrences', 'all'],
    description: 'Replace all occurrences',
  },
  {
    canonical: 'repo_path',
    aliases: ['repo_path', 'repoPath', 'repository_path', 'git_path', 'repo'],
    description: 'Git repository path',
  },
  {
    canonical: 'file_path',
    aliases: ['file_path', 'filePath', 'target_file', 'file', 'path'],
    description: 'Target file path',
  },
  {
    canonical: 'source',
    aliases: ['source', 'sourcePath', 'source_path', 'oldPath', 'old_path'],
    description: 'Source path for move/copy operations',
  },
  {
    canonical: 'destination',
    aliases: ['destination', 'destPath', 'dest_path', 'newPath', 'new_path'],
    description: 'Destination path for move/copy operations',
  },
  {
    canonical: 'command',
    aliases: ['command', 'cmd', 'shell_command'],
    description: 'Shell command to execute',
  },
  {
    canonical: 'url',
    aliases: ['url', 'URL', 'uri', 'URI', 'link'],
    description: 'URL for web operations',
  },
  {
    canonical: 'selector',
    aliases: ['selector', 'cssSelector', 'css_selector', 'element'],
    description: 'CSS selector for browser operations',
  },
  {
    canonical: 'value',
    aliases: ['value', 'text', 'content', 'input'],
    description: 'Value to fill or input',
  },
  {
    canonical: 'script',
    aliases: ['script', 'code', 'javascript', 'js'],
    description: 'JavaScript code to execute',
  },
  {
    canonical: 'shell_script',
    aliases: ['shell_script', 'shellScript', 'script_content', 'scriptContent', 'multiline_script'],
    description: 'Multi-line shell script content for terminal execution',
  },
  {
    canonical: 'pattern',
    aliases: ['pattern', 'regex', 'glob', 'search_pattern'],
    description: 'Search pattern',
  },
  {
    canonical: 'query',
    aliases: ['query', 'searchQuery', 'search_query', 'search'],
    description: 'Search query string',
  },
  {
    canonical: 'symbol_name',
    aliases: ['symbol_name', 'symbolName', 'symbol', 'name'],
    description: 'Symbol name to search for',
  },
  {
    canonical: 'permanent',
    aliases: ['permanent', 'force', 'skip_trash'],
    description: 'Whether to permanently delete',
  },
  {
    canonical: 'overwrite',
    aliases: ['overwrite', 'force_overwrite'],
    description: 'Whether to overwrite existing file',
  },
  {
    canonical: 'append',
    aliases: ['append', 'append_mode', 'mode'],
    description: 'Whether to append to file instead of overwriting',
  },
  {
    canonical: 'prepend',
    aliases: ['prepend', 'prepend_mode', 'insert_at_top', 'insert_head'],
    description: 'Whether to prepend content at file head',
  },
  {
    canonical: 'if_not_exists',
    aliases: ['if_not_exists', 'ifNotExists', 'create_only', 'no_overwrite', 'skip_existing'],
    description: 'Skip write if file already exists',
  },
  {
    canonical: 'template_vars',
    aliases: ['template_vars', 'templateVars', 'variables', 'vars', 'template'],
    description: 'Template variable substitution map',
  },
  {
    canonical: 'cached',
    aliases: ['cached', 'staged', 'is_cached'],
    description: 'Whether to show cached changes',
  },
  {
    canonical: 'tool',
    aliases: ['tool', 'linter', 'analyzer'],
    description: 'Tool name for diagnostics',
  },
  {
    canonical: 'severity_filter',
    aliases: ['severity_filter', 'severityFilter', 'severity', 'level'],
    description: 'Filter by severity level',
  },
  {
    canonical: 'max_depth',
    aliases: ['max_depth', 'maxDepth', 'depth'],
    description: 'Maximum directory depth',
  },
  {
    canonical: 'dirs_only',
    aliases: ['dirs_only', 'dirsOnly', 'directories_only'],
    description: 'Only show directories',
  },
  {
    canonical: 'action',
    aliases: ['action', 'operation', 'type'],
    description: 'Action to perform',
  },
  {
    canonical: 'timeout',
    aliases: ['timeout', 'timeout_ms', 'timeoutMs', 'max_time', 'maxTime'],
    description: 'Timeout in milliseconds',
  },
  {
    canonical: 'description',
    aliases: ['description', 'desc', 'purpose'],
    description: 'Brief description of what the command does',
  },
  {
    canonical: 'run_in_background',
    aliases: ['run_in_background', 'runInBackground', 'background', 'bg', 'daemon'],
    description: 'Run command in background',
  },
  {
    canonical: 'encoding',
    aliases: ['encoding', 'charset', 'enc', 'file_encoding'],
    description: 'Character encoding for reading files',
  },
  {
    canonical: 'no_output_expected',
    aliases: ['no_output_expected', 'noOutputExpected', 'quiet'],
    description: 'Whether the command is expected to produce no output',
  },
  {
    canonical: 'shell',
    aliases: ['shell', 'shell_type', 'shellType', 'shell_name', 'shellName'],
    description: 'Shell type for command execution',
  },
  {
    canonical: 'skill_name',
    aliases: ['skill_name', 'skillName', 'skill', 'name'],
    description: 'Skill name to load',
  },
  {
    canonical: 'exclude',
    aliases: ['exclude', 'excludes', 'exclude_dirs', 'ignore_dirs', 'skip_dirs'],
    description: 'Comma-separated directory names to exclude from search',
  },
  {
    canonical: 'context_lines',
    aliases: ['context_lines', 'contextLines', 'context', 'before_after', 'surrounding_lines'],
    description: 'Number of context lines before/after match',
  },
  {
    canonical: 'search',
    aliases: ['search', 'search_query', 'searchQuery', 'find', 'keyword', 'grep'],
    description: 'Search within a file for a keyword',
  },
  {
    canonical: 'around_line',
    aliases: ['around_line', 'aroundLine', 'center_line', 'centerLine', 'focus_line', 'at_line'],
    description: 'Line number to center context around',
  },
  {
    canonical: 'conflict',
    aliases: ['conflict', 'conflict_mode', 'on_conflict', 'collision'],
    description: 'How to handle destination conflicts: error, overwrite, or rename',
  },
  {
    canonical: 'glob',
    aliases: ['glob', 'glob_pattern', 'globPattern', 'pattern_match', 'wildcard'],
    description: 'Glob pattern for matching files to operate on',
  },
  {
    canonical: 'paths',
    aliases: ['paths', 'file_paths', 'filePaths', 'files', 'targets'],
    description: 'Array of file paths for batch operations',
  },
  {
    canonical: 'method',
    aliases: ['method', 'http_method', 'httpMethod', 'verb'],
    description: 'HTTP method for fetch requests',
  },
  {
    canonical: 'body',
    aliases: ['body', 'request_body', 'requestBody', 'data', 'payload'],
    description: 'Request body for POST/PUT/PATCH',
  },
  {
    canonical: 'follow_redirects',
    aliases: ['follow_redirects', 'followRedirects', 'followRedirect', 'redirects'],
    description: 'Whether to follow HTTP redirects',
  },
  {
    canonical: 'extract_links',
    aliases: ['extract_links', 'extractLinks', 'links', 'get_links', 'list_links'],
    description: 'Whether to extract links from HTML pages',
  },
];

const PARAM_ALIAS_MAP: Record<string, string[]> = Object.fromEntries(
  PARAM_ALIASES.map((config) => [config.canonical, config.aliases])
);

function findFirstValue(
  args: Record<string, unknown>,
  aliases: string[]
): unknown | undefined {
  for (const alias of aliases) {
    if (args[alias] !== undefined) {
      return args[alias];
    }
  }
  return undefined;
}

function findCanonicalValue(
  args: Record<string, unknown>,
  canonical: string
): unknown | undefined {
  const aliases = PARAM_ALIAS_MAP[canonical];
  if (!aliases) {
    return args[canonical];
  }
  return findFirstValue(args, aliases);
}

export function normalizeToolArgs(
  args: Record<string, unknown>,
  toolName?: string
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...args };

  for (const [canonical, aliases] of Object.entries(PARAM_ALIAS_MAP)) {
    if (result[canonical] !== undefined) continue;

    const value = findFirstValue(args, aliases);
    if (value !== undefined) {
      result[canonical] = value;
    }
  }

  if (toolName) {
    applyMergedToolNormalizations(result, toolName);
    const toolSpecificNormalizations = getToolSpecificNormalizations(toolName);
    for (const [key, value] of Object.entries(toolSpecificNormalizations)) {
      if (result[key] === undefined && value !== undefined) {
        result[key] = value;
      }
    }
  }

  if ((toolName === 'todo' || toolName === 'TodoWrite') && Array.isArray(result.todos)) {
    result.todos = (result.todos as Record<string, unknown>[]).map((todo) => {
      if (todo.status === 'in-progress' || todo.status === 'inprogress') {
        return { ...todo, status: 'in_progress' };
      }
      return todo;
    });
  }

  // Task / Agent tool (claude-code Agent-style) — normalize legacy parameter names
  if (toolName === 'Task' || toolName === 'Agent') {
    // prompt: accept legacy aliases 'task' and 'message'
    if (result.prompt === undefined && result.task !== undefined) {
      result.prompt = result.task;
      delete result.task;
    } else if (result.prompt === undefined && result.message !== undefined) {
      result.prompt = result.message;
      delete result.message;
    }
    // subagent_type: accept legacy alias 'agent_type'
    if (result.subagent_type === undefined && result.agent_type !== undefined) {
      result.subagent_type = result.agent_type;
      delete result.agent_type;
    }
    // Normalize old lowercase agent_type values to claude-code casing
    if (typeof result.subagent_type === 'string') {
      const lower = result.subagent_type.toLowerCase();
      const mapping: Record<string, string> = {
        'explore': 'Explore',
        'plan': 'Plan',
        'general': 'general-purpose',
        'general-purpose': 'general-purpose',
        'verification': 'verification',
        'bash': 'general-purpose', // bash mapped to general-purpose
      };
      if (mapping[lower]) {
        result.subagent_type = mapping[lower];
      }
    }
    // description: infer from prompt if not provided
    if (result.description === undefined && result.prompt !== undefined) {
      const promptStr = String(result.prompt);
      result.description = promptStr.length > 50 ? promptStr.slice(0, 47) + '...' : promptStr;
    }
  }

  return result;
}

function applyMergedToolNormalizations(result: Record<string, unknown>, toolName: string): void {
  if (toolName === 'term' || toolName === 'terminal') {
    const action = String(result.action ?? '').toLowerCase();
    if (action === 'run' && result.command === undefined && result.cmd !== undefined) {
      result.command = result.cmd;
    }
    // Map shell_script canonical to script for terminal tool
    if (result.script === undefined && result.shell_script !== undefined) {
      result.script = result.shell_script;
    }
  }
  if (toolName === 'search') {
    const searchType = String(result.type ?? result.action ?? '').toLowerCase();
    if (searchType === 'content' && result.query === undefined && result.pattern !== undefined) {
      result.query = result.pattern;
    }
    if (searchType === 'files' && result.pattern === undefined && result.query !== undefined) {
      result.pattern = result.query;
    }
  }
  if (toolName === 'finfo' || toolName === 'file_info') {
    if (result.root_path === undefined && result.path !== undefined) {
      result.root_path = result.path;
    }
  }
  if (toolName === 'graph_query') {
    Object.assign(result, normalizeGraphQueryArgs(result));
    // Object.assign does not remove keys dropped by normalizeGraphQueryArgs.
    if (typeof result.pattern === 'boolean') {
      if (result.regex === undefined) {
        result.regex = result.pattern;
      }
      delete result.pattern;
    }
  }
}

function getToolSpecificNormalizations(toolName: string): Record<string, unknown> {
  const normalizations: Record<string, unknown> = {};

  switch (toolName) {
    case 'read_file':
    case 'edit_file':
    case 'write_file':
    case 'delete_file':
    case 'get_file_info':
      if (!normalizations.path) {
        normalizations.path = findCanonicalValue(normalizations, 'path');
      }
      break;
    case 'search_files':
    case 'search_content':
    case 'list_directory':
      if (!normalizations.folder_path) {
        normalizations.folder_path = findCanonicalValue(normalizations, 'path') ||
          findCanonicalValue(normalizations, 'root_path');
      }
      break;
    case 'get_git_diff':
    case 'undo_changes':
      if (!normalizations.repo_path) {
        normalizations.repo_path = findCanonicalValue(normalizations, 'path') ||
          findCanonicalValue(normalizations, 'root_path');
      }
      break;
  }

  return normalizations;
}

