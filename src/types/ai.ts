/**
 * AI tool and provider type definitions
 */

/**
 * Tool parameter definition for AI function calling
 */
interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: { type: string; [key: string]: unknown };
  properties?: Record<string, ToolParameter>;
  required?: string[];
  // --- Advanced JSON Schema ---
  oneOf?: ToolParameter[];
  anyOf?: ToolParameter[];
  allOf?: ToolParameter[];
  $ref?: string;
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  additionalProperties?: unknown;
}

/**
 * AI tool definition with parameters for function calling
 */
export interface ToolDefinition {
  /** Tool name identifier */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** JSON Schema for tool parameters */
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required: string[];
  };
}

/**
 * Tool call from AI provider during response generation
 */
export interface ToolCall {
  /** Unique identifier for this tool call */
  id: string;
  /** Always 'function' for function calls */
  type: 'function';
  /** Function call details */
  function: {
    /** Name of the function to call */
    name: string;
    /** JSON-encoded arguments string */
    arguments: string;
  };
}

/**
 * Tool execution result returned to AI provider
 */
export interface ToolResult {
  /** ID of the tool call this result corresponds to */
  tool_call_id: string;
  /** Output string from tool execution */
  output: string;
  /** Error message if tool execution failed */
  error?: string;
  /** List of file paths modified by this tool */
  files_changed?: string[];
}

/**
 * Read file tool result containing file content and metadata
 */
interface BinaryFileInfo {
  /** MIME type guess (e.g., "image/png") */
  mime_type: string;
  /** Image width in pixels (if applicable) */
  width?: number;
  /** Image height in pixels (if applicable) */
  height?: number;
  /** File size in bytes */
  size_bytes: number;
}

export interface ReadFileToolResult {
  /** File content (may be truncated) */
  content: string;
  /** Whether content was truncated due to size limits */
  truncated: boolean;
  /** Whether file is binary (non-text) */
  is_binary: boolean;
  /** Number of bytes read */
  bytes_read: number;
  /** Number of lines read */
  lines_read: number;
  /** Detected or used encoding (e.g., "utf-8", "gbk") */
  encoding_used?: string;
  /** Binary file metadata (only when is_binary is true) */
  binary_info?: BinaryFileInfo;
  /** Total lines in the file (only when search or around_line is used) */
  total_lines?: number;
}

/** Result for write_file_content with optional large-file summary */
export interface WriteFileResult {
  path: string;
  bytes_written: number;
  /** Line count of written content */
  lines?: number;
  /** Duration in ms, populated for files >10KB */
  duration_ms?: number;
  /** True when if_not_exists=true and file already exists */
  skipped: boolean;
  /** Reason for skip */
  reason?: string;
}

/**
 * File tree display result for directory listing
 */
export interface FileTreeResult {
  /** Root path of the tree */
  root_path: string;
  /** ASCII tree representation */
  tree: string;
  /** Total number of directories */
  total_dirs: number;
  /** Total number of files */
  total_files: number;
}

/**
 * File information metadata
 */
export interface FileInfo {
  /** Absolute file path */
  path: string;
  /** Whether file exists */
  exists: boolean;
  /** File type (file, directory, symlink, etc.) */
  file_type: string;
  /** File size in bytes */
  size_bytes: number;
  /** Human-readable file size */
  size_human: string;
  /** Creation timestamp (ISO string) */
  created: string | null;
  /** Last modification timestamp (ISO string) */
  modified: string | null;
  /** Last access timestamp (ISO string) */
  accessed: string | null;
  /** Whether file is read-only */
  is_readonly: boolean;
  /** File permissions string */
  permissions: string | null;
  /** Whether file is binary */
  is_binary: boolean;
  /** Symlink target path (for symlinks) */
  target_path: string | null;
}

/**
 * Git diff result containing file changes
 */
export interface GitDiffResult {
  /** List of changed files */
  files: FileDiff[];
  /** Summary of changes */
  summary: DiffSummary;
  /** Whether diff was truncated */
  truncated: boolean;
  /** Truncation info message */
  truncated_info: string | null;
  /** Raw diff output */
  raw_diff: string;
}

/**
 * Single file diff information
 */
export interface FileDiff {
  /** Current file path */
  path: string;
  /** Original file path (for renames) */
  old_path: string | null;
  /** Git status (added, modified, deleted, renamed) */
  status: string;
  /** Number of added lines */
  additions: number;
  /** Number of deleted lines */
  deletions: number;
  /** Diff hunks */
  hunks: DiffHunk[];
}

/**
 * Single diff hunk
 */
export interface DiffHunk {
  /** Start line in old file */
  old_start: number;
  /** Number of lines in old file */
  old_lines: number;
  /** Start line in new file */
  new_start: number;
  /** Number of lines in new file */
  new_lines: number;
  /** Hunk header text */
  header: string;
  /** Individual diff lines */
  lines: DiffLine[];
}

/**
 * Single diff line
 */
export interface DiffLine {
  /** Line type: ' ' (context), '+' (addition), '-' (deletion) */
  line_type: string;
  /** Line content */
  content: string;
  /** Line number in old file (null for additions) */
  old_line_no: number | null;
  /** Line number in new file (null for deletions) */
  new_line_no: number | null;
}

/**
 * Summary of diff changes
 */
interface DiffSummary {
  /** Total number of changed files */
  total_files: number;
  /** Total added lines */
  total_additions: number;
  /** Total deleted lines */
  total_deletions: number;
}

/**
 * Result of undoing git changes
 */
export interface UndoChangesResult {
  /** Files that were restored */
  restored_files: string[];
  /** Files that were skipped */
  skipped_files: string[];
  /** Whether operation was successful */
  success: boolean;
  /** Human-readable message */
  message: string;
}

/**
 * Result of a directly executed command (bypasses PTY)
 */
export interface ExecuteCommandResult {
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Process exit code (null if killed or unable to determine) */
  exit_code: number | null;
  /** Whether the command timed out */
  timed_out: boolean;
  /** Command execution duration in milliseconds */
  duration_ms: number;
}

/** Incremental progress event for foreground command execution */
export interface CommandExecProgressEvent {
  stream_id: string;
  chunk: string;
  stream: 'stdout' | 'stderr';
  started: boolean;
  done: boolean;
  exit_code: number | null;
  duration_ms: number | null;
}

/**
 * Result of starting a background command
 */
export interface ExecuteCommandBgResult {
  /** Background task ID for later checking */
  task_id: string;
}

/**
 * Result of checking a background command's status
 */
export interface CheckBackgroundCommandResult {
  stdout: string;
  stderr: string;
  completed: boolean;
  exit_code: number | null;
  duration_ms: number | null;
}

/**
 * Summary of a background task for listing
 */
export interface BackgroundTaskSummary {
  task_id: string;
  pid: number;
  command: string;
  completed: boolean;
  exit_code: number | null;
  duration_ms: number | null;
}

/**
 * Result of symbol definition lookup
 */
export interface SymbolDefinitionResult {
  /** Symbol name */
  symbol_name: string;
  /** File where symbol is defined */
  definition_file: string;
  /** Line number of definition */
  definition_line: number;
  /** Type of definition (function, class, variable, etc.) */
  definition_type: string;
  /** Code snippet of definition */
  definition_code: string;
  /** Import source module */
  import_source: string;
  /** Resolved absolute path */
  resolved_path: string;
}

