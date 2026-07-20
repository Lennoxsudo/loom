import type { ToolDefinition } from '../../types/ai';

export const AI_TOOLS: ToolDefinition[] = [
  {
    name: 'term',
    description:
      'Execute terminal commands on the user\'s system. Actions: ' +
      'run - execute a command and wait for output with structured result (exit_code, duration_ms); ' +
      'read_output - check the output of a background command (pass the task ID as tid); ' +
      'list_bg - list all running and completed background tasks; ' +
      'kill - terminate a background task by task ID (pass tid). ' +
      'Foreground commands have a 30s timeout; if a command runs longer it is automatically moved to background ' +
      'and you can check its progress via read_output. You do NOT need to set bg=true explicitly for long-running commands. ' +
      'Use max_lines to control output length and avoid truncation. ' +
      'Use script for multi-line scripts (written to a temp file and executed).',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['run', 'read_output', 'list_bg', 'kill'],
          description: 'The action to perform on the terminal.',
        },
        command: {
          type: 'string',
          description: 'The command to execute. Required for the run action. Ignored for other actions.',
        },
        tid: {
          type: 'string',
          description: 'The task ID for read_output or kill, returned by a background command (bg=true).',
        },
        cwd: {
          type: 'string',
          description: 'The working directory for command execution.',
        },
        shell: {
          type: 'string',
          description:
            'Shell to use for execution. Default is platform-specific (powershell on Windows, bash on Unix). ' +
            'Supported values: "powershell", "pwsh", "cmd", "bash", "sh", "zsh", "fish".',
        },
        timeout: {
          type: 'number',
          description:
            'Timeout in milliseconds. Default: 30000 (30s). Maximum: 600000 (10 min). For commands that need longer (e.g. dev servers), set bg=true and check with read_output.',
        },
        desc: {
          type: 'string',
          description:
            'A clear, concise description of what this command does, written in active voice. ' +
            'This helps the user understand the intent of the command before approving it.',
        },
        bg: {
          type: 'boolean',
          description:
            'If true, run the command in the background without waiting for completion. ' +
            'Use read_output afterwards to check the output. Useful for long-running processes like dev servers.',
        },
        quiet: {
          type: 'boolean',
          description:
            'Set to true when the command is not expected to produce any meaningful output on success ' +
            '(e.g., mkdir, cp, mv). This avoids unnecessary waiting for output.',
        },
        max_lines: {
          type: 'number',
          description:
            'Maximum number of output lines to return. Extra lines are truncated with a hint. ' +
            'Use this to control output size and avoid the default 30000-char truncation.',
        },
        script: {
          type: 'string',
          description:
            'Multi-line script content to execute. The content is written to a temporary file and ' +
            'executed with the selected shell. Supports heredoc-style scripts, functions, and complex logic. ' +
            'When provided, the command parameter is ignored.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'edit',
    description:
      'Replace an exact string in a file. The old must match exactly, including all whitespace, indentation, and newlines. ' +
      'Set all to true to replace every occurrence of old in the file. ' +
      'Prefer this tool over write when making targeted edits to existing files, as it preserves the surrounding content. ' +
      'If old is not found, the edit will fail. If old matches multiple locations and all is not set, the edit will also fail.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file to edit.' },
        old: {
          type: 'string',
          description: 'The exact text to find and replace. Must match the file content exactly, including whitespace and newlines.',
        },
        new: {
          type: 'string',
          description: 'The text to replace old with. Use an empty string to delete the matched text.',
        },
        all: {
          type: 'boolean',
          description: 'If true, replace all occurrences of old. If false or omitted, only the first occurrence is replaced.',
        },
      },
      required: ['path', 'old', 'new'],
    },
  },
  {
    name: 'read',
    description:
      'Read the content of a file. Returns the text content with line numbers. ' +
      'Supports reading a subset of lines via from and limit, and a byte limit via maxb. ' +
      'If the file is binary, the tool returns metadata (MIME type, image dimensions, file size) instead of content. ' +
      'For large files, use limit or from to avoid reading the entire file at once. ' +
      'Use search to find a keyword within the file and return matching lines with context, avoiding reading the whole file. ' +
      'Use around_line to return N lines around a specific line number for code review. ' +
      'For non-UTF-8 files (common in Chinese environments), set encoding to the appropriate charset ' +
      '(e.g., "gbk", "gb18030", "big5", "shift_jis", "utf-16le"). If encoding is not specified, ' +
      'auto-detection is attempted for files that fail UTF-8 decoding. ' +
      'Path can also be an array to read multiple files at once.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the file to read. Can also be an array of paths for batch reading.',
        },
        from: {
          type: 'number',
          description: 'The 1-based line number to start reading from. If omitted, reading starts from the beginning of the file.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to read. If omitted, reads to the end of the file (subject to maxb).',
        },
        maxb: {
          type: 'number',
          description: 'Maximum number of bytes to read. Useful for very large files to limit memory usage.',
        },
        encoding: {
          type: 'string',
          description:
            'Character encoding of the file. Default is "utf-8" with auto-detection for non-UTF-8 files. ' +
            'Common values for Chinese environments: "gbk", "gb18030", "big5". ' +
            'Other supported: "shift_jis", "euc-jp", "euc-kr", "iso-8859-1", "utf-16le", "utf-16be".',
        },
        search: {
          type: 'string',
          description:
            'Search within the file for this keyword and return matching lines with 3 lines of context before/after. ' +
            'Case-insensitive by default. Use this for large files when you only need specific sections, ' +
            'instead of reading the entire file.',
        },
        around_line: {
          type: 'number',
          description:
            'Return N lines around a specific line number (centered). Default context is 20 lines. ' +
            'Use this for code review when you want to see the context around a specific line. ' +
            'Mutually exclusive with from; if both are set, around_line takes precedence.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write',
    description:
      'Write content to a file. If the file does not exist, it will be created (including any necessary parent directories). ' +
      'By default (append=false or omitted), the entire content of an existing file will be overwritten. ' +
      'Set append=true to append content to the end of the file instead of overwriting. ' +
      'Set prepend=true to insert content at the beginning of the file. ' +
      'Set if_not_exists=true to skip writing if the file already exists (prevents accidental overwrite). ' +
      'Use template_vars to substitute {{key}} placeholders in content with provided values. ' +
      'Writes are atomic — content is written to a temp file first, then renamed to the target. ' +
      'For large files (>100KB), a summary with line count and duration is returned. ' +
      'For making targeted edits to existing files, prefer edit instead.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file to write.' },
        content: { type: 'string', description: 'The content to write to the file. Supports {{key}} template placeholders when template_vars is provided.' },
        append: {
          type: 'boolean',
          description: 'If true, append content to the end of the file instead of overwriting. Default is false (overwrite).',
        },
        prepend: {
          type: 'boolean',
          description: 'If true, insert content at the beginning of the file. Cannot be used together with append.',
        },
        if_not_exists: {
          type: 'boolean',
          description: 'If true, skip writing if the file already exists. Prevents accidental overwrite of important files.',
        },
        template_vars: {
          type: 'object',
          description: 'Key-value pairs for template variable substitution. {{key}} in content will be replaced with the corresponding value.',
          properties: {},
          additionalProperties: { type: 'string' },
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'delete_file',
    description:
      'Delete a file or directory. By default (permanent=false or omitted), the target is moved to the system recycle bin. ' +
      'Set permanent=true to permanently delete without recovery. ' +
      'Works on both files and folders. Prefer this over term/rm for file deletion — it is safer and respects the project sandbox. ' +
      'This action requires user confirmation before execution.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the file or directory to delete.',
        },
        permanent: {
          type: 'boolean',
          description:
            'If true, permanently delete the target without moving it to the recycle bin. Default is false (move to recycle bin).',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'search',
    description:
      'Search for files or content within the project. Three search types are available: ' +
      'type=files: search for files matching a glob pattern (e.g., "**/*.ts", "src/**/*.css"); ' +
      'type=content: search for text or regex content within files (grep-style search); ' +
      'type=both: combined search that searches both filenames and file content simultaneously. ' +
      'For content search, the query parameter specifies the text or regex pattern to search for. ' +
      'Set regex=true to treat the query as a regular expression. ' +
      'Use the glob parameter to filter which files to search (e.g., "*.ts,*.tsx" to only search TypeScript files). ' +
      'Use exclude to skip additional directories (beyond the default: node_modules, .git, dist, build, etc.). ' +
      'Use context_lines to include N lines before and after each match (like grep -C). ' +
      'Matched text is highlighted with **markers** in the preview. ' +
      'For file search, the pattern parameter specifies the glob pattern.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['files', 'content', 'both'],
          description: 'The type of search to perform: "files" for glob pattern search, "content" for text/regex search, "both" for combined filename+content search.',
        },
        pattern: {
          type: 'string',
          description: 'Glob pattern for file search (used when type=files), or text/regex pattern (used when type=both). Examples: "**/*.ts", "src/**/*.css".',
        },
        query: {
          type: 'string',
          description: 'Text or regex pattern to search for within file contents (used when type=content or type=both).',
        },
        dir: {
          type: 'string',
          description: 'The directory to search in. If omitted, the project root is used.',
        },
        cs: {
          type: 'boolean',
          description: 'If true, the search is case-sensitive. Default is false (case-insensitive).',
        },
        regex: {
          type: 'boolean',
          description: 'If true, treat the query as a regular expression. Default is false (plain text search).',
        },
        glob: {
          type: 'string',
          description: 'Comma-separated glob patterns to filter which files to search (used with type=content or type=both). ' +
            'Examples: "*.ts,*.tsx", "**/*.rs", "src/**/*.{js,jsx}". Only matching files will be searched.',
        },
        exclude: {
          type: 'string',
          description: 'Comma-separated names or glob patterns to exclude from search, in addition to the defaults ' +
            '(node_modules, .git, dist, build, target, vendor, __pycache__, etc.). ' +
            'Supports glob patterns like "*.vue", "test_*", and path patterns like "**/App.vue". ' +
            'Examples: "test,fixtures,*.log,**/App.vue".',
        },
        context_lines: {
          type: 'number',
          description: 'Number of lines of context to include before and after each match (like grep -C). Default is 0 (no context).',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return. Default is 20. Useful for limiting output when searching large codebases.',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'finfo',
    description:
      'Retrieve information about files and directories. Available actions: ' +
      'list - list the children of a directory (like ls); ' +
      'tree - display a directory tree structure with configurable depth; ' +
      'info - get metadata for a file or directory (size, timestamps, permissions, type).',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'tree', 'info'],
          description: 'The type of information to retrieve.',
        },
        path: {
          type: 'string',
          description: 'Path to the file or directory. Required for list and info actions. Defaults to project root if omitted for tree.',
        },
        root_path: {
          type: 'string',
          description: 'Root path for the tree action. If omitted, the project root is used.',
        },
        depth: {
          type: 'number',
          description: 'Maximum depth for the tree action. Default is 3.',
        },
        dirs_only: {
          type: 'boolean',
          description: 'If true, only directories are included in the output. Works for both list and tree actions. Default is false.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'git',
    description:
      'Perform Git operations on a repository. Available actions: ' +
      'diff - show the changes between the working tree and the index (unstaged) or between the index and HEAD (staged with cached=true); ' +
      'undo - restore files to their last committed state. Only works on tracked files.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['diff', 'undo'],
          description: 'The Git operation to perform.',
        },
        repo: {
          type: 'string',
          description: 'Absolute path to the Git repository root.',
        },
        file: {
          type: 'string',
          description: 'Path to a specific file to diff or undo. If omitted, operates on all changed files.',
        },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of file paths to undo. Used with the undo action for multiple files.',
        },
        cached: {
          type: 'boolean',
          description:
            'For the diff action only. If true, show staged changes (index vs HEAD). If false or omitted, show unstaged changes (working tree vs index).',
        },
        limit: {
          type: 'number',
          description:
            'For the diff action only. Maximum number of lines in the diff output. Useful for limiting output for large diffs.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'sym',
    description:
      'Find the definition of a symbol (function, class, interface, type, constant, or component) in TypeScript/JavaScript/Vue files. ' +
      'This is a lightweight LSP-like tool that resolves imports and follows re-exports within the project. ' +
      'Works only for project-local TS/JS/TSX/JSX/Vue files. Does not support node_modules or external packages.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the file where the symbol is referenced.',
        },
        name: {
          type: 'string',
          description: 'The name of the symbol to find the definition for.',
        },
        line: {
          type: 'number',
          description: 'Optional line number hint for disambiguating symbols with the same name in different scopes.',
        },
      },
      required: ['path', 'name'],
    },
  },
  {
    name: 'todo',
    description:
      'Update the task list displayed to the user. Use this to track progress on multi-step tasks. ' +
      'Each todo has a content description, and a status (pending, in_progress, or completed). ' +
      'This tool replaces the entire todo list with the provided array, so include all existing items that should remain. ' +
      'Mark items as in_progress when you start working on them, and as completed when you finish.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique identifier for the todo item.' },
              content: { type: 'string', description: 'Description of the task to be done.' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: 'Current status of the task.',
              },
            },
            required: ['content', 'status'],
          },
        },
      },
      required: ['todos'],
    },
  },
  {
    name: 'update_plan',
    description:
      'Update the editable plan document shown to the user in Plan Mode. ' +
      'Use this while researching to maintain a living implementation plan (markdown). ' +
      'This does NOT exit plan mode — call exit_plan_mode when the plan is ready for human review. ' +
      'Each call replaces the full plan content.',
    parameters: {
      type: 'object',
      properties: {
        plan: {
          type: 'string',
          description:
            'Full plan document in markdown: goals, approach, file-level steps, risks, and verification.',
        },
        title: {
          type: 'string',
          description: 'Optional short title for the plan panel header.',
        },
      },
      required: ['plan'],
    },
  },
  {
    name: 'exit_plan_mode',
    description:
      'Submit the plan for human review and END the current turn. ' +
      'Call this only after you have finished researching and written a complete plan ' +
      '(via update_plan and/or the plan argument). ' +
      'This does not block: the conversation stops after this tool so the user can review the plan panel. ' +
      'Do not call more tools after this. The user Accepts in the UI to start execution in a new turn, ' +
      'or Keep Planning to revise later.',
    parameters: {
      type: 'object',
      properties: {
        plan: {
          type: 'string',
          description:
            'Final plan markdown to present for review. If omitted, the latest update_plan content is used.',
        },
        title: {
          type: 'string',
          description: 'Optional short title for the plan panel header.',
        },
      },
      required: [],
    },
  },
  {
    name: 'ask',
    description:
      'Ask the user a question to clarify requirements or get a decision. ' +
      'You can ask up to 4 questions at once, each with 2-4 options. ' +
      'The user can select one or more options per question (if multiSelect is enabled). ' +
      'Use this tool when you need user input before proceeding with a task.',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              header: {
                type: 'string',
                description: 'A short header or category label for the question.',
              },
              question: {
                type: 'string',
                description: 'The question to ask the user.',
              },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', description: 'Short label for the option.' },
                    description: {
                      type: 'string',
                      description: 'A brief description of what this option means or implies.',
                    },
                  },
                  required: ['label', 'description'],
                },
              },
              multiSelect: {
                type: 'boolean',
                description: 'If true, the user can select multiple options. Default is false (single selection).',
              },
            },
            required: ['header', 'question', 'options'],
          },
        },
      },
      required: ['questions'],
    },
  },
  {
    name: 'fetch',
    description:
      'Fetch web content and convert to Markdown. Supports custom HTTP methods (POST/PUT/DELETE/PATCH/HEAD), ' +
      'custom headers (Authorization, Cookie, etc.), request body for API testing, configurable timeout, ' +
      'redirect control, and link extraction. ' +
      'Non-200 responses still return body content when available (e.g., 404 pages with useful info). ' +
      'For SPA pages that require JavaScript rendering, use the browser tool instead. ' +
      'For discovering URLs by keyword, prefer web_search first.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch. Must be publicly accessible (http/https). HTTP is auto-upgraded to HTTPS.',
        },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'],
          description: 'HTTP method. Default is GET. Use POST/PUT for API testing.',
        },
        headers: {
          type: 'object',
          description: 'Custom request headers as key-value pairs. E.g., {"Authorization": "Bearer token", "Cookie": "session=abc"}',
        },
        body: {
          type: 'string',
          description: 'Request body for POST/PUT/PATCH. Can be JSON string, form data, etc.',
        },
        timeout: {
          type: 'number',
          description: 'Request timeout in seconds. Default is 60. Increase for slow websites.',
        },
        follow_redirects: {
          type: 'boolean',
          description: 'Whether to follow HTTP redirects. Default is true. Set false to debug redirect chains.',
        },
        extract_links: {
          type: 'boolean',
          description: 'Whether to extract and list all links from HTML pages. Default false. Useful for crawling multi-page content.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'web_search',
    description:
      'Search the public web and return lightweight results (title, URL, snippet) directly into context. ' +
      'Use this to discover sources for versions, APIs, error messages, docs, or current events. ' +
      'Unlike fetch (full page content) and browser (embedded UI), this only returns a short SERP list. ' +
      'After finding a relevant URL, call fetch to load the full page if needed.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query keywords. Be specific (e.g. "React 19 useEffect cleanup changelog").',
        },
        num_results: {
          type: 'number',
          description: 'Maximum number of results to return (1–10). Default is 5.',
        },
      },
      required: ['query'],
    },
  },

  {
    name: 'browser',
    description:
      'Control the browser. Basic actions always work on the built-in preview: open, navigate, refresh. ' +
      'When the CDP browser plugin is enabled (Settings → Plugins), additional actions control system Chrome/Edge via CDP: ' +
      'close, click, type, press_key, content, evaluate, wait, screenshot. ' +
      'Prefer CDP actions for real DOM interaction and screenshots; use open/navigate/refresh for simple preview.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'open',
            'close',
            'navigate',
            'refresh',
            'click',
            'type',
            'press_key',
            'content',
            'evaluate',
            'wait',
            'screenshot',
          ],
          description: 'The browser action to perform.',
        },
        url: {
          type: 'string',
          description: 'URL for open/navigate. Ignored for other actions.',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for click, type, and wait actions.',
        },
        text: {
          type: 'string',
          description: 'Text to type into the element (type action).',
        },
        key: {
          type: 'string',
          description: 'Key to press (press_key), e.g. Enter, Tab, Escape, ArrowDown.',
        },
        clear: {
          type: 'boolean',
          description: 'When typing, clear the existing value first. Default false.',
        },
        expression: {
          type: 'string',
          description: 'JavaScript expression to evaluate in the page (evaluate action).',
        },
        timeout_ms: {
          type: 'number',
          description: 'Timeout in ms for wait action (default 10000, max 60000).',
        },
        full_page: {
          type: 'boolean',
          description: 'Capture full-page screenshot when action is screenshot.',
        },
        include_base64: {
          type: 'boolean',
          description: 'Include base64 PNG data in screenshot result (large). Default false.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'skill',
    description:
      'Load skill instructions by name. Skills provide specialized knowledge or step-by-step procedures ' +
      'for specific tasks. The loaded instructions will be injected into the conversation context.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name of the skill to load.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'run_subagent',
    description:
      'Spawn a separate subagent to execute a task in an isolated context. ' +
      'The subagent will perform its work independently and only return a summary result ' +
      'without polluting the parent conversation history.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'A self-contained description of the task to be performed by the subagent.',
        },
        context: {
          type: 'string',
          description: 'Optional critical background context that the subagent cannot retrieve on its own.',
        },
        allowed_tools: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Optional list of allowed tools. If omitted, inherits the full parent agent tool set.',
        },
        max_tool_rounds: {
          type: 'number',
          description: 'Optional maximum tool execution rounds for this subagent.',
        },
        context_budget: {
          type: 'number',
          description: 'Optional context token budget. When set, background context may be truncated to fit.',
        },
        model: {
          type: 'string',
          description: 'Optional model selection. Can be "inherit" or a specific provider/model ID.',
        },
        preset: {
          type: 'string',
          description: 'Optional built-in preset ID (e.g. "research", "parallel-exec") that provides default prompts and allowed tools.',
        },
        async: {
          type: 'boolean',
          description: 'Optional. If true, start the subagent in the background and return immediately. Default is false.',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'run_subagents',
    description:
      'Spawn multiple separate subagents in parallel to execute independent tasks in isolated contexts. ' +
      'Use this to delegate multiple sub-tasks that have no dependencies between each other. ' +
      'If tasks have dependencies or must be run sequentially, call run_subagent multiple times instead.',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              task: {
                type: 'string',
                description: 'A self-contained description of the task to be performed by the subagent.',
              },
              context: {
                type: 'string',
                description: 'Optional critical background context that the subagent cannot retrieve on its own.',
              },
              allowed_tools: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'Optional list of allowed tools. If omitted, inherits the full parent agent tool set.',
              },
              max_tool_rounds: {
                type: 'number',
                description: 'Optional maximum tool execution rounds for this subagent.',
              },
              context_budget: {
                type: 'number',
                description: 'Optional context token budget. When set, background context may be truncated to fit.',
              },
              model: {
                type: 'string',
                description: 'Optional model selection. Can be "inherit" or a specific provider/model ID.',
              },
              preset: {
                type: 'string',
                description: 'Optional built-in preset ID (e.g. "research", "parallel-exec") that provides default prompts and allowed tools.',
              },
            },
            required: ['task'],
          },
          description: 'List of tasks to execute in parallel.',
        },
      },
      required: ['tasks'],
    },
  },
  {
    name: 'graph_index',
    description:
      'Build and manage a lightweight code relationship index — a symbol-level store of function calls, class inheritance, ' +
      'imports, and variable references (not plain full-text search).\n' +
      '\n' +
      'Index facts (read once):\n' +
      '  Persistence — stored on DISK at {app_data}/Loom/cbm/. Survives Loom restarts; no re-index after restart if status=indexed.\n' +
      '  Scope       — indexes the ENTIRE project tree under repo_path (all supported source files), NOT just open editor tabs.\n' +
      '  Auto-index  — Loom may index on workspace open (Settings → Code graph). File changes can trigger incremental re-index.\n' +
      '\n' +
      'repo_path vs project (usually pass only repo_path):\n' +
      '  repo_path — filesystem path to the project ROOT. Default: current Loom workspace folder if omitted.\n' +
      '  project   — CBM internal slug (e.g. "D-myapp" from action=list "name" column), NOT a friendly name or path alias.\n' +
      '              Loom auto-resolves repo_path → project slug. Pass project only when path mapping fails (folder moved); get slug from list.\n' +
      '  Both omitted → current workspace. Never use project_id (deprecated alias, stripped).\n' +
      '\n' +
      'When to use: before first graph_query/graph_trace on a new project, after major refactors, or when status shows missing/stale.\n' +
      '\n' +
      'Actions:\n' +
      '  index  — Build/rebuild index for repo_path. CPU-intensive (large repos: minutes; 30min timeout).\n' +
      '  status — Check indexed? Returns node/edge counts and indexed_at.\n' +
      '  list   — List all indexed projects with repo_path + slug (no params needed).\n' +
      '  delete — Remove index data for repo_path (does not delete source files).\n' +
      '\n' +
      'For read-only lookups use graph_query/graph_trace instead of rebuilding.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['index', 'status', 'list', 'delete'] },
        repo_path: {
          type: 'string',
          description:
            'Filesystem path to project root. Default: current workspace. Preferred over project. ' +
            'Required for index/status/delete unless project slug is given. action=list ignores this.',
        },
        project: {
          type: 'string',
          description:
            'CBM internal slug from action=list (the "name" field, e.g. "D-myapp"). NOT a path. ' +
            'Rarely needed — omit and pass repo_path; Loom resolves slug automatically.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'graph_query',
    description:
      'Query the indexed code relationship graph. Requires graph_index first. Index is disk-persistent; queries the whole indexed project.\n' +
      '\n' +
      'repo_path vs project: pass repo_path (default: workspace). project = rare CBM slug from graph_index list; auto-resolved if omitted.\n' +
      '\n' +
      'Pick ONE action — typical scenarios:\n' +
      '  search  — Find symbol definitions by name. Scenario: "where is AuthService defined?" / Go-to-Symbol.\n' +
      '  snippet — Read one symbol\'s source code. Scenario: after search, view the function body.\n' +
      '  code    — Grep text inside symbol bodies. Scenario: "which functions mention TODO or use deprecated API?"\n' +
      '  schema  — List graph entity types (labels, edge types). Scenario: before writing a Cypher query, learn what exists.\n' +
      '  query   — Custom Cypher graph query. Scenario: multi-hop or cross-type questions search/trace cannot answer.\n' +
      '  list    — List indexed projects (alias for graph_index list). Scenario: discover CBM project slugs.\n' +
      '\n' +
      'action=query syntax: CBM built-in Cypher subset (Neo4j-style MATCH/WHERE/RETURN). NOT natural language, NOT SPARQL/SQL. MUST start with MATCH.\n' +
      'Run schema first. Example: MATCH (f:Function) WHERE f.name =~ ".*send.*" RETURN f.name, f.file LIMIT 10\n' +
      'Simple "who calls X?" → graph_trace trace, not query.\n' +
      '\n' +
      'Parameter priority (only pass params for your action):\n' +
      '  1. action (required)\n' +
      '  2. action-specific: search→name_pattern,qualified_name,label,file_pattern | snippet→qualified_name OR name_pattern | code→pattern (+optional name_pattern to scope symbols) | query→query | schema→none\n' +
      '  3. repo_path (optional, default workspace) — ignore other actions\' params\n' +
      '\n' +
      'action=search filter logic: name_pattern + label + file_pattern are ANDed (all provided filters must match). Omit a filter = no restriction on that axis.\n' +
      'action=search exact symbol: pass qualified_name (mapped to CBM qn_pattern). Use regex=true when name_pattern/qn_pattern is already a regex.\n' +
      'qualified_name on snippet: exact symbol id from search. On search: exact qualified id filter.\n' +
      '\n' +
      'Workflows: search → snippet | schema → query | code for body-text grep.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['search', 'snippet', 'query', 'schema', 'code', 'list'] },
        repo_path: {
          type: 'string',
          description: 'Project root path. Default: current workspace. Preferred over project slug.',
        },
        project: {
          type: 'string',
          description: 'CBM slug from graph_index list (rare). Omit — repo_path is auto-resolved to slug.',
        },
        name_pattern: {
          type: 'string',
          description:
            'action=search: regex on symbol NAME (AND with label/file_pattern if also set). ' +
            'action=snippet fallback: auto-search first match when qualified_name omitted (globs like use* supported). ' +
            'action=code optional: limit grep to symbols matching this name regex before searching bodies.',
        },
        regex: {
          type: 'boolean',
          description:
            'action=search only: when true, name_pattern/qn_pattern are raw regex. Default false escapes qualified_name for exact match.',
        },
        qn_pattern: {
          type: 'string',
          description: 'action=search only: advanced — regex on qualified_name (usually use qualified_name instead).',
        },
        label: {
          type: 'string',
          description: 'action=search only: node type filter (AND with name_pattern/file_pattern). E.g. Function, Class, Route.',
        },
        file_pattern: {
          type: 'string',
          description:
            'action=search: file path glob (AND with name_pattern/label). ' +
            'action=code: grep scope (glob) + path_filter. ' +
            'action=query: injected into Cypher as `n.file_path =~ "..."` (query_graph has no native file_pattern).',
        },
        limit: { type: 'number', description: 'action=search only: max results.' },
        offset: { type: 'number', description: 'action=search only: pagination skip.' },
        qualified_name: {
          type: 'string',
          description:
            'action=search: exact qualified symbol id filter (e.g. ".src.stores.products.getProductById"). ' +
            'action=snippet: exact symbol id from search (preferred over name_pattern).',
        },
        query: {
          type: 'string',
          description:
            'action=query only: Cypher MATCH string (aliases: cypher). Supports labels(n), type(r), n.label, r.type. No CALL db.* — use action=schema first.',
        },
        pattern: {
          type: 'string',
          description: 'action=code only: text/regex inside symbol bodies (param: pattern; aliases: code, text). Not for symbol name lookup (use name_pattern).',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'graph_trace',
    description:
      'Trace and analyze code relationships from the indexed graph. Requires graph_index first (disk-persistent, whole project).\n' +
      '\n' +
      'repo_path vs project: pass repo_path (default: workspace). project = rare CBM slug; auto-resolved if omitted.\n' +
      '\n' +
      'trace vs graph_query query: trace = preset call-chain for ONE function_name. query = custom Cypher you write.\n' +
      '\n' +
      'action=trace — direction is relative to function_name as the CENTER node:\n' +
      '  inbound  — edges pointing TO this symbol: callers, referrers, importers (who/what uses it)\n' +
      '  outbound — edges FROM this symbol: callees, imports, references (what it calls/uses)\n' +
      '  both     — inbound + outbound neighborhood (default)\n' +
      '  depth    — hop count along those edges (1-5, default 3). Follows CALLS edges primarily; falls back to other edge types if no CALLS.\n' +
      '  Example: function_name="sendMessage" direction=inbound → list every symbol that calls sendMessage.\n' +
      '\n' +
      'action=architecture — text report of project structure: packages (fan-in/out), entry points, inferred layers,\n' +
      '  language breakdown, node/edge counts. NOT a rendered diagram.\n' +
      '\n' +
      'action=changes — compares current DISK files vs last index snapshot (NOT git). Lists changed files + impacted symbols.\n' +
      '  Optional function_name filters changed_files by path substring (e.g. "products.ts"). node_modules/vendor/dist excluded by default.\n' +
      '  Re-index after large edits. Use git tool for commit history.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['trace', 'architecture', 'changes'] },
        repo_path: {
          type: 'string',
          description: 'Project root path. Default: current workspace.',
        },
        project: {
          type: 'string',
          description: 'CBM slug from graph_index list (rare). Omit — repo_path auto-resolved.',
        },
        function_name: {
          type: 'string',
          description:
            'action=trace: anchor symbol name (e.g. "sendMessage"). Required for trace. ' +
            'action=changes: optional file path substring filter (e.g. "products.ts"). Omit for all changed files.',
        },
        direction: {
          type: 'string',
          enum: ['inbound', 'outbound', 'both'],
          description:
            'action=trace only. Relative to function_name: inbound=callers/referrers (edges TO it), ' +
            'outbound=callees/dependencies (edges FROM it), both=both sides. Default: both.',
        },
        depth: {
          type: 'number',
          description: 'action=trace only. Traversal hops 1-5 (default 3). Ignored by architecture/changes.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'Agent',
    description:
      'Launch a specialized subagent to handle a task in an isolated context. ' +
      'Use subagent_type to select from available agents (Explore, Plan, general-purpose, or custom .claude/agents definitions). ' +
      'The subagent runs independently and returns only a summary.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'A self-contained task description for the subagent.',
        },
        subagent_type: {
          type: 'string',
          description: 'Subagent type name. Default: general-purpose.',
        },
        description: {
          type: 'string',
          description: 'Short label for the task (optional, inferred from prompt).',
        },
        context: {
          type: 'string',
          description: 'Optional background context the subagent cannot retrieve on its own.',
        },
        model: {
          type: 'string',
          description: 'Optional model: inherit, sonnet, haiku, or a specific model ID.',
        },
        allowed_tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of allowed tools. If omitted, inherits the full parent agent tool set.',
        },
        max_tool_rounds: {
          type: 'number',
          description: 'Optional maximum tool execution rounds for this subagent.',
        },
        context_budget: {
          type: 'number',
          description: 'Optional context token budget. When set, background context may be truncated to fit.',
        },
        run_in_background: {
          type: 'boolean',
          description: 'If true, start in background without blocking. Default false.',
        },
        resume: {
          type: 'string',
          description: 'Set to "self" for fork mode (inherit parent conversation history).',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'Task',
    description:
      'Alias for Agent tool. Launch a specialized subagent to handle a delegated task.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Task description for the subagent.' },
        subagent_type: { type: 'string', description: 'Subagent type name.' },
        description: { type: 'string' },
        context: { type: 'string' },
        model: { type: 'string' },
        allowed_tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of allowed tools. If omitted, inherits the full parent agent tool set.',
        },
        max_tool_rounds: { type: 'number', description: 'Optional maximum tool execution rounds.' },
        context_budget: { type: 'number', description: 'Optional context token budget.' },
        run_in_background: { type: 'boolean' },
        resume: { type: 'string' },
      },
      required: ['prompt'],
    },
  },
];

