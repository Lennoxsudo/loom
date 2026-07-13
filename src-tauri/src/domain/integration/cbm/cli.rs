use std::collections::HashSet;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::{LazyLock, Mutex, RwLock};
use std::thread;
use std::time::Duration;

use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};

use super::path::{adapt_cbm_cli_json, cbm_cache_dir, normalize_repo_path, resolve_cbm_executable};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// RwLock for CBM CLI invocations.
/// Write operations (index_repository, delete_project) acquire write lock.
/// Read operations (search, trace, status, list, etc.) acquire read lock,
/// allowing concurrent queries while serializing write operations.
/// Uses poison recovery — if a previous holder panicked,
/// we still acquire the lock via into_inner() to avoid permanent breakage.
static CBM_CLI_LOCK: RwLock<()> = RwLock::new(());

/// CBM CLI tools that perform write operations (SQLite write transactions).
const WRITE_CLI_TOOLS: &[&str] = &["index_repository", "delete_project"];

/// Check if the given CLI args contain a write operation.
fn is_write_operation(extra_args: &[&str]) -> bool {
    extra_args.iter().any(|a| WRITE_CLI_TOOLS.contains(a))
}
static ACTIVE_CBM_PIDS: LazyLock<Mutex<HashSet<u32>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

fn track_cbm_child(pid: u32) {
    if let Ok(mut set) = ACTIVE_CBM_PIDS.lock() {
        set.insert(pid);
    }
}

fn untrack_cbm_child(pid: u32) {
    if let Ok(mut set) = ACTIVE_CBM_PIDS.lock() {
        set.remove(&pid);
    }
}

/// Kill in-flight CBM CLI children (e.g. background indexing) during app shutdown.
pub fn shutdown_running_cli_processes() {
    let pids: Vec<u32> = ACTIVE_CBM_PIDS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .drain()
        .collect();
    for pid in pids {
        kill_child_process(pid);
    }
}

/// Default timeout for read-only graph operations (search, trace, etc.).
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);

/// Timeout for indexing operations (can be very slow on large repos).
const INDEX_TIMEOUT: Duration = Duration::from_secs(1800);

/// Entry point for CBM CLI calls. Selects timeout and lock type based on operation.
/// Write operations (index_repository, delete_project) acquire write lock;
/// read operations acquire read lock, allowing concurrent queries.
pub fn run_cbm_with_args(app: &AppHandle, extra_args: &[&str]) -> Result<String, String> {
    let is_write = is_write_operation(extra_args);
    let timeout = if extra_args.iter().any(|a| *a == "index_repository") {
        INDEX_TIMEOUT
    } else {
        DEFAULT_TIMEOUT
    };

    // Acquire read or write lock with poison recovery.
    // RwLockReadGuard and RwLockWriteGuard are distinct types, so we
    // duplicate the call rather than unifying into a single variable.
    if is_write {
        let _guard = CBM_CLI_LOCK
            .write()
            .unwrap_or_else(|e| e.into_inner());
        run_cbm_with_timeout_unlocked(app, extra_args, timeout)
    } else {
        let _guard = CBM_CLI_LOCK
            .read()
            .unwrap_or_else(|e| e.into_inner());
        run_cbm_with_timeout_unlocked(app, extra_args, timeout)
    }
}

fn apply_cbm_command_env(cmd: &mut Command, cache_dir: &std::path::Path) {
    cmd.env("CBM_CACHE_DIR", cache_dir);
    cmd.env(
        "CBM_LOG_LEVEL",
        std::env::var("LOOM_CBM_LOG_LEVEL").unwrap_or_else(|_| "warn".into()),
    );
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

fn kill_child_process(pid: u32) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status();
    }
}

/// Wait for a child process with a timeout. Safe to call from Tokio worker threads.
fn wait_child_with_timeout(
    child: std::process::Child,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    let pid = child.id();
    track_cbm_child(pid);
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });

    let result = match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(e)) => Err(format!("等待 codebase-memory 退出失败: {e}")),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            kill_child_process(pid);
            Err(format!(
                "codebase-memory 超时（{}s）",
                timeout.as_secs()
            ))
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("等待 codebase-memory 线程异常退出".into())
        }
    };
    untrack_cbm_child(pid);
    result
}

pub(crate) fn run_cbm_with_timeout_unlocked(
    app: &AppHandle,
    extra_args: &[&str],
    timeout: Duration,
) -> Result<String, String> {
    let executable = resolve_cbm_executable(app)?;
    let cache_dir = cbm_cache_dir()?;

    let mut cmd = Command::new(&executable);
    cmd.args(extra_args);
    apply_cbm_command_env(&mut cmd, &cache_dir);

    let child = cmd
        .spawn()
        .map_err(|e| format!("启动 codebase-memory 失败: {e}"))?;

    let output = wait_child_with_timeout(child, timeout)?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        if !stdout.is_empty() {
            return Ok(stdout);
        }
        return Ok("{}".to_string());
    }

    // Prefer structured JSON error on stdout over stderr log noise from CBM.
    let message = if !stdout.is_empty() {
        stdout
    } else if !stderr.is_empty() {
        stderr
    } else {
        format!("CBM CLI 退出码 {}", output.status)
    };
    Err(format_cbm_cli_error(&message))
}

/// Format CBM CLI JSON or plain-text errors for Agent-visible messages.
pub fn format_cbm_cli_error(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        if let Some(obj) = value.as_object() {
            let mut parts: Vec<String> = Vec::new();
            if let Some(err) = obj.get("error").and_then(|v| v.as_str()) {
                parts.push(err.to_string());
            } else if let Some(msg) = obj.get("message").and_then(|v| v.as_str()) {
                parts.push(msg.to_string());
            }
            if let Some(hint) = obj.get("hint").and_then(|v| v.as_str()) {
                if !hint.is_empty() {
                    parts.push(format!("Hint: {hint}"));
                }
            }
            if let Some(projects) = obj.get("available_projects") {
                let names: Vec<String> = match projects {
                    Value::Array(items) => items
                        .iter()
                        .filter_map(|p| {
                            p.as_str().map(String::from).or_else(|| {
                                p.get("name")
                                    .or_else(|| p.get("project"))
                                    .and_then(|v| v.as_str())
                                    .map(String::from)
                            })
                        })
                        .collect(),
                    Value::String(s) => vec![s.clone()],
                    _ => Vec::new(),
                };
                if !names.is_empty() {
                    parts.push(format!("Available projects: {}", names.join(", ")));
                }
            }
            if !parts.is_empty() {
                return parts.join(" — ");
            }
        }
    }
    trimmed.to_string()
}

/// Returns true when a failure should count toward the circuit breaker.
pub(crate) fn is_cbm_transient_failure(err: &str) -> bool {
    let trimmed = err.trim();
    let lower = trimmed.to_lowercase();

    const TRANSIENT: &[&str] = &[
        "超时",
        "timeout",
        "启动 codebase-memory 失败",
        "等待 codebase-memory 退出失败",
        "cbm 任务执行失败",
        "cbm cli 退出码",
    ];
    if TRANSIENT.iter().any(|p| lower.contains(p)) {
        return true;
    }

    const NON_TRANSIENT: &[&str] = &[
        "project not found",
        "project is required",
        "repo_path is required",
        "no indexed projects",
        "not indexed",
        "不支持的 graph",
        "无法映射 cbm cli",
        "cbm 参数",
        "cbm cli 参数",
        "sidecar 不可用",
        "项目路径不存在",
    ];
    if NON_TRANSIENT.iter().any(|p| lower.contains(p)) {
        return false;
    }

    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        if value.get("error").is_some() {
            return false;
        }
    }

    true
}

fn projects_from_list_value(value: &Value) -> Vec<&Value> {
    if let Some(array) = value.as_array() {
        return array.iter().collect();
    }
    if let Some(array) = value.get("projects").and_then(|v| v.as_array()) {
        return array.iter().collect();
    }
    if let Some(array) = value.get("results").and_then(|v| v.as_array()) {
        return array.iter().collect();
    }
    Vec::new()
}

fn repo_path_from_project_entry(project: &Value) -> Option<String> {
    for key in ["repo_path", "root_path", "path", "root", "project_path"] {
        if let Some(value) = project.get(key).and_then(|v| v.as_str()) {
            return Some(value.to_string());
        }
    }
    None
}

/// CBM CLI tools that scope queries by internal `project` slug (not `repo_path`).
const PROJECT_SCOPED_CLI_TOOLS: &[&str] = &[
    "index_status",
    "search_graph",
    "query_graph",
    "get_code_snippet",
    "trace_path",
    "get_architecture",
    "detect_changes",
    "get_graph_schema",
    "search_code",
];

fn parse_cli_args_map(args_json: Option<&str>) -> Result<Map<String, Value>, String> {
    match args_json.filter(|s| !s.trim().is_empty()) {
        None => Ok(Map::new()),
        Some(s) => serde_json::from_str::<Value>(s)
            .map_err(|e| format!("CBM CLI 参数 JSON 解析失败: {e}"))
            .and_then(|value| match value {
                Value::Object(map) => Ok(map),
                _ => Err("CBM CLI 参数必须是 JSON 对象".into()),
            }),
    }
}

fn normalized_invoke_repo_path(repo_path: &str) -> Option<String> {
    let json = serde_json::json!({ "repo_path": repo_path }).to_string();
    let adapted = adapt_cbm_cli_json(&json).ok()?;
    let value: Value = serde_json::from_str(&adapted).ok()?;
    value
        .get("repo_path")
        .and_then(|v| v.as_str())
        .map(normalize_repo_path)
}

fn list_projects_value(app: &AppHandle) -> Result<Value, String> {
    let raw = try_run_cbm_cli(app, "list_projects", None)?.ok_or_else(|| {
        "no indexed projects; run graph_index action=index first".to_string()
    })?;
    Ok(serde_json::from_str(&raw).unwrap_or(Value::Null))
}

fn find_project_name_by_slug(app: &AppHandle, slug: &str) -> Result<String, String> {
    let trimmed = slug.trim();
    if trimmed.is_empty() {
        return Err("project is required".into());
    }
    let value = list_projects_value(app)?;
    let projects = projects_from_list_value(&value);
    for project in &projects {
        if project
            .get("name")
            .and_then(|v| v.as_str())
            .is_some_and(|name| name == trimmed)
        {
            return Ok(trimmed.to_string());
        }
    }
    if let Some(actual) = super::project_path::resolve_project_slug_alias(trimmed, &projects) {
        return Ok(actual);
    }
    Err(format!(
        "project not found: {trimmed}; run graph_index action=list"
    ))
}

fn cached_project_slug_for_path(app: &AppHandle, normalized_path: &str) -> Option<String> {
    app.try_state::<super::state::CbmState>()
        .and_then(|state| state.get_cached_project_slug(normalized_path))
}

fn store_project_slug_for_path(app: &AppHandle, normalized_path: &str, slug: &str) {
    if let Some(state) = app.try_state::<super::state::CbmState>() {
        state.cache_project_slug(normalized_path.to_string(), slug.to_string());
    }
}

fn find_project_name_for_repo_path(app: &AppHandle, repo_path: &str) -> Result<String, String> {
    let trimmed = repo_path.trim();
    if trimmed.is_empty() {
        return Err("repo_path is required".into());
    }
    let normalized_input = normalize_repo_path(trimmed);

    if let Some(cached) = cached_project_slug_for_path(app, &normalized_input) {
        return Ok(cached);
    }

    let normalized_invoke = normalized_invoke_repo_path(trimmed);

    let value = list_projects_value(app)?;
    for project in projects_from_list_value(&value) {
        let Some(root) = repo_path_from_project_entry(project) else {
            continue;
        };
        let user_root = super::project_path::resolve_stored_repo_path(&root);
        let normalized_root = normalize_repo_path(&root);
        let normalized_user_root = normalize_repo_path(&user_root);
        let path_matches = normalized_root == normalized_input
            || normalized_user_root == normalized_input
            || normalized_invoke
                .as_ref()
                .is_some_and(|invoke| *invoke == normalized_root);
        if !path_matches {
            continue;
        }
        if let Some(name) = project
            .get("name")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            store_project_slug_for_path(app, &normalized_input, name);
            return Ok(name.to_string());
        }
    }

    Err(format!(
        "project not found for path: {normalized_input}; run graph_index action=list"
    ))
}

fn resolve_project_slug_from_map(
    app: &AppHandle,
    map: &Map<String, Value>,
) -> Result<String, String> {
    if let Some(name) = map
        .get("project")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        return find_project_name_by_slug(app, name);
    }

    if let Some(id) = map
        .get("project_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        return find_project_name_by_slug(app, id);
    }

    let repo_path = map
        .get("repo_path")
        .and_then(|v| v.as_str())
        .or_else(|| map.get("path").and_then(|v| v.as_str()));

    match repo_path {
        Some(path) => find_project_name_for_repo_path(app, path),
        None => Err("project or repo_path is required".into()),
    }
}

/// CBM 0.8.x query tools require `{ "project": "<slug>", ... }`, not `repo_path`.
fn resolve_project_args(app: &AppHandle, args_json: Option<&str>) -> Result<String, String> {
    let mut map = parse_cli_args_map(args_json)?;
    let project = resolve_project_slug_from_map(app, &map)?;

    map.remove("repo_path");
    map.remove("path");
    map.remove("project_id");
    map.insert("project".to_string(), Value::String(project));

    serde_json::to_string(&Value::Object(map))
        .map_err(|e| format!("CBM 参数序列化失败: {e}"))
}

/// CBM 0.8.x `delete_project` requires `{ "project": "<slug>" }`, not `repo_path`.
fn resolve_delete_project_args(app: &AppHandle, args_json: Option<&str>) -> Result<String, String> {
    let map = parse_cli_args_map(args_json)?;
    let project = resolve_project_slug_from_map(app, &map)?;
    Ok(serde_json::json!({ "project": project }).to_string())
}

fn resolve_cli_json_for_tool(
    app: &AppHandle,
    tool_name: &str,
    args_json: Option<&str>,
) -> Result<Option<String>, String> {
    if tool_name == "delete_project" {
        return Ok(Some(resolve_delete_project_args(app, args_json)?));
    }
    if PROJECT_SCOPED_CLI_TOOLS.contains(&tool_name) {
        return Ok(Some(resolve_project_args(app, args_json)?));
    }
    prepare_cli_json(args_json)
}

fn prepare_cli_json(args_json: Option<&str>) -> Result<Option<String>, String> {
    match args_json {
        None => Ok(None),
        Some(s) if s.trim().is_empty() => Ok(None),
        Some(s) => adapt_cbm_cli_json(s).map(Some),
    }
}

pub fn run_cbm_cli(app: &AppHandle, tool_name: &str, args_json: Option<&str>) -> Result<String, String> {
    let resolved_json = resolve_cli_json_for_tool(app, tool_name, args_json)?;

    let mut args = vec!["cli", tool_name];
    if let Some(json) = resolved_json.as_ref() {
        if !json.trim().is_empty() {
            args.push(json);
        }
    }
    run_cbm_with_args(app, &args)
}

/// Like `run_cbm_cli`, but returns `Ok(None)` when the global CLI lock is busy
/// (e.g. a long `index_repository` is in progress).
/// Read operations use try_read; write operations use try_write.
/// For delete_project, args are resolved before acquiring the lock to avoid
/// re-entrant lock acquisition (resolve_delete_project_args calls try_run_cbm_cli
/// for list_projects internally).
pub fn try_run_cbm_cli(
    app: &AppHandle,
    tool_name: &str,
    args_json: Option<&str>,
) -> Result<Option<String>, String> {
    // For delete_project / project-scoped tools, resolve args first (may call
    // try_run_cbm_cli for list_projects) before acquiring the lock.
    let resolved_json = resolve_cli_json_for_tool(app, tool_name, args_json)?;

    let is_write = WRITE_CLI_TOOLS.contains(&tool_name);

    let mut args: Vec<String> = vec!["cli".into(), tool_name.to_string()];
    if let Some(json) = resolved_json.as_ref() {
        if !json.trim().is_empty() {
            args.push(json.clone());
        }
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let timeout = if tool_name == "index_repository" {
        INDEX_TIMEOUT
    } else {
        DEFAULT_TIMEOUT
    };

    // RwLockReadGuard and RwLockWriteGuard are distinct types;
    // acquire in separate branches and call run_cbm_with_timeout_unlocked in each.
    if is_write {
        let _guard = match CBM_CLI_LOCK.try_write() {
            Ok(guard) => guard,
            Err(_) => return Ok(None),
        };
        run_cbm_with_timeout_unlocked(app, &arg_refs, timeout).map(Some)
    } else {
        let _guard = match CBM_CLI_LOCK.try_read() {
            Ok(guard) => guard,
            Err(_) => return Ok(None),
        };
        run_cbm_with_timeout_unlocked(app, &arg_refs, timeout).map(Some)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepare_cli_json_none_returns_none() {
        assert_eq!(prepare_cli_json(None).unwrap(), None);
        assert_eq!(prepare_cli_json(Some("  ")).unwrap(), None);
    }

    #[test]
    fn prepare_cli_json_adapts_repo_path() {
        let input = r#"{"repo_path":"D:/project/foo"}"#;
        let output = prepare_cli_json(Some(input)).unwrap().expect("json");
        assert_eq!(output, input);
    }

    #[test]
    fn prepare_cli_json_propagates_invalid_json_error() {
        assert!(prepare_cli_json(Some("not-json")).is_err());
    }

    #[test]
    fn adapt_cbm_cli_json_empty_object_unchanged() {
        let output = super::super::path::adapt_cbm_cli_json("{}").unwrap();
        assert_eq!(output, "{}");
    }

    #[test]
    fn rw_lock_recovers_from_poison() {
        // Use a local lock to avoid interference from parallel tests sharing CBM_CLI_LOCK.
        let lock = RwLock::new(());
        {
            let _a = lock.write().unwrap();
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                panic!("intentional poison test");
            }));
            // _a dropped here while poisoned.
        }
        // The lock should be recoverable via into_inner (same logic as production code).
        let guard = lock.write().unwrap_or_else(|e| e.into_inner());
        drop(guard);
    }

    #[test]
    fn rw_lock_allows_concurrent_reads() {
        let lock = RwLock::new(());
        let g1 = lock.read().unwrap();
        let g2 = lock.try_read();
        assert!(g2.is_ok());
        drop(g1);
        drop(g2);
    }

    #[test]
    fn rw_lock_blocks_write_during_read() {
        let lock = RwLock::new(());
        let g1 = lock.read().unwrap();
        let g2 = lock.try_write();
        assert!(g2.is_err());
        drop(g1);
    }

    #[test]
    fn rw_lock_blocks_read_during_write() {
        let lock = RwLock::new(());
        let g1 = lock.write().unwrap();
        let g2 = lock.try_read();
        assert!(g2.is_err());
        drop(g1);
    }

    #[test]
    fn write_tools_correctly_classified() {
        assert!(is_write_operation(&["cli", "index_repository"]));
        assert!(is_write_operation(&["cli", "delete_project"]));
        assert!(!is_write_operation(&["cli", "search_graph"]));
        assert!(!is_write_operation(&["cli", "list_projects"]));
        assert!(!is_write_operation(&["cli", "config", "set", "auto_index"]));
    }

    #[test]
    fn index_timeout_is_longer_than_default() {
        assert!(INDEX_TIMEOUT > DEFAULT_TIMEOUT);
    }

    #[test]
    fn default_timeout_is_60s() {
        assert_eq!(DEFAULT_TIMEOUT, Duration::from_secs(60));
    }

    #[test]
    fn index_timeout_is_30min() {
        assert_eq!(INDEX_TIMEOUT, Duration::from_secs(1800));
    }

    #[test]
    fn projects_from_list_value_reads_nested_projects() {
        let value = serde_json::json!({
            "projects": [{ "name": "D-project-foo", "root_path": "D:/project/foo" }]
        });
        assert_eq!(projects_from_list_value(&value).len(), 1);
    }

    #[test]
    fn repo_path_from_project_entry_prefers_root_path() {
        let project = serde_json::json!({
            "name": "D-project-foo",
            "root_path": "D:/project/foo"
        });
        assert_eq!(
            repo_path_from_project_entry(&project).as_deref(),
            Some("D:/project/foo")
        );
    }

    #[test]
    fn parse_cli_args_map_rejects_non_object() {
        assert!(parse_cli_args_map(Some("[]")).is_err());
    }

    #[test]
    fn parse_cli_args_map_empty_returns_empty_map() {
        let map = parse_cli_args_map(None).unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn project_scoped_tools_include_index_status_and_search_graph() {
        assert!(PROJECT_SCOPED_CLI_TOOLS.contains(&"index_status"));
        assert!(PROJECT_SCOPED_CLI_TOOLS.contains(&"search_graph"));
        assert!(!PROJECT_SCOPED_CLI_TOOLS.contains(&"index_repository"));
        assert!(!PROJECT_SCOPED_CLI_TOOLS.contains(&"list_projects"));
    }

    #[test]
    fn project_scoped_tools_include_schema_and_code() {
        assert!(PROJECT_SCOPED_CLI_TOOLS.contains(&"get_graph_schema"));
        assert!(PROJECT_SCOPED_CLI_TOOLS.contains(&"search_code"));
    }

    #[test]
    fn resolve_project_slug_alias_matches_actual_slug() {
        let projects = vec![serde_json::json!({
            "name": "C-Users-me-AppData-invoke-links-abc123",
            "root_path": "C:/Users/me/AppData/Roaming/Loom/cbm/invoke-links/abc123"
        })];
        let refs: Vec<&serde_json::Value> = projects.iter().collect();
        assert_eq!(
            super::super::project_path::resolve_project_slug_alias(
                "C-Users-me-AppData-invoke-links-abc123",
                &refs,
            )
            .as_deref(),
            Some("C-Users-me-AppData-invoke-links-abc123")
        );
    }

    #[test]
    fn wait_child_with_timeout_collects_output() {
        #[cfg(windows)]
        let mut cmd = {
            let mut c = Command::new("cmd");
            c.args(["/C", "echo", "cbm-test"]);
            c
        };
        #[cfg(not(windows))]
        let mut cmd = {
            let mut c = Command::new("sh");
            c.args(["-c", "echo cbm-test"]);
            c
        };

        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let child = cmd.spawn().expect("spawn test command");
        let output = wait_child_with_timeout(child, Duration::from_secs(10)).expect("wait output");
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("cbm-test"));
    }

    #[tokio::test]
    async fn wait_child_with_timeout_safe_inside_tokio_runtime() {
        #[cfg(windows)]
        let mut cmd = {
            let mut c = Command::new("cmd");
            c.args(["/C", "echo", "tokio-safe"]);
            c
        };
        #[cfg(not(windows))]
        let mut cmd = {
            let mut c = Command::new("sh");
            c.args(["-c", "echo tokio-safe"]);
            c
        };

        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let child = cmd.spawn().expect("spawn test command");
        let output = wait_child_with_timeout(child, Duration::from_secs(10)).expect("wait output");
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("tokio-safe"));
    }

    /// Verify that `shutdown_running_cli_processes` kills a tracked child
    /// process, which unblocks `wait_child_with_timeout` immediately instead
    /// of waiting for the full timeout.
    ///
    /// This is the core mechanism that makes `cancel_all` → `wait_all`
    /// return within the 5s exit budget instead of blocking up to 1800s.
    #[test]
    fn shutdown_running_cli_processes_unblocks_wait_child_with_timeout() {
        // Spawn a long-running process (60s) that would normally block
        // wait_child_with_timeout for the full duration.
        #[cfg(windows)]
        let mut cmd = {
            let mut c = Command::new("cmd");
            c.args(["/C", "ping", "-n", "60", "127.0.0.1"]);
            c
        };
        #[cfg(not(windows))]
        let mut cmd = {
            let mut c = Command::new("sh");
            c.args(["-c", "sleep 60"]);
            c
        };

        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let child = cmd.spawn().expect("spawn long-running process");

        // wait_child_with_timeout runs in a separate thread so we can
        // call shutdown_running_cli_processes from this thread.
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let result = wait_child_with_timeout(child, Duration::from_secs(60));
            let _ = tx.send(result);
        });

        // Give the thread time to enter recv_timeout and track the PID.
        thread::sleep(Duration::from_millis(200));

        // Kill all tracked CBM CLI processes — this should cause the
        // long-running process to exit, unblocking recv_timeout.
        shutdown_running_cli_processes();

        // If the unblock works, we get a result within 10s (not 60s).
        // If it doesn't work, this will hang for 60s and fail the test.
        let start = std::time::Instant::now();
        let result = rx
            .recv_timeout(Duration::from_secs(10))
            .expect("wait_child_with_timeout should return within 10s after kill");
        let elapsed = start.elapsed();

        // The result should arrive quickly (process was killed, not timed out).
        assert!(
            elapsed < Duration::from_secs(5),
            "should unblock within 5s after kill, took {elapsed:?}"
        );

        // The process was killed, so the exit status should be non-zero.
        // wait_child_with_timeout returns Ok(Output) when the process exits
        // (even if killed), not Err — Err is only for timeout/disconnect.
        match &result {
            Ok(output) => {
                assert!(
                    !output.status.success(),
                    "killed process should have non-zero exit status, got: {:?}",
                    output.status
                );
            }
            Err(e) => {
                // Also acceptable — the wait itself may fail on some platforms.
                let _ = e;
            }
        }
    }

    #[test]
    fn format_cbm_cli_error_includes_hint_and_available_projects() {
        let raw = r#"{"error":"project not found","hint":"Run list_projects first","available_projects":["foo","bar"]}"#;
        let formatted = format_cbm_cli_error(raw);
        assert!(formatted.contains("project not found"));
        assert!(formatted.contains("Hint: Run list_projects first"));
        assert!(formatted.contains("Available projects: foo, bar"));
    }

    #[test]
    fn is_cbm_transient_failure_ignores_project_not_found() {
        assert!(!is_cbm_transient_failure(r#"{"error":"project not found"}"#));
        assert!(!is_cbm_transient_failure("project not found for path: d:/foo"));
        assert!(!is_cbm_transient_failure("project is required"));
    }

    #[test]
    fn is_cbm_transient_failure_counts_timeout_and_spawn_errors() {
        assert!(is_cbm_transient_failure("codebase-memory 超时（60s）"));
        assert!(is_cbm_transient_failure("启动 codebase-memory 失败: not found"));
    }
}
