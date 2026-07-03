//! MCP (Model Context Protocol) module
//!
//! This module contains MCP server management, transport layer, and tool types.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, BufWriter, Write};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

// ============================================================================
// MCP Transport Layer
// ============================================================================

/// MCP transport layer abstraction
pub enum McpTransport {
    /// Standard IO transport (spawned process)
    Stdio {
        process: Option<Child>,
        stdin: Option<BufWriter<ChildStdin>>,
        stdout: Option<BufReader<ChildStdout>>,
    },
    /// HTTP transport
    Http {
        url: String,
        client: reqwest::blocking::Client,
    },
    /// SSE transport (Server-Sent Events)
    Sse {
        /// POST endpoint for requests
        post_endpoint: String,
        client: reqwest::blocking::Client,
        /// Receiver for JSON-RPC messages from SSE thread
        receiver: Arc<Mutex<std::sync::mpsc::Receiver<serde_json::Value>>>,
    },
}

// ============================================================================
// Single MCP Server Instance
// ============================================================================

/// A single MCP server instance
pub struct SingleMcpServer {
    pub transport: McpTransport,
    pub io_lock: Arc<Mutex<()>>,
    pub request_id: AtomicU64,
    pub is_initialized: AtomicBool,
    pub server_name: String,
}

impl SingleMcpServer {
    /// Send JSON-RPC request and receive response, abstracting different transport layers
    pub fn send_and_receive(
        &mut self,
        request: &serde_json::Value,
        request_id: u64,
    ) -> Result<serde_json::Value, String> {
        match &mut self.transport {
            McpTransport::Stdio { stdin, stdout, .. } => {
                // Stdio: write to stdin + read from stdout
                let stdin_ref = stdin.as_mut().ok_or("stdin not available")?;
                let request_str = serde_json::to_string(request)
                    .map_err(|e| format!("Serialization failed: {}", e))?;
                writeln!(stdin_ref, "{}", request_str)
                    .map_err(|e| format!("Write failed: {}", e))?;
                stdin_ref
                    .flush()
                    .map_err(|e| format!("Flush failed: {}", e))?;

                let stdout_ref = stdout.as_mut().ok_or("stdout not available")?;
                read_jsonrpc_response(stdout_ref, request_id, &self.server_name, 50)
            }
            McpTransport::Http { url, client } => {
                // HTTP: POST JSON-RPC request to URL
                let resp = client
                    .post(url.as_str())
                    .header("Content-Type", "application/json")
                    .json(request)
                    .send()
                    .map_err(|e| format!("HTTP 请求失败 ({}): {}", self.server_name, e))?;

                if !resp.status().is_success() {
                    return Err(format!(
                        "HTTP response error ({}): {}",
                        self.server_name,
                        resp.status()
                    ));
                }

                let text = resp.text().map_err(|e| {
                    format!("Failed to read HTTP response ({}): {}", self.server_name, e)
                })?;

                serde_json::from_str(&text).map_err(|e| {
                    format!(
                        "Failed to parse HTTP JSON-RPC response ({}): {} - Original: {}",
                        self.server_name,
                        e,
                        &text[..text.len().min(500)]
                    )
                })
            }
            McpTransport::Sse {
                post_endpoint,
                client,
                receiver,
            } => {
                // SSE: POST request to endpoint, read from receiver channel
                let resp = client
                    .post(post_endpoint.as_str())
                    .header("Content-Type", "application/json")
                    .json(request)
                    .send()
                    .map_err(|e| format!("SSE POST 请求失败 ({}): {}", self.server_name, e))?;

                if !resp.status().is_success() {
                    return Err(format!(
                        "SSE POST response error ({}): {}",
                        self.server_name,
                        resp.status()
                    ));
                }

                // Read matching response from SSE channel (max 60 seconds)
                let rx = receiver
                    .lock()
                    .map_err(|_| "Failed to lock SSE receiver".to_string())?;
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
                loop {
                    let remaining = deadline.saturating_duration_since(std::time::Instant::now());
                    if remaining.is_zero() {
                        return Err(format!(
                            "SSE 等待响应超时 ({}): id={}",
                            self.server_name, request_id
                        ));
                    }
                    match rx.recv_timeout(remaining) {
                        Ok(msg) => {
                            // Notification messages have no id, skip
                            if msg.get("id").is_none() {
                                log::debug!("[MCP][{}] SSE 璺宠繃閫氱煡: {}", self.server_name, msg);
                                continue;
                            }
                            // Check if id matches
                            let matches = match msg.get("id") {
                                Some(serde_json::Value::Number(n)) => {
                                    n.as_u64() == Some(request_id)
                                }
                                _ => false,
                            };
                            if matches {
                                return Ok(msg);
                            }
                            log::debug!(
                                "[MCP][{}] 跳过不匹配响应 (期望 id={}): {}",
                                self.server_name, request_id, msg
                            );
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                            return Err(format!(
                                "SSE 等待响应超时 ({}): id={}",
                                self.server_name, request_id
                            ));
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                            return Err(format!("SSE 连接已断开€ ({})", self.server_name));
                        }
                    }
                }
            }
        }
    }
}

// ============================================================================
// MCP Server Configuration
// ============================================================================

/// Server definition in MCP configuration
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub enabled: bool,
    #[serde(default)]
    pub env: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub url: Option<String>,
    /// Transport type: "stdio" | "http" | "sse" (default inferred from url/command)
    #[serde(default)]
    pub transport: Option<String>,
}

// ============================================================================
// MCP Server State
// ============================================================================

/// Multi-MCP server state management
pub struct McpServerState {
    pub servers: Arc<Mutex<HashMap<String, SingleMcpServer>>>,
}

impl Default for McpServerState {
    fn default() -> Self {
        Self {
            servers: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

// ============================================================================
// MCP Events and Status
// ============================================================================

/// MCP server async start event payload
#[derive(Clone, serde::Serialize)]
pub struct McpServerStartedPayload {
    pub server_id: String,
    pub server_name: String,
    pub success: bool,
    pub error: Option<String>,
}

/// Status entry for listing all servers
#[derive(Serialize, Clone)]
pub struct McpServerStatusEntry {
    pub server_id: String,
    pub server_name: String,
    pub is_running: bool,
    pub is_initialized: bool,
}

// ============================================================================
// MCP Tool Types
// ============================================================================

/// Tool info with server ID
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpToolInfoWithServer {
    pub name: String,
    pub description: Option<String>,
    pub server_id: String,
}

/// Property schema for MCP tool parameters
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpPropertySchema {
    #[serde(rename = "type", default, skip_serializing_if = "String::is_empty")]
    pub prop_type: String,
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enum_values: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Box<McpPropertySchema>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub properties: Option<std::collections::HashMap<String, McpPropertySchema>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<Vec<String>>,
    // --- Advanced JSON Schema fields ---
    #[serde(rename = "oneOf", skip_serializing_if = "Option::is_none")]
    pub one_of: Option<Vec<McpPropertySchema>>,
    #[serde(rename = "anyOf", skip_serializing_if = "Option::is_none")]
    pub any_of: Option<Vec<McpPropertySchema>>,
    #[serde(rename = "allOf", skip_serializing_if = "Option::is_none")]
    pub all_of: Option<Vec<McpPropertySchema>>,
    #[serde(rename = "$ref", skip_serializing_if = "Option::is_none")]
    pub ref_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimum: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maximum: Option<f64>,
    #[serde(
        rename = "additionalProperties",
        skip_serializing_if = "Option::is_none"
    )]
    pub additional_properties: Option<Box<serde_json::Value>>,
}

/// Input schema for MCP tool
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpInputSchema {
    #[serde(rename = "type")]
    pub schema_type: String,
    pub properties: std::collections::HashMap<String, McpPropertySchema>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<Vec<String>>,
}

/// Tool schema from MCP server
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpToolSchema {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: McpInputSchema,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_id: Option<String>,
}

/// Result of fetching tool schemas
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpToolSchemaResult {
    pub success: bool,
    pub schemas: Vec<McpToolSchema>,
    pub error: Option<String>,
}

// ============================================================================
// MCP Content Items
// ============================================================================

/// MCP content item - corresponds to each item in result.content array
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum McpContentItem {
    Text {
        text: String,
    },
    Image {
        data: String,
        #[serde(rename = "mimeType", default = "default_mime_png")]
        mime_type: String,
        /// For frontend display, convenient for size check
        #[serde(skip_serializing_if = "Option::is_none")]
        data_len: Option<usize>,
    },
    Resource {
        resource: serde_json::Value,
    },
}

pub fn default_mime_png() -> String {
    "image/png".to_string()
}

/// Result of calling an MCP tool
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpToolResult {
    pub success: bool,
    /// Raw JSON value (backward compatibility)
    pub content: Option<serde_json::Value>,
    /// Structured content items
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_items: Option<Vec<McpContentItem>>,
    /// MCP isError flag (tool returned content but execution failed)
    #[serde(default)]
    pub is_error: bool,
    pub error: Option<String>,
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Read JSON-RPC messages from MCP server stdout, skip notifications, return matching response
pub fn read_jsonrpc_response(
    stdout: &mut BufReader<ChildStdout>,
    expected_id: u64,
    server_name: &str,
    max_attempts: usize,
) -> Result<serde_json::Value, String> {
    for attempt in 0..max_attempts {
        let mut line = String::new();
        stdout
            .read_line(&mut line)
            .map_err(|e| format!("读取响应失败 ({}): {}", server_name, e))?;

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let msg: serde_json::Value = serde_json::from_str(trimmed).map_err(|e| {
            format!(
                "解析 JSON-RPC 消息失败 ({}): {} — 原始内容: {}",
                server_name, e, trimmed
            )
        })?;

        // Notification messages have no "id" field, skip
        if msg.get("id").is_none() {
            log::debug!("[MCP][{}] 跳过通知: {}", server_name, trimmed);
            continue;
        }

        // Check if id matches
        if let Some(id_val) = msg.get("id") {
            let matches = match id_val {
                serde_json::Value::Number(n) => n.as_u64() == Some(expected_id),
                _ => false,
            };
            if matches {
                return Ok(msg);
            }
            // id mismatch, possibly out-of-order response (rare), log and continue
            log::debug!(
                "[MCP][{}] 跳过不匹配的响应 (期望 id={}, 实际 id={}): {}",
                server_name, expected_id, id_val, trimmed
            );
        }

        if attempt == max_attempts - 1 {
            return Err(format!(
                "[MCP][{}] 读取 {} 次仍未收到 id={} 的响应",
                server_name, max_attempts, expected_id
            ));
        }
    }
    Err(format!("[MCP][{}] 读取响应超过最大尝试次数", server_name))
}

/// Sanitize MCP tool result, extract structured content_items and isError
/// Returns (sanitized_result_for_log, content_items, is_error)
pub fn sanitize_mcp_tool_result(
    result: serde_json::Value,
) -> (serde_json::Value, Option<Vec<McpContentItem>>, bool) {
    let is_error = result
        .get("isError")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let mut content_items: Vec<McpContentItem> = Vec::new();
    let mut sanitized = result.clone();

    if let Some(arr) = result.get("content").and_then(|v| v.as_array()) {
        for (idx, item) in arr.iter().enumerate() {
            match item.get("type").and_then(|v| v.as_str()) {
                Some("text") => {
                    if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                        content_items.push(McpContentItem::Text {
                            text: text.to_string(),
                        });
                    }
                }
                Some("image") => {
                    let data = item
                        .get("data")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let mime = item
                        .get("mimeType")
                        .and_then(|v| v.as_str())
                        .unwrap_or("image/png")
                        .to_string();
                    let data_len = data.len();

                    content_items.push(McpContentItem::Image {
                        data,
                        mime_type: mime,
                        data_len: Some(data_len),
                    });

                    // Remove base64 data in sanitized version to keep logs concise
                    if let Some(san_arr) =
                        sanitized.get_mut("content").and_then(|v| v.as_array_mut())
                    {
                        if let Some(san_item) = san_arr.get_mut(idx) {
                            san_item["data_len"] = serde_json::json!(data_len);
                            san_item["data"] = serde_json::json!("(omitted)");
                        }
                    }
                }
                Some("resource") => {
                    if let Some(res) = item.get("resource") {
                        content_items.push(McpContentItem::Resource {
                            resource: res.clone(),
                        });
                    }
                }
                _ => {
                    // Unknown type: pass raw JSON as text
                    content_items.push(McpContentItem::Text {
                        text: serde_json::to_string(item).unwrap_or_default(),
                    });
                }
            }
        }
    }

    let items = if content_items.is_empty() {
        None
    } else {
        Some(content_items)
    };

    (sanitized, items, is_error)
}

// ============================================================================
// Tauri Commands and Server Management
// ============================================================================

/// 内部辅助：启动单个 MCP 服务器进程，执行 JSON-RPC 初始化
pub fn spawn_single_mcp_server(
    server_id: &str,
    server_name: &str,
    command: &str,
    args: &[String],
    env: &std::collections::HashMap<String, String>,
) -> Result<SingleMcpServer, String> {
    log::info!(
        "[MCP] Starting server '{}' (id: {}): {} {:?}",
        server_name, server_id, command, args
    );

    // 检测 npx 是否可用（如果命令是 npx）
    if command == "npx" {
        #[cfg(target_os = "windows")]
        let npx_check = std::process::Command::new("cmd")
            .args(["/c", "npx", "--version"])
            .creation_flags(0x08000000)
            .output();

        #[cfg(not(target_os = "windows"))]
        let npx_check = std::process::Command::new("npx").arg("--version").output();

        match &npx_check {
            Ok(output) if output.status.success() => {
                let version = String::from_utf8_lossy(&output.stdout);
                log::debug!("[MCP] npx version: {}", version.trim());
            }
            _ => {
                return Err(
                    "未检测到 Node.js/npx。请先安装 Node.js: https://nodejs.org/".to_string(),
                );
            }
        }
    }

    // 启动进程
    #[cfg(target_os = "windows")]
    let mut child = if command == "npx" || command == "node" || command == "npm" {
        let mut cmd = std::process::Command::new("cmd");
        cmd.arg("/c")
            .arg(command)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(0x08000000);
        if !env.is_empty() {
            cmd.envs(env);
        }
        cmd.spawn()
            .map_err(|e| format!("启动 MCP 服务器 '{}' 失败: {}", server_name, e))?
    } else {
        let mut cmd = std::process::Command::new(command);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(0x08000000);
        if !env.is_empty() {
            cmd.envs(env);
        }
        cmd.spawn()
            .map_err(|e| format!("启动 MCP 服务器 '{}' 失败: {}", server_name, e))?
    };

    #[cfg(not(target_os = "windows"))]
    let mut child = {
        let mut cmd = std::process::Command::new(command);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if !env.is_empty() {
            cmd.envs(env);
        }
        cmd.spawn()
            .map_err(|e| format!("启动 MCP 服务器 '{}' 失败: {}", server_name, e))?
    };

    let stdin = child
        .stdin
        .take()
        .ok_or(format!("无法获取 {} 的 stdin", server_name))?;
    let stdout = child
        .stdout
        .take()
        .ok_or(format!("无法获取 {} 的 stdout", server_name))?;
    let stderr: ChildStderr = child
        .stderr
        .take()
        .ok_or(format!("无法获取 {} 的 stderr", server_name))?;

    // stderr 日志线程
    let name_for_thread = server_name.to_string();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    let s = line.trim();
                    if !s.is_empty() {
                        log::debug!("[MCP][{}][stderr] {}", name_for_thread, s);
                    }
                }
                Err(_) => break,
            }
        }
    });

    let mut stdin_writer = BufWriter::new(stdin);
    let mut stdout_reader = BufReader::new(stdout);

    // JSON-RPC 初始化
    let init_request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 0,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": { "listChanged": true },
                "resources": { "subscribe": true, "listChanged": true },
                "prompts": { "listChanged": true }
            },
            "clientInfo": {
                "name": "Loom",
                "version": "1.0.0"
            }
        }
    });

    let request_str =
        serde_json::to_string(&init_request).map_err(|e| format!("序列化失败: {}", e))?;
    writeln!(stdin_writer, "{}", request_str)
        .map_err(|e| format!("写入初始化请求失败 ({}): {}", server_name, e))?;
    stdin_writer
        .flush()
        .map_err(|e| format!("刷新失败 ({}): {}", server_name, e))?;

    let mut init_line = String::new();
    stdout_reader
        .read_line(&mut init_line)
        .map_err(|e| format!("读取初始化响应失败 ({}): {}", server_name, e))?;
    log::debug!(
        "[MCP][{}] Initialize response: {}",
        server_name,
        init_line.trim()
    );

    // 发送 initialized 通知
    let initialized_notification = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    });
    let notif_str = serde_json::to_string(&initialized_notification)
        .map_err(|e| format!("序列化失败: {}", e))?;
    writeln!(stdin_writer, "{}", notif_str)
        .map_err(|e| format!("写入通知失败 ({}): {}", server_name, e))?;
    stdin_writer
        .flush()
        .map_err(|e| format!("刷新失败 ({}): {}", server_name, e))?;

    log::info!(
        "[MCP][{}] Server started and initialized successfully",
        server_name
    );

    Ok(SingleMcpServer {
        transport: McpTransport::Stdio {
            process: Some(child),
            stdin: Some(stdin_writer),
            stdout: Some(stdout_reader),
        },
        io_lock: Arc::new(Mutex::new(())),
        request_id: AtomicU64::new(1),
        is_initialized: AtomicBool::new(true),
        server_name: server_name.to_string(),
    })
}

/// 内部辅助：创建 HTTP 传输的 MCP 服务器
pub fn spawn_http_mcp_server(
    server_id: &str,
    server_name: &str,
    url: &str,
) -> Result<SingleMcpServer, String> {
    log::info!(
        "[MCP] Starting HTTP server '{}' (id: {}): {}",
        server_name, server_id, url
    );

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    // 发送 initialize 请求
    let init_request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 0,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": { "listChanged": true },
                "resources": { "subscribe": true, "listChanged": true },
                "prompts": { "listChanged": true }
            },
            "clientInfo": {
                "name": "Loom",
                "version": "1.0.0"
            }
        }
    });

    let resp = client
        .post(url)
        .header("Content-Type", "application/json")
        .json(&init_request)
        .send()
        .map_err(|e| format!("初始化 HTTP MCP 服务器 '{}' 失败: {}", server_name, e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "HTTP MCP 服务器 '{}' 初始化返回错误: {}",
            server_name,
            resp.status()
        ));
    }

    let init_body = resp.text().unwrap_or_default();
    log::debug!(
        "[MCP][{}] HTTP Initialize response: {}",
        server_name,
        &init_body[..init_body.len().min(500)]
    );

    // 发送 initialized 通知
    let initialized_notification = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    });

    let _ = client
        .post(url)
        .header("Content-Type", "application/json")
        .json(&initialized_notification)
        .send();

    log::info!(
        "[MCP][{}] HTTP Server initialized successfully",
        server_name
    );

    Ok(SingleMcpServer {
        transport: McpTransport::Http {
            url: url.to_string(),
            client,
        },
        io_lock: Arc::new(Mutex::new(())),
        request_id: AtomicU64::new(1),
        is_initialized: AtomicBool::new(true),
        server_name: server_name.to_string(),
    })
}

/// 内部辅助：停止单个服务器
pub fn shutdown_single_server(server: &mut SingleMcpServer) {
    log::info!("[MCP] Stopping server '{}'", server.server_name);
    match &mut server.transport {
        McpTransport::Stdio {
            process,
            stdin,
            stdout,
        } => {
            if let Some(ref mut child) = process {
                let _ = child.kill();
                let _ = child.wait();
            }
            *process = None;
            *stdin = None;
            *stdout = None;
        }
        McpTransport::Http { .. } => {
            // HTTP 传输无需特殊清理
        }
        McpTransport::Sse { .. } => {
            // SSE: drop receiver 后后台线程会自动退出
            log::debug!(
                "[MCP][{}] SSE connection will be dropped",
                server.server_name
            );
        }
    }
    server.is_initialized.store(false, Ordering::SeqCst);
}

/// 内部辅助：启动 SSE 传输的 MCP 服务器
pub fn spawn_sse_mcp_server(
    server_id: &str,
    server_name: &str,
    sse_url: &str,
) -> Result<SingleMcpServer, String> {
    log::info!(
        "[MCP] Starting SSE server '{}' (id: {}): {}",
        server_name, server_id, sse_url
    );

    let client = reqwest::blocking::Client::builder()
        .timeout(None) // SSE 是长连接
        .build()
        .map_err(|e| format!("创建 SSE HTTP 客户端失败: {}", e))?;

    // 连接 SSE endpoint
    let sse_resp = client
        .get(sse_url)
        .header("Accept", "text/event-stream")
        .send()
        .map_err(|e| format!("连接 SSE 端点失败 ({}): {}", server_name, e))?;

    if !sse_resp.status().is_success() {
        return Err(format!(
            "SSE 端点返回错误 ({}): {}",
            server_name,
            sse_resp.status()
        ));
    }

    // 创建 channel 用于 SSE 后台线程 → 主线程通信
    let (tx, rx) = std::sync::mpsc::channel::<serde_json::Value>();
    // 也创建一个 channel 用于接收初始 endpoint URL
    let (endpoint_tx, endpoint_rx) = std::sync::mpsc::channel::<String>();

    let name_for_thread = server_name.to_string();

    // 后台线程：读取 SSE 事件流
    std::thread::spawn(move || {
        let reader = std::io::BufReader::new(sse_resp);
        let mut event_type = String::new();
        let mut data_buf = String::new();
        let mut endpoint_sent = false;

        for line_result in reader.lines() {
            let line = match line_result {
                Ok(l) => l,
                Err(e) => {
                    log::warn!("[MCP][{}] SSE 读取错误: {}", name_for_thread, e);
                    break;
                }
            };

            let trimmed = line.trim();

            if trimmed.is_empty() {
                // 空行 = 事件结束，处理累积的数据
                if !data_buf.is_empty() {
                    if event_type == "endpoint" && !endpoint_sent {
                        // 发送 endpoint URL
                        let endpoint = data_buf.trim().to_string();
                        log::debug!("[MCP][{}] SSE 收到 endpoint: {}", name_for_thread, endpoint);
                        let _ = endpoint_tx.send(endpoint);
                        endpoint_sent = true;
                    } else {
                        // 尝试解析为 JSON-RPC 消息
                        match serde_json::from_str::<serde_json::Value>(&data_buf) {
                            Ok(msg) => {
                                if tx.send(msg).is_err() {
                                    log::debug!("[MCP][{}] SSE channel 已关闭，退出", name_for_thread);
                                    break;
                                }
                            }
                            Err(e) => {
                                log::warn!(
                                    "[MCP][{}] SSE 解析 JSON 失败: {} — 数据: {}",
                                    name_for_thread,
                                    e,
                                    &data_buf[..data_buf.len().min(200)]
                                );
                            }
                        }
                    }
                }
                event_type.clear();
                data_buf.clear();
                continue;
            }

            if let Some(rest) = trimmed.strip_prefix("event:") {
                event_type = rest.trim().to_string();
            } else if let Some(rest) = trimmed.strip_prefix("data:") {
                if !data_buf.is_empty() {
                    data_buf.push('\n');
                }
                data_buf.push_str(rest.trim());
            }
            // 忽略 id:, retry: 等其他 SSE 字段
        }

        log::debug!("[MCP][{}] SSE 读取线程退出", name_for_thread);
    });

    // 等待接收 endpoint URL（最多 30 秒）
    let post_endpoint = endpoint_rx
        .recv_timeout(std::time::Duration::from_secs(30))
        .map_err(|_| {
            format!(
                "SSE 等待 endpoint 超时 ({}): 30 秒内未收到 endpoint 事件",
                server_name
            )
        })?;

    // 如果 endpoint 是相对路径，拼接成绝对 URL
    let post_endpoint =
        if post_endpoint.starts_with("http://") || post_endpoint.starts_with("https://") {
            post_endpoint
        } else {
            // 从 sse_url 提取 base URL
            let base = if let Some(pos) = sse_url.rfind('/') {
                &sse_url[..pos]
            } else {
                sse_url
            };
            if post_endpoint.starts_with('/') {
                format!("{}{}", base, post_endpoint)
            } else {
                format!("{}/{}", base, post_endpoint)
            }
        };

    log::debug!(
        "[MCP][{}] SSE POST endpoint: {}",
        server_name, post_endpoint
    );

    // 用一个新的带超时的 client 用于 POST 请求
    let post_client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("创建 POST 客户端失败: {}", e))?;

    // 发送 initialize 请求
    let init_request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 0,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": { "listChanged": true },
                "resources": { "subscribe": true, "listChanged": true },
                "prompts": { "listChanged": true }
            },
            "clientInfo": {
                "name": "Loom",
                "version": "1.0.0"
            }
        }
    });

    let resp = post_client
        .post(&post_endpoint)
        .header("Content-Type", "application/json")
        .json(&init_request)
        .send()
        .map_err(|e| format!("SSE 初始化请求失败 ({}): {}", server_name, e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "SSE 初始化返回错误 ({}): {}",
            server_name,
            resp.status()
        ));
    }

    // 从 SSE channel 读取初始化响应
    let init_response = rx
        .recv_timeout(std::time::Duration::from_secs(30))
        .map_err(|_| format!("SSE 等待初始化响应超时 ({})", server_name))?;
    log::debug!(
        "[MCP][{}] SSE Initialize response: {:?}",
        server_name, init_response
    );

    // 发送 initialized 通知
    let initialized_notification = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    });

    let _ = post_client
        .post(&post_endpoint)
        .header("Content-Type", "application/json")
        .json(&initialized_notification)
        .send();

    log::info!("[MCP][{}] SSE Server initialized successfully", server_name);

    Ok(SingleMcpServer {
        transport: McpTransport::Sse {
            post_endpoint,
            client: post_client,
            receiver: Arc::new(Mutex::new(rx)),
        },
        io_lock: Arc::new(Mutex::new(())),
        request_id: AtomicU64::new(1),
        is_initialized: AtomicBool::new(true),
        server_name: server_name.to_string(),
    })
}

/// 读取 MCP 配置中 enabled 的服务器列表
pub fn read_enabled_mcp_servers() -> Result<Vec<McpServerConfig>, String> {
    let config_file = crate::config_paths::resolve_dot_config_file("mcp_config.json")?;

    if !config_file.exists() {
        return Ok(vec![]);
    }

    let content =
        std::fs::read_to_string(&config_file).map_err(|e| format!("读取 MCP 配置失败: {}", e))?;

    let config: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析 MCP 配置失败: {}", e))?;

    // MCP 标准格式: { "mcpServers": { "name": { "command": "...", "args": [...], "disabled": false } } }
    if let Some(mcp_servers) = config.get("mcpServers").and_then(|v| v.as_object()) {
        let servers: Vec<McpServerConfig> = mcp_servers
            .iter()
            .filter_map(|(key, v)| {
                let command = v
                    .get("command")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                let args: Vec<String> = match v.get("args") {
                    Some(serde_json::Value::Array(arr)) => arr
                        .iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect(),
                    Some(serde_json::Value::String(s)) => {
                        s.split_whitespace().map(|s| s.to_string()).collect()
                    }
                    _ => vec![],
                };
                let disabled = v.get("disabled").and_then(|x| x.as_bool()).unwrap_or(false);
                let enabled = !disabled;

                let url = v.get("url").and_then(|x| x.as_str()).map(|s| s.to_string());

                if (command.is_empty() && url.is_none()) || !enabled {
                    None
                } else {
                    // 解析 env 环境变量
                    let env: std::collections::HashMap<String, String> = match v.get("env") {
                        Some(serde_json::Value::Object(obj)) => obj
                            .iter()
                            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                            .collect(),
                        _ => std::collections::HashMap::new(),
                    };

                    let transport = v
                        .get("transport")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string());

                    Some(McpServerConfig {
                        id: key.clone(),
                        name: key.clone(),
                        command,
                        args,
                        enabled,
                        env,
                        url,
                        transport,
                    })
                }
            })
            .collect();

        return Ok(servers);
    }

    // 向后兼容: 旧的 { "servers": [ { "id": "...", ... } ] } 格式
    if let Some(arr) = config.get("servers").and_then(|v| v.as_array()) {
        let servers: Vec<McpServerConfig> = arr
            .iter()
            .filter_map(|v| {
                let id = v
                    .get("id")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                let name = v
                    .get("name")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                let command = v
                    .get("command")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                let args: Vec<String> = match v.get("args") {
                    Some(serde_json::Value::Array(arr)) => arr
                        .iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect(),
                    Some(serde_json::Value::String(s)) => {
                        s.split_whitespace().map(|s| s.to_string()).collect()
                    }
                    _ => vec![],
                };
                let enabled = v.get("enabled").and_then(|x| x.as_bool()).unwrap_or(false);

                if id.is_empty() || (command.is_empty() && !v.get("url").is_some()) || !enabled {
                    None
                } else {
                    let env: std::collections::HashMap<String, String> = match v.get("env") {
                        Some(serde_json::Value::Object(obj)) => obj
                            .iter()
                            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                            .collect(),
                        _ => std::collections::HashMap::new(),
                    };
                    let url = v.get("url").and_then(|x| x.as_str()).map(|s| s.to_string());
                    let transport = v
                        .get("transport")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string());
                    Some(McpServerConfig {
                        id,
                        name,
                        command,
                        args,
                        enabled,
                        env,
                        url,
                        transport,
                    })
                }
            })
            .collect();

        return Ok(servers);
    }

    Ok(vec![])
}

pub fn start_mcp_server_blocking(state: &McpServerState) -> Result<(), String> {
    log::info!("[MCP] Starting all enabled MCP servers...");

    let configs = read_enabled_mcp_servers()?;

    if configs.is_empty() {
        log::info!("[MCP] No enabled MCP servers configured");
        return Ok(());
    }

    let mut servers = state.servers.lock().map_err(|_| "锁定失败")?;

    for config in &configs {
        // 跳过已经运行的
        if servers.contains_key(&config.id) {
            let existing = servers.get(&config.id).unwrap();
            if existing.is_initialized.load(Ordering::SeqCst) {
                log::debug!("[MCP] Server '{}' already running, skipping", config.name);
                continue;
            }
        }

        let spawn_result = match config.transport.as_deref() {
            Some("sse") => spawn_sse_mcp_server(
                &config.id,
                &config.name,
                config.url.as_deref().unwrap_or(""),
            ),
            Some("http") => spawn_http_mcp_server(
                &config.id,
                &config.name,
                config.url.as_deref().unwrap_or(""),
            ),
            _ if config.url.is_some() => {
                spawn_http_mcp_server(&config.id, &config.name, config.url.as_deref().unwrap())
            }
            _ => spawn_single_mcp_server(
                &config.id,
                &config.name,
                &config.command,
                &config.args,
                &config.env,
            ),
        };
        match spawn_result {
            Ok(server) => {
                servers.insert(config.id.clone(), server);
            }
            Err(e) => {
                log::warn!("[MCP] Failed to start server '{}': {}", config.name, e);
                // 继续启动其他服务器，不因一个失败而中断
            }
        }
    }

    log::info!("[MCP] Started {} servers", servers.len());
    Ok(())
}

#[tauri::command]
pub async fn start_mcp_server(state: State<'_, McpServerState>) -> Result<(), String> {
    let servers = state.servers.clone();
    tokio::task::spawn_blocking(move || {
        let local_state = McpServerState { servers };
        start_mcp_server_blocking(&local_state)
    })
    .await
    .map_err(|e| format!("MCP startup task failed: {}", e))?
}

#[tauri::command]
pub async fn start_mcp_servers_async(
    state: State<'_, McpServerState>,
    app: tauri::AppHandle,
) -> Result<usize, String> {
    let configs = read_enabled_mcp_servers()?;

    if configs.is_empty() {
        log::info!("[MCP] Async: No enabled MCP servers configured");
        return Ok(0);
    }

    // 过滤掉已运行的服务器
    let servers_lock = state.servers.lock().map_err(|_| "锁定失败")?;
    let to_start: Vec<McpServerConfig> = configs
        .into_iter()
        .filter(|c| {
            if let Some(existing) = servers_lock.get(&c.id) {
                if existing.is_initialized.load(Ordering::SeqCst) {
                    log::debug!("[MCP] Async: Server '{}' already running, skipping", c.name);
                    return false;
                }
            }
            true
        })
        .collect();
    drop(servers_lock);

    let count = to_start.len();
    log::info!("[MCP] Async: Starting {} servers in parallel...", count);

    let servers_arc = state.servers.clone();

    for config in to_start {
        let servers = servers_arc.clone();
        let app_handle = app.clone();
        let server_id = config.id.clone();
        let server_name = config.name.clone();

        tokio::task::spawn_blocking(move || {
            log::debug!(
                "[MCP] Async: Spawning server '{}' (id: {})",
                server_name, server_id
            );

            let spawn_result = match config.transport.as_deref() {
                Some("sse") => spawn_sse_mcp_server(
                    &config.id,
                    &config.name,
                    config.url.as_deref().unwrap_or(""),
                ),
                Some("http") => spawn_http_mcp_server(
                    &config.id,
                    &config.name,
                    config.url.as_deref().unwrap_or(""),
                ),
                _ if config.url.is_some() => {
                    spawn_http_mcp_server(&config.id, &config.name, config.url.as_deref().unwrap())
                }
                _ => spawn_single_mcp_server(
                    &config.id,
                    &config.name,
                    &config.command,
                    &config.args,
                    &config.env,
                ),
            };

            match spawn_result {
                Ok(server) => {
                    if let Ok(mut map) = servers.lock() {
                        map.insert(server_id.clone(), server);
                    }
                    log::info!("[MCP] Async: Server '{}' started successfully", server_name);
                    let _ = app_handle.emit(
                        "mcp-server-started",
                        McpServerStartedPayload {
                            server_id,
                            server_name,
                            success: true,
                            error: None,
                        },
                    );
                }
                Err(e) => {
                    log::warn!(
                        "[MCP] Async: Failed to start server '{}': {}",
                        server_name, e
                    );
                    let _ = app_handle.emit(
                        "mcp-server-started",
                        McpServerStartedPayload {
                            server_id,
                            server_name,
                            success: false,
                            error: Some(e),
                        },
                    );
                }
            }
        });
    }

    Ok(count)
}

#[tauri::command]
pub fn stop_mcp_server(state: State<McpServerState>) -> Result<(), String> {
    log::info!("[MCP] Stopping all MCP servers...");

    let mut servers = state.servers.lock().map_err(|_| "锁定失败")?;

    for (_, server) in servers.iter_mut() {
        shutdown_single_server(server);
    }

    servers.clear();

    log::info!("[MCP] All servers stopped");
    Ok(())
}

pub fn start_single_mcp_blocking(server_id: String, state: &McpServerState) -> Result<(), String> {
    log::info!("[MCP] Starting single server: {}", server_id);

    let configs = read_enabled_mcp_servers()?;
    let config = configs
        .iter()
        .find(|c| c.id == server_id)
        .ok_or_else(|| format!("未找到服务器配置: {}", server_id))?;

    let mut servers = state.servers.lock().map_err(|_| "锁定失败")?;

    // 如果已运行，先停止
    if let Some(existing) = servers.get_mut(&server_id) {
        shutdown_single_server(existing);
        servers.remove(&server_id);
    }

    let server = match config.transport.as_deref() {
        Some("sse") => spawn_sse_mcp_server(
            &config.id,
            &config.name,
            config.url.as_deref().unwrap_or(""),
        )?,
        Some("http") => spawn_http_mcp_server(
            &config.id,
            &config.name,
            config.url.as_deref().unwrap_or(""),
        )?,
        _ if config.url.is_some() => {
            spawn_http_mcp_server(&config.id, &config.name, config.url.as_deref().unwrap())?
        }
        _ => spawn_single_mcp_server(
            &config.id,
            &config.name,
            &config.command,
            &config.args,
            &config.env,
        )?,
    };
    servers.insert(server_id, server);

    Ok(())
}

#[tauri::command]
pub async fn start_single_mcp(
    server_id: String,
    state: State<'_, McpServerState>,
) -> Result<(), String> {
    let servers = state.servers.clone();
    tokio::task::spawn_blocking(move || {
        let local_state = McpServerState { servers };
        start_single_mcp_blocking(server_id, &local_state)
    })
    .await
    .map_err(|e| format!("MCP single startup task failed: {}", e))?
}

#[tauri::command]
pub fn stop_single_mcp(server_id: String, state: State<McpServerState>) -> Result<(), String> {
    log::info!("[MCP] Stopping single server: {}", server_id);

    let mut servers = state.servers.lock().map_err(|_| "锁定失败")?;

    if let Some(server) = servers.get_mut(&server_id) {
        shutdown_single_server(server);
        servers.remove(&server_id);
        Ok(())
    } else {
        Err(format!("服务器 '{}' 未运行", server_id))
    }
}

#[tauri::command]
pub fn get_mcp_status(state: State<McpServerState>) -> Vec<McpServerStatusEntry> {
    let servers = state.servers.lock().unwrap_or_else(|e| e.into_inner());

    servers
        .iter()
        .map(|(id, server)| McpServerStatusEntry {
            server_id: id.clone(),
            server_name: server.server_name.clone(),
            is_running: matches!(
                &server.transport,
                McpTransport::Stdio {
                    process: Some(_),
                    ..
                } | McpTransport::Http { .. }
                    | McpTransport::Sse { .. }
            ),
            is_initialized: server.is_initialized.load(Ordering::SeqCst),
        })
        .collect()
}

#[tauri::command]
pub fn list_mcp_tools(state: State<McpServerState>) -> Result<Vec<McpToolInfoWithServer>, String> {
    let mut all_tools: Vec<McpToolInfoWithServer> = Vec::new();
    let mut servers = state.servers.lock().map_err(|_| "锁定失败")?;

    for (server_id, server) in servers.iter_mut() {
        if !server.is_initialized.load(Ordering::SeqCst) {
            continue;
        }

        let io_lock = server.io_lock.clone();
        let _io_guard = io_lock.lock().map_err(|_| "锁定失败")?;

        // 分页循环：持续请求直到没有 nextCursor
        let mut cursor: Option<String> = None;
        let max_pages = 100; // 安全上限

        for _page in 0..max_pages {
            let request_id = server.request_id.fetch_add(1, Ordering::SeqCst);

            let mut params = serde_json::json!({});
            if let Some(ref c) = cursor {
                params["cursor"] = serde_json::json!(c);
            }

            let request = serde_json::json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "tools/list",
                "params": params
            });

            let response = match server.send_and_receive(&request, request_id) {
                Ok(v) => v,
                Err(e) => {
                    log::warn!("[MCP][{}] list_mcp_tools 失败: {}", server.server_name, e);
                    break;
                }
            };

            if let Some(tools) = response["result"]["tools"].as_array() {
                for t in tools {
                    if let Some(name) = t["name"].as_str() {
                        all_tools.push(McpToolInfoWithServer {
                            name: name.to_string(),
                            description: t["description"].as_str().map(|s| s.to_string()),
                            server_id: server_id.clone(),
                        });
                    }
                }
            }

            // 检查 nextCursor
            match response["result"]["nextCursor"].as_str() {
                Some(next) => cursor = Some(next.to_string()),
                None => break,
            }
        }
    }

    Ok(all_tools)
}

/// 递归解析 JSON Schema 属性为 McpPropertySchema
pub fn parse_property_schema(prop: &serde_json::Value) -> McpPropertySchema {
    // 当属性使用 oneOf/anyOf/allOf 而没有顶层 type 时，不应强制默认为 "string"
    let prop_type = prop["type"].as_str().unwrap_or("").to_string();
    let description = prop["description"].as_str().map(|s| s.to_string());
    let enum_vals = prop["enum"]
        .as_array()
        .map(|arr| arr.iter().cloned().collect());
    let default_val = prop.get("default").cloned();

    // 递归解析 items（array 类型的元素 schema）
    let items = prop
        .get("items")
        .map(|v| Box::new(parse_property_schema(v)));

    // 递归解析 properties（object 类型的子属性）
    let properties = prop
        .get("properties")
        .and_then(|v| v.as_object())
        .map(|obj| {
            obj.iter()
                .map(|(k, v)| (k.clone(), parse_property_schema(v)))
                .collect()
        });

    // 子对象的 required 字段
    let required = prop.get("required").and_then(|v| v.as_array()).map(|arr| {
        arr.iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect()
    });

    // --- 高级 JSON Schema 字段 ---
    let one_of = prop
        .get("oneOf")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().map(|v| parse_property_schema(v)).collect());
    let any_of = prop
        .get("anyOf")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().map(|v| parse_property_schema(v)).collect());
    let all_of = prop
        .get("allOf")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().map(|v| parse_property_schema(v)).collect());
    let ref_path = prop
        .get("$ref")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let pattern = prop
        .get("pattern")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let format = prop
        .get("format")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let minimum = prop.get("minimum").and_then(|v| v.as_f64());
    let maximum = prop.get("maximum").and_then(|v| v.as_f64());
    let additional_properties = prop
        .get("additionalProperties")
        .map(|v| Box::new(v.clone()));

    McpPropertySchema {
        prop_type,
        description,
        enum_values: enum_vals,
        default: default_val,
        items,
        properties,
        required,
        one_of,
        any_of,
        all_of,
        ref_path,
        pattern,
        format,
        minimum,
        maximum,
        additional_properties,
    }
}

#[tauri::command]
pub fn get_mcp_tool_schemas(state: State<McpServerState>) -> Result<McpToolSchemaResult, String> {
    let mut all_schemas: Vec<McpToolSchema> = Vec::new();
    let mut servers = state.servers.lock().map_err(|_| "锁定失败")?;

    for (server_id, server) in servers.iter_mut() {
        if !server.is_initialized.load(Ordering::SeqCst) {
            continue;
        }

        let io_lock = server.io_lock.clone();
        let _io_guard = io_lock.lock().map_err(|_| "锁定失败")?;

        // 分页循环
        let mut cursor: Option<String> = None;
        let max_pages = 100;

        for _page in 0..max_pages {
            let request_id = server.request_id.fetch_add(1, Ordering::SeqCst);

            let mut params = serde_json::json!({});
            if let Some(ref c) = cursor {
                params["cursor"] = serde_json::json!(c);
            }

            let request = serde_json::json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "tools/list",
                "params": params
            });

            let response = match server.send_and_receive(&request, request_id) {
                Ok(v) => v,
                Err(e) => {
                    log::warn!(
                        "[MCP][{}] get_mcp_tool_schemas 失败: {}",
                        server.server_name, e
                    );
                    break;
                }
            };

            if let Some(tools) = response["result"]["tools"].as_array() {
                for t in tools {
                    let name = match t["name"].as_str() {
                        Some(n) => n.to_string(),
                        None => continue,
                    };
                    let description = t["description"].as_str().map(|s| s.to_string());

                    let mut properties = std::collections::HashMap::new();
                    let mut required = Vec::new();

                    if let Some(input_schema_value) = t.get("inputSchema") {
                        if let Some(props) = input_schema_value["properties"].as_object() {
                            for (key, prop) in props {
                                properties.insert(key.clone(), parse_property_schema(prop));
                            }
                        }

                        if let Some(req) = input_schema_value["required"].as_array() {
                            required = req
                                .iter()
                                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                .collect();
                        }
                    }

                    all_schemas.push(McpToolSchema {
                        name,
                        description,
                        input_schema: McpInputSchema {
                            schema_type: "object".to_string(),
                            properties,
                            required: if required.is_empty() {
                                None
                            } else {
                                Some(required)
                            },
                        },
                        server_id: Some(server_id.clone()),
                    });
                }
            }

            // 检查 nextCursor
            match response["result"]["nextCursor"].as_str() {
                Some(next) => cursor = Some(next.to_string()),
                None => break,
            }
        }
    }

    Ok(McpToolSchemaResult {
        success: true,
        schemas: all_schemas,
        error: None,
    })
}

#[tauri::command]
pub async fn call_mcp_tool(
    server_id: String,
    tool_name: String,
    arguments: serde_json::Value,
    state: State<'_, McpServerState>,
) -> Result<McpToolResult, String> {
    let servers_arc = state.servers.clone();

    tokio::task::spawn_blocking(move || {
        let mut servers = servers_arc.lock().map_err(|_| "锁定失败".to_string())?;

        let server = servers
            .get_mut(&server_id)
            .ok_or_else(|| format!("MCP 服务器 '{}' 未运行", server_id))?;

        if !server.is_initialized.load(Ordering::SeqCst) {
            return Err(format!("MCP 服务器 '{}' 未初始化", server_id));
        }

        let io_lock = server.io_lock.clone();
        let _io_guard = io_lock.lock().map_err(|_| "锁定失败".to_string())?;

        log::debug!(
            "[MCP][{}] Calling tool: {} with args: {:?}",
            server.server_name, tool_name, arguments
        );

        let request_id = server.request_id.fetch_add(1, Ordering::SeqCst);

        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/call",
            "params": {
                "name": tool_name.clone(),
                "arguments": arguments
            }
        });

        // 通过传输层发送并接收
        let response = server.send_and_receive(&request, request_id)?;
        log::debug!(
            "[MCP][{}] Tool response: {:?}",
            server.server_name, response
        );

        // 检查 JSON-RPC 层错误
        if let Some(error) = response.get("error") {
            return Ok(McpToolResult {
                success: false,
                content: None,
                content_items: None,
                is_error: true,
                error: Some(error["message"].as_str().unwrap_or("未知错误").to_string()),
            });
        }

        // 解析 MCP result
        let raw_result = response.get("result").cloned();
        match raw_result {
            Some(result_val) => {
                let (sanitized, items, is_mcp_error) = sanitize_mcp_tool_result(result_val);
                log::debug!(
                    "[MCP][{}] Tool response (sanitized): {:?}",
                    server.server_name, sanitized
                );
                Ok(McpToolResult {
                    success: !is_mcp_error,
                    content: Some(sanitized),
                    content_items: items,
                    is_error: is_mcp_error,
                    error: None,
                })
            }
            None => Ok(McpToolResult {
                success: true,
                content: None,
                content_items: None,
                is_error: false,
                error: None,
            }),
        }
    })
    .await
    .map_err(|e| format!("任务执行失败: {}", e))?
}

// ============================================================
// MCP Resources 支持
// ============================================================

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpResource {
    uri: String,
    name: String,
    description: Option<String>,
    #[serde(rename = "mimeType")]
    mime_type: Option<String>,
    server_id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpResourceContent {
    uri: String,
    #[serde(rename = "mimeType")]
    mime_type: Option<String>,
    text: Option<String>,
    blob: Option<String>,
}

#[tauri::command]
pub fn list_mcp_resources(state: State<McpServerState>) -> Result<Vec<McpResource>, String> {
    let mut servers = state.servers.lock().map_err(|_| "锁定失败")?;
    let mut all_resources: Vec<McpResource> = Vec::new();

    let server_ids: Vec<String> = servers.keys().cloned().collect();

    for server_id in &server_ids {
        let server = match servers.get_mut(server_id) {
            Some(s) if s.is_initialized.load(Ordering::SeqCst) => s,
            _ => continue,
        };

        let io_lock = server.io_lock.clone();
        let _io_guard = io_lock.lock().map_err(|_| "锁定失败")?;

        // 分页循环：持续请求直到没有 nextCursor
        let mut cursor: Option<String> = None;
        let max_pages = 100;

        for _page in 0..max_pages {
            let request_id = server.request_id.fetch_add(1, Ordering::SeqCst);

            let mut params = serde_json::json!({});
            if let Some(ref c) = cursor {
                params["cursor"] = serde_json::json!(c);
            }

            let request = serde_json::json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "resources/list",
                "params": params
            });

            let response = match server.send_and_receive(&request, request_id) {
                Ok(v) => v,
                Err(e) => {
                    log::warn!("[MCP][{}] resources/list 失败: {}", server_id, e);
                    break;
                }
            };

            if let Some(resources) = response["result"]["resources"].as_array() {
                for r in resources {
                    all_resources.push(McpResource {
                        uri: r["uri"].as_str().unwrap_or("").to_string(),
                        name: r["name"].as_str().unwrap_or("").to_string(),
                        description: r["description"].as_str().map(|s| s.to_string()),
                        mime_type: r["mimeType"].as_str().map(|s| s.to_string()),
                        server_id: server_id.clone(),
                    });
                }
            }

            // 检查 nextCursor
            match response["result"]["nextCursor"].as_str() {
                Some(next) => cursor = Some(next.to_string()),
                None => break,
            }
        }
    }

    Ok(all_resources)
}

#[tauri::command]
pub async fn read_mcp_resource(
    server_id: String,
    uri: String,
    state: State<'_, McpServerState>,
) -> Result<Vec<McpResourceContent>, String> {
    let servers_arc = state.servers.clone();

    tokio::task::spawn_blocking(move || {
        let mut servers = servers_arc.lock().map_err(|_| "锁定失败".to_string())?;

        let server = servers
            .get_mut(&server_id)
            .ok_or_else(|| format!("MCP 服务器 '{}' 未运行", server_id))?;

        if !server.is_initialized.load(Ordering::SeqCst) {
            return Err(format!("MCP 服务器 '{}' 未初始化", server_id));
        }

        let io_lock = server.io_lock.clone();
        let _io_guard = io_lock.lock().map_err(|_| "锁定失败".to_string())?;

        let request_id = server.request_id.fetch_add(1, Ordering::SeqCst);
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "resources/read",
            "params": {
                "uri": uri
            }
        });

        let response = server.send_and_receive(&request, request_id)?;

        if let Some(error) = response.get("error") {
            return Err(format!(
                "resources/read 失败: {}",
                error["message"].as_str().unwrap_or("未知错误")
            ));
        }

        let mut contents: Vec<McpResourceContent> = Vec::new();
        if let Some(arr) = response["result"]["contents"].as_array() {
            for item in arr {
                contents.push(McpResourceContent {
                    uri: item["uri"].as_str().unwrap_or("").to_string(),
                    mime_type: item["mimeType"].as_str().map(|s| s.to_string()),
                    text: item["text"].as_str().map(|s| s.to_string()),
                    blob: item["blob"].as_str().map(|s| s.to_string()),
                });
            }
        }

        Ok(contents)
    })
    .await
    .map_err(|e| format!("任务执行失败: {}", e))?
}

// ============================================================
// MCP Prompts 支持
// ============================================================

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpPromptArgument {
    name: String,
    description: Option<String>,
    required: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpPromptInfo {
    name: String,
    description: Option<String>,
    arguments: Option<Vec<McpPromptArgument>>,
    server_id: String,
}

#[tauri::command]
pub fn list_mcp_prompts(state: State<McpServerState>) -> Result<Vec<McpPromptInfo>, String> {
    let mut servers = state.servers.lock().map_err(|_| "锁定失败")?;
    let mut all_prompts: Vec<McpPromptInfo> = Vec::new();

    let server_ids: Vec<String> = servers.keys().cloned().collect();

    for server_id in &server_ids {
        let server = match servers.get_mut(server_id) {
            Some(s) if s.is_initialized.load(Ordering::SeqCst) => s,
            _ => continue,
        };

        let io_lock = server.io_lock.clone();
        let _io_guard = io_lock.lock().map_err(|_| "锁定失败")?;

        // 分页循环：持续请求直到没有 nextCursor
        let mut cursor: Option<String> = None;
        let max_pages = 100;

        for _page in 0..max_pages {
            let request_id = server.request_id.fetch_add(1, Ordering::SeqCst);

            let mut params = serde_json::json!({});
            if let Some(ref c) = cursor {
                params["cursor"] = serde_json::json!(c);
            }

            let request = serde_json::json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "prompts/list",
                "params": params
            });

            let response = match server.send_and_receive(&request, request_id) {
                Ok(v) => v,
                Err(e) => {
                    log::warn!("[MCP][{}] prompts/list 失败: {}", server_id, e);
                    break;
                }
            };

            if let Some(prompts) = response["result"]["prompts"].as_array() {
                for p in prompts {
                    let arguments = p["arguments"].as_array().map(|arr| {
                        arr.iter()
                            .map(|a| McpPromptArgument {
                                name: a["name"].as_str().unwrap_or("").to_string(),
                                description: a["description"].as_str().map(|s| s.to_string()),
                                required: a["required"].as_bool(),
                            })
                            .collect()
                    });

                    all_prompts.push(McpPromptInfo {
                        name: p["name"].as_str().unwrap_or("").to_string(),
                        description: p["description"].as_str().map(|s| s.to_string()),
                        arguments,
                        server_id: server_id.clone(),
                    });
                }
            }

            // 检查 nextCursor
            match response["result"]["nextCursor"].as_str() {
                Some(next) => cursor = Some(next.to_string()),
                None => break,
            }
        }
    }

    Ok(all_prompts)
}

#[tauri::command]
pub async fn get_mcp_prompt(
    server_id: String,
    name: String,
    arguments: serde_json::Value,
    state: State<'_, McpServerState>,
) -> Result<serde_json::Value, String> {
    let servers_arc = state.servers.clone();

    tokio::task::spawn_blocking(move || {
        let mut servers = servers_arc.lock().map_err(|_| "锁定失败".to_string())?;

        let server = servers
            .get_mut(&server_id)
            .ok_or_else(|| format!("MCP 服务器 '{}' 未运行", server_id))?;

        if !server.is_initialized.load(Ordering::SeqCst) {
            return Err(format!("MCP 服务器 '{}' 未初始化", server_id));
        }

        let io_lock = server.io_lock.clone();
        let _io_guard = io_lock.lock().map_err(|_| "锁定失败".to_string())?;

        let request_id = server.request_id.fetch_add(1, Ordering::SeqCst);
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "prompts/get",
            "params": {
                "name": name,
                "arguments": arguments
            }
        });

        let response = server.send_and_receive(&request, request_id)?;

        if let Some(error) = response.get("error") {
            return Err(format!(
                "prompts/get 失败: {}",
                error["message"].as_str().unwrap_or("未知错误")
            ));
        }

        Ok(response["result"].clone())
    })
    .await
    .map_err(|e| format!("任务执行失败: {}", e))?
}

#[tauri::command]
pub fn save_mcp_config(config: String) -> Result<String, String> {
    use std::fs;

    let config_dir = crate::config_paths::dot_config_dir()?;
    fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;

    let config_file = config_dir.join("mcp_config.json");
    fs::write(&config_file, &config).map_err(|e| format!("Failed to save config: {}", e))?;

    log::debug!("[MCP] Config saved to {:?}", config_file);
    Ok("Configuration saved successfully".to_string())
}

#[tauri::command]
pub fn load_mcp_config() -> Result<String, String> {
    use std::fs;

    let config_file = crate::config_paths::resolve_dot_config_file("mcp_config.json")?;

    if !config_file.exists() {
        // Return default configuration
        return Ok(r#"{"browserType":"builtin"}"#.to_string());
    }

    let content =
        fs::read_to_string(&config_file).map_err(|e| format!("Failed to read config: {}", e))?;

    log::debug!("[MCP] Config loaded from {:?}", config_file);
    Ok(content)
}

#[tauri::command]
pub fn get_mcp_config_path() -> Result<String, String> {
    let config_file = crate::config_paths::resolve_dot_config_file("mcp_config.json")?;
    Ok(config_file.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_mcp_config_file() -> Result<(), String> {
    use std::fs;

    let config_file = crate::config_paths::resolve_dot_config_file("mcp_config.json")?;
    if let Some(parent) = config_file.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }

    // 如果文件不存在，创建默认配置
    if !config_file.exists() {
        fs::write(&config_file, r#"{"browserType":"builtin","servers":[]}"#)
            .map_err(|e| format!("创建配置文件失败: {}", e))?;
    }

    Ok(())
}

// Claude 配置路径
#[tauri::command]
pub fn get_claude_config_path() -> Result<String, String> {
    use std::env;

    let home = env::var("USERPROFILE")
        .or_else(|_| env::var("HOME"))
        .map_err(|_| "无法获取用户目录")?;

    let config_file = PathBuf::from(&home).join(".claude").join("settings.json");

    Ok(config_file.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_claude_config_file() -> Result<(), String> {
    use std::env;
    use std::fs;
    use std::path::PathBuf;

    let home = env::var("USERPROFILE")
        .or_else(|_| env::var("HOME"))
        .map_err(|_| "无法获取用户目录")?;

    let config_dir = PathBuf::from(&home).join(".claude");
    fs::create_dir_all(&config_dir).map_err(|e| format!("创建配置目录失败: {}", e))?;

    let config_file = config_dir.join("settings.json");

    // 如果文件不存在，创建默认配置
    if !config_file.exists() {
        fs::write(&config_file, r#"{}"#).map_err(|e| format!("创建配置文件失败: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn save_claude_config(content: String) -> Result<String, String> {
    use std::env;
    use std::fs;
    use std::path::PathBuf;

    let home = env::var("USERPROFILE")
        .or_else(|_| env::var("HOME"))
        .map_err(|_| "无法获取用户目录")?;

    let config_dir = PathBuf::from(&home).join(".claude");
    fs::create_dir_all(&config_dir).map_err(|e| format!("创建配置目录失败: {}", e))?;

    let config_file = config_dir.join("settings.json");

    let json_value: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("JSON解析失败: {}", e))?;
    let formatted_json =
        serde_json::to_string_pretty(&json_value).map_err(|e| format!("JSON格式化失败: {}", e))?;

    fs::write(&config_file, formatted_json).map_err(|e| format!("保存配置失败: {}", e))?;

    Ok(config_file.to_string_lossy().to_string())
}
