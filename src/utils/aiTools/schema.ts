/**
 * Zod schemas for AI tool parameter validation
 * 
 * Provides runtime validation for tool parameters to prevent:
 * - Command injection attacks
 * - Invalid parameter types
 * - Missing required parameters
 * - Parameter format violations
 */

import { z } from 'zod';

/**
 * Base schema for all tool parameters
 */
const ToolParametersSchema = z.object({
  // Common parameters across multiple tools
  path: z.string().optional(),
  file_path: z.string().optional(),
  terminal_id: z.string().optional(),
  working_dir: z.string().optional(),
  command: z.string().optional(),
  action: z.string().optional(),
  timeout: z.number().int().positive().max(600000).optional(), // max 10 minutes
  description: z.string().optional(),
  
  // Tool-specific parameters
  old_string: z.string().optional(),
  new_string: z.string().optional(),
  replace_all: z.boolean().optional(),
  start_line: z.number().int().positive().optional(),
  max_lines: z.number().int().positive().optional(),
  max_bytes: z.number().int().positive().optional(),
  content: z.string().optional(),
  pattern: z.string().optional(),
  include: z.string().optional(),
  max_depth: z.number().int().positive().optional(),
  show_hidden: z.boolean().optional(),
  recursive: z.boolean().optional(),
  case_sensitive: z.boolean().optional(),
  regex: z.boolean().optional(),
  file_glob: z.string().optional(),
  glob: z.string().optional(),
  base_dir: z.string().optional(),
  file: z.string().optional(),
  branch: z.string().optional(),
  url: z.string().url().optional(),
  title: z.string().optional(),
  questions: z.array(z.object({
    header: z.string().optional(),
    question: z.string(),
    options: z.array(z.object({
      label: z.string(),
      description: z.string().optional(),
    })).optional(),
    multiSelect: z.boolean().optional(),
    multiple: z.boolean().optional(),
  })).optional(),
  todos: z.array(z.object({
    content: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
    priority: z.enum(['high', 'medium', 'low']).optional(),
  })).optional(),
  run_in_background: z.boolean().optional(),
  no_output_expected: z.boolean().optional(),
});

/**
 * Terminal tool specific schema
 */
const TerminalToolSchema = ToolParametersSchema.extend({
  action: z.enum(['run', 'read_output', 'list_bg', 'kill']),
  command: z.string().optional(),
  terminal_id: z.string().optional(),
  tid: z.string().optional(),
  working_dir: z.string().optional(),
  cwd: z.string().optional(),
  shell: z.string().optional(),
  timeout: z.number().int().positive().max(600000).optional(),
  description: z.string().optional(),
  desc: z.string().optional(),
  run_in_background: z.boolean().optional(),
  bg: z.boolean().optional(),
  no_output_expected: z.boolean().optional(),
  quiet: z.boolean().optional(),
  max_lines: z.number().int().positive().optional(),
  script: z.string().optional(),
}).refine(
  (data) => {
    if (data.action === 'run' && !data.command && !data.script) {
      return false;
    }
    if (data.action === 'read_output' && !data.terminal_id && !data.tid) {
      return false;
    }
    if (data.action === 'kill' && !data.terminal_id && !data.tid) {
      return false;
    }
    return true;
  },
  {
    message: 'Missing required parameters for action',
    path: ['action'],
  }
);

/**
 * File operation tool schemas
 */
const EditFileSchema = ToolParametersSchema.extend({
  path: z.string(),
  old_string: z.string(),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
}).refine(
  (data) => data.old_string.trim().length > 0,
  {
    message: 'old_string cannot be empty or whitespace only',
    path: ['old_string'],
  }
);

const ReadFileSchema = ToolParametersSchema.extend({
  path: z.union([z.string(), z.array(z.string())]),
  start_line: z.number().int().positive().optional(),
  max_lines: z.number().int().positive().optional(),
  max_bytes: z.number().int().positive().optional(),
  encoding: z.string().optional(),
  search: z.string().optional(),
  around_line: z.number().int().positive().optional(),
});

const WriteFileSchema = ToolParametersSchema.extend({
  path: z.string(),
  content: z.string(),
  append: z.boolean().optional(),
  prepend: z.boolean().optional(),
  if_not_exists: z.boolean().optional(),
  template_vars: z.record(z.string(), z.string()).optional(),
});

const DeleteFileSchema = ToolParametersSchema.extend({
  path: z.string(),
  permanent: z.boolean().optional(),
});

const SearchFilesSchema = ToolParametersSchema.extend({
  pattern: z.string(),
  include: z.string().optional(),
  max_depth: z.number().int().positive().optional(),
  show_hidden: z.boolean().optional(),
  recursive: z.boolean().optional(),
});

const SearchContentSchema = ToolParametersSchema.extend({
  pattern: z.string().optional(),
  include: z.string().optional(),
  file_glob: z.string().optional(),
  glob: z.string().optional(),
  case_sensitive: z.boolean().optional(),
  regex: z.boolean().optional(),
  max_depth: z.number().int().positive().optional(),
});

/**
 * Git tool schemas
 */
const GitDiffSchema = ToolParametersSchema.extend({
  file: z.string().optional(),
  base_dir: z.string().optional(),
  branch: z.string().optional(),
});

const UndoChangesSchema = ToolParametersSchema.extend({
  path: z.string(),
  base_dir: z.string().optional(),
});

/**
 * Browser tool schemas
 */
const ControlBrowserSchema = ToolParametersSchema.extend({
  action: z.enum(['open', 'close', 'navigate', 'refresh', 'back', 'forward']),
  url: z.string().url().optional(),
  title: z.string().optional(),
}).refine(
  (data) => {
    if (['open', 'navigate'].includes(data.action) && !data.url) {
      return false;
    }
    return true;
  },
  {
    message: 'URL is required for open and navigate actions',
    path: ['url'],
  }
);

const FetchWebContentSchema = ToolParametersSchema.extend({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  timeout: z.number().int().positive().max(600).optional(),
  follow_redirects: z.boolean().optional(),
  extract_links: z.boolean().optional(),
});

/**
 * Get symbol definition tool schema
 */
const GetSymbolDefinitionSchema = ToolParametersSchema.extend({
  file_path: z.string(),
  symbol_name: z.string(),
  line_number: z.number().int().positive().optional(),
});

/**
 * File info merged tool schema
 */
const FileInfoSchema = ToolParametersSchema.extend({
  action: z.enum(['list', 'tree', 'info']),
  path: z.string().optional(),
  root_path: z.string().optional(),
  max_depth: z.number().int().positive().optional(),
  dirs_only: z.boolean().optional(),
});

/**
 * Search merged tool schema
 */
const SearchMergedSchema = ToolParametersSchema.extend({
  type: z.enum(['files', 'content', 'both']),
  pattern: z.string().optional(),
  query: z.string().optional(),
  folder_path: z.string().optional(),
  case_sensitive: z.boolean().optional(),
  regex: z.boolean().optional(),
  glob: z.string().optional(),
  file_glob: z.string().optional(),
  exclude: z.string().optional(),
  context_lines: z.number().int().nonnegative().optional(),
  max_results: z.number().int().positive().optional(),
}).refine(
  (data) => {
    if (data.type === 'files' && !data.pattern) return false;
    if (data.type === 'content' && !data.query && !data.pattern) return false;
    if (data.type === 'both' && !data.query && !data.pattern) return false;
    return true;
  },
  { message: 'Missing required parameters for search type', path: ['type'] }
);

/**
 * Git merged tool schema
 */
const GitMergedSchema = ToolParametersSchema.extend({
  action: z.enum(['diff', 'undo']),
  repo_path: z.string().optional(),
  file_path: z.string().optional(),
  file_paths: z.array(z.string()).optional(),
  cached: z.boolean().optional(),
  max_lines: z.number().int().positive().optional(),
});

/**
 * Load skill schema
 */
const LoadSkillSchema = ToolParametersSchema.extend({
  skill_name: z.string(),
});

import { IMAGE_GENERATION_SIZES, SENSENOVA_IMAGE_SIZES } from '../../components/settings/types';

const GenerateImageSchema = ToolParametersSchema.extend({
  prompt: z.string(),
  model: z.string().optional(),
  size: z
    .union([z.enum(IMAGE_GENERATION_SIZES), z.enum(SENSENOVA_IMAGE_SIZES), z.string()])
    .optional(),
  quality: z.enum(['standard', 'hd']).optional(),
  n: z.number().int().min(1).max(4).optional(),
});

const RunSubagentSchema = ToolParametersSchema.extend({
  task: z.string(),
  context: z.string().optional(),
  allowed_tools: z.array(z.string()).optional(),
  model: z.string().optional(),
  preset: z.string().optional(),
  subagent_type: z.string().optional(),
  max_tool_rounds: z.number().int().positive().optional(),
  context_budget: z.number().int().positive().optional(),
  async: z.boolean().optional(),
});

const AgentToolSchema = ToolParametersSchema.extend({
  prompt: z.string(),
  subagent_type: z.string().optional(),
  description: z.string().optional(),
  context: z.string().optional(),
  model: z.string().optional(),
  allowed_tools: z.array(z.string()).optional(),
  max_tool_rounds: z.number().int().positive().optional(),
  context_budget: z.number().int().positive().optional(),
  run_in_background: z.boolean().optional(),
  async: z.boolean().optional(),
  resume: z.string().optional(),
  spawn_mode: z.enum(['isolated', 'fork']).optional(),
});

const RunSubagentsSchema = ToolParametersSchema.extend({
  tasks: z.array(
    z.object({
      task: z.string(),
      context: z.string().optional(),
      allowed_tools: z.array(z.string()).optional(),
      model: z.string().optional(),
      preset: z.string().optional(),
      subagent_type: z.string().optional(),
      max_tool_rounds: z.number().int().positive().optional(),
      context_budget: z.number().int().positive().optional(),
    })
  ).min(1),
});

/**
 * Interaction tool schemas
 */
const AskUserQuestionSchema = ToolParametersSchema.extend({
  questions: z.array(z.object({
    header: z.string(),
    question: z.string(),
    options: z.array(z.object({
      label: z.string(),
      description: z.string().optional(),
    })),
    multiSelect: z.boolean().optional(),
  })).min(1),
});

const TodoWriteSchema = ToolParametersSchema.extend({
  todos: z.array(z.object({
    content: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
    priority: z.enum(['high', 'medium', 'low']).optional(),
  })).min(1),
});

const GraphIndexSchema = ToolParametersSchema.extend({
  action: z.enum(['index', 'status', 'list', 'delete']),
  repo_path: z.string().optional(),
  project: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.action === 'index' && !data.repo_path?.trim() && !data.project?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'repo_path or project is required for action=index',
      path: ['repo_path'],
    });
  }
});

const GraphQuerySchema = ToolParametersSchema.extend({
  action: z.enum(['search', 'snippet', 'query', 'schema', 'code', 'list']),
  repo_path: z.string().optional(),
  project: z.string().optional(),
  name_pattern: z.string().optional(),
  label: z.string().optional(),
  file_pattern: z.string().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  qualified_name: z.string().optional(),
  qn_pattern: z.string().optional(),
  query: z.string().optional(),
  pattern: z.string().optional(),
  regex: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (
    data.action === 'snippet' &&
    !data.qualified_name?.trim() &&
    !data.name_pattern?.trim()
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'qualified_name or name_pattern is required for snippet',
      path: ['qualified_name'],
    });
  }
  if (data.action === 'query' && !data.query?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'action=query requires `query` (Cypher MATCH string). Example: MATCH (f:Function) RETURN f.name LIMIT 10',
      path: ['query'],
    });
  }
  if (data.action === 'code' && !data.pattern?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'action=code requires `pattern` (text/regex to grep inside symbol bodies, e.g. "TODO")',
      path: ['pattern'],
    });
  }
});

const GraphTraceSchema = ToolParametersSchema.extend({
  action: z.enum(['trace', 'architecture', 'changes']),
  repo_path: z.string().optional(),
  project: z.string().optional(),
  function_name: z.string().optional(),
  direction: z.enum(['inbound', 'outbound', 'both']).optional(),
  depth: z.number().int().min(1).max(5).optional(),
  scope: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.action === 'trace' && !data.function_name?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'function_name is required for trace',
      path: ['function_name'],
    });
  }
});

/**
 * Utility function to validate tool parameters against schema
 */
export function validateToolParameters(
  toolName: string,
  params: Record<string, unknown>
): { success: true; data: any } | { success: false; error: string } {
  try {
    let schema;
    
    switch (toolName) {
      case 'term':
      case 'terminal':
        schema = TerminalToolSchema;
        break;
      case 'edit':
      case 'edit_file':
        schema = EditFileSchema;
        break;
      case 'read':
      case 'read_file':
        schema = ReadFileSchema;
        break;
      case 'write':
      case 'write_file':
        schema = WriteFileSchema;
        break;
      case 'delete_file':
        schema = DeleteFileSchema;
        break;
      case 'search_files':
        schema = SearchFilesSchema;
        break;
      case 'search_content':
        schema = SearchContentSchema;
        break;
      case 'git_diff':
      case 'get_git_diff':
        schema = GitDiffSchema;
        break;
      case 'undo_changes':
        schema = UndoChangesSchema;
        break;
      case 'browser':
      case 'control_browser':
        schema = ControlBrowserSchema;
        break;
      case 'fetch':
      case 'fetch_web_content':
        schema = FetchWebContentSchema;
        break;
      case 'ask':
      case 'ask_user_question':
        schema = AskUserQuestionSchema;
        break;
      case 'todo':
      case 'TodoWrite':
        schema = TodoWriteSchema;
        break;
      case 'finfo':
      case 'file_info':
        schema = FileInfoSchema;
        break;
      case 'search':
        schema = SearchMergedSchema;
        break;
      case 'git':
        schema = GitMergedSchema;
        break;
      case 'skill':
      case 'load_skill':
        schema = LoadSkillSchema;
        break;
      case 'generate_image':
        schema = GenerateImageSchema;
        break;
      case 'run_subagent':
        schema = RunSubagentSchema;
        break;
      case 'run_subagents':
        schema = RunSubagentsSchema;
        break;
      case 'Agent':
      case 'Task':
        schema = AgentToolSchema;
        break;
      case 'sym':
      case 'get_symbol_definition':
        schema = GetSymbolDefinitionSchema;
        break;
      case 'graph_index':
        schema = GraphIndexSchema;
        break;
      case 'graph_query':
        schema = GraphQuerySchema;
        break;
      case 'graph_trace':
        schema = GraphTraceSchema;
        break;
      default:
        // For tools without specific schema, use base validation
        schema = ToolParametersSchema;
    }
    
    const result = schema.safeParse(params);
    
    if (result.success) {
      return { success: true, data: result.data };
    } else {
      // Handle case where result.error might be undefined
      if (result.error && result.error.issues) {
        const errors = result.error.issues.map(err =>
          `${err.path.join('.')}: ${err.message}`
        ).join(', ');
        return { 
          success: false, 
          error: `Validation failed for tool "${toolName}": ${errors}` 
        };
      } else {
        return { 
          success: false, 
          error: `Validation failed for tool "${toolName}" with unknown error` 
        };
      }
    }
  } catch (error) {
    return { 
      success: false, 
      error: `Validation error for tool "${toolName}": ${error instanceof Error ? error.message : String(error)}` 
    };
  }
}
