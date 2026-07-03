//! Terminal module - PTY and terminal buffer management
//!
//! This module contains all terminal-related structures, state management,
//! and helper functions for terminal operations.

use portable_pty::native_pty_system;
use portable_pty::{CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::sandbox::{self, SandboxState};

// ============================================================================
// Terminal Buffer - Ring buffer for terminal output
// ============================================================================

/// Ring buffer for storing terminal output data
pub struct TerminalBuffer {
    pub ring: VecDeque<u8>,
    pub start_seq: u64,
    pub end_seq: u64,
    pub max_bytes: usize,
}

/// A chunk of data read from the terminal buffer
pub struct TerminalBufferChunk {
    pub data: Vec<u8>,
    pub next_seq: u64,
    pub truncated: bool,
}

impl TerminalBuffer {
    /// Create a new terminal buffer with the specified maximum size
    pub fn new(max_bytes: usize) -> Self {
        let mut ring = VecDeque::with_capacity(max_bytes);
        ring.reserve_exact(max_bytes);
        Self {
            ring,
            start_seq: 0,
            end_seq: 0,
            max_bytes,
        }
    }

    /// Push bytes into the buffer using batch operations for better performance.
    pub fn push_bytes(&mut self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }

        self.ring.extend(bytes.iter().copied());

        if self.ring.len() > self.max_bytes {
            let overflow = self.ring.len() - self.max_bytes;
            self.ring.drain(..overflow);
            self.start_seq += overflow as u64;
        }

        self.end_seq += bytes.len() as u64;
    }

    /// Read data from the buffer since a given sequence number.
    pub fn read_since(&self, since_seq: u64, max_bytes: usize) -> TerminalBufferChunk {
        let max_bytes = max_bytes.max(1).min(self.max_bytes);
        let mut truncated = false;
        let mut read_from = since_seq;

        if read_from < self.start_seq {
            truncated = true;
            read_from = self.start_seq;
        }

        if read_from > self.end_seq {
            read_from = self.end_seq;
        }

        let offset = (read_from - self.start_seq) as usize;
        let available = self.ring.len().saturating_sub(offset);
        let take = available.min(max_bytes);

        let mut data = Vec::with_capacity(take);
        data.extend(self.ring.iter().skip(offset).take(take).copied());

        let next_seq = read_from + data.len() as u64;

        TerminalBufferChunk {
            data,
            next_seq,
            truncated,
        }
    }
}

// ============================================================================
// Terminal Session - Single PTY session
// ============================================================================

/// A single terminal session with PTY and buffer
pub struct TerminalSession {
    pub writer: Box<dyn Write + Send>,
    pub master: Box<dyn MasterPty + Send>,
    pub buffer: Arc<Mutex<TerminalBuffer>>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub title: String,
    /// Shell type: "powershell" on Windows, "zsh" or "bash" on Unix
    pub shell_type: String,
    pub last_rows: u16,
    pub last_cols: u16,
}

// ============================================================================
// Terminal State - Global terminal management
// ============================================================================

/// Global state for managing all terminal sessions
pub struct TerminalState {
    pub sessions: Arc<Mutex<std::collections::HashMap<String, TerminalSession>>>,
    pub active_terminal_id: Arc<Mutex<Option<String>>>,
    pub next_index: AtomicU64,
    pub max_bytes: usize,
}

impl TerminalState {
    /// Create a new terminal state with the specified buffer size
    pub fn new(max_bytes: usize) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(std::collections::HashMap::new())),
            active_terminal_id: Arc::new(Mutex::new(None)),
            next_index: AtomicU64::new(0),
            max_bytes,
        }
    }
}

// ============================================================================
// Terminal Events and Descriptors - For frontend communication
// ============================================================================

/// Descriptor for a terminal instance
#[derive(Serialize, Clone)]
pub struct TerminalDescriptor {
    pub terminal_id: String,
    pub title: String,
    pub pid: Option<u32>,
    /// Shell type: "powershell", "zsh", "bash", etc.
    pub shell_type: String,
}

/// Event payload for terminal data output
#[derive(Serialize, Clone)]
pub struct TerminalDataEvent {
    pub terminal_id: String,
    pub data: String,
}

/// Event payload for terminal closed
#[derive(Serialize, Clone)]
pub struct TerminalClosedEvent {
    pub terminal_id: String,
}

/// Output chunk from terminal buffer
#[derive(Serialize)]
pub struct TerminalOutputChunk {
    pub data: String,
    pub next_seq: u64,
    pub truncated: bool,
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Resolve terminal ID from provided or active terminal
pub fn resolve_terminal_id(
    provided: Option<String>,
    active: Option<String>,
) -> Result<String, String> {
    if let Some(id) = provided {
        return Ok(id);
    }

    if let Some(id) = active {
        return Ok(id);
    }

    Err("未找到可用终端".to_string())
}

/// Select the active terminal after closing one
pub fn select_active_after_close(
    active: Option<String>,
    closed_id: &str,
    remaining_ids: &[String],
) -> Option<String> {
    if active.as_deref() != Some(closed_id) {
        return active;
    }

    remaining_ids.first().cloned()
}

fn should_skip_ai_shell_rewrite(command: &str) -> bool {
    let trimmed = command.trim_start();
    let lower = trimmed.to_ascii_lowercase();

    lower.starts_with("cmd /c ")
        || lower.starts_with("cmd.exe /c ")
        || lower.starts_with("powershell ")
        || lower.starts_with("powershell.exe ")
        || lower.starts_with("pwsh ")
        || lower.starts_with("pwsh.exe ")
        || lower.starts_with("bash ")
        || lower.starts_with("bash.exe ")
        || lower.starts_with("sh ")
        || lower.starts_with("zsh ")
}

fn split_top_level_command_chain(command: &str) -> Option<(Vec<String>, Vec<&'static str>)> {
    let mut parts: Vec<String> = Vec::new();
    let mut operators: Vec<&'static str> = Vec::new();
    let mut last_idx = 0usize;
    let mut in_single = false;
    let mut in_double = false;
    let mut escape_next = false;
    let mut found_operator = false;
    let bytes = command.as_bytes();
    let mut idx = 0usize;

    while idx < bytes.len() {
        let ch = bytes[idx] as char;

        if escape_next {
            escape_next = false;
            idx += 1;
            continue;
        }

        if ch == '`' && !in_single {
            escape_next = true;
            idx += 1;
            continue;
        }

        if ch == '\'' && !in_double {
            in_single = !in_single;
            idx += 1;
            continue;
        }

        if ch == '"' && !in_single {
            in_double = !in_double;
            idx += 1;
            continue;
        }

        if !in_single && !in_double && idx + 1 < bytes.len() {
            let next = bytes[idx + 1] as char;
            let op = match (ch, next) {
                ('&', '&') => Some("&&"),
                ('|', '|') => Some("||"),
                _ => None,
            };

            if let Some(operator) = op {
                parts.push(command[last_idx..idx].to_string());
                operators.push(operator);
                found_operator = true;
                idx += 2;
                last_idx = idx;
                continue;
            }
        }

        idx += 1;
    }

    if !found_operator {
        return None;
    }

    parts.push(command[last_idx..].to_string());

    if parts.iter().any(|part| part.trim().is_empty()) {
        return None;
    }

    Some((parts, operators))
}

pub fn rewrite_powershell_command_chain(command: &str) -> String {
    if should_skip_ai_shell_rewrite(command) {
        return command.to_string();
    }

    let trimmed_command = command.trim_end_matches(['\r', '\n']);
    let trailing = &command[trimmed_command.len()..];

    let Some((parts, operators)) = split_top_level_command_chain(trimmed_command) else {
        return command.to_string();
    };

    let mut rewritten = String::new();
    let status_var = "$__loom_last_status";

    rewritten.push_str(parts[0].trim());
    rewritten.push_str(&format!("; {} = $?", status_var));

    for (operator, part) in operators.iter().zip(parts.iter().skip(1)) {
        match *operator {
            "&&" => {
                rewritten.push_str(&format!(
                    "; if ({}) {{ {}; {} = $? }}",
                    status_var,
                    part.trim(),
                    status_var
                ));
            }
            "||" => {
                rewritten.push_str(&format!(
                    "; if (-not {}) {{ {}; {} = $? }}",
                    status_var,
                    part.trim(),
                    status_var
                ));
            }
            _ => {}
        }
    }

    rewritten.push_str(trailing);
    rewritten
}

fn adapt_ai_terminal_input(data: &str) -> String {
    if !cfg!(target_os = "windows") {
        return data.to_string();
    }

    rewrite_powershell_command_chain(data)
}

fn enrich_terminal_path() -> String {
    let current_path = std::env::var("PATH").unwrap_or_default();
    let mut extra_dirs: Vec<String> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            extra_dirs.push(format!("{}\\npm", appdata));
        }
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            extra_dirs.push(format!("{}\\.cargo\\bin", userprofile));
        }
        if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
            extra_dirs.push(format!("{}\\pnpm", localappdata));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(home) = std::env::var("HOME") {
            extra_dirs.push(format!("{}/.npm-global/bin", home));
            extra_dirs.push(format!("{}/.nvm/versions/node/default/bin", home));
            extra_dirs.push(format!("{}/.cargo/bin", home));
            extra_dirs.push(format!("{}/.local/bin", home));
            extra_dirs.push(format!("{}/.local/share/pnpm", home));
        }
        extra_dirs.push("/usr/local/bin".to_string());
    }

    let separator = if cfg!(target_os = "windows") { ';' } else { ':' };
    let existing: Vec<&str> = current_path.split(separator).collect();
    let mut parts: Vec<&str> = existing.clone();

    for dir in &extra_dirs {
        if !existing.iter().any(|p| p.eq_ignore_ascii_case(dir)) && std::path::Path::new(dir).is_dir()
        {
            parts.push(dir.as_str());
        }
    }

    parts.join(if cfg!(target_os = "windows") { ";" } else { ":" })
}

fn printable_ratio(text: &str) -> f64 {
    let total = text.chars().count().max(1) as f64;
    let printable = text
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\r' || *c == '\t')
        .count() as f64;
    printable / total
}

fn decode_terminal_bytes(bytes: &[u8]) -> String {
    if let Ok(text) = String::from_utf8(bytes.to_vec()) {
        return text;
    }

    #[cfg(target_os = "windows")]
    {
        if bytes.len() >= 2 {
            // Respect UTF-16 BOM first if present.
            if bytes[0] == 0xFF && bytes[1] == 0xFE {
                let (decoded, _, _) = encoding_rs::UTF_16LE.decode(bytes);
                return decoded.into_owned();
            }
            if bytes[0] == 0xFE && bytes[1] == 0xFF {
                let (decoded, _, _) = encoding_rs::UTF_16BE.decode(bytes);
                return decoded.into_owned();
            }
        }

        // Windows console/pipes often use active ANSI code page (e.g. GBK/CP936).
        let candidates: &[&encoding_rs::Encoding] = &[
            encoding_rs::GBK,
            encoding_rs::UTF_16LE,
            encoding_rs::UTF_16BE,
            encoding_rs::BIG5,
            encoding_rs::SHIFT_JIS,
            encoding_rs::EUC_JP,
            encoding_rs::EUC_KR,
        ];

        for encoding in candidates {
            let (decoded, _, had_errors) = encoding.decode(bytes);
            if had_errors {
                continue;
            }
            let text = decoded.as_ref();
            if printable_ratio(text) > 0.85 {
                return text.to_string();
            }
        }
    }

    String::from_utf8_lossy(bytes).to_string()
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

/// Create terminal internally
pub fn create_terminal_internal(
    app: &AppHandle,
    state: &TerminalState,
    working_dir: Option<String>,
) -> Result<TerminalDescriptor, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("打开 PTY 失败: {e}"))?;

    let primary_shell = if cfg!(target_os = "windows") {
        "powershell"
    } else {
        "zsh"
    };

    let mut cmd = CommandBuilder::new(if cfg!(target_os = "windows") {
        "powershell.exe"
    } else {
        "zsh"
    });

    if cfg!(target_os = "windows") {
        cmd.arg("-NoLogo");
    }

    let working_dir = working_dir.and_then(|dir| {
        let p = std::path::Path::new(&dir);
        if p.is_dir() {
            Some(dir)
        } else {
            None
        }
    });

    if let Some(ref dir) = working_dir {
        cmd.cwd(dir);
    }
    cmd.env("PATH", enrich_terminal_path());

    let mut shell_type = primary_shell.to_string();
    let mut spawn_result = pair.slave.spawn_command(cmd);
    if spawn_result.is_err() && !cfg!(target_os = "windows") {
        let mut bash_cmd = CommandBuilder::new("bash");
        if let Some(ref dir) = working_dir {
            bash_cmd.cwd(dir);
        }
        spawn_result = pair.slave.spawn_command(bash_cmd);
        if spawn_result.is_ok() {
            shell_type = "bash".to_string();
        }
    }

    let child = spawn_result.map_err(|e| format!("启动 Shell 失败: {e}"))?;
    let pid = child.process_id();

    let master = pair.master;
    let mut reader = master
        .try_clone_reader()
        .map_err(|e| format!("克隆 PTY reader 失败: {e}"))?;
    let writer = master
        .take_writer()
        .map_err(|e| format!("无法获取 PTY writer: {e}"))?;

    let terminal_id = Uuid::new_v4().to_string();
    let index = state.next_index.fetch_add(1, Ordering::SeqCst) + 1;
    let title = format!("终端 {}", index);

    let buffer = Arc::new(Mutex::new(TerminalBuffer::new(state.max_bytes)));
    let buffer_for_thread = buffer.clone();
    let terminal_id_for_thread = terminal_id.clone();
    let app_for_thread = app.clone();

    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if let Ok(mut ring) = buffer_for_thread.lock() {
                        ring.push_bytes(&buf[..n]);
                    } else {
                        break;
                    }

                    let data = decode_terminal_bytes(&buf[..n]);
                    let _ = app_for_thread.emit(
                        "terminal-data",
                        TerminalDataEvent {
                            terminal_id: terminal_id_for_thread.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });

    let session = TerminalSession {
        writer,
        master,
        buffer,
        child,
        title: title.clone(),
        shell_type: shell_type.clone(),
        last_rows: 24,
        last_cols: 80,
    };

    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "终端会话锁定失败".to_string())?;
        sessions.insert(terminal_id.clone(), session);
    }

    {
        let mut active_guard = state
            .active_terminal_id
            .lock()
            .map_err(|_| "终端状态锁定失败".to_string())?;
        *active_guard = Some(terminal_id.clone());
    }

    Ok(TerminalDescriptor {
        terminal_id,
        title,
        pid,
        shell_type,
    })
}

/// Build terminal descriptor from session
pub fn build_terminal_descriptor(
    terminal_id: &str,
    session: &TerminalSession,
) -> TerminalDescriptor {
    TerminalDescriptor {
        terminal_id: terminal_id.to_string(),
        title: session.title.clone(),
        pid: session.child.process_id(),
        shell_type: session.shell_type.clone(),
    }
}

// ============================================================================
// Tauri Commands
// ============================================================================

#[tauri::command]
pub fn ensure_terminal(
    app: tauri::AppHandle,
    state: State<'_, TerminalState>,
    working_dir: Option<String>,
) -> Result<TerminalDescriptor, String> {
    let active_id = {
        let active = state
            .active_terminal_id
            .lock()
            .map_err(|_| "终端状态锁定失败".to_string())?;
        active.clone()
    };

    if let Some(id) = active_id {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "终端会话锁定失败".to_string())?;
        if let Some(session) = sessions.get(&id) {
            return Ok(build_terminal_descriptor(&id, session));
        }
    }

    create_terminal_internal(&app, &state, working_dir)
}

#[tauri::command]
pub fn create_terminal(
    app: tauri::AppHandle,
    state: State<'_, TerminalState>,
    source: Option<String>,
    working_dir: Option<String>,
) -> Result<TerminalDescriptor, String> {
    let descriptor = create_terminal_internal(&app, &state, working_dir)?;
    if source.as_deref() == Some("ai") {
        let _ = app.emit("terminal-created", descriptor.clone());
    }
    Ok(descriptor)
}

#[tauri::command]
pub fn set_active_terminal(
    terminal_id: String,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "终端会话锁定失败".to_string())?;
    if !sessions.contains_key(&terminal_id) {
        return Err("终端不存在".to_string());
    }
    drop(sessions);

    let mut active_guard = state
        .active_terminal_id
        .lock()
        .map_err(|_| "终端状态锁定失败".to_string())?;
    *active_guard = Some(terminal_id);
    Ok(())
}

#[tauri::command]
pub fn write_to_terminal(
    data: String,
    terminal_id: Option<String>,
    source: Option<String>,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let active = state
        .active_terminal_id
        .lock()
        .map_err(|_| "终端状态锁定失败".to_string())?;
    let resolved_id = resolve_terminal_id(terminal_id, active.clone())?;
    drop(active);

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "终端会话锁定失败".to_string())?;
    let session = sessions
        .get_mut(&resolved_id)
        .ok_or("终端不存在".to_string())?;

    let data = if source.as_deref() == Some("ai") {
        adapt_ai_terminal_input(&data)
    } else {
        data
    };

    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("写入 PTY 失败: {e}"))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("刷新 PTY 失败: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn get_terminal_output(
    terminal_id: Option<String>,
    since_seq: u64,
    max_bytes: Option<usize>,
    state: State<'_, TerminalState>,
) -> Result<TerminalOutputChunk, String> {
    let max_bytes = max_bytes.unwrap_or(8192);
    let active = state
        .active_terminal_id
        .lock()
        .map_err(|_| "终端状态锁定失败".to_string())?;
    let resolved_id = resolve_terminal_id(terminal_id, active.clone())?;
    drop(active);

    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "终端会话锁定失败".to_string())?;
    let session = sessions.get(&resolved_id).ok_or("终端不存在".to_string())?;
    let buffer = session
        .buffer
        .lock()
        .map_err(|_| "终端缓冲锁定失败".to_string())?;
    let chunk = buffer.read_since(since_seq, max_bytes);

    Ok(TerminalOutputChunk {
        data: decode_terminal_bytes(&chunk.data),
        next_seq: chunk.next_seq,
        truncated: chunk.truncated,
    })
}

#[tauri::command]
pub fn set_terminal_size(
    terminal_id: Option<String>,
    rows: u16,
    cols: u16,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let rows = rows.max(2);
    let cols = cols.max(2);
    let active = state
        .active_terminal_id
        .lock()
        .map_err(|_| "终端状态锁定失败".to_string())?;
    let resolved_id = resolve_terminal_id(terminal_id, active.clone())?;
    drop(active);

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "终端会话锁定失败".to_string())?;
    let session = sessions
        .get_mut(&resolved_id)
        .ok_or("终端不存在".to_string())?;

    if session.last_rows == rows && session.last_cols == cols {
        return Ok(());
    }

    session.last_rows = rows;
    session.last_cols = cols;

    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("调整 PTY 大小失败: {e}"))
}

#[tauri::command]
pub fn close_terminal(
    app: tauri::AppHandle,
    terminal_id: Option<String>,
    source: Option<String>,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let active = state
        .active_terminal_id
        .lock()
        .map_err(|_| "终端状态锁定失败".to_string())?;
    let resolved_id = resolve_terminal_id(terminal_id, active.clone())?;
    let current_active = active.clone();
    drop(active);

    let session = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "终端会话锁定失败".to_string())?;
        sessions
            .remove(&resolved_id)
            .ok_or("终端不存在".to_string())?
    };

    let mut child = session.child;
    let _ = child.kill();

    let remaining_ids = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "终端会话锁定失败".to_string())?;
        sessions.keys().cloned().collect::<Vec<String>>()
    };

    let next_active = select_active_after_close(current_active, &resolved_id, &remaining_ids);
    let mut active_guard = state
        .active_terminal_id
        .lock()
        .map_err(|_| "终端状态锁定失败".to_string())?;
    *active_guard = next_active;

    if source.as_deref() == Some("ai") {
        let _ = app.emit(
            "terminal-closed",
            TerminalClosedEvent {
                terminal_id: resolved_id.clone(),
            },
        );
    }

    Ok(())
}

// ============================================================================
// Direct command execution (bypasses PTY — for AI tool calls)
// ============================================================================

/// Result of a directly executed command
#[derive(Serialize)]
pub struct ExecuteCommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub duration_ms: u64,
}

/// Incremental command execution progress for UI streaming
#[derive(Clone, Serialize)]
pub struct CommandExecProgressEvent {
    pub stream_id: String,
    pub chunk: String,
    pub stream: String,
    pub started: bool,
    pub done: bool,
    pub exit_code: Option<i32>,
    pub duration_ms: Option<u64>,
}

fn emit_command_exec_progress(app: &AppHandle, event: CommandExecProgressEvent) {
    let _ = app.emit("command-exec-progress", event);
}

async fn read_stream_chunks(
    mut reader: impl tokio::io::AsyncRead + Unpin,
    stream_label: &str,
    collected: std::sync::Arc<std::sync::Mutex<String>>,
    app: &AppHandle,
    stream_id: &Option<String>,
    emit_chunks: bool,
) {
    use tokio::io::AsyncReadExt;

    let mut buf = [0u8; 8192];
    let mut started = false;
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                let chunk = decode_terminal_bytes(&buf[..n]);
                if let Ok(mut data) = collected.lock() {
                    data.push_str(&chunk);
                }
                if emit_chunks {
                    if let Some(sid) = stream_id {
                        if !started {
                            started = true;
                            emit_command_exec_progress(
                                app,
                                CommandExecProgressEvent {
                                    stream_id: sid.clone(),
                                    chunk: String::new(),
                                    stream: stream_label.to_string(),
                                    started: true,
                                    done: false,
                                    exit_code: None,
                                    duration_ms: None,
                                },
                            );
                        }
                        if !chunk.is_empty() {
                            emit_command_exec_progress(
                                app,
                                CommandExecProgressEvent {
                                    stream_id: sid.clone(),
                                    chunk,
                                    stream: stream_label.to_string(),
                                    started: false,
                                    done: false,
                                    exit_code: None,
                                    duration_ms: None,
                                },
                            );
                        }
                    }
                }
            }
            Err(_) => break,
        }
    }
}

/// Execute a command directly via `std::process::Command`, bypassing PTY.
///
/// This is the preferred path for AI tool calls because:
/// - No sentinel marker or polling needed — the process exits on its own
/// - Exit code is captured accurately
/// - stdout and stderr are separated
/// - No marker mis-detection risk
///
/// On Windows the command is run through `powershell.exe -NoProfile -Command`
/// Build a `std::process::Command` for the given shell type.
/// Supported values: "powershell", "pwsh", "cmd", "bash", "sh", "zsh", "fish".
/// Falls back to platform default (powershell on Windows, bash elsewhere) if not specified.
fn build_shell_command(shell: &Option<String>, command: &str) -> std::process::Command {
    let shell_str = shell.as_deref().unwrap_or("").to_lowercase();

    if !shell_str.is_empty() {
        match shell_str.as_str() {
            "cmd" => {
                let mut c = std::process::Command::new("cmd.exe");
                c.args(["/C", command]);
                return c;
            }
            "pwsh" => {
                let mut c = std::process::Command::new("pwsh.exe");
                c.args(["-NoProfile", "-Command", command]);
                return c;
            }
            "powershell" | "ps" => {
                let mut c = std::process::Command::new("powershell.exe");
                c.args(["-NoProfile", "-Command", command]);
                return c;
            }
            "bash" => {
                let mut c = std::process::Command::new("bash");
                c.args(["-c", command]);
                return c;
            }
            "sh" => {
                let mut c = std::process::Command::new("sh");
                c.args(["-c", command]);
                return c;
            }
            "zsh" => {
                let mut c = std::process::Command::new("zsh");
                c.args(["-c", command]);
                return c;
            }
            "fish" => {
                let mut c = std::process::Command::new("fish");
                c.args(["-c", command]);
                return c;
            }
            // Unknown shell: try using it directly with -c flag
            other => {
                let mut c = std::process::Command::new(other);
                c.args(["-c", command]);
                return c;
            }
        }
    }

    // Default: platform-specific
    if cfg!(target_os = "windows") {
        let mut c = std::process::Command::new("powershell.exe");
        c.args(["-NoProfile", "-Command", command]);
        c
    } else {
        let mut c = std::process::Command::new("bash");
        c.args(["-c", command]);
        c
    }
}

fn build_tokio_shell_command(shell: &Option<String>, command: &str) -> tokio::process::Command {
    let shell_str = shell.as_deref().unwrap_or("").to_lowercase();

    if !shell_str.is_empty() {
        match shell_str.as_str() {
            "cmd" => {
                let mut c = tokio::process::Command::new("cmd.exe");
                c.args(["/C", command]);
                return c;
            }
            "pwsh" => {
                let mut c = tokio::process::Command::new("pwsh.exe");
                c.args(["-NoProfile", "-Command", command]);
                return c;
            }
            "powershell" | "ps" => {
                let mut c = tokio::process::Command::new("powershell.exe");
                c.args(["-NoProfile", "-Command", command]);
                return c;
            }
            "bash" => {
                let mut c = tokio::process::Command::new("bash");
                c.args(["-c", command]);
                return c;
            }
            "sh" => {
                let mut c = tokio::process::Command::new("sh");
                c.args(["-c", command]);
                return c;
            }
            "zsh" => {
                let mut c = tokio::process::Command::new("zsh");
                c.args(["-c", command]);
                return c;
            }
            "fish" => {
                let mut c = tokio::process::Command::new("fish");
                c.args(["-c", command]);
                return c;
            }
            // Unknown shell: try using it directly with -c flag
            other => {
                let mut c = tokio::process::Command::new(other);
                c.args(["-c", command]);
                return c;
            }
        }
    }

    // Default: platform-specific
    if cfg!(target_os = "windows") {
        let mut c = tokio::process::Command::new("powershell.exe");
        c.args(["-NoProfile", "-Command", command]);
        c
    } else {
        let mut c = tokio::process::Command::new("bash");
        c.args(["-c", command]);
        c
    }
}

/// so that `&&`, `||`, pipes, and other shell features work correctly.
#[tauri::command]
pub async fn execute_command(
    command: String,
    working_dir: Option<String>,
    timeout_ms: Option<u64>,
    app: AppHandle,
    shell: Option<String>,
    max_lines: Option<usize>,
    script: Option<String>,
    no_output_expected: Option<bool>,
    stream_id: Option<String>,
    sandbox_state: State<'_, SandboxState>,
) -> Result<ExecuteCommandResult, String> {
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    let sandbox_ctx = sandbox::current_sandbox_context(&sandbox_state);
    sandbox_ctx.validate_command_allowed()?;
    sandbox_ctx.validate_network(&command)?;
    if let Some(ref dir) = working_dir {
        sandbox_ctx.validate_command_cwd(Some(std::path::Path::new(dir)))?;
    }

    let timeout = Duration::from_millis(timeout_ms.unwrap_or(30_000).min(600_000));

    // If script is provided, write it to a temp file and execute that
    let (actual_command, script_shell, _temp_file) = if let Some(ref script_content) = script {
        // Determine file extension based on shell (or OS default)
        let ext = match shell.as_deref() {
            Some("cmd") => "cmd",
            Some("pwsh") | Some("powershell") | Some("ps") => "ps1",
            Some("bash") | Some("sh") | Some("zsh") | Some("fish") => "sh",
            _ => {
                // Default: use ps1 on Windows, sh elsewhere
                if cfg!(target_os = "windows") {
                    "ps1"
                } else {
                    "sh"
                }
            }
        };
        let temp_dir = std::env::temp_dir();
        let temp_path = temp_dir.join(format!("loom_script_{}.{}", Uuid::new_v4(), ext));
        std::fs::write(&temp_path, script_content)
            .map_err(|e| format!("写入临时脚本文件失败: {e}"))?;

        let temp_str = temp_path.to_string_lossy().to_string();
        let shell_cmd = match shell.as_deref() {
            Some("cmd") => format!("cmd.exe /C \"{}\"", temp_str),
            Some("pwsh") => format!("pwsh.exe -NoProfile -File \"{}\"", temp_str),
            Some("powershell") | Some("ps") => {
                format!("powershell.exe -NoProfile -File \"{}\"", temp_str)
            }
            Some("bash") => format!("bash \"{}\"", temp_str),
            Some("sh") => format!("sh \"{}\"", temp_str),
            Some("zsh") => format!("zsh \"{}\"", temp_str),
            Some("fish") => format!("fish \"{}\"", temp_str),
            _ => {
                if cfg!(target_os = "windows") {
                    format!("powershell.exe -NoProfile -File \"{}\"", temp_str)
                } else {
                    format!("bash \"{}\"", temp_str)
                }
            }
        };
        // Return the shell that was used for the script command
        let used_shell = shell.clone().unwrap_or_else(|| {
            if cfg!(target_os = "windows") {
                "powershell".to_string()
            } else {
                "bash".to_string()
            }
        });
        (shell_cmd, Some(used_shell), Some(temp_path))
    } else {
        (command.clone(), None, None)
    };

    // For script execution, actual_command already includes the shell invocation.
    // Pass the script shell directly to avoid double-wrapping.
    let mut cmd = if script_shell.is_some() {
        // Build a raw command — actual_command already has the shell prefix
        let mut c = tokio::process::Command::new("cmd.exe");
        c.args(["/C", &actual_command]);
        #[cfg(not(target_os = "windows"))]
        {
            c = tokio::process::Command::new("sh");
            c.args(["-c", &actual_command]);
        }
        c
    } else {
        build_tokio_shell_command(&shell, &actual_command)
    };
    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    // Hide console window on Windows
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.as_std_mut().creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    if let Some(ref dir) = working_dir {
        let path = std::path::Path::new(dir);
        if path.is_dir() {
            cmd.current_dir(dir);
        }
    }

    let mut child = cmd.spawn().map_err(|e| format!("启动命令失败: {e}"))?;

    let stdout = child.stdout.take().ok_or("无法获取 stdout")?;
    let stderr = child.stderr.take().ok_or("无法获取 stderr")?;

    let emit_chunks = stream_id.is_some() && no_output_expected != Some(true);
    let stdout_buf = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let stderr_buf = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let app_stdout = app.clone();
    let app_stderr = app.clone();
    let stream_id_stdout = stream_id.clone();
    let stream_id_stderr = stream_id.clone();
    let stdout_collect = stdout_buf.clone();
    let stderr_collect = stderr_buf.clone();

    let stdout_reader = tokio::spawn(async move {
        read_stream_chunks(
            stdout,
            "stdout",
            stdout_collect,
            &app_stdout,
            &stream_id_stdout,
            emit_chunks,
        )
        .await;
    });

    let stderr_reader = tokio::spawn(async move {
        read_stream_chunks(
            stderr,
            "stderr",
            stderr_collect,
            &app_stderr,
            &stream_id_stderr,
            emit_chunks,
        )
        .await;
    });

    let start = Instant::now();
    let wait_result = tokio::time::timeout(timeout, child.wait()).await;

    let (exit_code, timed_out) = match wait_result {
        Ok(Ok(status)) => (status.code(), false),
        Ok(Err(e)) => {
            if let Some(ref p) = _temp_file {
                let _ = std::fs::remove_file(p);
            }
            return Err(format!("等待命令执行失败: {e}"));
        }
        Err(_) => {
            // Timeout! Kill the process
            let _ = child.kill().await;
            let status = child.wait().await.ok();
            (status.and_then(|s| s.code()), true)
        }
    };

    // Wait for the background readers to complete (which they will immediately after process exits)
    let _ = stdout_reader.await;
    let _ = stderr_reader.await;

    let elapsed = start.elapsed().as_millis() as u64;
    let stdout_str = stdout_buf
        .lock()
        .map(|s| s.clone())
        .unwrap_or_default();
    let stderr_str = stderr_buf
        .lock()
        .map(|s| s.clone())
        .unwrap_or_default();

    if emit_chunks {
        if let Some(sid) = stream_id {
            emit_command_exec_progress(
                &app,
                CommandExecProgressEvent {
                    stream_id: sid,
                    chunk: String::new(),
                    stream: "stdout".to_string(),
                    started: false,
                    done: true,
                    exit_code,
                    duration_ms: Some(elapsed),
                },
            );
        }
    }

    // Emit to terminal panel so user can see what AI is doing
    // (skip when no_output_expected is set — avoids noise for quiet commands)
    if no_output_expected != Some(true)
        && (!stdout_str.is_empty() || !stderr_str.is_empty())
    {
        let display = if stderr_str.is_empty() {
            stdout_str.clone()
        } else if stdout_str.is_empty() {
            stderr_str.clone()
        } else {
            format!("{stdout_str}\n[stderr]\n{stderr_str}")
        };
        let _ = app.emit(
            "terminal-data",
            TerminalDataEvent {
                terminal_id: "__direct_exec__".to_string(),
                data: format!("$ {command}\r\n{display}"),
            },
        );
    }

    // Clean up temp file
    if let Some(ref p) = _temp_file {
        let _ = std::fs::remove_file(p);
    }

    let stdout_limited = apply_max_lines(&stdout_str, max_lines);
    let stderr_limited = apply_max_lines(&stderr_str, max_lines);

    let output = ExecuteCommandResult {
        stdout: stdout_limited,
        stderr: stderr_limited,
        exit_code,
        timed_out,
        duration_ms: elapsed,
    };

    Ok(output)
}

// ============================================================================
// Background command execution
// ============================================================================

/// Truncate output to at most `max_lines` lines, keeping the first lines.
/// Returns the truncated string with a hint if lines were removed.
fn apply_max_lines(output: &str, max_lines: Option<usize>) -> String {
    let Some(limit) = max_lines else {
        return output.to_string();
    };
    if limit == 0 {
        return output.to_string();
    }
    let lines: Vec<&str> = output.lines().collect();
    if lines.len() <= limit {
        return output.to_string();
    }
    let truncated: Vec<&str> = lines.into_iter().take(limit).collect();
    let mut result = truncated.join("\n");
    result.push_str(&format!(
        "\n\n... [output truncated at {} lines] ...",
        limit
    ));
    result
}

static BG_TASK_COUNTER: AtomicU64 = AtomicU64::new(0);

struct BackgroundTaskState {
    stdout: String,
    stderr: String,
    completed: bool,
    exit_code: Option<i32>,
    pid: u32,
    command: String,
    duration_ms: Option<u64>,
}

pub struct BackgroundTasks {
    tasks: Mutex<HashMap<String, Arc<Mutex<BackgroundTaskState>>>>,
}

impl Default for BackgroundTasks {
    fn default() -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
        }
    }
}

impl BackgroundTasks {
    /// Collect PIDs of incomplete background commands for port ownership hints.
    pub fn active_pids(&self) -> std::collections::HashSet<u32> {
        let mut pids = std::collections::HashSet::new();
        if let Ok(tasks) = self.tasks.lock() {
            for task_arc in tasks.values() {
                if let Ok(state) = task_arc.lock() {
                    if !state.completed {
                        pids.insert(state.pid);
                    }
                }
            }
        }
        pids
    }
}

#[derive(Serialize)]
pub struct ExecuteCommandBgResult {
    pub task_id: String,
}

#[derive(Serialize)]
pub struct CheckBackgroundCommandResult {
    pub stdout: String,
    pub stderr: String,
    pub completed: bool,
    pub exit_code: Option<i32>,
    pub duration_ms: Option<u64>,
}

/// Execute a command in the background, returning a task ID immediately.
/// Output is accumulated incrementally and can be checked via `check_background_command`.
#[tauri::command]
pub fn execute_command_bg(
    command: String,
    working_dir: Option<String>,
    _timeout_ms: Option<u64>,
    app: AppHandle,
    bg_state: State<'_, BackgroundTasks>,
    shell: Option<String>,
    sandbox_state: State<'_, SandboxState>,
) -> Result<ExecuteCommandBgResult, String> {
    use std::process::Stdio;
    use std::time::Instant;

    let sandbox_ctx = sandbox::current_sandbox_context(&sandbox_state);
    sandbox_ctx.validate_command_allowed()?;
    sandbox_ctx.validate_network(&command)?;
    if let Some(ref dir) = working_dir {
        sandbox_ctx.validate_command_cwd(Some(std::path::Path::new(dir)))?;
    }

    let task_id = format!("bg{}", BG_TASK_COUNTER.fetch_add(1, Ordering::Relaxed));

    let mut cmd = build_shell_command(&shell, &command);
    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    if let Some(ref dir) = working_dir {
        let path = std::path::Path::new(dir);
        if path.is_dir() {
            cmd.current_dir(dir);
        }
    }

    let mut child = cmd.spawn().map_err(|e| format!("启动后台命令失败: {e}"))?;
    let pid = child.id();
    let stdout_handle = child.stdout.take();
    let stderr_handle = child.stderr.take();

    let start_time = Instant::now();

    let task_state = Arc::new(Mutex::new(BackgroundTaskState {
        stdout: String::new(),
        stderr: String::new(),
        completed: false,
        exit_code: None,
        pid,
        command: command.clone(),
        duration_ms: None,
    }));

    // Register the task
    {
        let mut tasks = bg_state
            .tasks
            .lock()
            .map_err(|_| "后台任务状态锁定失败".to_string())?;
        tasks.insert(task_id.clone(), task_state.clone());
    }

    // Spawn background thread to read output and wait for completion
    let ts = task_state.clone();
    let app_clone = app.clone();
    let cmd_display = command.clone();
    let progress_task_id = task_id.clone();

    std::thread::spawn(move || {
        // Read stdout in a separate thread
        let ts_stdout = ts.clone();
        let app_for_stdout = app_clone.clone();
        let stream_task_id = progress_task_id.clone();
        let stdout_thread = stdout_handle.map(|mut r| {
            std::thread::spawn(move || {
                let mut buf = [0u8; 8192];
                loop {
                    match r.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            let text = decode_terminal_bytes(&buf[..n]);
                            if let Ok(mut s) = ts_stdout.lock() {
                                s.stdout.push_str(&text);
                            }
                            if !text.is_empty() {
                                emit_command_exec_progress(
                                    &app_for_stdout,
                                    CommandExecProgressEvent {
                                        stream_id: stream_task_id.clone(),
                                        chunk: text,
                                        stream: "stdout".to_string(),
                                        started: false,
                                        done: false,
                                        exit_code: None,
                                        duration_ms: None,
                                    },
                                );
                            }
                        }
                        Err(_) => break,
                    }
                }
            })
        });

        // Read stderr in a separate thread
        let ts_stderr = ts.clone();
        let stderr_thread = stderr_handle.map(|mut r| {
            std::thread::spawn(move || {
                let mut buf = [0u8; 8192];
                loop {
                    match r.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            let text = decode_terminal_bytes(&buf[..n]);
                            if let Ok(mut s) = ts_stderr.lock() {
                                s.stderr.push_str(&text);
                            }
                        }
                        Err(_) => break,
                    }
                }
            })
        });

        // Wait for output threads to finish
        if let Some(h) = stdout_thread {
            let _ = h.join();
        }
        if let Some(h) = stderr_thread {
            let _ = h.join();
        }

        // Wait for process to exit
        match child.wait() {
            Ok(status) => {
                if let Ok(mut s) = ts.lock() {
                    s.exit_code = status.code();
                    s.completed = true;
                    s.duration_ms = Some(start_time.elapsed().as_millis() as u64);
                }
            }
            Err(_) => {
                if let Ok(mut s) = ts.lock() {
                    s.completed = true;
                    s.duration_ms = Some(start_time.elapsed().as_millis() as u64);
                }
            }
        }

        // Emit terminal-data event with the complete output
        if let Ok(s) = ts.lock() {
            let display = if s.stderr.is_empty() {
                s.stdout.clone()
            } else if s.stdout.is_empty() {
                s.stderr.clone()
            } else {
                format!("{}\n[stderr]\n{}", s.stdout, s.stderr)
            };
            if !display.is_empty() {
                let _ = app_clone.emit(
                    "terminal-data",
                    TerminalDataEvent {
                        terminal_id: "__direct_exec__".to_string(),
                        data: format!("$ {cmd_display}\r\n{display}"),
                    },
                );
            }
        }
    });

    Ok(ExecuteCommandBgResult { task_id })
}

/// Check the current state of a background command.
#[tauri::command]
pub fn check_background_command(
    task_id: String,
    bg_state: State<'_, BackgroundTasks>,
) -> Result<CheckBackgroundCommandResult, String> {
    let tasks = bg_state
        .tasks
        .lock()
        .map_err(|_| "后台任务状态锁定失败".to_string())?;
    let task = tasks
        .get(&task_id)
        .ok_or(format!("后台任务不存在: {task_id}"))?;
    let s = task.lock().map_err(|_| "后台任务锁定失败".to_string())?;

    Ok(CheckBackgroundCommandResult {
        stdout: s.stdout.clone(),
        stderr: s.stderr.clone(),
        completed: s.completed,
        exit_code: s.exit_code,
        duration_ms: s.duration_ms,
    })
}

/// Kill a running background command by task ID.
#[tauri::command]
pub fn kill_background_command(
    task_id: String,
    bg_state: State<'_, BackgroundTasks>,
) -> Result<(), String> {
    let tasks = bg_state
        .tasks
        .lock()
        .map_err(|_| "后台任务状态锁定失败".to_string())?;
    let task = tasks
        .get(&task_id)
        .ok_or(format!("后台任务不存在: {task_id}"))?;
    let s = task.lock().map_err(|_| "后台任务锁定失败".to_string())?;

    if s.completed {
        return Err("任务已完成，无需终止".to_string());
    }

    let pid = s.pid;
    drop(s);
    drop(tasks);

    #[cfg(target_os = "windows")]
    {
        let mut kill_cmd = std::process::Command::new("taskkill");
        kill_cmd.args(["/PID", &pid.to_string(), "/F", "/T"]);
        use std::os::windows::process::CommandExt;
        kill_cmd.creation_flags(0x08000000);
        let _ = kill_cmd.status();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("kill")
            .arg(pid.to_string())
            .status();
    }

    Ok(())
}

/// A single background task summary for listing
#[derive(Serialize)]
pub struct BackgroundTaskSummary {
    pub task_id: String,
    pub pid: u32,
    pub command: String,
    pub completed: bool,
    pub exit_code: Option<i32>,
    pub duration_ms: Option<u64>,
}

/// List all background tasks.
#[tauri::command]
pub fn list_background_commands(
    bg_state: State<'_, BackgroundTasks>,
) -> Result<Vec<BackgroundTaskSummary>, String> {
    let tasks = bg_state
        .tasks
        .lock()
        .map_err(|_| "后台任务状态锁定失败".to_string())?;

    let mut result = Vec::new();
    for (task_id, task_arc) in tasks.iter() {
        if let Ok(s) = task_arc.lock() {
            result.push(BackgroundTaskSummary {
                task_id: task_id.clone(),
                pid: s.pid,
                command: s.command.clone(),
                completed: s.completed,
                exit_code: s.exit_code,
                duration_ms: s.duration_ms,
            });
        }
    }
    Ok(result)
}
