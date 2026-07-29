//! Loom built-in CDP browser automation.
//!
//! Controls system Chrome/Edge over the Chrome DevTools Protocol:
//! launch, navigate, click, type, evaluate, screenshot, and content.
//! Implemented as Loom's own lean CDP WebSocket client for Tauri/Tokio.

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::State;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdpBrowserStatus {
    pub running: bool,
    pub enabled_note: String,
    pub browser_path: Option<String>,
    pub debugging_port: Option<u16>,
    pub current_url: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdpActionResult {
    pub ok: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screenshot_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screenshot_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
}

struct PendingJsDialog {
    message: String,
    dialog_type: String,
    default_prompt: Option<String>,
}

struct CdpSession {
    child: Child,
    port: u16,
    browser_path: PathBuf,
    /// Chrome user-data-dir for this session (stable or ephemeral fallback).
    profile_dir: PathBuf,
    /// When true, profile_dir was created for this launch and can be removed on stop.
    ephemeral_profile: bool,
    ws: WsStream,
    next_id: AtomicU64,
    /// Page target session id (flatten mode). Browser/Target commands omit this.
    session_id: Option<String>,
    current_url: Option<String>,
    pending_dialog: Option<PendingJsDialog>,
}

#[derive(Clone, Copy)]
enum PageLoadWait {
    DomContentLoaded,
    Load,
}

impl PageLoadWait {
    fn from_str(s: Option<&str>) -> Self {
        match s.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            Some("domcontentloaded") => Self::DomContentLoaded,
            _ => Self::Load,
        }
    }

    fn is_ready(&self, ready_state: &str) -> bool {
        match self {
            Self::DomContentLoaded => ready_state == "interactive" || ready_state == "complete",
            Self::Load => ready_state == "complete",
        }
    }
}

pub struct CdpBrowserState {
    inner: Arc<Mutex<Option<CdpSession>>>,
}

impl Default for CdpBrowserState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
        }
    }
}

// ============================================================================
// Chrome / Edge discovery
// ============================================================================

fn candidate_browser_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    #[cfg(target_os = "windows")]
    {
        let env_keys = ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"];
        let suffixes = [
            r"Google\Chrome\Application\chrome.exe",
            r"Microsoft\Edge\Application\msedge.exe",
            r"Chromium\Application\chrome.exe",
        ];
        for key in env_keys {
            if let Ok(base) = std::env::var(key) {
                for suffix in suffixes {
                    paths.push(PathBuf::from(&base).join(suffix));
                }
            }
        }
        // Common hard-coded fallbacks
        paths.push(PathBuf::from(
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        ));
        paths.push(PathBuf::from(
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        ));
        paths.push(PathBuf::from(
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        ));
        paths.push(PathBuf::from(
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        ));
    }

    #[cfg(target_os = "macos")]
    {
        paths.push(PathBuf::from(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ));
        paths.push(PathBuf::from(
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ));
        paths.push(PathBuf::from(
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ));
    }

    #[cfg(target_os = "linux")]
    {
        for name in [
            "google-chrome",
            "google-chrome-stable",
            "chromium",
            "chromium-browser",
            "microsoft-edge",
            "microsoft-edge-stable",
        ] {
            paths.push(PathBuf::from(format!("/usr/bin/{name}")));
            paths.push(PathBuf::from(format!("/usr/local/bin/{name}")));
            paths.push(PathBuf::from(format!("/snap/bin/{name}")));
        }
    }

    if let Ok(custom) = std::env::var("LOOM_CDP_BROWSER") {
        paths.insert(0, PathBuf::from(custom));
    }
    if let Ok(custom) = std::env::var("CHROME_PATH") {
        paths.insert(0, PathBuf::from(custom));
    }

    paths
}

fn find_browser_executable() -> Result<PathBuf, String> {
    for path in candidate_browser_paths() {
        if path.is_file() {
            return Ok(path);
        }
    }

    // PATH lookup
    for name in [
        "chrome",
        "google-chrome",
        "google-chrome-stable",
        "msedge",
        "chromium",
        "chromium-browser",
    ] {
        if let Ok(output) = Command::new(if cfg!(windows) { "where" } else { "which" })
            .arg(name)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                if let Some(line) = text.lines().next() {
                    let p = PathBuf::from(line.trim());
                    if p.is_file() {
                        return Ok(p);
                    }
                }
            }
        }
    }

    Err(
        "未找到 Chrome/Edge。请安装 Google Chrome 或 Microsoft Edge，或设置环境变量 LOOM_CDP_BROWSER。"
            .into(),
    )
}

fn pick_debug_port() -> u16 {
    // Users can override with LOOM_CDP_PORT.
    if let Ok(raw) = std::env::var("LOOM_CDP_PORT") {
        if let Ok(p) = raw.parse::<u16>() {
            if p > 0 {
                return p;
            }
        }
    }
    // Bind an ephemeral local port so we never collide with a stale Chrome.
    match std::net::TcpListener::bind("127.0.0.1:0") {
        Ok(listener) => listener.local_addr().map(|a| a.port()).unwrap_or(9333),
        Err(_) => 9333,
    }
}

/// Stable Chrome profile (reused across sessions). Not one folder per action.
fn stable_user_data_dir() -> Result<PathBuf, String> {
    let base = crate::config_paths::dot_config_dir()?;
    let dir = base.join("cdp-browser-profile");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建 CDP 用户目录失败: {e}"))?;
    Ok(dir)
}

/// Remove Chromium lock files so a crashed previous session does not block reuse.
fn clear_profile_locks(dir: &std::path::Path) {
    for name in [
        "SingletonLock",
        "SingletonCookie",
        "SingletonSocket",
        "lockfile",
    ] {
        let p = dir.join(name);
        let _ = std::fs::remove_file(&p);
    }
}

/// Delete leftover `cdp-browser-profile-<pid>-<ts>` dirs from older builds.
fn cleanup_orphan_profiles() {
    let Ok(base) = crate::config_paths::dot_config_dir() else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(&base) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with("cdp-browser-profile-") {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

fn prepare_user_data_dir() -> Result<(PathBuf, bool), String> {
    cleanup_orphan_profiles();
    let stable = stable_user_data_dir()?;
    clear_profile_locks(&stable);
    Ok((stable, false))
}

fn screenshots_dir() -> Result<PathBuf, String> {
    let base = crate::config_paths::dot_config_dir()?;
    let dir = base.join("cdp-screenshots");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建截图目录失败: {e}"))?;
    Ok(dir)
}

// ============================================================================
// CDP WebSocket helpers
// ============================================================================

/// Poll Chrome HTTP CDP for the *browser-level* websocket URL.
/// Page-level sockets die after navigation (Windows often surfaces os error 10053);
/// browser-level + Target.attachToTarget(flatten) stays stable across navigations.
async fn fetch_browser_ws_debugger_url(port: u16) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;

    let mut last_err = String::from("无法连接 CDP 端点");
    for _ in 0..60 {
        match client
            .get(format!("http://127.0.0.1:{port}/json/version"))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                let body: Value = resp.json().await.map_err(|e| e.to_string())?;
                if let Some(url) = body.get("webSocketDebuggerUrl").and_then(|v| v.as_str()) {
                    // Force loopback; Chrome may report a hostname that fails locally.
                    let fixed = url.replace("localhost", "127.0.0.1");
                    return Ok(fixed);
                }
                last_err = "CDP /json/version 缺少 webSocketDebuggerUrl".into();
            }
            Ok(resp) => {
                last_err = format!("CDP /json/version 状态: {}", resp.status());
            }
            Err(e) => {
                last_err = e.to_string();
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err(format!("等待 Chrome CDP 就绪超时: {last_err}"))
}

fn method_uses_page_session(method: &str) -> bool {
    !method.starts_with("Target.") && !method.starts_with("Browser.")
}

fn capture_cdp_event(session: &mut CdpSession, value: &Value) {
    if value.get("method").and_then(|v| v.as_str()) != Some("Page.javascriptDialogOpening") {
        return;
    }
    let Some(params) = value.get("params") else {
        return;
    };
    let message = params
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let dialog_type = params
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("alert")
        .to_string();
    let default_prompt = params
        .get("defaultPrompt")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    session.pending_dialog = Some(PendingJsDialog {
        message,
        dialog_type,
        default_prompt,
    });
}

enum DialogWaitPolicy {
    /// Ignore dialog events (caller handles later via handle_alert).
    Ignore,
    /// Auto-accept dialog so the in-flight command can finish.
    AutoAccept,
}

async fn cdp_send(session: &mut CdpSession, method: &str, params: Value) -> Result<Value, String> {
    cdp_send_timeout(session, method, params, Duration::from_secs(30)).await
}

async fn cdp_send_timeout(
    session: &mut CdpSession,
    method: &str,
    params: Value,
    timeout: Duration,
) -> Result<Value, String> {
    cdp_send_inner(session, method, params, timeout, DialogWaitPolicy::Ignore).await
}

async fn send_cdp_raw(
    session: &mut CdpSession,
    id: u64,
    method: &str,
    params: Value,
) -> Result<(), String> {
    let mut msg = json!({
        "id": id,
        "method": method,
        "params": params,
    });
    if method_uses_page_session(method) {
        if let Some(sid) = session.session_id.as_ref() {
            msg["sessionId"] = json!(sid);
        }
    }
    let text = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
    session
        .ws
        .send(Message::Text(text.into()))
        .await
        .map_err(|e| format!("CDP 发送失败 ({method}): {e}"))
}

async fn cdp_send_inner(
    session: &mut CdpSession,
    method: &str,
    params: Value,
    timeout: Duration,
    dialog_policy: DialogWaitPolicy,
) -> Result<Value, String> {
    let id = session.next_id.fetch_add(1, Ordering::SeqCst);
    send_cdp_raw(session, id, method, params).await?;

    let deadline = tokio::time::Instant::now() + timeout;
    let mut pending_handle_id: Option<u64> = None;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err(format!("CDP 等待响应超时: {method}"));
        }
        let next = tokio::time::timeout(remaining, session.ws.next())
            .await
            .map_err(|_| format!("CDP 等待响应超时: {method}"))?
            .ok_or_else(|| format!("CDP 连接已关闭: {method}"))?
            .map_err(|e| format!("CDP 读取失败: {e}"))?;

        let Message::Text(payload) = next else {
            continue;
        };
        let value: Value = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
        let msg_id = value.get("id").and_then(|v| v.as_u64());

        if msg_id == Some(id) {
            if let Some(err) = value.get("error") {
                let message = err
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown CDP error");
                return Err(format!("CDP 错误 ({method}): {message}"));
            }
            return Ok(value.get("result").cloned().unwrap_or(Value::Null));
        }

        if pending_handle_id.is_some() && msg_id == pending_handle_id {
            pending_handle_id = None;
            continue;
        }

        if msg_id.is_some() {
            // Unrelated command response — ignore while waiting.
            continue;
        }

        let had_dialog = session.pending_dialog.is_some();
        capture_cdp_event(session, &value);
        if !had_dialog
            && session.pending_dialog.is_some()
            && matches!(dialog_policy, DialogWaitPolicy::AutoAccept)
        {
            let dialog = session.pending_dialog.as_ref().unwrap();
            let mut handle_params = json!({ "accept": true });
            if dialog.dialog_type == "prompt" {
                if let Some(default) = dialog.default_prompt.as_ref() {
                    handle_params["promptText"] = json!(default);
                } else {
                    handle_params["promptText"] = json!("");
                }
            }
            let hid = session.next_id.fetch_add(1, Ordering::SeqCst);
            pending_handle_id = Some(hid);
            send_cdp_raw(session, hid, "Page.handleJavaScriptDialog", handle_params).await?;
            // Dialog accepted — clear pending so later commands are not blocked.
            session.pending_dialog = None;
        }
    }
}

async fn attach_page_session(session: &mut CdpSession, url: &str) -> Result<(), String> {
    let _ = cdp_send(
        session,
        "Target.setDiscoverTargets",
        json!({ "discover": true }),
    )
    .await;

    let created = cdp_send(session, "Target.createTarget", json!({ "url": url })).await?;
    let target_id = created
        .get("targetId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Target.createTarget 未返回 targetId".to_string())?
        .to_string();

    let attached = cdp_send(
        session,
        "Target.attachToTarget",
        json!({
            "targetId": target_id,
            "flatten": true,
        }),
    )
    .await?;
    let session_id = attached
        .get("sessionId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Target.attachToTarget 未返回 sessionId".to_string())?
        .to_string();
    session.session_id = Some(session_id);
    session.current_url = Some(url.to_string());
    Ok(())
}

async fn ensure_domains(session: &mut CdpSession) -> Result<(), String> {
    cdp_send(session, "Page.enable", json!({})).await?;
    cdp_send(session, "Runtime.enable", json!({})).await?;
    cdp_send(session, "DOM.enable", json!({})).await?;
    let _ = cdp_send(session, "Network.enable", json!({})).await;
    Ok(())
}

async fn wait_for_page_load(
    session: &mut CdpSession,
    wait_until: PageLoadWait,
    timeout_ms: u64,
) -> Result<(), String> {
    let timeout_ms = timeout_ms.clamp(500, 60_000);
    let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        let ready = cdp_send(
            session,
            "Runtime.evaluate",
            json!({
                "expression": "document.readyState",
                "returnByValue": true,
            }),
        )
        .await?;
        let state = ready
            .pointer("/result/value")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if wait_until.is_ready(state) {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            let label = match wait_until {
                PageLoadWait::DomContentLoaded => "DOMContentLoaded",
                PageLoadWait::Load => "load",
            };
            return Err(format!(
                "等待页面 {label} 超时 ({timeout_ms}ms, readyState={state})"
            ));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn page_navigate(
    session: &mut CdpSession,
    url: &str,
    wait_until: PageLoadWait,
    timeout_ms: u64,
) -> Result<(), String> {
    session.pending_dialog = None;
    cdp_send(session, "Page.navigate", json!({ "url": url })).await?;
    wait_for_page_load(session, wait_until, timeout_ms).await?;
    session.current_url = Some(url.to_string());
    Ok(())
}

async fn wait_for_javascript_dialog(session: &mut CdpSession, timeout_ms: u64) -> Result<(), String> {
    if session.pending_dialog.is_some() {
        return Ok(());
    }
    let timeout_ms = timeout_ms.clamp(100, 60_000);
    let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms);
    while session.pending_dialog.is_none() {
        if tokio::time::Instant::now() >= deadline {
            return Err(format!("等待 JavaScript 弹窗超时 ({timeout_ms}ms)"));
        }
        let _ = cdp_send_timeout(
            session,
            "Runtime.evaluate",
            json!({ "expression": "1", "returnByValue": true }),
            Duration::from_secs(2),
        )
        .await;
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Ok(())
}

async fn handle_javascript_dialog(
    session: &mut CdpSession,
    dialog_action: &str,
    prompt_text: Option<&str>,
    timeout_ms: u64,
) -> Result<CdpActionResult, String> {
    wait_for_javascript_dialog(session, timeout_ms).await?;
    let pending = session
        .pending_dialog
        .as_ref()
        .ok_or_else(|| "未检测到 JavaScript 弹窗".to_string())?;

    match dialog_action {
        "get_text" => {
            let mut result = ok_result(format!(
                "弹窗类型: {}, 内容已读取",
                pending.dialog_type
            ));
            result.content = Some(pending.message.clone());
            Ok(result)
        }
        "accept" => {
            let message = pending.message.clone();
            let dialog_type = pending.dialog_type.clone();
            let mut params = json!({ "accept": true });
            if let Some(text) = prompt_text.filter(|s| !s.is_empty()) {
                params["promptText"] = json!(text);
            }
            cdp_send(session, "Page.handleJavaScriptDialog", params).await?;
            session.pending_dialog = None;
            Ok(ok_result(format!(
                "已确认弹窗 ({dialog_type}): {message}"
            )))
        }
        "dismiss" => {
            let message = pending.message.clone();
            let dialog_type = pending.dialog_type.clone();
            cdp_send(
                session,
                "Page.handleJavaScriptDialog",
                json!({ "accept": false }),
            )
            .await?;
            session.pending_dialog = None;
            Ok(ok_result(format!(
                "已取消弹窗 ({dialog_type}): {message}"
            )))
        }
        other => Err(format!("未知 dialog_action: {other}")),
    }
}

async fn page_url(session: &mut CdpSession) -> Result<String, String> {
    let res = cdp_send(
        session,
        "Runtime.evaluate",
        json!({
            "expression": "location.href",
            "returnByValue": true,
        }),
    )
    .await?;
    let url = res
        .pointer("/result/value")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if !url.is_empty() {
        session.current_url = Some(url.clone());
    }
    Ok(url)
}

async fn page_title(session: &mut CdpSession) -> Result<String, String> {
    let res = cdp_send(
        session,
        "Runtime.evaluate",
        json!({
            "expression": "document.title",
            "returnByValue": true,
        }),
    )
    .await?;
    Ok(res
        .pointer("/result/value")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string())
}

async fn page_content(session: &mut CdpSession) -> Result<String, String> {
    let res = cdp_send(
        session,
        "Runtime.evaluate",
        json!({
            "expression": "document.documentElement.outerHTML",
            "returnByValue": true,
        }),
    )
    .await?;
    Ok(res
        .pointer("/result/value")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string())
}

fn js_string_literal(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

const INTERACTIVE_ELEMENTS_JS: &str = r#"(function() {
  const isVisible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
      && rect.bottom > 0 && rect.right > 0
      && rect.top < (window.innerHeight || 0)
      && rect.left < (window.innerWidth || 0);
  };
  const trimText = (s) => {
    const t = (s || '').trim().replace(/\s+/g, ' ');
    return t.length > 50 ? t.slice(0, 50) + '…' : t;
  };
  const hint = (el) => {
    if (el.id) return '#' + el.id;
    if (el.name) return el.tagName.toLowerCase() + '[name="' + String(el.name).replace(/"/g, '\\"') + '"]';
    const aria = el.getAttribute('aria-label');
    if (aria) return el.tagName.toLowerCase() + '[aria-label="' + aria.replace(/"/g, '\\"') + '"]';
    if (typeof el.className === 'string' && el.className.trim()) {
      const cls = el.className.trim().split(/\s+/).slice(0, 2).join('.');
      return el.tagName.toLowerCase() + '.' + cls;
    }
    return el.tagName.toLowerCase();
  };
  const queries = ['a[href]', 'button', 'input', 'select', 'textarea', '[role="button"]', '[role="link"]', '[contenteditable="true"]'];
  const seen = new Set();
  const out = [];
  for (const q of queries) {
    for (const el of document.querySelectorAll(q)) {
      if (seen.has(el) || !isVisible(el)) continue;
      seen.add(el);
      const tag = el.tagName.toLowerCase();
      const type = el.type ? ':' + el.type : '';
      const text = trimText(el.innerText || el.textContent || el.value || el.getAttribute('placeholder') || '');
      out.push({ hint: hint(el), tag: tag + type, text });
      if (out.length >= 20) return out;
    }
  }
  return out;
})()"#;

async fn interactive_elements_hint(session: &mut CdpSession) -> Option<String> {
    let res = cdp_send(
        session,
        "Runtime.evaluate",
        json!({
            "expression": INTERACTIVE_ELEMENTS_JS,
            "returnByValue": true,
        }),
    )
    .await
    .ok()?;
    let items = res.pointer("/result/value")?.as_array()?;
    if items.is_empty() {
        return Some("当前视口内未发现可见交互元素。".into());
    }
    let mut lines = Vec::new();
    for item in items {
        let hint = item.get("hint").and_then(|v| v.as_str()).unwrap_or("?");
        let tag = item.get("tag").and_then(|v| v.as_str()).unwrap_or("");
        let text = item.get("text").and_then(|v| v.as_str()).unwrap_or("");
        if text.is_empty() {
            lines.push(format!("  - {hint} ({tag})"));
        } else {
            lines.push(format!("  - {hint} ({tag}) \"{text}\""));
        }
    }
    Some(format!("可见交互元素 ({}):\n{}", lines.len(), lines.join("\n")))
}

fn should_attach_interactive_hint(detail: &str) -> bool {
    detail.contains("element not found")
}

async fn selector_error(
    session: &mut CdpSession,
    prefix: &str,
    target: &str,
    detail: &str,
) -> String {
    let mut msg = format!("{prefix} ({target}): {detail}");
    if should_attach_interactive_hint(detail) {
        if let Some(hint) = interactive_elements_hint(session).await {
            msg.push_str("\n\n");
            msg.push_str(&hint);
        }
    }
    msg
}

async fn append_interactive_hint(session: &mut CdpSession, msg: String) -> String {
    let mut out = msg;
    if let Some(hint) = interactive_elements_hint(session).await {
        out.push_str("\n\n");
        out.push_str(&hint);
    }
    out
}

async fn click_selector(session: &mut CdpSession, selector: &str) -> Result<(), String> {
    let expr = format!(
        r#"(function() {{
  const el = document.querySelector({sel});
  if (!el) return {{ ok: false, error: 'element not found' }};
  el.scrollIntoView({{ block: 'center', inline: 'center' }});
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  el.focus?.();
  el.click?.();
  return {{ ok: true, x, y }};
}})()"#,
        sel = js_string_literal(selector)
    );
    let res = cdp_send(
        session,
        "Runtime.evaluate",
        json!({
            "expression": expr,
            "returnByValue": true,
            "awaitPromise": true,
        }),
    )
    .await?;
    let value = res.get("result").and_then(|r| r.get("value")).cloned();
    if value
        .as_ref()
        .and_then(|v| v.get("ok"))
        .and_then(|v| v.as_bool())
        != Some(true)
    {
        let err = value
            .as_ref()
            .and_then(|v| v.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("click failed");
        return Err(selector_error(session, "点击失败", selector, err).await);
    }
    Ok(())
}

async fn hover_selector(session: &mut CdpSession, selector: &str) -> Result<(), String> {
    let expr = format!(
        r#"(function() {{
  const el = document.querySelector({sel});
  if (!el) return {{ ok: false, error: 'element not found' }};
  el.scrollIntoView({{ block: 'center', inline: 'center' }});
  const rect = el.getBoundingClientRect();
  return {{ ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }};
}})()"#,
        sel = js_string_literal(selector)
    );
    let res = cdp_send(
        session,
        "Runtime.evaluate",
        json!({
            "expression": expr,
            "returnByValue": true,
            "awaitPromise": true,
        }),
    )
    .await?;
    let value = res.get("result").and_then(|r| r.get("value")).cloned();
    let ok = value
        .as_ref()
        .and_then(|v| v.get("ok"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !ok {
        let err = value
            .as_ref()
            .and_then(|v| v.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("hover failed");
        return Err(selector_error(session, "悬停失败", selector, err).await);
    }
    let x = value
        .as_ref()
        .and_then(|v| v.get("x"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let y = value
        .as_ref()
        .and_then(|v| v.get("y"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    cdp_send(
        session,
        "Input.dispatchMouseEvent",
        json!({
            "type": "mouseMoved",
            "x": x,
            "y": y,
        }),
    )
    .await?;

    let dom_expr = format!(
        r#"(function() {{
  const el = document.querySelector({sel});
  if (!el) return false;
  const base = {{ cancelable: true, view: window, clientX: {x}, clientY: {y}, bubbles: true }};
  el.dispatchEvent(new MouseEvent('mousemove', base));
  el.dispatchEvent(new MouseEvent('mouseover', base));
  el.dispatchEvent(new MouseEvent('mouseenter', {{ ...base, bubbles: false }}));
  return true;
}})()"#,
        sel = js_string_literal(selector),
        x = x,
        y = y,
    );
    let _ = cdp_send(
        session,
        "Runtime.evaluate",
        json!({
            "expression": dom_expr,
            "returnByValue": true,
        }),
    )
    .await;
    Ok(())
}

async fn type_selector(
    session: &mut CdpSession,
    selector: &str,
    text: &str,
    clear: bool,
) -> Result<(), String> {
    // Native value setter + InputEvent so React/Vue controlled inputs update.
    let expr = format!(
        r#"(function() {{
  const el = document.querySelector({sel});
  if (!el) return {{ ok: false, error: 'element not found' }};
  el.focus();
  el.scrollIntoView?.({{ block: 'center', inline: 'center' }});
  const isInput = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
  const proto = isInput
    ? (el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype)
    : null;
  const desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
  const setValue = desc && desc.set
    ? (v) => desc.set.call(el, v)
    : (v) => {{ if ('value' in el) el.value = v; else el.textContent = v; }};
  const current = isInput ? (el.value || '') : (el.textContent || '');
  const next = {clear} ? {text} : (current + {text});
  setValue(next);
  el.dispatchEvent(new InputEvent('input', {{ bubbles: true, cancelable: true, data: {text}, inputType: 'insertText' }}));
  el.dispatchEvent(new Event('change', {{ bubbles: true }}));
  return {{ ok: true, value: isInput ? el.value : (el.textContent || '') }};
}})()"#,
        sel = js_string_literal(selector),
        text = js_string_literal(text),
        clear = if clear { "true" } else { "false" },
    );
    let res = cdp_send(
        session,
        "Runtime.evaluate",
        json!({
            "expression": expr,
            "returnByValue": true,
            "awaitPromise": true,
        }),
    )
    .await?;
    let ok = res
        .pointer("/result/value/ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !ok {
        let err = res
            .pointer("/result/value/error")
            .and_then(|v| v.as_str())
            .unwrap_or("type failed");
        return Err(selector_error(session, "输入失败", selector, err).await);
    }
    Ok(())
}

async fn scroll_page(
    session: &mut CdpSession,
    selector: Option<&str>,
    x: Option<f64>,
    y: Option<f64>,
    scroll_by: bool,
) -> Result<(), String> {
    let expr = if let Some(sel) = selector {
        format!(
            r#"(function() {{
  const el = document.querySelector({sel});
  if (!el) return {{ ok: false, error: 'element not found' }};
  el.scrollIntoView({{ block: 'center', inline: 'center', behavior: 'instant' }});
  return {{ ok: true, mode: 'element', scrollX: window.scrollX, scrollY: window.scrollY }};
}})()"#,
            sel = js_string_literal(sel)
        )
    } else {
        let x = x.unwrap_or(0.0);
        let y = y.unwrap_or(0.0);
        let mode = if scroll_by { "by" } else { "to" };
        format!(
            r#"(function() {{
  const x = {x};
  const y = {y};
  if ({scroll_by}) {{
    window.scrollBy(x, y);
  }} else {{
    window.scrollTo(x, y);
  }}
  return {{ ok: true, mode: '{mode}', scrollX: window.scrollX, scrollY: window.scrollY }};
}})()"#,
            x = x,
            y = y,
            scroll_by = if scroll_by { "true" } else { "false" },
            mode = mode
        )
    };
    let res = cdp_send(
        session,
        "Runtime.evaluate",
        json!({
            "expression": expr,
            "returnByValue": true,
            "awaitPromise": true,
        }),
    )
    .await?;
    let ok = res
        .pointer("/result/value/ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !ok {
        let err = res
            .pointer("/result/value/error")
            .and_then(|v| v.as_str())
            .unwrap_or("scroll failed");
        let target = selector.unwrap_or("window");
        if should_attach_interactive_hint(err) {
            return Err(selector_error(session, "滚动失败", target, err).await);
        }
        return Err(format!("滚动失败 ({target}): {err}"));
    }
    Ok(())
}

async fn select_option(
    session: &mut CdpSession,
    selector: &str,
    value: Option<&str>,
    index: Option<i32>,
    option_text: Option<&str>,
) -> Result<(), String> {
    let value_js = value
        .map(js_string_literal)
        .unwrap_or_else(|| "null".to_string());
    let index_js = index
        .map(|i| i.to_string())
        .unwrap_or_else(|| "null".to_string());
    let text_js = option_text
        .map(js_string_literal)
        .unwrap_or_else(|| "null".to_string());
    let expr = format!(
        r#"(function() {{
  const el = document.querySelector({sel});
  if (!el) return {{ ok: false, error: 'element not found' }};
  if (!(el instanceof HTMLSelectElement)) return {{ ok: false, error: 'not a select element' }};
  const value = {value_js};
  const index = {index_js};
  const optionText = {text_js};
  const opts = Array.from(el.options);
  const listOptions = () => opts.slice(0, 20).map((o) => '"' + o.text.trim() + '" (value=' + o.value + ')').join(', ');
  const matchText = (needle) => {{
    const n = needle.trim();
    return opts.find((o) => o.text.trim() === n || o.label.trim() === n || o.value === n) || null;
  }};
  let target = null;
  if (value !== null) {{
    target = opts.find((o) => o.value === value) || matchText(value);
    if (!target) return {{ ok: false, error: 'option not found: ' + value + '. available: ' + listOptions() }};
    el.value = target.value;
  }} else if (index !== null) {{
    if (index < 0 || index >= opts.length) {{
      return {{ ok: false, error: 'index out of range: ' + index + ' (options: ' + opts.length + '). available: ' + listOptions() }};
    }}
    el.selectedIndex = index;
    target = opts[index];
  }} else if (optionText !== null) {{
    target = matchText(optionText);
    if (!target) return {{ ok: false, error: 'option not found: ' + optionText + '. available: ' + listOptions() }};
    el.value = target.value;
  }} else {{
    return {{ ok: false, error: 'missing value, index, label, or text' }};
  }}
  el.dispatchEvent(new Event('input', {{ bubbles: true }}));
  el.dispatchEvent(new Event('change', {{ bubbles: true }}));
  return {{ ok: true, value: el.value, label: target ? target.text : '' }};
}})()"#,
        sel = js_string_literal(selector),
        value_js = value_js,
        index_js = index_js,
        text_js = text_js,
    );
    let res = cdp_send(
        session,
        "Runtime.evaluate",
        json!({
            "expression": expr,
            "returnByValue": true,
            "awaitPromise": true,
        }),
    )
    .await?;
    let ok = res
        .pointer("/result/value/ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !ok {
        let err = res
            .pointer("/result/value/error")
            .and_then(|v| v.as_str())
            .unwrap_or("select failed");
        if should_attach_interactive_hint(err) {
            return Err(selector_error(session, "选择失败", selector, err).await);
        }
        return Err(format!("选择失败 ({selector}): {err}"));
    }
    Ok(())
}

fn normalize_key_name(key: &str) -> &str {
    match key {
        "Return" => "Enter",
        "Esc" => "Escape",
        other => other,
    }
}

async fn dispatch_cdp_key(session: &mut CdpSession, key: &str) -> Result<(), String> {
    let key = normalize_key_name(key);
    let (code, text, key_code) = match key {
        "Enter" => ("Enter", "\r", 13),
        "Tab" => ("Tab", "\t", 9),
        "Escape" => ("Escape", "", 27),
        "Backspace" => ("Backspace", "", 8),
        "ArrowUp" => ("ArrowUp", "", 38),
        "ArrowDown" => ("ArrowDown", "", 40),
        "ArrowLeft" => ("ArrowLeft", "", 37),
        "ArrowRight" => ("ArrowRight", "", 39),
        other => (other, if other.len() == 1 { other } else { "" }, 0),
    };

    // rawKeyDown + char/keyDown + keyUp matches Chromium event sequence more closely.
    cdp_send(
        session,
        "Input.dispatchKeyEvent",
        json!({
            "type": "rawKeyDown",
            "key": key,
            "code": code,
            "windowsVirtualKeyCode": key_code,
            "nativeVirtualKeyCode": key_code,
        }),
    )
    .await?;

    if !text.is_empty() {
        cdp_send(
            session,
            "Input.dispatchKeyEvent",
            json!({
                "type": "char",
                "key": key,
                "code": code,
                "text": text,
                "unmodifiedText": text,
                "windowsVirtualKeyCode": key_code,
                "nativeVirtualKeyCode": key_code,
            }),
        )
        .await?;
    } else {
        cdp_send(
            session,
            "Input.dispatchKeyEvent",
            json!({
                "type": "keyDown",
                "key": key,
                "code": code,
                "windowsVirtualKeyCode": key_code,
                "nativeVirtualKeyCode": key_code,
            }),
        )
        .await?;
    }

    cdp_send(
        session,
        "Input.dispatchKeyEvent",
        json!({
            "type": "keyUp",
            "key": key,
            "code": code,
            "windowsVirtualKeyCode": key_code,
            "nativeVirtualKeyCode": key_code,
        }),
    )
    .await?;
    Ok(())
}

/// DOM-level key simulation for SPA handlers that ignore CDP Input events.
async fn dispatch_dom_key(session: &mut CdpSession, key: &str) -> Result<Value, String> {
    let key = normalize_key_name(key);
    let (code, key_code) = match key {
        "Enter" => ("Enter", 13),
        "Tab" => ("Tab", 9),
        "Escape" => ("Escape", 27),
        "Backspace" => ("Backspace", 8),
        "ArrowUp" => ("ArrowUp", 38),
        "ArrowDown" => ("ArrowDown", 40),
        "ArrowLeft" => ("ArrowLeft", 37),
        "ArrowRight" => ("ArrowRight", 39),
        other => (other, 0),
    };
    let expr = format!(
        r#"(function() {{
  const key = {key};
  const code = {code};
  const keyCode = {key_code};
  const target = document.activeElement || document.body;
  const opts = {{
    key,
    code,
    keyCode,
    which: keyCode,
    bubbles: true,
    cancelable: true,
    view: window,
  }};
  const down = new KeyboardEvent('keydown', opts);
  const press = new KeyboardEvent('keypress', opts);
  const up = new KeyboardEvent('keyup', opts);
  const downPrevented = !target.dispatchEvent(down);
  if (!downPrevented) target.dispatchEvent(press);
  target.dispatchEvent(up);

  let submitted = false;
  if (key === 'Enter') {{
    const el = target;
    const form = (el && el.form) || (el && el.closest && el.closest('form'));
    if (form) {{
      try {{
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.submit();
        submitted = true;
      }} catch (e) {{
        try {{ form.submit(); submitted = true; }} catch (_) {{}}
      }}
    }} else if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {{
      const root = el.closest('form, .s_form, .search, [role=search]') || document;
      const btn =
        root.querySelector('button[type=submit], input[type=submit], #su, .search-btn')
        || document.querySelector('#su, button[type=submit], input[type=submit]');
      if (btn) {{ btn.click(); submitted = true; }}
    }}
  }}
  return {{
    ok: true,
    key,
    active: (document.activeElement && (document.activeElement.id || document.activeElement.tagName)) || null,
    downPrevented,
    submitted,
    href: location.href,
  }};
}})()"#,
        key = js_string_literal(key),
        code = js_string_literal(code),
        key_code = key_code,
    );
    evaluate_js(session, &expr, true).await
}

async fn press_key(session: &mut CdpSession, key: &str) -> Result<(), String> {
    // 1) CDP Input events
    dispatch_cdp_key(session, key).await?;
    // 2) DOM KeyboardEvent + form submit fallback (Baidu / many SPAs)
    let _ = dispatch_dom_key(session, key).await?;
    if matches!(normalize_key_name(key), "Enter") {
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    Ok(())
}

async fn sleep_ms(timeout_ms: u64) {
    let timeout_ms = timeout_ms.clamp(100, 60_000);
    tokio::time::sleep(Duration::from_millis(timeout_ms)).await;
}

async fn wait_for_selector(
    session: &mut CdpSession,
    selector: &str,
    timeout_ms: u64,
) -> Result<(), String> {
    let timeout_ms = timeout_ms.clamp(100, 60_000);
    let started = std::time::Instant::now();
    let expr = format!(
        "!!document.querySelector({})",
        js_string_literal(selector)
    );
    loop {
        let res = cdp_send(
            session,
            "Runtime.evaluate",
            json!({
                "expression": expr,
                "returnByValue": true,
            }),
        )
        .await?;
        if res
            .pointer("/result/value")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            return Ok(());
        }
        if started.elapsed().as_millis() as u64 >= timeout_ms {
            return Err(
                append_interactive_hint(
                    session,
                    format!("等待选择器超时 ({timeout_ms}ms): {selector}"),
                )
                .await,
            );
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

async fn page_content_size(session: &mut CdpSession) -> (f64, f64) {
    // Prefer layout metrics; fall back to DOM measurements.
    if let Ok(layout) = cdp_send(session, "Page.getLayoutMetrics", json!({})).await {
        let content = layout
            .get("cssContentSize")
            .or_else(|| layout.get("contentSize"));
        if let Some(c) = content {
            let w = c.get("width").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let h = c.get("height").and_then(|v| v.as_f64()).unwrap_or(0.0);
            if w > 0.0 && h > 0.0 {
                return (w, h);
            }
        }
    }
    let metrics = cdp_send(
        session,
        "Runtime.evaluate",
        json!({
            "expression": "(() => { const b = document.body, e = document.documentElement; return { w: Math.max(b?.scrollWidth||0, e?.scrollWidth||0, e?.clientWidth||0, 1280), h: Math.max(b?.scrollHeight||0, e?.scrollHeight||0, e?.clientHeight||0, 720) }; })()",
            "returnByValue": true,
        }),
    )
    .await
    .ok();
    let w = metrics
        .as_ref()
        .and_then(|m| m.pointer("/result/value/w"))
        .and_then(|v| v.as_f64())
        .unwrap_or(1280.0);
    let h = metrics
        .as_ref()
        .and_then(|m| m.pointer("/result/value/h"))
        .and_then(|v| v.as_f64())
        .unwrap_or(720.0);
    (w.max(1.0), h.max(1.0))
}

async fn capture_screenshot(
    session: &mut CdpSession,
    full_page: bool,
) -> Result<(PathBuf, String), String> {
    // Bring page forward and wait two animation frames so compositor has a frame.
    // fromSurface:true often hangs on Windows when the window is unfocused/minimized.
    let _ = cdp_send(session, "Page.bringToFront", json!({})).await;
    let _ = cdp_send(
        session,
        "Runtime.evaluate",
        json!({
            "expression": "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))",
            "awaitPromise": true,
            "returnByValue": true,
        }),
    )
    .await;

    let mut used_metrics_override = false;
    if full_page {
        let (width, height) = page_content_size(session).await;
        // Cap size: huge full-page PNGs are slow and can exceed CDP timeouts.
        let width = width.clamp(320.0, 1920.0);
        let height = height.clamp(240.0, 6000.0);
        if cdp_send(
            session,
            "Emulation.setDeviceMetricsOverride",
            json!({
                "width": width.round() as u64,
                "height": height.round() as u64,
                "deviceScaleFactor": 1,
                "mobile": false,
            }),
        )
        .await
        .is_ok()
        {
            used_metrics_override = true;
            tokio::time::sleep(Duration::from_millis(80)).await;
        }
    }

    // Prefer software path without fromSurface (stable on Windows headless/detached).
    // captureBeyondViewport helps full-page when metrics override is unavailable.
    let attempts: Vec<Value> = if full_page {
        vec![
            json!({
                "format": "png",
                "captureBeyondViewport": true,
            }),
            json!({
                "format": "png",
            }),
            json!({
                "format": "jpeg",
                "quality": 80,
            }),
        ]
    } else {
        vec![
            json!({
                "format": "png",
            }),
            json!({
                "format": "jpeg",
                "quality": 80,
            }),
        ]
    };

    let mut last_err = String::from("截图失败");
    let mut b64: Option<String> = None;
    for params in attempts {
        match cdp_send_timeout(
            session,
            "Page.captureScreenshot",
            params,
            Duration::from_secs(20),
        )
        .await
        {
            Ok(res) => {
                if let Some(data) = res.get("data").and_then(|v| v.as_str()) {
                    if !data.is_empty() {
                        b64 = Some(data.to_string());
                        break;
                    }
                }
                last_err = "截图响应缺少 data".into();
            }
            Err(e) => {
                last_err = e;
            }
        }
    }

    if used_metrics_override {
        let _ = cdp_send(session, "Emulation.clearDeviceMetricsOverride", json!({})).await;
    }

    let b64 = b64.ok_or_else(|| format!("截图超时或失败: {last_err}"))?;

    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&b64)
        .map_err(|e| format!("截图 base64 解码失败: {e}"))?;

    let dir = screenshots_dir()?;
    let name = format!(
        "cdp-{}.png",
        chrono::Local::now().format("%Y%m%d-%H%M%S-%3f")
    );
    let path = dir.join(name);
    std::fs::write(&path, bytes).map_err(|e| format!("写入截图失败: {e}"))?;

    Ok((path, b64))
}

/// Wrap user JS so sync alert/confirm/prompt do not open native dialogs
/// (which would block Runtime.evaluate until dismissed).
fn wrap_evaluate_expression(expression: &str) -> String {
    let expr = js_string_literal(expression);
    format!(
        r#"(function() {{
  var __dialogs = [];
  var __alert = window.alert;
  var __confirm = window.confirm;
  var __prompt = window.prompt;
  window.alert = function(msg) {{
    __dialogs.push({{ type: 'alert', message: String(msg == null ? '' : msg) }});
  }};
  window.confirm = function(msg) {{
    __dialogs.push({{ type: 'confirm', message: String(msg == null ? '' : msg) }});
    return true;
  }};
  window.prompt = function(msg, def) {{
    var d = def == null ? '' : String(def);
    __dialogs.push({{ type: 'prompt', message: String(msg == null ? '' : msg), defaultPrompt: d }});
    return d;
  }};
  function __restore() {{
    window.alert = __alert;
    window.confirm = __confirm;
    window.prompt = __prompt;
  }}
  function __ok(v) {{
    __restore();
    return {{ ok: true, result: v, dialogs: __dialogs }};
  }}
  function __fail(e) {{
    __restore();
    var err = e && (e.stack || e.message) ? String(e.stack || e.message) : String(e);
    return {{ ok: false, error: err, dialogs: __dialogs }};
  }}
  try {{
    var __result = (0, eval)({expr});
    if (__result && typeof __result.then === 'function') {{
      return Promise.resolve(__result).then(__ok, __fail);
    }}
    return __ok(__result);
  }} catch (e) {{
    return __fail(e);
  }}
}})()"#
    )
}

async fn evaluate_js(
    session: &mut CdpSession,
    expression: &str,
    intercept_dialogs: bool,
) -> Result<Value, String> {
    if session.pending_dialog.is_some() {
        return Err(
            "已有未处理的 JavaScript 弹窗，请先调用 handle_alert 再继续 evaluate".into(),
        );
    }
    if !intercept_dialogs {
        // Raw evaluate — native dialogs will block until handle_alert is called.
        let res = cdp_send_inner(
            session,
            "Runtime.evaluate",
            json!({
                "expression": expression,
                "returnByValue": true,
                "awaitPromise": true,
            }),
            Duration::from_secs(30),
            DialogWaitPolicy::Ignore,
        )
        .await?;
        if res.pointer("/exceptionDetails").is_some() {
            let msg = res
                .pointer("/exceptionDetails/text")
                .and_then(|v| v.as_str())
                .unwrap_or("JS exception");
            return Err(format!("evaluate 失败: {msg}"));
        }
        return Ok(res.get("result").cloned().unwrap_or(Value::Null));
    }

    let wrapped = wrap_evaluate_expression(expression);
    // AutoAccept: if a native dialog still opens (e.g. page code outside the wrap),
    // accept it so evaluate can finish instead of timing out.
    let res = cdp_send_inner(
        session,
        "Runtime.evaluate",
        json!({
            "expression": wrapped,
            "returnByValue": true,
            "awaitPromise": true,
        }),
        Duration::from_secs(30),
        DialogWaitPolicy::AutoAccept,
    )
    .await?;
    if res.pointer("/exceptionDetails").is_some() {
        let msg = res
            .pointer("/exceptionDetails/text")
            .and_then(|v| v.as_str())
            .unwrap_or("JS exception");
        return Err(format!("evaluate 失败: {msg}"));
    }
    let remote = res.get("result").cloned().unwrap_or(Value::Null);
    let Some(payload) = remote.get("value").cloned() else {
        return Ok(remote);
    };

    if payload.get("ok").and_then(|v| v.as_bool()) == Some(false) {
        let err = payload
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("JS exception");
        return Err(format!("evaluate 失败: {err}"));
    }

    let dialogs = payload
        .get("dialogs")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let dialog_count = dialogs.as_array().map(|a| a.len()).unwrap_or(0);
    let result_value = payload.get("result").cloned().unwrap_or(Value::Null);

    if dialog_count == 0 {
        return Ok(result_value);
    }

    Ok(json!({
        "result": result_value,
        "dialogs": dialogs,
        "dialogOpened": true,
        "dialogAutoHandled": true,
        "hint": "alert/confirm/prompt 已在 evaluate 内拦截并自动处理（confirm→true，prompt→默认值），无需再调用 handle_alert。"
    }))
}

// ============================================================================
// Session lifecycle
// ============================================================================

async fn start_session(
    url: Option<String>,
    wait_until: PageLoadWait,
    load_timeout_ms: u64,
) -> Result<CdpSession, String> {
    let browser_path = find_browser_executable()?;
    let port = pick_debug_port();
    let (profile_dir, ephemeral_profile) = prepare_user_data_dir()?;
    let start_url = url.unwrap_or_else(|| "about:blank".into());

    let mut cmd = Command::new(&browser_path);
    // --remote-allow-origins=* is required on modern Chrome/Edge (111+) for CDP WS.
    // Bind debugging to loopback only. Open the real page via Target.createTarget so the
    // browser-level websocket remains the single long-lived connection across navigations.
    cmd.args([
        format!("--remote-debugging-port={port}"),
        "--remote-debugging-address=127.0.0.1".into(),
        "--remote-allow-origins=*".into(),
        format!("--user-data-dir={}", profile_dir.display()),
        "--no-first-run".into(),
        "--no-default-browser-check".into(),
        "--disable-background-networking".into(),
        "--disable-client-side-phishing-detection".into(),
        "--disable-default-apps".into(),
        "--disable-hang-monitor".into(),
        "--disable-popup-blocking".into(),
        "--disable-prompt-on-repost".into(),
        "--disable-sync".into(),
        "--metrics-recording-only".into(),
        "--password-store=basic".into(),
        "--use-mock-keychain".into(),
        "--disable-features=Translate,MediaRouter".into(),
        "about:blank".into(),
    ]);
    // Keep Chrome independent of the Loom console on Windows.
    // Avoid CREATE_NO_WINDOW — it can destabilize GUI Chromium processes.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动浏览器失败 ({}): {e}", browser_path.display()))?;

    // Brief settle time before polling the debug port.
    tokio::time::sleep(Duration::from_millis(250)).await;

    if let Ok(Some(status)) = child.try_wait() {
        return Err(format!(
            "Chrome/Edge 启动后立即退出 (code={status:?})。请检查端口 {port} 与用户目录是否可用。"
        ));
    }

    let ws_url = match fetch_browser_ws_debugger_url(port).await {
        Ok(u) => u,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(e);
        }
    };

    let mut last_ws_err = String::new();
    let mut ws_opt = None;
    for attempt in 0..8u64 {
        match connect_async(&ws_url).await {
            Ok((ws, _)) => {
                ws_opt = Some(ws);
                break;
            }
            Err(e) => {
                last_ws_err = e.to_string();
                tokio::time::sleep(Duration::from_millis(120 + attempt * 40)).await;
            }
        }
    }
    let ws = match ws_opt {
        Some(ws) => ws,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "连接 CDP WebSocket 失败: {last_ws_err} (url={ws_url})"
            ));
        }
    };

    let mut session = CdpSession {
        child,
        port,
        browser_path,
        profile_dir,
        ephemeral_profile,
        ws,
        next_id: AtomicU64::new(1),
        session_id: None,
        current_url: None,
        pending_dialog: None,
    };

    if let Err(e) = attach_page_session(&mut session, &start_url).await {
        stop_session(&mut session).await;
        return Err(format!("附着页面会话失败: {e}"));
    }
    if let Err(e) = ensure_domains(&mut session).await {
        stop_session(&mut session).await;
        return Err(format!("启用 CDP 域失败: {e}"));
    }
    if start_url != "about:blank" {
        if let Err(e) = wait_for_page_load(&mut session, wait_until, load_timeout_ms).await {
            stop_session(&mut session).await;
            return Err(e);
        }
    }
    Ok(session)
}

async fn stop_session(session: &mut CdpSession) {
    // Browser.close on the browser connection (no page sessionId).
    let sid = session.session_id.take();
    let _ = cdp_send(session, "Browser.close", json!({})).await;
    session.session_id = sid;
    let _ = session.ws.close(None).await;
    let _ = session.child.kill();
    let _ = session.child.wait();
    clear_profile_locks(&session.profile_dir);
    if session.ephemeral_profile {
        let _ = std::fs::remove_dir_all(&session.profile_dir);
    }
}

fn ok_result(message: impl Into<String>) -> CdpActionResult {
    CdpActionResult {
        ok: true,
        message: message.into(),
        url: None,
        title: None,
        content: None,
        screenshot_path: None,
        screenshot_base64: None,
        value: None,
    }
}

#[tauri::command]
pub async fn cdp_browser_status(
    state: State<'_, CdpBrowserState>,
) -> Result<CdpBrowserStatus, String> {
    let guard = state.inner.lock().await;
    if let Some(session) = guard.as_ref() {
        Ok(CdpBrowserStatus {
            running: true,
            enabled_note: "CDP session active".into(),
            browser_path: Some(session.browser_path.display().to_string()),
            debugging_port: Some(session.port),
            current_url: session.current_url.clone(),
            title: None,
        })
    } else {
        let browser = find_browser_executable().ok();
        Ok(CdpBrowserStatus {
            running: false,
            enabled_note: if browser.is_some() {
                "Browser found, session idle".into()
            } else {
                "Chrome/Edge not found".into()
            },
            browser_path: browser.map(|p| p.display().to_string()),
            debugging_port: None,
            current_url: None,
            title: None,
        })
    }
}

#[tauri::command]
pub async fn cdp_browser_start(
    state: State<'_, CdpBrowserState>,
    url: Option<String>,
    wait_until: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<CdpActionResult, String> {
    let load_wait = PageLoadWait::from_str(wait_until.as_deref());
    let load_timeout = timeout_ms.unwrap_or(30_000);
    let mut guard = state.inner.lock().await;
    if guard.is_some() {
        if let Some(u) = url.as_ref().filter(|s| !s.is_empty()) {
            let session = guard.as_mut().unwrap();
            page_navigate(session, u, load_wait, load_timeout).await?;
            let title = page_title(session).await.unwrap_or_default();
            let mut result = ok_result(format!("已导航到: {u}"));
            result.url = Some(u.clone());
            result.title = Some(title);
            return Ok(result);
        }
        let session = guard.as_ref().unwrap();
        let mut result = ok_result("CDP 浏览器已在运行");
        result.url = session.current_url.clone();
        return Ok(result);
    }

    let mut session = start_session(url.clone(), load_wait, load_timeout).await?;
    if let Some(u) = url.as_ref().filter(|s| !s.is_empty() && *s != "about:blank") {
        // already opened with start_url
        let _ = u;
    }
    let current = page_url(&mut session).await.unwrap_or_else(|_| {
        url.clone().unwrap_or_else(|| "about:blank".into())
    });
    let title = page_title(&mut session).await.unwrap_or_default();
    let path = session.browser_path.display().to_string();
    *guard = Some(session);

    let mut result = ok_result(format!("已启动 CDP 浏览器: {path}"));
    result.url = Some(current);
    result.title = Some(title);
    Ok(result)
}

#[tauri::command]
pub async fn cdp_browser_stop(state: State<'_, CdpBrowserState>) -> Result<CdpActionResult, String> {
    let mut guard = state.inner.lock().await;
    if let Some(mut session) = guard.take() {
        stop_session(&mut session).await;
        Ok(ok_result("已关闭 CDP 浏览器"))
    } else {
        Ok(ok_result("CDP 浏览器未运行"))
    }
}

#[tauri::command]
pub async fn cdp_browser_navigate(
    state: State<'_, CdpBrowserState>,
    url: String,
    wait_until: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<CdpActionResult, String> {
    let mut guard = state.inner.lock().await;
    let session = guard
        .as_mut()
        .ok_or_else(|| "CDP 浏览器未启动，请先 open/start".to_string())?;
    page_navigate(
        session,
        &url,
        PageLoadWait::from_str(wait_until.as_deref()),
        timeout_ms.unwrap_or(30_000),
    )
    .await?;
    let title = page_title(session).await.unwrap_or_default();
    let mut result = ok_result(format!("已导航到: {url}"));
    result.url = Some(url);
    result.title = Some(title);
    Ok(result)
}

#[tauri::command]
pub async fn cdp_browser_handle_alert(
    state: State<'_, CdpBrowserState>,
    dialog_action: String,
    prompt_text: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<CdpActionResult, String> {
    let mut guard = state.inner.lock().await;
    let session = guard
        .as_mut()
        .ok_or_else(|| "CDP 浏览器未启动".to_string())?;
    handle_javascript_dialog(
        session,
        dialog_action.trim(),
        prompt_text.as_deref(),
        timeout_ms.unwrap_or(5_000),
    )
    .await
}

#[tauri::command]
pub async fn cdp_browser_click(
    state: State<'_, CdpBrowserState>,
    selector: String,
) -> Result<CdpActionResult, String> {
    let mut guard = state.inner.lock().await;
    let session = guard
        .as_mut()
        .ok_or_else(|| "CDP 浏览器未启动".to_string())?;
    click_selector(session, &selector).await?;
    Ok(ok_result(format!("已点击: {selector}")))
}

#[tauri::command]
pub async fn cdp_browser_hover(
    state: State<'_, CdpBrowserState>,
    selector: String,
    timeout_ms: Option<u64>,
) -> Result<CdpActionResult, String> {
    let mut guard = state.inner.lock().await;
    let session = guard
        .as_mut()
        .ok_or_else(|| "CDP 浏览器未启动".to_string())?;
    let wait_timeout = timeout_ms.unwrap_or(10_000);
    wait_for_selector(session, &selector, wait_timeout).await?;
    hover_selector(session, &selector).await?;
    Ok(ok_result(format!("已悬停: {selector}")))
}

#[tauri::command]
pub async fn cdp_browser_type(
    state: State<'_, CdpBrowserState>,
    selector: String,
    text: String,
    clear: Option<bool>,
    timeout_ms: Option<u64>,
) -> Result<CdpActionResult, String> {
    let mut guard = state.inner.lock().await;
    let session = guard
        .as_mut()
        .ok_or_else(|| "CDP 浏览器未启动".to_string())?;
    let wait_timeout = timeout_ms.unwrap_or(10_000);
    wait_for_selector(session, &selector, wait_timeout).await?;
    type_selector(session, &selector, &text, clear.unwrap_or(false)).await?;
    Ok(ok_result(format!("已输入到 {selector}")))
}

#[tauri::command]
pub async fn cdp_browser_scroll(
    state: State<'_, CdpBrowserState>,
    selector: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
    scroll_mode: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<CdpActionResult, String> {
    let mut guard = state.inner.lock().await;
    let session = guard
        .as_mut()
        .ok_or_else(|| "CDP 浏览器未启动".to_string())?;
    let scroll_by = scroll_mode.as_deref().map(str::trim).eq(&Some("by"));
    match selector.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(sel) => {
            let wait_timeout = timeout_ms.unwrap_or(10_000);
            wait_for_selector(session, sel, wait_timeout).await?;
            scroll_page(session, Some(sel), None, None, false).await?;
            Ok(ok_result(format!("已滚动到元素: {sel}")))
        }
        None => {
            if x.is_none() && y.is_none() {
                return Err("scroll 需要 selector 或 x/y 坐标".into());
            }
            scroll_page(session, None, x, y, scroll_by).await?;
            let mode = if scroll_by { "scroll_by" } else { "scroll_to" };
            Ok(ok_result(format!(
                "已滚动 ({mode}): x={}, y={}",
                x.unwrap_or(0.0),
                y.unwrap_or(0.0)
            )))
        }
    }
}

#[tauri::command]
pub async fn cdp_browser_select(
    state: State<'_, CdpBrowserState>,
    selector: String,
    value: Option<String>,
    index: Option<i32>,
    label: Option<String>,
    text: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<CdpActionResult, String> {
    let has_value = value.as_deref().map(str::trim).is_some_and(|s| !s.is_empty());
    let has_index = index.is_some();
    let has_label = label.as_deref().map(str::trim).is_some_and(|s| !s.is_empty());
    let has_text = text.as_deref().map(str::trim).is_some_and(|s| !s.is_empty());
    let chosen = [has_value, has_index, has_label, has_text]
        .into_iter()
        .filter(|v| *v)
        .count();
    if chosen != 1 {
        return Err("select 需要且只能指定 value、index、label 或 text 之一".into());
    }

    let option_text = if has_label {
        label.as_deref().map(str::trim)
    } else if has_text {
        text.as_deref().map(str::trim)
    } else {
        None
    };

    let mut guard = state.inner.lock().await;
    let session = guard
        .as_mut()
        .ok_or_else(|| "CDP 浏览器未启动".to_string())?;
    let wait_timeout = timeout_ms.unwrap_or(10_000);
    wait_for_selector(session, &selector, wait_timeout).await?;
    select_option(
        session,
        &selector,
        if has_value {
            value.as_deref().map(str::trim)
        } else {
            None
        },
        if has_index { index } else { None },
        option_text,
    )
    .await?;
    Ok(ok_result(format!("已选择: {selector}")))
}

#[tauri::command]
pub async fn cdp_browser_press_key(
    state: State<'_, CdpBrowserState>,
    key: String,
) -> Result<CdpActionResult, String> {
    let mut guard = state.inner.lock().await;
    let session = guard
        .as_mut()
        .ok_or_else(|| "CDP 浏览器未启动".to_string())?;
    press_key(session, &key).await?;
    Ok(ok_result(format!("已按键: {key}")))
}

#[tauri::command]
pub async fn cdp_browser_content(
    state: State<'_, CdpBrowserState>,
) -> Result<CdpActionResult, String> {
    let mut guard = state.inner.lock().await;
    let session = guard
        .as_mut()
        .ok_or_else(|| "CDP 浏览器未启动".to_string())?;
    let content = page_content(session).await?;
    let url = page_url(session).await.ok();
    let title = page_title(session).await.ok();
    let mut result = ok_result(format!("已获取页面 HTML ({} bytes)", content.len()));
    result.content = Some(content);
    result.url = url;
    result.title = title;
    Ok(result)
}

#[tauri::command]
pub async fn cdp_browser_evaluate(
    state: State<'_, CdpBrowserState>,
    expression: String,
    handle_dialog: Option<bool>,
) -> Result<CdpActionResult, String> {
    let mut guard = state.inner.lock().await;
    let session = guard
        .as_mut()
        .ok_or_else(|| "CDP 浏览器未启动".to_string())?;
    let intercept = handle_dialog.unwrap_or(true);
    let value = evaluate_js(session, &expression, intercept).await?;
    let dialog_opened = value
        .get("dialogOpened")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let dialog_auto = value
        .get("dialogAutoHandled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let mut result = if dialog_opened && dialog_auto {
        ok_result(
            "evaluate 完成（已拦截 alert/confirm/prompt，无需 handle_alert）".to_string(),
        )
    } else if dialog_opened {
        ok_result(
            "evaluate 触发了 JavaScript 弹窗，请先调用 handle_alert 再继续".to_string(),
        )
    } else {
        ok_result("evaluate 完成".to_string())
    };
    if dialog_opened {
        if let Some(dialogs) = value.get("dialogs").and_then(|v| v.as_array()) {
            if let Some(first) = dialogs.first() {
                if let Some(msg) = first.get("message").and_then(|v| v.as_str()) {
                    result.content = Some(msg.to_string());
                }
            }
        } else if let Some(msg) = value.get("dialogMessage").and_then(|v| v.as_str()) {
            result.content = Some(msg.to_string());
        }
    }
    result.value = Some(value);
    Ok(result)
}

#[tauri::command]
pub async fn cdp_browser_wait_for_selector(
    state: State<'_, CdpBrowserState>,
    selector: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<CdpActionResult, String> {
    let timeout = timeout_ms.unwrap_or(10_000);
    let mut guard = state.inner.lock().await;
    let session = guard
        .as_mut()
        .ok_or_else(|| "CDP 浏览器未启动".to_string())?;
    match selector.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => {
            sleep_ms(timeout).await;
            Ok(ok_result(format!("已等待 {timeout}ms")))
        }
        Some(sel) => {
            wait_for_selector(session, sel, timeout).await?;
            Ok(ok_result(format!("选择器已出现: {sel}")))
        }
    }
}

#[tauri::command]
pub async fn cdp_browser_screenshot(
    state: State<'_, CdpBrowserState>,
    full_page: Option<bool>,
    include_base64: Option<bool>,
) -> Result<CdpActionResult, String> {
    let mut guard = state.inner.lock().await;
    let session = guard
        .as_mut()
        .ok_or_else(|| "CDP 浏览器未启动".to_string())?;
    let full_page = full_page.unwrap_or(false);
    let (path, b64) = capture_screenshot(session, full_page).await?;
    let mode_label = if full_page { "整页" } else { "可见区域" };
    let mut result = ok_result(format!("{mode_label}截图已保存: {}", path.display()));
    result.screenshot_path = Some(path.display().to_string());
    if include_base64.unwrap_or(false) {
        result.screenshot_base64 = Some(b64);
    }
    Ok(result)
}

#[tauri::command]
pub async fn cdp_browser_refresh(
    state: State<'_, CdpBrowserState>,
) -> Result<CdpActionResult, String> {
    let mut guard = state.inner.lock().await;
    let session = guard
        .as_mut()
        .ok_or_else(|| "CDP 浏览器未启动".to_string())?;
    cdp_send(session, "Page.reload", json!({ "ignoreCache": false })).await?;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let url = page_url(session).await.ok();
    let mut result = ok_result("已刷新页面");
    result.url = url;
    Ok(result)
}

/// Resolve browser binary without starting a session (for UI).
#[tauri::command]
pub fn cdp_browser_detect() -> Result<CdpBrowserStatus, String> {
    match find_browser_executable() {
        Ok(path) => Ok(CdpBrowserStatus {
            running: false,
            enabled_note: "Browser detected".into(),
            browser_path: Some(path.display().to_string()),
            debugging_port: None,
            current_url: None,
            title: None,
        }),
        Err(e) => Ok(CdpBrowserStatus {
            running: false,
            enabled_note: e,
            browser_path: None,
            debugging_port: None,
            current_url: None,
            title: None,
        }),
    }
}

