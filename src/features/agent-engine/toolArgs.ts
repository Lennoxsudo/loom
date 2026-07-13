export type ReadFileArgs = {
  path: string | string[];
  start_line?: number;
  max_lines?: number;
  max_bytes?: number;
  encoding?: string;
  /** Search within the file for a keyword and return matching lines with context */
  search?: string;
  /** Return N lines around a specific line number (centered context) */
  around_line?: number;
};

export type WriteFileArgs = {
  path: string;
  content: string;
  append?: boolean;
  prepend?: boolean;
  if_not_exists?: boolean;
  template_vars?: Record<string, string>;
};

export type EditFileArgs = {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
  base_dir?: string;
};

export type SearchFilesArgs = {
  pattern: string;
  folder_path?: string;
  max_results?: number;
  exclude?: string;
  max_depth?: number;
};

export type SearchContentArgs = {
  query: string;
  folder_path?: string;
  case_sensitive?: boolean;
  regex?: boolean;
  file_glob?: string;
  max_results?: number;
  exclude?: string;
  context_lines?: number;
};

export type ListDirectoryArgs = {
  path?: string;
  dirs_only?: boolean;
};

export type CreateFolderArgs = {
  path: string;
};

export type GetFileTreeArgs = {
  root_path?: string;
  max_depth?: number;
  dirs_only?: boolean;
};

export type GetFileInfoArgs = {
  path: string;
};

export type CopyFileArgs = {
  source: string;
  destination: string;
  overwrite?: boolean;
};

export type MoveFileArgs = {
  source: string;
  destination: string;
  overwrite?: boolean;
};

export type DeleteFileArgs = {
  path: string;
  permanent?: boolean;
};

export type RunCommandArgs = {
  command: string;
  terminal_id?: string;
  working_dir?: string;
  shell?: string;
  strip_ansi?: boolean;
  timeout?: number;
  description?: string;
  run_in_background?: boolean;
  no_output_expected?: boolean;
  max_lines?: number;
  script?: string;
};

export type GetGitDiffArgs = {
  repo_path?: string;
  file_path?: string;
  cached?: boolean;
  max_lines?: number;
};

export type UndoChangesArgs = {
  repo_path?: string;
  file_paths: string[];
};

export type GetSymbolDefinitionArgs = {
  file_path: string;
  symbol_name: string;
  line_number?: number;
};

export type ControlBrowserArgs = {
  action: 'open' | 'navigate' | 'refresh';
  url?: string;
};

export type FetchWebContentArgs = {
  url: string;
  /** HTTP method: GET (default), POST, PUT, DELETE, PATCH, HEAD */
  method?: string;
  /** Custom request headers (e.g., Authorization, Cookie) */
  headers?: Record<string, string>;
  /** Request body for POST/PUT/PATCH */
  body?: string;
  /** Timeout in seconds (default 60) */
  timeout?: number;
  /** Whether to follow redirects (default true). Set false to debug redirect chains. */
  follow_redirects?: boolean;
  /** Whether to extract and list links from HTML pages (default false) */
  extract_links?: boolean;
};

export type WebSearchArgs = {
  /** Search keywords */
  query: string;
  /** Max results (1–10, default 5) */
  num_results?: number;
};

export type TodoWriteArgs = {
  clear?: boolean;
  todos?: Array<{
    id?: string;
    content: string;
    status: string;
  }>;
};

type QuestionOption = {
  label: string;
  description: string;
};

export type QuestionInput = {
  header: string;
  question: string;
  options: QuestionOption[];
  multiSelect?: boolean;
};

export type UserAnswer = {
  questionIndex: number;
  selected: string[];
};

export type AskUserQuestionArgs = {
  questions: QuestionInput[];
};

export type LoadSkillArgs = {
  skill_name: string;
};

import type { ImageGenerationSize, SenseNovaImageSize } from '../../shared/lib/imageGenSizes';

export type GenerateImageArgs = {
  prompt: string;
  model?: string;
  size?: ImageGenerationSize | SenseNovaImageSize | string;
  quality?: 'standard' | 'hd';
  n?: number;
};

export type RunSubagentArgs = {
  task: string;
  context?: string;
  allowed_tools?: string[];
  model?: string;
  preset?: string;
  subagent_type?: string;
  max_tool_rounds?: number;
  context_budget?: number;
  async?: boolean;
};

export type AgentToolArgs = {
  prompt: string;
  subagent_type?: string;
  description?: string;
  context?: string;
  model?: string;
  allowed_tools?: string[];
  max_tool_rounds?: number;
  context_budget?: number;
  run_in_background?: boolean;
  async?: boolean;
  resume?: string;
  spawn_mode?: 'isolated' | 'fork';
};

export type RunSubagentsArgs = {
  tasks: Array<{
    task: string;
    context?: string;
    allowed_tools?: string[];
    model?: string;
    preset?: string;
    subagent_type?: string;
    max_tool_rounds?: number;
    context_budget?: number;
  }>;
};


type TerminalMergedArgs = {
  action: 'run' | 'read_output' | 'list_bg' | 'kill';
  command?: string;
  terminal_id?: string;
  working_dir?: string;
  shell?: string;
  timeout?: number;
  description?: string;
  run_in_background?: boolean;
  no_output_expected?: boolean;
  max_lines?: number;
  script?: string;
};

export type ReadTerminalOutputArgs = {
  terminal_id?: string;
};

type FileInfoMergedArgs = {
  action: 'list' | 'tree' | 'info';
  path?: string;
  root_path?: string;
  max_depth?: number;
  dirs_only?: boolean;
};

type SearchMergedArgs = {
  type: 'files' | 'content' | 'both';
  pattern?: string;
  query?: string;
  folder_path?: string;
  case_sensitive?: boolean;
  regex?: boolean;
  glob?: string;
  exclude?: string;
  context_lines?: number;
  max_results?: number;
};

type GraphIndexArgs = {
  action: 'index' | 'status' | 'list' | 'delete';
  repo_path?: string;
  project?: string;
};

type GraphQueryArgs = {
  action: 'search' | 'snippet' | 'query' | 'schema' | 'code' | 'list';
  repo_path?: string;
  project?: string;
  name_pattern?: string;
  label?: string;
  file_pattern?: string;
  limit?: number;
  offset?: number;
  qualified_name?: string;
  query?: string;
  pattern?: string;
  // Alias fields accepted by normalizer
  code?: string;
  text?: string;
  grep?: string;
  keyword?: string;
  search_text?: string;
  script?: string;
  cypher?: string;
  cypher_query?: string;
  graph_query?: string;
  statement?: string;
  sql?: string;
  name?: string;
  symbol?: string;
  symbol_name?: string;
  full_name?: string;
  qn_pattern?: string;
  regex?: boolean;
  // Degree-filter fields (rewriteGraphSearchDegreeFilter)
  relationship?: string;
  relationship_type?: string;
  edge_type?: string;
  rel_type?: string;
  min_degree?: number;
  minDegree?: number;
  max_degree?: number;
  maxDegree?: number;
  exclude_entry_points?: boolean;
  direction?: string;
  // Internal flag set by normalizeGraphQueryArgs
  _code_property_rewrite?: boolean;
};

type GraphTraceArgs = {
  action: 'trace' | 'architecture' | 'changes';
  repo_path?: string;
  project?: string;
  function_name?: string;
  direction?: 'inbound' | 'outbound' | 'both';
  depth?: number;
  scope?: string;
};

export type { GraphIndexArgs, GraphQueryArgs, GraphTraceArgs };

type GitMergedArgs = {
  action: 'diff' | 'undo';
  repo_path?: string;
  file_path?: string;
  file_paths?: string[];
  cached?: boolean;
  max_lines?: number;
};

type ToolArgsMap = {
  term: TerminalMergedArgs;
  finfo: FileInfoMergedArgs;
  search: SearchMergedArgs;
  git: GitMergedArgs;
  read: ReadFileArgs;
  write: WriteFileArgs;
  edit: EditFileArgs;
  sym: GetSymbolDefinitionArgs;
  browser: ControlBrowserArgs;
  fetch: FetchWebContentArgs;
  web_search: WebSearchArgs;
  todo: TodoWriteArgs;
  ask: AskUserQuestionArgs;
  skill: LoadSkillArgs;
  generate_image: GenerateImageArgs;
  run_subagent: RunSubagentArgs;
  run_subagents: RunSubagentsArgs;
  Agent: AgentToolArgs;
  Task: AgentToolArgs;
  graph_index: GraphIndexArgs;
  graph_query: GraphQueryArgs;
  graph_trace: GraphTraceArgs;

  // Legacy names (kept for backward compatibility with stored conversations)
  terminal: TerminalMergedArgs;
  file_info: FileInfoMergedArgs;
  read_file: ReadFileArgs;
  write_file: WriteFileArgs;
  edit_file: EditFileArgs;
  get_symbol_definition: GetSymbolDefinitionArgs;
  control_browser: ControlBrowserArgs;
  fetch_web_content: FetchWebContentArgs;
  TodoWrite: TodoWriteArgs;
  ask_user_question: AskUserQuestionArgs;
  load_skill: LoadSkillArgs;
  run_command: RunCommandArgs;
  read_terminal_output: ReadTerminalOutputArgs;
  list_bg_tasks: Record<string, never>;
  kill_bg_task: { terminal_id?: string };
  search_files: SearchFilesArgs;
  search_content: SearchContentArgs;
  search_both: SearchContentArgs;
  list_directory: ListDirectoryArgs;
  create_folder: CreateFolderArgs;
  get_file_tree: GetFileTreeArgs;
  get_file_info: GetFileInfoArgs;
  move_file: MoveFileArgs;
  copy_file: CopyFileArgs;
  delete_file: DeleteFileArgs;
  get_git_diff: GetGitDiffArgs;
  undo_changes: UndoChangesArgs;
  mcp_tool: Record<string, unknown> & { __mcp_tool_name: string };
};

export type ToolName = keyof ToolArgsMap;

export type GetToolArgs<T extends ToolName> = ToolArgsMap[T];
