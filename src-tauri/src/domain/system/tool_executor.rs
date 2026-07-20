//! Tool Executor module – Backend-side tool chain orchestration
//!
//! Executes read-only tools (read_file, list_directory, get_file_tree, etc.)
//! directly in the Rust backend, avoiding Tauri IPC round-trips to the frontend.
//! When the AI model responds with tool calls that are all backend-executable,
//! this module handles them and feeds results back to the next AI request
//! without involving the frontend React layer.

use crate::file_ops;
use crate::sandbox::{CallSource, SandboxContext};
use serde::{Deserialize, Serialize};
use std::path::Path;

// ============================================================================
// Configuration
// ============================================================================

/// Configuration for backend tool chain orchestration.
#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolChainConfig {
    /// Whether backend orchestration is enabled.
    #[serde(default = "default_true")]
    pub enable_backend_orchestration: bool,

    /// Maximum number of auto-continue rounds (prevents infinite loops).
    #[serde(default = "default_max_rounds")]
    pub max_rounds: u32,

    /// Project path for resolving relative file paths.
    #[serde(default)]
    pub project_path: Option<String>,

    /// Application data directory (for global skills resolution).
    #[serde(default)]
    pub app_data_path: Option<String>,

    /// Delay in milliseconds after tool execution before sending the next
    /// AI request. Allows frontend to display tool results more completely.
    #[serde(default)]
    pub tool_call_delay_ms: Option<u64>,
}

fn default_true() -> bool {
    true
}
fn default_max_rounds() -> u32 {
    10
}

impl Default for ToolChainConfig {
    fn default() -> Self {
        Self {
            enable_backend_orchestration: true,
            max_rounds: 10,
            project_path: None,
            app_data_path: None,
            tool_call_delay_ms: None,
        }
    }
}

// ============================================================================
// Tool classification
// ============================================================================

/// Tools that the backend can execute directly (read-only / safe).
const BACKEND_EXECUTABLE_TOOLS: &[&str] = &[
    "read_file",
    "list_directory",
    "get_file_tree",
    "search_files",
    "search_content",
    "get_file_info",
    "fetch_web_content",
    "fetch",
    // web_search intentionally NOT backend-executable:
    // backend tool-chain only emits truncated executedTools previews which the
    // Agent UI does not render as tool cards. Frontend execution shows
    // WebSearchToolResultCard with full results.
    "load_skill",
];

/// Check if a single tool can be executed backend-side.
pub fn is_backend_executable(name: &str) -> bool {
    BACKEND_EXECUTABLE_TOOLS.contains(&name)
}

/// Check if ALL tool calls in a batch can be executed backend-side.
pub fn all_tools_backend_executable(tool_calls: &[serde_json::Value]) -> bool {
    if tool_calls.is_empty() {
        return false;
    }
    tool_calls.iter().all(|tc| {
        let name = tc["function"]["name"].as_str().unwrap_or("");
        is_backend_executable(name)
    })
}

// ============================================================================
// Tool execution
// ============================================================================

/// Result of executing a single tool on the backend.
#[derive(Debug, Clone, Serialize)]
pub struct ToolExecutionResult {
    pub tool_call_id: String,
    pub tool_name: String,
    pub output: String,
    pub success: bool,
}

/// Execute a single tool call and return the result.
pub fn execute_tool(
    tool_call: &serde_json::Value,
    project_path: Option<&str>,
    app_data_path: Option<&str>,
    sandbox_ctx: &SandboxContext,
) -> ToolExecutionResult {
    execute_tool_with_meta(tool_call, project_path, app_data_path, sandbox_ctx, None, None)
}

/// Execute a tool with optional session / execution ids for audit enrichment.
pub fn execute_tool_with_meta(
    tool_call: &serde_json::Value,
    project_path: Option<&str>,
    app_data_path: Option<&str>,
    sandbox_ctx: &SandboxContext,
    session_id: Option<&str>,
    execution_id: Option<&str>,
) -> ToolExecutionResult {
    let tool_call_id = tool_call["id"].as_str().unwrap_or("").to_string();
    let tool_name = tool_call["function"]["name"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let args_str = tool_call["function"]["arguments"].as_str().unwrap_or("{}");

    let args: serde_json::Value =
        serde_json::from_str(args_str).unwrap_or_else(|_| serde_json::json!({}));

    let meta = crate::security::context::AuditMeta {
        session_id: session_id.map(|s| s.to_string()),
        execution_id: execution_id.map(|s| s.to_string()),
        tool_name: Some(tool_name.clone()),
    };

    crate::security::context::with_audit_meta(meta, || {
        let result = match tool_name.as_str() {
            "read_file" => {
                // P0: validate read access before executing
                if let Err(e) = validate_read_paths(&args, project_path, sandbox_ctx) {
                    Err(e)
                } else {
                    execute_read_file(&args, project_path)
                }
            }
            "list_directory" => {
                if let Err(e) = validate_read_path_arg(&args, project_path, sandbox_ctx) {
                    Err(e)
                } else {
                    execute_list_directory(&args, project_path)
                }
            }
            "get_file_tree" => {
                if let Err(e) = validate_read_path_arg(&args, project_path, sandbox_ctx) {
                    Err(e)
                } else {
                    execute_get_file_tree(&args, project_path)
                }
            }
            "search_files" => {
                if let Err(e) = validate_read_path_arg(&args, project_path, sandbox_ctx) {
                    Err(e)
                } else {
                    execute_search_files(&args, project_path)
                }
            }
            "search_content" => {
                if let Err(e) = validate_read_path_arg(&args, project_path, sandbox_ctx) {
                    Err(e)
                } else {
                    execute_search_content(&args, project_path)
                }
            }
            "get_file_info" => {
                if let Err(e) = validate_read_path_arg(&args, project_path, sandbox_ctx) {
                    Err(e)
                } else {
                    execute_get_file_info(&args, project_path)
                }
            }
            "fetch_web_content" | "fetch" => execute_fetch_web_content(&args, sandbox_ctx),
            "web_search" => execute_web_search(&args, sandbox_ctx),
            "load_skill" => execute_load_skill(&args, project_path, app_data_path),
            _ => Err(format!("Unknown backend tool: {}", tool_name)),
        };

        match result {
            Ok(output) => ToolExecutionResult {
                tool_call_id,
                tool_name,
                output,
                success: true,
            },
            Err(err) => ToolExecutionResult {
                tool_call_id,
                tool_name,
                output: format!("Error: {}", err),
                success: false,
            },
        }
    })
}

/// Execute all tool calls in a batch, returning results in order.
pub fn execute_all_tools(
    tool_calls: &[serde_json::Value],
    project_path: Option<&str>,
    app_data_path: Option<&str>,
    sandbox_ctx: &SandboxContext,
) -> Vec<ToolExecutionResult> {
    tool_calls
        .iter()
        .map(|tc| execute_tool(tc, project_path, app_data_path, sandbox_ctx))
        .collect()
}

// ============================================================================
// Message building – assemble tool results into the message history
// ============================================================================

/// Build an assistant message containing the tool calls, then tool-result
/// messages for each result. These are appended to the conversation history
/// for the next AI request.
pub fn build_tool_result_messages(
    assistant_content: &str,
    tool_calls: &[serde_json::Value],
    results: &[ToolExecutionResult],
    provider: &str,
    thinking_blocks: &[serde_json::Value],
) -> Vec<crate::chat::ChatMessage> {
    let mut messages: Vec<crate::chat::ChatMessage> = Vec::new();

    // 1) The assistant message that requested the tool calls
    // Build content array: thinking blocks (if any) + tool_use blocks
    let mut content_blocks: Vec<serde_json::Value> = Vec::new();

    // Add thinking blocks first (Anthropic requires them before tool_use)
    for tb in thinking_blocks {
        content_blocks.push(tb.clone());
    }

    // Add text content if present
    if !assistant_content.is_empty() {
        content_blocks.push(serde_json::json!({
            "type": "text",
            "text": assistant_content
        }));
    }

    // Add tool_use blocks
    for tc in tool_calls {
        if provider == "anthropic" {
            let id = tc["id"].as_str().unwrap_or("").to_string();
            let name = tc["function"]["name"].as_str().unwrap_or("").to_string();
            let args_str = tc["function"]["arguments"].as_str().unwrap_or("{}");
            let input: serde_json::Value = serde_json::from_str(args_str).unwrap_or(serde_json::json!({}));
            
            content_blocks.push(serde_json::json!({
                "type": "tool_use",
                "id": id,
                "name": name,
                "input": input
            }));
        } else {
            content_blocks.push(tc.clone());
        }
    }

    let content = if content_blocks.is_empty() {
        serde_json::Value::String(" ".to_string())
    } else {
        serde_json::Value::Array(content_blocks)
    };

    messages.push(crate::chat::ChatMessage {
        role: "assistant".to_string(),
        content,
        attachments: None,
        tool_calls: Some(
            tool_calls
                .iter()
                .map(|tc| crate::chat::ToolCall {
                    id: tc["id"].as_str().unwrap_or("").to_string(),
                    call_type: "function".to_string(),
                    function: crate::chat::ToolCallFunction {
                        name: tc["function"]["name"].as_str().unwrap_or("").to_string(),
                        arguments: tc["function"]["arguments"]
                            .as_str()
                            .unwrap_or("{}")
                            .to_string(),
                    },
                })
                .collect(),
        ),
        tool_call_id: None,
        tool_name: None,
        tool_args: None,
        thinking: None,
        thinking_started_at: None,
        thinking_ended_at: None,
        thinking_signature: None,
        is_error: None,
        slash_command: None,
    });

    // 2) One tool-result message per tool call
    for result in results {
        let mut msg = crate::chat::ChatMessage {
            role: "tool".to_string(),
            content: serde_json::Value::String(result.output.clone()),
            attachments: None,
            tool_calls: None,
            tool_call_id: Some(result.tool_call_id.clone()),
            tool_name: Some(result.tool_name.clone()),
            tool_args: None,
            thinking: None,
            thinking_started_at: None,
            thinking_ended_at: None,
            thinking_signature: None,
            is_error: Some(!result.success),
            slash_command: None,
        };

        // For Anthropic, content must be formatted differently – but the stream
        // functions already handle that via build_anthropic_message_content,
        // so we just set the plain text here.
        let _ = &mut msg; // satisfy unused warning
        messages.push(msg);
    }

    messages
}

// ============================================================================
// Individual tool implementations
// ============================================================================

/// Resolve a path that may be relative, using the project path as base.
///
/// When `project_path` is set, absolute paths and `../` escapes outside the
/// workspace are rejected (phase 2 path containment).
fn resolve_path_strict(raw: &str, project_path: Option<&str>) -> Result<String, String> {
    crate::security::context::resolve_under_root(raw, project_path)
        .map(|p| p.to_string_lossy().to_string())
}



// ============================================================================
// P0: Read-access validation helpers
// ============================================================================

/// Validate read access for the `read_file` tool which may take an array of paths.
fn validate_read_paths(
    args: &serde_json::Value,
    project_path: Option<&str>,
    sandbox_ctx: &SandboxContext,
) -> Result<(), String> {
    let paths: Vec<String> = if args["path"].is_array() {
        args["path"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str())
            .map(|s| s.to_string())
            .collect()
    } else if args["paths"].is_array() {
        args["paths"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str())
            .map(|s| s.to_string())
            .collect()
    } else {
        args["path"]
            .as_str()
            .or_else(|| args["file_path"].as_str())
            .map(|s| vec![s.to_string()])
            .unwrap_or_default()
    };

    for p in &paths {
        let resolved = match resolve_path_strict(p, project_path) {
            Ok(r) => r,
            Err(e) => {
                // Containment failure happens before validate_read — still audit.
                crate::audit_log::log_path_denied(p, &e, &sandbox_ctx.access_mode);
                return Err(e);
            }
        };
        sandbox_ctx.validate_read(Path::new(&resolved), CallSource::Ai)?;
    }
    Ok(())
}

/// Validate read access for tools that take a single path/folder argument
/// (list_directory, get_file_tree, search_files, search_content, get_file_info).
fn validate_read_path_arg(
    args: &serde_json::Value,
    project_path: Option<&str>,
    sandbox_ctx: &SandboxContext,
) -> Result<(), String> {
    let path = args["path"]
        .as_str()
        .or_else(|| args["directory"].as_str())
        .or_else(|| args["root_path"].as_str())
        .or_else(|| args["folder_path"].as_str())
        .or(project_path);

    if let Some(p) = path {
        let resolved = match resolve_path_strict(p, project_path) {
            Ok(r) => r,
            Err(e) => {
                crate::audit_log::log_path_denied(p, &e, &sandbox_ctx.access_mode);
                return Err(e);
            }
        };
        sandbox_ctx.validate_read(Path::new(&resolved), CallSource::Ai)?;
    }
    Ok(())
}

fn execute_read_file(
    args: &serde_json::Value,
    project_path: Option<&str>,
) -> Result<String, String> {
    // Support array of paths for batch reading
    let paths = if args["path"].is_array() {
        args["path"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str())
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
    } else if args["paths"].is_array() {
        args["paths"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str())
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
    } else {
        let single_path = args["path"]
            .as_str()
            .or_else(|| args["file_path"].as_str())
            .ok_or("Missing required parameter: path")?;
        vec![single_path.to_string()]
    };

    if paths.is_empty() {
        return Err("Missing required parameter: path".to_string());
    }

    let max_lines = args["max_lines"].as_u64().map(|v| v as usize);
    let max_bytes = args["max_bytes"].as_u64().map(|v| v as usize);
    let start_line = args["start_line"].as_u64().map(|v| v as usize);
    let encoding = args["encoding"].as_str().map(|s| s.to_string());
    let search = args["search"].as_str().map(|s| s.to_string());
    let around_line = args["around_line"].as_u64().map(|v| v as usize);

    let mut outputs: Vec<String> = Vec::new();

    for single_path in &paths {
        let resolved = resolve_path_strict(single_path, project_path)?;

        let req = file_ops::ReadFileToolRequest {
            file_path: resolved.clone(),
            max_bytes,
            max_lines: max_lines.or(Some(2000)),
            start_line,
            encoding: encoding.clone(),
            search: search.clone(),
            around_line,
        };

        let result = file_ops::read_file_content_tool_impl(req)?;

        if result.is_binary {
            if let Some(ref info) = result.binary_info {
                outputs.push(format!(
                    "⚠️ {} is a binary file ({}). Type: {}, Size: {} bytes{}",
                    resolved,
                    info.mime_type,
                    info.mime_type,
                    info.size_bytes,
                    match (info.width, info.height) {
                        (Some(w), Some(h)) => format!(", Dimensions: {}x{}", w, h),
                        _ => String::new(),
                    }
                ));
            } else {
                outputs.push(format!(
                    "⚠️ {} is a binary file. Cannot display content.",
                    resolved
                ));
            }
            continue;
        }

        let mut output = result.content;
        if result.truncated {
            output.push_str(&format!(
                "\n... (truncated after {} lines, {} bytes)",
                result.lines_read, result.bytes_read
            ));
        }
        if let Some(enc) = result.encoding_used {
            if enc != "utf-8" {
                output.push_str(&format!("\n[Encoding: {}]", enc));
            }
        }
        if let Some(total) = result.total_lines {
            output.push_str(&format!("\n[Total lines in file: {}]", total));
        }

        outputs.push(output);
    }

    Ok(outputs.join("\n\n---\n\n"))
}

fn execute_list_directory(
    args: &serde_json::Value,
    project_path: Option<&str>,
) -> Result<String, String> {
    let path = args["path"]
        .as_str()
        .or_else(|| args["directory"].as_str())
        .unwrap_or(".");

    let resolved = resolve_path_strict(path, project_path)?;
    let nodes = file_ops::read_dir_shallow(&resolved);

    if nodes.is_empty() {
        return Ok(format!(
            "Directory '{}' is empty or does not exist.",
            resolved
        ));
    }

    let mut output = format!("Directory listing for: {}\n\n", resolved);
    for node in &nodes {
        let type_indicator = if node.is_dir { "📁" } else { "📄" };
        output.push_str(&format!("{} {}", type_indicator, node.name));
        if !node.is_dir {
            // Get file size from metadata
            if let Ok(meta) = std::fs::metadata(&node.path) {
                output.push_str(&format!("  ({})", format_size_human(meta.len())));
            }
        }
        output.push('\n');
    }
    output.push_str(&format!("\nTotal: {} items", nodes.len()));

    Ok(output)
}

fn execute_get_file_tree(
    args: &serde_json::Value,
    project_path: Option<&str>,
) -> Result<String, String> {
    let path = args["path"]
        .as_str()
        .or_else(|| args["root_path"].as_str())
        .or(project_path)
        .ok_or("Missing required parameter: path")?;

    let resolved = resolve_path_strict(path, project_path)?;
    let max_depth = args["max_depth"].as_u64().map(|v| v as usize);
    let dirs_only = args["dirs_only"].as_bool();

    let result = file_ops::get_file_tree_impl(Some(resolved), max_depth, dirs_only)?;

    Ok(result.tree)
}

fn execute_search_files(
    args: &serde_json::Value,
    project_path: Option<&str>,
) -> Result<String, String> {
    let pattern = args["pattern"]
        .as_str()
        .or_else(|| args["query"].as_str())
        .ok_or("Missing required parameter: pattern")?;

    let folder = args["path"]
        .as_str()
        .or_else(|| args["folder_path"].as_str())
        .or(project_path)
        .ok_or("Missing required parameter: path")?;

    let resolved = resolve_path_strict(folder, project_path)?;
    let max_results = args["max_results"].as_u64().map(|v| v as usize);
    let exclude = args["exclude"].as_str().map(|s| s.to_string());
    let max_depth = args["max_depth"].as_u64().map(|v| v as usize);

    let results = file_ops::glob_search_files_impl(
        resolved,
        pattern.to_string(),
        max_results,
        exclude,
        max_depth,
    )?;

    if results.is_empty() {
        return Ok(format!("No files matching pattern '{}' found.", pattern));
    }

    let mut output = format!(
        "Found {} file(s) matching '{}':\n\n",
        results.len(),
        pattern
    );
    for path in &results {
        output.push_str(path);
        output.push('\n');
    }

    Ok(output)
}

fn execute_search_content(
    args: &serde_json::Value,
    project_path: Option<&str>,
) -> Result<String, String> {
    let query = args["query"]
        .as_str()
        .or_else(|| args["text"].as_str())
        .ok_or("Missing required parameter: query")?;

    let folder = args["path"]
        .as_str()
        .or_else(|| args["folder_path"].as_str())
        .or(project_path)
        .ok_or("Missing required parameter: path")?;

    let resolved = resolve_path_strict(folder, project_path)?;
    let case_sensitive = args["case_sensitive"].as_bool().unwrap_or(false);
    let use_regex = args["regex"].as_bool();
    let file_glob = args["file_glob"]
        .as_str()
        .or_else(|| args["glob"].as_str())
        .map(|s| s.to_string());
    let max_results = args["max_results"].as_u64().unwrap_or(100) as usize;
    let exclude = args["exclude"].as_str().map(|s| s.to_string());
    let context_lines = args["context_lines"].as_u64().map(|v| v as usize);

    let results = file_ops::search_in_folder_impl(
        resolved,
        query.to_string(),
        case_sensitive,
        max_results,
        10 * 1024 * 1024, // 10MB max file size
        use_regex,
        file_glob,
        exclude,
        context_lines,
    )?;

    if results.is_empty() {
        return Ok(format!("No matches found for '{}'.", query));
    }

    let mut output = String::new();
    let total_matches: usize = results.iter().map(|r| r.matches.len()).sum();
    output.push_str(&format!(
        "Found {} match(es) in {} file(s) for '{}':\n\n",
        total_matches,
        results.len(),
        query
    ));

    for file_result in &results {
        output.push_str(&format!("📄 {}\n", file_result.path));
        for m in &file_result.matches {
            // Show context lines before match
            for (i, ctx_line) in m.context_before.iter().enumerate() {
                output.push_str(&format!(
                    "  {} {}: {}\n",
                    "│".to_string(),
                    m.line.saturating_sub(m.context_before.len()).saturating_add(i),
                    ctx_line.trim()
                ));
            }
            output.push_str(&format!("  L{}: {}\n", m.line, m.preview.trim()));
            // Show context lines after match
            for (i, ctx_line) in m.context_after.iter().enumerate() {
                output.push_str(&format!(
                    "  {} {}: {}\n",
                    "│".to_string(),
                    m.line + i + 1,
                    ctx_line.trim()
                ));
            }
        }
        output.push('\n');
    }

    Ok(output)
}

fn execute_get_file_info(
    args: &serde_json::Value,
    project_path: Option<&str>,
) -> Result<String, String> {
    let path = args["path"]
        .as_str()
        .ok_or("Missing required parameter: path")?;

    let resolved = resolve_path_strict(path, project_path)?;
    let info = file_ops::get_file_info_impl(resolved)?;

    Ok(serde_json::to_string_pretty(&info).unwrap_or_else(|_| format!("{:?}", info)))
}

/// Whether first-class web tools (`fetch` / `web_search`) may perform HTTP.
///
/// These tools are intentional agent capabilities, already filtered by the
/// frontend (`canAccessBrowser` / tool allow-lists). They must work in the
/// default `auto` and `read_only` tiers.
///
/// Shell egress (`curl` / `wget` via `term`) remains gated by
/// `SandboxContext::network_enabled` (only `full_access` enables it today).
fn allow_intentional_web_tool(sandbox_ctx: &SandboxContext) -> bool {
    // Reserved for a future explicit air-gap flag. All current access modes
    // permit curated web tools.
    let _ = sandbox_ctx;
    true
}

fn execute_fetch_web_content(
    args: &serde_json::Value,
    sandbox_ctx: &SandboxContext,
) -> Result<String, String> {
    let url = args["url"]
        .as_str()
        .ok_or("Missing required parameter: url")?;

    if !allow_intentional_web_tool(sandbox_ctx) {
        let err = format!(
            "网络访问被禁止（当前环境禁用了 Web 工具）。fetch 请求: {}",
            url
        );
        crate::audit_log::log_decision(
            "ai",
            "network",
            url,
            "denied",
            Some(&err),
            &sandbox_ctx.access_mode,
        );
        return Err(err);
    }
    crate::audit_log::log_decision(
        "ai",
        "network",
        url,
        "allowed",
        Some("intentional web tool (fetch)"),
        &sandbox_ctx.access_mode,
    );

    let method = args["method"].as_str().map(|s| s.to_string());
    let headers = args["headers"].as_object().map(|obj| {
        obj.iter()
            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
            .collect::<std::collections::HashMap<String, String>>()
    });
    let body = args["body"].as_str().map(|s| s.to_string());
    let timeout = args["timeout"].as_u64();
    let follow_redirects = args["follow_redirects"].as_bool();
    let extract_links = args["extract_links"].as_bool();

    // fetch_web_content_v3 is async, use blocking approach within tokio runtime
    let rt = tokio::runtime::Handle::try_current().map_err(|_| "No tokio runtime available")?;

    let url_owned = url.to_string();
    let result = std::thread::spawn(move || {
        rt.block_on(crate::chat::fetch_web_content_v3(
            url_owned,
            method,
            headers,
            body,
            timeout,
            follow_redirects,
            extract_links,
        ))
    })
    .join()
    .map_err(|_| "Thread panicked during fetch_web_content")?;

    // Convert FetchResult to string for backend tool execution
    result.map(|fetch_result| match fetch_result.result_type.as_str() {
        "redirect" => format!(
            "网页已重定向: {} → {} ({} {})",
            fetch_result.url,
            fetch_result.redirect_to.as_deref().unwrap_or("unknown"),
            fetch_result
                .redirect_status
                .map(|s: u16| s.to_string())
                .unwrap_or_default(),
            fetch_result.code_text.as_deref().unwrap_or("")
        ),
        "binary" => format!(
            "文件已下载到: {} ({} bytes, 类型: {})",
            fetch_result.persisted_path.as_deref().unwrap_or("unknown"),
            fetch_result
                .bytes
                .map(|b: usize| b.to_string())
                .unwrap_or_default(),
            fetch_result.content_type.as_deref().unwrap_or("unknown")
        ),
        _ => {
            let content = fetch_result.content.as_deref().unwrap_or("");
            format!(
                "来源: {}\n状态: {} {}\n大小: {} bytes\n\n---\n{}",
                fetch_result.url,
                fetch_result
                    .code
                    .map(|c: u16| c.to_string())
                    .unwrap_or_default(),
                fetch_result.code_text.as_deref().unwrap_or(""),
                fetch_result
                    .bytes
                    .map(|b: usize| b.to_string())
                    .unwrap_or_default(),
                content
            )
        }
    })
}

fn execute_web_search(
    args: &serde_json::Value,
    sandbox_ctx: &SandboxContext,
) -> Result<String, String> {
    let query = args["query"]
        .as_str()
        .or_else(|| args["q"].as_str())
        .or_else(|| args["search"].as_str())
        .ok_or("Missing required parameter: query")?;

    // Same policy as fetch: curated web tool, not shell egress.
    // Default agent mode is `auto` (network_enabled=false); blocking here made
    // backend-executed web_search always fail while frontend fetch still worked.
    if !allow_intentional_web_tool(sandbox_ctx) {
        let err = format!(
            "网络访问被禁止（当前环境禁用了 Web 工具）。web_search 请求: {}",
            query
        );
        crate::audit_log::log_decision(
            "ai",
            "network",
            query,
            "denied",
            Some(&err),
            &sandbox_ctx.access_mode,
        );
        return Err(err);
    }
    crate::audit_log::log_decision(
        "ai",
        "network",
        query,
        "allowed",
        Some("intentional web tool (web_search)"),
        &sandbox_ctx.access_mode,
    );

    let num_results = args["num_results"]
        .as_u64()
        .or_else(|| args["numResults"].as_u64())
        .map(|n| n as u32);

    let rt = tokio::runtime::Handle::try_current().map_err(|_| "No tokio runtime available")?;
    let query_owned = query.to_string();
    let result = std::thread::spawn(move || {
        rt.block_on(crate::chat::web_search(query_owned, num_results))
    })
    .join()
    .map_err(|_| "Thread panicked during web_search")?;

    result.map(|resp| crate::chat::format_search_output(&resp))
}

/// Execute load_skill: read a SKILL.md file from project or global skills directory.
///
/// Resolution order: project-level `.skills/<name>/SKILL.md` first,
/// then global `{appDataDir}/skills/<name>/SKILL.md`.
/// Parses YAML frontmatter and returns the body content.
fn execute_load_skill(
    args: &serde_json::Value,
    project_path: Option<&str>,
    app_data_path: Option<&str>,
) -> Result<String, String> {
    let skill_name = args["skill_name"]
        .as_str()
        .or_else(|| args["skillName"].as_str())
        .or_else(|| args["skill"].as_str())
        .ok_or("Missing required parameter: skill_name")?;

    if skill_name.trim().is_empty() {
        return Err("skill_name must not be empty".to_string());
    }

    // Try project-level first
    if let Some(proj) = project_path {
        let project_skill_path = format!(
            "{}\\.skills\\{}\\SKILL.md",
            proj.trim_end_matches('\\'),
            skill_name
        );
        if let Ok(content) = read_and_parse_skill_file(&project_skill_path, skill_name, "project") {
            return Ok(content);
        }
    }

    // Try global-level
    if let Some(app_data) = app_data_path {
        let global_skill_path = format!(
            "{}\\skills\\{}\\SKILL.md",
            app_data.trim_end_matches('\\'),
            skill_name
        );
        if let Ok(content) = read_and_parse_skill_file(&global_skill_path, skill_name, "global") {
            return Ok(content);
        }
    }

    Err(format!(
        "Skill \"{}\" not found. Check the available_skills list for valid names.",
        skill_name
    ))
}

/// Read a SKILL.md file, parse YAML frontmatter, and return the body wrapped in XML tags.
fn read_and_parse_skill_file(file_path: &str, skill_name: &str, scope: &str) -> Result<String, ()> {
    let raw = std::fs::read_to_string(file_path).map_err(|_| ())?;
    if raw.trim().is_empty() {
        return Err(());
    }

    // Parse frontmatter: strip leading ---\n...\n---\n block
    let body = if let Some(rest) = raw.strip_prefix("---") {
        // Find the closing ---
        let rest = rest.trim_start();
        if let Some(end_idx) = rest.find("\n---") {
            rest[end_idx + 4..].trim().to_string()
        } else {
            raw.trim().to_string()
        }
    } else {
        raw.trim().to_string()
    };

    let scope_label = if scope == "project" {
        "项目级"
    } else {
        "全局级"
    };

    Ok(format!(
        "<skill name=\"{}\" scope=\"{}\">\n{}\n</skill>\n\n[已加载 {} skill \"{}\"，请按照以上指令执行任务。]",
        skill_name, scope, body, scope_label, skill_name
    ))
}

// ============================================================================
// Helpers
// ============================================================================

fn format_size_human(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else if bytes < 1024 * 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else {
        format!("{:.2} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backend_executable_classification() {
        assert!(is_backend_executable("read_file"));
        assert!(is_backend_executable("list_directory"));
        assert!(is_backend_executable("get_file_tree"));
        assert!(is_backend_executable("search_files"));
        assert!(is_backend_executable("search_content"));
        assert!(is_backend_executable("get_file_info"));
        assert!(is_backend_executable("fetch_web_content"));
        assert!(is_backend_executable("fetch"));
        assert!(!is_backend_executable("web_search"));
        assert!(is_backend_executable("load_skill"));

        // Write/mutating tools should NOT be backend-executable
        assert!(!is_backend_executable("write_file"));
        assert!(!is_backend_executable("edit_file"));
        assert!(!is_backend_executable("run_command"));
        assert!(!is_backend_executable("create_folder"));
        assert!(!is_backend_executable("browser_navigate"));
    }

    #[test]
    fn test_all_tools_backend_executable() {
        let all_read = vec![
            serde_json::json!({"id": "1", "function": {"name": "read_file", "arguments": "{}"}}),
            serde_json::json!({"id": "2", "function": {"name": "list_directory", "arguments": "{}"}}),
        ];
        assert!(all_tools_backend_executable(&all_read));

        let mixed = vec![
            serde_json::json!({"id": "1", "function": {"name": "read_file", "arguments": "{}"}}),
            serde_json::json!({"id": "2", "function": {"name": "write_file", "arguments": "{}"}}),
        ];
        assert!(!all_tools_backend_executable(&mixed));

        assert!(!all_tools_backend_executable(&[]));
    }

    #[test]
    fn test_resolve_path_absolute_outside_is_rejected() {
        let err = resolve_path_strict("C:\\Users\\test\\file.rs", Some("D:\\project")).unwrap_err();
        assert!(err.contains("越界") || err.contains("工作区"));
    }

    #[test]
    fn test_resolve_path_absolute_inside_is_allowed() {
        let resolved =
            resolve_path_strict("D:\\project\\src\\a.rs", Some("D:\\project")).expect("ok");
        assert!(resolved.to_lowercase().contains("d:\\project"));
    }

    #[test]
    fn test_resolve_path_relative() {
        let resolved = resolve_path_strict("src/main.rs", Some("D:\\project")).expect("ok");
        let norm = resolved.replace('/', "\\").to_lowercase();
        assert_eq!(norm, "d:\\project\\src\\main.rs");
    }

    #[test]
    fn test_resolve_path_traversal_rejected() {
        let err = resolve_path_strict("..\\..\\Windows\\System32", Some("D:\\project")).unwrap_err();
        assert!(err.contains("越界") || err.contains("工作区"));
    }

    #[test]
    fn test_resolve_path_no_base() {
        let resolved = resolve_path_strict("src/main.rs", None).expect("ok");
        assert!(resolved.contains("main.rs"));
    }

    #[test]
    fn test_execute_read_file_array() {
        use std::fs;
        
        let temp_dir = std::env::temp_dir();
        let file1_path = temp_dir.join("test_file_1.txt");
        let file2_path = temp_dir.join("test_file_2.txt");
        
        fs::write(&file1_path, "Content of file 1").unwrap();
        fs::write(&file2_path, "Content of file 2").unwrap();
        
        let path1_str = file1_path.to_string_lossy().to_string();
        let path2_str = file2_path.to_string_lossy().to_string();
        
        // Test array of paths in "path" field
        let args = serde_json::json!({
            "path": [path1_str.clone(), path2_str.clone()]
        });
        
        let result = execute_read_file(&args, None).unwrap();
        assert!(result.contains("Content of file 1"));
        assert!(result.contains("Content of file 2"));
        
        // Test array of paths in "paths" field
        let args_paths = serde_json::json!({
            "paths": [path1_str.clone(), path2_str.clone()]
        });
        
        let result_paths = execute_read_file(&args_paths, None).unwrap();
        assert!(result_paths.contains("Content of file 1"));
        assert!(result_paths.contains("Content of file 2"));
        
        // Clean up
        let _ = fs::remove_file(file1_path);
        let _ = fs::remove_file(file2_path);
    }

    #[test]
    fn test_execute_read_file_single() {
        use std::fs;
        
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join("test_file_single.txt");
        fs::write(&file_path, "Single content").unwrap();
        let path_str = file_path.to_string_lossy().to_string();
        
        let args = serde_json::json!({
            "path": path_str.clone()
        });
        let result = execute_read_file(&args, None).unwrap();
        assert!(result.contains("Single content"));
        
        let args_file_path = serde_json::json!({
            "file_path": path_str.clone()
        });
        let result_file_path = execute_read_file(&args_file_path, None).unwrap();
        assert!(result_file_path.contains("Single content"));
        
        let _ = fs::remove_file(file_path);
    }

    #[test]
    fn test_build_tool_result_messages() {
        let tool_calls = vec![
            serde_json::json!({
                "id": "tc_1",
                "type": "function",
                "function": {
                    "name": "read_file",
                    "arguments": "{\"path\":\"file.txt\"}"
                }
            })
        ];
        
        let results = vec![
            ToolExecutionResult {
                tool_call_id: "tc_1".to_string(),
                tool_name: "read_file".to_string(),
                output: "file contents".to_string(),
                success: true,
            }
        ];

        // 1) Test standard (e.g. openai) provider
        let msgs_openai = build_tool_result_messages(
            "thinking text",
            &tool_calls,
            &results,
            "openai",
            &[]
        );

        assert_eq!(msgs_openai.len(), 2);
        assert_eq!(msgs_openai[0].role, "assistant");
        
        // Under openai, tool_calls are pushed raw in assistant message content
        if let serde_json::Value::Array(ref arr) = msgs_openai[0].content {
            assert_eq!(arr.len(), 2);
            assert_eq!(arr[0]["type"], "text");
            assert_eq!(arr[1]["type"], "function");
        } else {
            panic!("Expected array content");
        }
        
        assert_eq!(msgs_openai[1].role, "tool");
        assert_eq!(msgs_openai[1].content, serde_json::Value::String("file contents".to_string()));

        // 2) Test anthropic provider
        let msgs_anthropic = build_tool_result_messages(
            "thinking text",
            &tool_calls,
            &results,
            "anthropic",
            &[]
        );

        assert_eq!(msgs_anthropic.len(), 2);
        assert_eq!(msgs_anthropic[0].role, "assistant");
        
        // Under anthropic, tool_calls are transformed to Anthropic tool_use blocks
        if let serde_json::Value::Array(ref arr) = msgs_anthropic[0].content {
            assert_eq!(arr.len(), 2);
            assert_eq!(arr[0]["type"], "text");
            assert_eq!(arr[1]["type"], "tool_use");
            assert_eq!(arr[1]["id"], "tc_1");
            assert_eq!(arr[1]["name"], "read_file");
            assert_eq!(arr[1]["input"]["path"], "file.txt");
        } else {
            panic!("Expected array content");
        }
        
        assert_eq!(msgs_anthropic[1].role, "tool");
        assert_eq!(msgs_anthropic[1].content, serde_json::Value::String("file contents".to_string()));
    }

    #[test]
    fn test_fetch_web_content_allowed_in_auto_mode_without_shell_network() {
        // Default agent tier is `auto` with network_enabled=false (shell egress
        // still blocked). Intentional web tools must still be permitted.
        let sandbox_ctx = SandboxContext {
            readable_roots: vec![],
            writable_roots: vec![],
            access_mode: "auto".to_string(),
            network_enabled: false,
        };
        let args = serde_json::json!({"url": "https://127.0.0.1:1/nonexistent"});
        let result = execute_fetch_web_content(&args, &sandbox_ctx);
        assert!(result.is_err()); // connection refused / request fail, not sandbox block
        let err = result.unwrap_err();
        assert!(
            !err.contains("网络访问被禁止"),
            "intentional fetch must not be blocked when shell network is off: {err}"
        );
    }

    #[test]
    fn test_web_search_allowed_in_auto_mode_without_shell_network() {
        let sandbox_ctx = SandboxContext {
            readable_roots: vec![],
            writable_roots: vec![],
            access_mode: "auto".to_string(),
            network_enabled: false,
        };
        let args = serde_json::json!({"query": "rust async"});
        // May succeed or fail on network, but must not be sandbox-denied.
        let result = execute_web_search(&args, &sandbox_ctx);
        if let Err(err) = result {
            assert!(
                !err.contains("网络访问被禁止"),
                "intentional web_search must not be blocked when shell network is off: {err}"
            );
        }
    }

    #[test]
    fn test_fetch_web_content_allowed_when_network_enabled() {
        let sandbox_ctx = SandboxContext {
            readable_roots: vec![],
            writable_roots: vec![],
            access_mode: "auto".to_string(),
            network_enabled: true,
        };
        let args = serde_json::json!({"url": "https://127.0.0.1:1/nonexistent"});
        // Network is enabled, so validation passes — the actual HTTP request
        // will fail with a connection error, not a sandbox denial.
        let result = execute_fetch_web_content(&args, &sandbox_ctx);
        assert!(result.is_err()); // connection refused, not sandbox block
        let err = result.unwrap_err();
        assert!(
            !err.contains("网络访问被禁止"),
            "should not be blocked by sandbox when network is enabled"
        );
    }

    #[test]
    fn test_fetch_web_content_allowed_in_trusted_mode() {
        let sandbox_ctx = SandboxContext {
            readable_roots: vec![],
            writable_roots: vec![],
            access_mode: "full_access".to_string(),
            network_enabled: false,
        };
        let args = serde_json::json!({"url": "https://127.0.0.1:1/nonexistent"});
        let result = execute_fetch_web_content(&args, &sandbox_ctx);
        assert!(result.is_err()); // connection refused, not sandbox block
        let err = result.unwrap_err();
        assert!(
            !err.contains("网络访问被禁止"),
            "trusted mode should bypass network check"
        );
    }
}
