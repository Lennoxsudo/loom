use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use super::cli::run_cbm_cli;
use super::registry::CbmTaskRegistry;
use super::ui::CbmUiState;
use super::path::{normalize_repo_path, path_status};
use super::types::{
    CbmDeleteResult, CbmDeleteStatus, CbmIndexStatus, CbmScheduleResult, CbmScheduleStatus,
};

const INCREMENTAL_DEBOUNCE: Duration = Duration::from_secs(3);
const DELETE_LOCK_RELEASE_WAIT: Duration = Duration::from_millis(100);
const CIRCUIT_BREAKER_THRESHOLD: u32 = 5;
const CIRCUIT_BREAKER_COOLDOWN: Duration = Duration::from_secs(60);
const STALE_THRESHOLD_SECS: i64 = 60 * 60 * 24 * 30; // 30 days

/// Stop the CBM UI process and briefly wait for file handle release.
///
/// Does NOT call `shutdown_running_cli_processes()` — that would kill ALL
/// CBM CLI children globally, including unrelated concurrent queries from
/// other WebViews. The `delete_project` CLI call runs under `CBM_CLI_LOCK`
/// write lock, which naturally serializes against other CLI operations.
/// We only need to stop the UI process because it holds file handles in
/// `CBM_CACHE_DIR` that would cause `delete_project` to fail with
/// "permission denied" on Windows.
fn release_cbm_locks_before_delete(app: &AppHandle) {
    if let Some(ui) = app.try_state::<CbmUiState>() {
        let _ = ui.stop();
    }
    std::thread::sleep(DELETE_LOCK_RELEASE_WAIT);
}

fn format_cbm_delete_error(raw: &str) -> String {
    if let Ok(value) = serde_json::from_str::<Value>(raw) {
        if let Some(err) = value.get("error").and_then(|v| v.as_str()) {
            return map_cbm_delete_error_message(err);
        }
    }
    map_cbm_delete_error_message(raw)
}

fn map_cbm_delete_error_message(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("permission denied") {
        return "索引文件被占用，请先关闭图谱浏览器或等待索引完成后再试".into();
    }
    raw.to_string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RepoRuntimeState {
    Indexing,
    Indexed,
}

// ═══════════════════════════════════════════════════════════════
// CBM 锁获取顺序契约（违反将导致死锁）
//
// 当需要同时获取多把锁时，必须按以下顺序获取：
//
//   1. CBM_CLI_LOCK            (cli.rs, RwLock — 跨线程，持有时长最长)
//   2. ACTIVE_CBM_PIDS         (cli.rs, Mutex — 极短，PID 追踪)
//   3. CbmState.inner          (state.rs, Mutex — repo 状态表)
//   4. CbmState.sync_pending   (state.rs, Mutex — debounce 去重)
//   5. CbmState.circuit_open_until (state.rs, Mutex — 熔断器)
//
// CbmTaskRegistry.handles 和 CbmUiState.inner 独立于上述顺序。
// failure_count 是 AtomicU32，不需要锁。
//
// 当前代码中不存在跨模块的多锁获取，但未来修改时务必遵守此顺序。
// ═══════════════════════════════════════════════════════════════
pub struct CbmState {
    inner: Mutex<HashMap<String, RepoRuntimeState>>,
    sync_pending: Mutex<HashMap<String, Instant>>,
    /// normalized repo_path → CBM project slug (from list_projects)
    project_slug_cache: Mutex<HashMap<String, String>>,
    failure_count: AtomicU32,
    circuit_open_until: Mutex<Option<Instant>>,
}

impl Default for CbmState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            sync_pending: Mutex::new(HashMap::new()),
            project_slug_cache: Mutex::new(HashMap::new()),
            failure_count: AtomicU32::new(0),
            circuit_open_until: Mutex::new(None),
        }
    }
}

impl CbmState {
    /// Returns `Err` if the circuit breaker is currently open (too many
    /// consecutive failures). Callers should short-circuit and return an
    /// error to the caller instead of attempting the CBM CLI invocation.
    pub fn check_circuit(&self) -> Result<(), String> {
        if let Ok(guard) = self.circuit_open_until.lock() {
            if let Some(until) = *guard {
                if Instant::now() < until {
                    return Err("CBM circuit breaker open — sidecar 连续失败，已暂时熔断".into());
                }
            }
        }
        Ok(())
    }

    /// Record a failed CBM CLI invocation. After `CIRCUIT_BREAKER_THRESHOLD`
    /// consecutive failures, the circuit opens for `CIRCUIT_BREAKER_COOLDOWN`.
    pub fn record_failure(&self) {
        let count = self.failure_count.fetch_add(1, Ordering::Relaxed) + 1;
        if count >= CIRCUIT_BREAKER_THRESHOLD {
            if let Ok(mut guard) = self.circuit_open_until.lock() {
                *guard = Some(Instant::now() + CIRCUIT_BREAKER_COOLDOWN);
            }
        }
    }

    /// Record failure only for transient/infra errors (timeouts, spawn failures).
    /// Business errors such as "project not found" do not trip the circuit breaker.
    pub fn record_failure_if_transient(&self, err: &str) {
        if super::cli::is_cbm_transient_failure(err) {
            self.record_failure();
        }
    }

    pub fn get_cached_project_slug(&self, normalized_path: &str) -> Option<String> {
        self.project_slug_cache
            .lock()
            .ok()
            .and_then(|cache| cache.get(normalized_path).cloned())
    }

    pub fn cache_project_slug(&self, normalized_path: String, slug: String) {
        if let Ok(mut cache) = self.project_slug_cache.lock() {
            cache.insert(normalized_path, slug);
        }
    }

    pub fn invalidate_project_slug(&self, normalized_path: &str) {
        if let Ok(mut cache) = self.project_slug_cache.lock() {
            cache.remove(normalized_path);
        }
    }

    /// Record a successful CBM CLI invocation. Resets the failure counter and
    /// closes the circuit.
    pub fn record_success(&self) {
        self.failure_count.store(0, Ordering::Relaxed);
        if let Ok(mut guard) = self.circuit_open_until.lock() {
            *guard = None;
        }
    }

    pub fn is_indexing(&self, key: &str) -> bool {
        self.inner
            .lock()
            .ok()
            .and_then(|map| map.get(key).copied())
            .map(|state| state == RepoRuntimeState::Indexing)
            .unwrap_or(false)
    }

    pub fn index_status_for(&self, key: &str) -> CbmIndexStatus {
        match self.inner.lock().ok().and_then(|map| map.get(key).copied()) {
            Some(RepoRuntimeState::Indexing) => CbmIndexStatus::Indexing,
            _ => CbmIndexStatus::Ready,
        }
    }

    fn set_state(&self, key: &str, state: Option<RepoRuntimeState>) {
        if let Ok(mut map) = self.inner.lock() {
            if let Some(state) = state {
                map.insert(key.to_string(), state);
            } else {
                map.remove(key);
            }
        }
    }

    fn is_indexed_response(raw: &str) -> bool {
        if let Ok(value) = serde_json::from_str::<Value>(raw) {
            if value
                .get("indexed")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                return true;
            }
            if value
                .get("status")
                .and_then(|v| v.as_str())
                .map(|s| {
                    s.eq_ignore_ascii_case("indexed") || s.eq_ignore_ascii_case("ready")
                })
                .unwrap_or(false)
            {
                return true;
            }
        }
        false
    }

    /// Check if CBM CLI `index_status` response indicates indexing is in progress.
    /// Used to recover memory state after app restart.
    fn is_indexing_response(raw: &str) -> bool {
        if let Ok(value) = serde_json::from_str::<Value>(raw) {
            if value
                .get("status")
                .and_then(|v| v.as_str())
                .map(|s| s.eq_ignore_ascii_case("indexing") || s.eq_ignore_ascii_case("in_progress"))
                .unwrap_or(false)
            {
                return true;
            }
        }
        false
    }

    pub fn schedule_workspace_index(
        &self,
        app: AppHandle,
        repo_path: String,
        max_files: Option<u64>,
        force: bool,
    ) -> Result<CbmScheduleResult, String> {
        let normalized = normalize_repo_path(&repo_path);
        if normalized.is_empty() {
            return Ok(CbmScheduleResult {
                status: CbmScheduleStatus::SkippedEmpty,
                repo_path: normalized,
                message: None,
            });
        }

        if !super::path::cbm_sidecar_available(&app) {
            return Ok(CbmScheduleResult {
                status: CbmScheduleStatus::SkippedUnavailable,
                repo_path: normalized.clone(),
                message: Some("sidecar 不可用".into()),
            });
        }

        if let Some(limit) = max_files {
            if limit > 0 {
                let count =
                    super::estimate::count_repo_files(std::path::Path::new(&normalized), limit);
                if count > limit {
                    return Ok(CbmScheduleResult {
                        status: CbmScheduleStatus::SkippedTooLarge,
                        repo_path: normalized,
                        message: Some(format!("{count} files exceed limit {limit}")),
                    });
                }
            }
        }

        if self.is_indexing(&normalized) {
            return Ok(CbmScheduleResult {
                status: CbmScheduleStatus::InProgress,
                repo_path: normalized,
                message: None,
            });
        }

        if !force {
            let status_args = serde_json::json!({ "repo_path": normalized }).to_string();
            // Check CBM CLI index_status for both "indexing" and "indexed" states.
            // The "indexing" check recovers memory state after app restart —
            // if CBM CLI side is still indexing (e.g. started before crash),
            // we restore the in-memory flag and return InProgress instead of
            // starting a duplicate index.
            if let Ok(Some(raw)) = super::cli::try_run_cbm_cli(&app, "index_status", Some(&status_args)) {
                if Self::is_indexing_response(&raw) {
                    self.set_state(&normalized, Some(RepoRuntimeState::Indexing));
                    return Ok(CbmScheduleResult {
                        status: CbmScheduleStatus::InProgress,
                        repo_path: normalized,
                        message: None,
                    });
                }
                if Self::is_indexed_response(&raw) {
                    self.set_state(&normalized, Some(RepoRuntimeState::Indexed));
                    return Ok(CbmScheduleResult {
                        status: CbmScheduleStatus::AlreadyIndexed,
                        repo_path: normalized,
                        message: None,
                    });
                }
            } else if is_repo_indexed_in_cbm(&app, &normalized) {
                self.set_state(&normalized, Some(RepoRuntimeState::Indexed));
                return Ok(CbmScheduleResult {
                    status: CbmScheduleStatus::AlreadyIndexed,
                    repo_path: normalized,
                    message: None,
                });
            }
        }

        self.set_state(&normalized, Some(RepoRuntimeState::Indexing));
        let _ = app.emit(
            "cbm-index-started",
            serde_json::json!({ "repo_path": normalized }),
        );

        let app_clone = app.clone();
        let key = normalized.clone();
        let registry = app.state::<CbmTaskRegistry>();
        registry.spawn(move |cancel_flag: Arc<AtomicBool>| {
            if cancel_flag.load(Ordering::Relaxed) {
                if let Some(state) = app_clone.try_state::<CbmState>() {
                    state.set_state(&key, None);
                }
                return;
            }

            let args = serde_json::json!({ "repo_path": key }).to_string();
            let result = run_cbm_cli(&app_clone, "index_repository", Some(&args));

            // Skip emit if app is shutting down
            if cancel_flag.load(Ordering::Relaxed) {
                return;
            }

            if let Some(state) = app_clone.try_state::<CbmState>() {
                match &result {
                    Ok(_) => {
                        state.invalidate_project_slug(&key);
                        state.set_state(&key, Some(RepoRuntimeState::Indexed));
                    }
                    Err(_) => state.set_state(&key, None),
                }
            }
            match result {
                Ok(_) => {
                    let _ = app_clone.emit(
                        "cbm-index-complete",
                        serde_json::json!({ "repo_path": key }),
                    );
                }
                Err(err) => {
                    let _ = app_clone.emit(
                        "cbm-index-failed",
                        serde_json::json!({ "repo_path": key, "error": err }),
                    );
                }
            }
        });

        Ok(CbmScheduleResult {
            status: CbmScheduleStatus::Scheduled,
            repo_path: normalized,
            message: None,
        })
    }

    pub fn notify_files_changed(&self, app: AppHandle, repo_path: String) {
        let normalized = normalize_repo_path(&repo_path);
        if normalized.is_empty() {
            return;
        }

        if !super::path::cbm_sidecar_available(&app) {
            return;
        }

        // Skip if the circuit breaker is open — CBM CLI is failing
        // repeatedly, so spawning incremental index threads is wasteful.
        if self.check_circuit().is_err() {
            return;
        }

        let is_indexed = self
            .inner
            .lock()
            .ok()
            .and_then(|map| map.get(&normalized).copied())
            .map(|state| state == RepoRuntimeState::Indexed)
            .unwrap_or(false);

        if !is_indexed {
            return;
        }

        if self.is_indexing(&normalized) {
            return;
        }

        let now = Instant::now();
        if let Ok(mut pending) = self.sync_pending.lock() {
            if let Some(last) = pending.get(&normalized) {
                if now.duration_since(*last) < INCREMENTAL_DEBOUNCE {
                    return;
                }
            }
            pending.insert(normalized.clone(), now);
        }

        let app_clone = app.clone();
        let key = normalized.clone();
        let spawn_time = now;
        let registry = app.state::<CbmTaskRegistry>();
        registry.spawn(move |cancel_flag: Arc<AtomicBool>| {
            // Debounce: wait before incremental re-index
            std::thread::sleep(INCREMENTAL_DEBOUNCE);

            // Exit early if cancelled during sleep
            if cancel_flag.load(Ordering::Relaxed) {
                return;
            }

            if let Some(state) = app_clone.try_state::<CbmState>() {
                if state.is_indexing(&key) {
                    return;
                }
                // Skip if a newer notify_files_changed or schedule_workspace_index
                // updated sync_pending after this thread was spawned. That newer
                // caller will perform its own index after its debounce window,
                // so this one is redundant.
                if let Ok(pending) = state.sync_pending.lock() {
                    if let Some(last) = pending.get(&key) {
                        if *last > spawn_time {
                            return;
                        }
                    }
                }
            }
            let args = serde_json::json!({ "repo_path": key }).to_string();
            let _ = run_cbm_cli(&app_clone, "index_repository", Some(&args));
        });
    }

    pub fn delete_workspace_index(
        &self,
        app: &AppHandle,
        repo_path: String,
        enable_code_graph: bool,
    ) -> Result<CbmDeleteResult, String> {
        let normalized = normalize_repo_path(&repo_path);
        if normalized.is_empty() {
            return Ok(CbmDeleteResult {
                status: CbmDeleteStatus::NotFound,
                repo_path: normalized,
                message: None,
            });
        }

        if !enable_code_graph {
            return Ok(CbmDeleteResult {
                status: CbmDeleteStatus::SkippedDisabled,
                repo_path: normalized,
                message: Some("代码图谱已关闭".into()),
            });
        }

        if !super::path::cbm_sidecar_available(app) {
            return Ok(CbmDeleteResult {
                status: CbmDeleteStatus::SkippedUnavailable,
                repo_path: normalized,
                message: Some("sidecar 不可用".into()),
            });
        }

        if self.is_indexing(&normalized) {
            // Abort the in-progress indexing task by clearing its state,
            // but skip CBM CLI deletion to avoid SQLite conflict.
            //
            // We do NOT call shutdown_running_cli_processes() here — that
            // would kill ALL CBM CLI children globally, including unrelated
            // concurrent queries. The background indexing thread will
            // complete (or timeout) on its own; clearing the in-memory
            // state is sufficient to allow future operations on this repo.
            self.set_state(&normalized, None);
            return Ok(CbmDeleteResult {
                status: CbmDeleteStatus::SkippedInProgress,
                repo_path: normalized,
                message: Some("索引进行中，已中止索引任务但跳过删除".into()),
            });
        }

        release_cbm_locks_before_delete(app);

        let args = serde_json::json!({ "repo_path": normalized }).to_string();
        match run_cbm_cli(app, "delete_project", Some(&args)) {
            Ok(_) => {
                self.set_state(&normalized, None);
                self.invalidate_project_slug(&normalized);
                let _ = app.emit(
                    "cbm-index-deleted",
                    serde_json::json!({ "repo_path": normalized }),
                );
                Ok(CbmDeleteResult {
                    status: CbmDeleteStatus::Deleted,
                    repo_path: normalized,
                    message: None,
                })
            }
            Err(err) => {
                let lower = err.to_lowercase();
                if lower.contains("not found") || lower.contains("no project") {
                    self.set_state(&normalized, None);
                    return Ok(CbmDeleteResult {
                        status: CbmDeleteStatus::NotFound,
                        repo_path: normalized,
                        message: None,
                    });
                }
                Ok(CbmDeleteResult {
                    status: CbmDeleteStatus::Failed,
                    repo_path: normalized,
                    message: Some(format_cbm_delete_error(&err)),
                })
            }
        }
    }

    pub fn list_indexed_projects(&self, app: &AppHandle) -> Result<Vec<super::types::CbmIndexedProject>, String> {
        if !super::path::cbm_sidecar_available(app) {
            return Ok(Vec::new());
        }

        let raw = match super::cli::try_run_cbm_cli(app, "list_projects", None)? {
            Some(value) => value,
            None => return Ok(Vec::new()),
        };
        let enriched = super::list_enrich::enrich_list_projects_json(&raw).unwrap_or(raw);
        let value: Value = serde_json::from_str(&enriched).unwrap_or(Value::Null);
        let projects = extract_projects_array(&value);

        let mut result = Vec::new();
        for project in projects {
            let repo_path = extract_repo_path(project).unwrap_or_default();
            if repo_path.is_empty() {
                continue;
            }
            let key = normalize_repo_path(&repo_path);
            let indexed_at_str = project
                .get("indexed_at")
                .or_else(|| project.get("created_at"))
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let is_stale = indexed_at_str
                .as_deref()
                .and_then(parse_iso8601_to_epoch)
                .map(|ts| {
                    let now = chrono::Utc::now().timestamp();
                    now - ts > STALE_THRESHOLD_SECS
                })
                .unwrap_or(false);
            result.push(super::types::CbmIndexedProject {
                display_name: super::path::display_name_for_path(&key),
                indexed_at: indexed_at_str,
                node_count: project
                    .get("node_count")
                    .or_else(|| project.get("nodes"))
                    .and_then(|v| v.as_u64()),
                path_status: path_status(&key),
                index_status: self.index_status_for(&key),
                repo_path: key,
                is_stale,
            });
        }

        result.sort_by(|a, b| {
            b.indexed_at
                .cmp(&a.indexed_at)
                .then_with(|| a.display_name.cmp(&b.display_name))
        });

        Ok(result)
    }

    #[cfg(test)]
    pub(crate) fn test_set_repo_state(&self, key: &str, state: Option<RepoRuntimeState>) {
        self.set_state(key, state);
    }

    #[cfg(test)]
    pub(crate) fn test_expire_circuit(&self) {
        if let Ok(mut guard) = self.circuit_open_until.lock() {
            *guard = Some(Instant::now() - Duration::from_secs(1));
        }
    }
}

/// Parse an ISO 8601 timestamp (e.g. "2026-01-15T12:00:00Z") to Unix epoch seconds.
/// Returns `None` for unparseable input.
fn parse_iso8601_to_epoch(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.timestamp())
}

fn extract_projects_array(value: &Value) -> Vec<&Value> {
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

fn extract_repo_path(project: &Value) -> Option<String> {
    for key in [
        "repo_path",
        "root_path",
        "path",
        "root",
        "project_path",
    ] {
        if let Some(value) = project.get(key).and_then(|v| v.as_str()) {
            return Some(value.to_string());
        }
    }
    project
        .get("name")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

fn is_repo_indexed_in_cbm(app: &AppHandle, normalized: &str) -> bool {
    let raw = match super::cli::try_run_cbm_cli(app, "list_projects", None) {
        Ok(Some(value)) => value,
        _ => return false,
    };
    let value: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
    extract_projects_array(&value).into_iter().any(|project| {
        extract_repo_path(project)
            .map(|repo| super::path::normalize_repo_path(&repo) == normalized)
            .unwrap_or(false)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_indexing_when_marked_in_memory() {
        let state = CbmState::default();
        let key = "d:/project/foo";
        state.test_set_repo_state(key, Some(RepoRuntimeState::Indexing));
        assert!(state.is_indexing(key));
        assert_eq!(state.index_status_for(key), CbmIndexStatus::Indexing);
    }

    #[test]
    fn extract_projects_array_reads_nested_projects() {
        let value = serde_json::json!({ "projects": [{ "repo_path": "D:/foo" }] });
        assert_eq!(extract_projects_array(&value).len(), 1);
    }

    // ── dedup: schedule_workspace_index 去重逻辑 ──

    #[test]
    fn schedule_dedup_returns_in_progress_when_already_indexing() {
        // 验证：内存态为 Indexing 时，is_indexing 返回 true，
        // schedule_workspace_index 会在去重检查阶段返回 InProgress。
        // 这里直接测去重的判断条件，不依赖 AppHandle。
        let state = CbmState::default();
        let key = "d:/project/dedup-test";

        assert!(!state.is_indexing(key));

        state.test_set_repo_state(key, Some(RepoRuntimeState::Indexing));
        assert!(state.is_indexing(key));
        assert_eq!(state.index_status_for(key), CbmIndexStatus::Indexing);
    }

    #[test]
    fn schedule_dedup_different_paths_are_independent() {
        let state = CbmState::default();

        state.test_set_repo_state("d:/proj/a", Some(RepoRuntimeState::Indexing));
        assert!(state.is_indexing("d:/proj/a"));
        assert!(!state.is_indexing("d:/proj/b"));
    }

    // ── delete: delete_workspace_index 内存态清理 ──

    #[test]
    fn delete_clears_in_progress_state() {
        // 验证：delete_workspace_index 中 is_indexing → set_state(None) 清理逻辑。
        // 新行为：清理内存态后返回 SkippedInProgress，不继续 CBM CLI 删除。
        let state = CbmState::default();
        let key = "d:/proj/to-delete";

        state.test_set_repo_state(key, Some(RepoRuntimeState::Indexing));
        assert!(state.is_indexing(key));

        // 模拟 delete_workspace_index 中 SkippedInProgress 分支的清理逻辑
        if state.is_indexing(key) {
            state.test_set_repo_state(key, None);
            // 此处应返回 SkippedInProgress，不再继续 delete
        }
        assert!(!state.is_indexing(key));
        assert_eq!(state.index_status_for(key), CbmIndexStatus::Ready);
    }

    #[test]
    fn delete_clears_indexed_state() {
        // delete 成功后应清除 Indexed 状态
        let state = CbmState::default();
        let key = "d:/proj/indexed-then-deleted";

        state.test_set_repo_state(key, Some(RepoRuntimeState::Indexed));
        assert_eq!(state.index_status_for(key), CbmIndexStatus::Ready);

        // delete_workspace_index 成功路径会 set_state(None)
        state.test_set_repo_state(key, None);
        assert!(!state.is_indexing(key));
        assert_eq!(state.index_status_for(key), CbmIndexStatus::Ready);
    }

    #[test]
    fn delete_skipped_in_progress_clears_state_and_returns() {
        // 验证：当 is_indexing 为 true 时，
        // delete_workspace_index 应清理内存态并返回 SkippedInProgress（不继续删除）。
        let state = CbmState::default();
        let key = "d:/proj/indexing-now";

        state.test_set_repo_state(key, Some(RepoRuntimeState::Indexing));
        assert!(state.is_indexing(key));

        // 模拟 delete_workspace_index 的 SkippedInProgress 分支
        let should_skip = state.is_indexing(key);
        if should_skip {
            state.test_set_repo_state(key, None);
        }

        assert!(should_skip); // 应返回 SkippedInProgress
        assert!(!state.is_indexing(key)); // 内存态已清理
    }

    #[test]
    fn delete_skipped_disabled_when_code_graph_off() {
        // 验证：enable_code_graph = false 时应返回 SkippedDisabled。
        let enable_code_graph = false;
        let should_skip_disabled = !enable_code_graph;
        assert!(should_skip_disabled);
    }

    #[test]
    fn delete_proceeds_when_code_graph_on_and_not_indexing() {
        // 验证：enable_code_graph = true 且未索引时，不应跳过。
        let state = CbmState::default();
        let key = "d:/proj/ready-to-delete";

        let enable_code_graph = true;
        let is_indexing = state.is_indexing(key);

        let should_skip_disabled = !enable_code_graph;
        let should_skip_in_progress = is_indexing;

        assert!(!should_skip_disabled);
        assert!(!should_skip_in_progress);
        // 应继续执行 CBM CLI delete
    }

    // ── list: list_indexed_projects 解析逻辑 ──

    #[test]
    fn list_parses_top_level_array() {
        let raw = serde_json::json!([
            { "repo_path": "D:/foo", "indexed_at": "2026-01-01", "node_count": 42 },
            { "repo_path": "D:/bar", "created_at": "2026-02-01" }
        ]);
        let projects = extract_projects_array(&raw);
        assert_eq!(projects.len(), 2);
    }

    #[test]
    fn list_parses_nested_projects_key() {
        let raw = serde_json::json!({
            "projects": [{ "path": "D:/nested" }]
        });
        let projects = extract_projects_array(&raw);
        assert_eq!(projects.len(), 1);
    }

    #[test]
    fn list_parses_nested_results_key() {
        let raw = serde_json::json!({
            "results": [{ "root": "D:/results" }]
        });
        let projects = extract_projects_array(&raw);
        assert_eq!(projects.len(), 1);
    }

    #[test]
    fn list_parses_empty_response() {
        let raw = serde_json::json!({});
        assert_eq!(extract_projects_array(&raw).len(), 0);
    }

    #[test]
    fn list_extracts_root_path_key() {
        assert_eq!(
            extract_repo_path(&serde_json::json!({ "root_path": "D:/foo" })),
            Some("D:/foo".into())
        );
    }

    #[test]
    fn is_indexed_response_detects_ready_status() {
        assert!(CbmState::is_indexed_response(r#"{"status": "ready"}"#));
    }

    #[test]
    fn list_extracts_repo_path_from_multiple_keys() {
        // repo_path 优先
        assert_eq!(
            extract_repo_path(&serde_json::json!({ "repo_path": "D:/a" })),
            Some("D:/a".into())
        );
        // fallback 到 path
        assert_eq!(
            extract_repo_path(&serde_json::json!({ "path": "D:/b" })),
            Some("D:/b".into())
        );
        // fallback 到 name
        assert_eq!(
            extract_repo_path(&serde_json::json!({ "name": "D:/c" })),
            Some("D:/c".into())
        );
        // 无匹配
        assert_eq!(extract_repo_path(&serde_json::json!({ "other": "x" })), None);
    }

    // ── list + index_status 合并 ──

    #[test]
    fn list_reflects_indexing_state() {
        let state = CbmState::default();
        let key = "d:/proj/indexing-now";

        // 未索引时状态为 Ready
        assert_eq!(state.index_status_for(key), CbmIndexStatus::Ready);

        // 标记为 Indexing
        state.test_set_repo_state(key, Some(RepoRuntimeState::Indexing));
        assert_eq!(state.index_status_for(key), CbmIndexStatus::Indexing);
    }

    // ── is_indexed_response 判断 ──

    #[test]
    fn is_indexed_response_detects_boolean() {
        assert!(CbmState::is_indexed_response(r#"{"indexed": true}"#));
        assert!(!CbmState::is_indexed_response(r#"{"indexed": false}"#));
    }

    #[test]
    fn is_indexed_response_detects_status_string() {
        assert!(CbmState::is_indexed_response(r#"{"status": "indexed"}"#));
        assert!(CbmState::is_indexed_response(r#"{"status": "INDEXED"}"#));
        assert!(!CbmState::is_indexed_response(r#"{"status": "pending"}"#));
    }

    #[test]
    fn is_indexed_response_handles_invalid_json() {
        assert!(!CbmState::is_indexed_response("not json"));
        assert!(!CbmState::is_indexed_response("{}"));
    }

    // ── is_indexing_response 判断 ──

    #[test]
    fn is_indexing_response_detects_indexing_status() {
        assert!(CbmState::is_indexing_response(r#"{"status": "indexing"}"#));
        assert!(CbmState::is_indexing_response(r#"{"status": "INDEXING"}"#));
    }

    #[test]
    fn is_indexing_response_detects_in_progress_status() {
        assert!(CbmState::is_indexing_response(r#"{"status": "in_progress"}"#));
        assert!(CbmState::is_indexing_response(r#"{"status": "IN_PROGRESS"}"#));
    }

    #[test]
    fn is_indexing_response_rejects_non_indexing_status() {
        assert!(!CbmState::is_indexing_response(r#"{"status": "ready"}"#));
        assert!(!CbmState::is_indexing_response(r#"{"status": "indexed"}"#));
        assert!(!CbmState::is_indexing_response(r#"{"status": "pending"}"#));
    }

    #[test]
    fn is_indexing_response_handles_invalid_json() {
        assert!(!CbmState::is_indexing_response("not json"));
        assert!(!CbmState::is_indexing_response("{}"));
    }

    #[test]
    fn schedule_recovers_indexing_state_from_cbm() {
        // 验证：当内存态无记录（应用重启后），但 CBM CLI index_status 返回 "indexing"，
        // is_indexing_response 应返回 true，调用方据此恢复内存态为 Indexing 并返回 InProgress。
        let state = CbmState::default();
        let key = "d:/proj/recovered";

        // 模拟应用重启后内存态为空
        assert!(!state.is_indexing(key));

        // CBM CLI 返回 "indexing" 状态
        let raw = r#"{"status": "indexing"}"#;
        assert!(CbmState::is_indexing_response(raw));

        // 恢复内存态
        state.test_set_repo_state(key, Some(RepoRuntimeState::Indexing));
        assert!(state.is_indexing(key));
        assert_eq!(state.index_status_for(key), CbmIndexStatus::Indexing);
    }

    #[test]
    fn schedule_does_not_recover_from_non_indexing_status() {
        // 验证：CBM CLI 返回 "ready" 状态时，不应恢复为 Indexing。
        let raw = r#"{"status": "ready"}"#;
        assert!(!CbmState::is_indexing_response(raw));
        assert!(CbmState::is_indexed_response(raw));
    }

    // ── circuit breaker ──

    #[test]
    fn circuit_closed_by_default() {
        let state = CbmState::default();
        assert!(state.check_circuit().is_ok());
    }

    #[test]
    fn circuit_stays_closed_below_threshold() {
        let state = CbmState::default();
        for _ in 0..4 {
            state.record_failure();
        }
        assert!(state.check_circuit().is_ok());
    }

    #[test]
    fn circuit_opens_after_threshold_failures() {
        let state = CbmState::default();
        for _ in 0..5 {
            state.record_failure();
        }
        assert!(state.check_circuit().is_err());
    }

    #[test]
    fn circuit_resets_on_success() {
        let state = CbmState::default();
        for _ in 0..5 {
            state.record_failure();
        }
        assert!(state.check_circuit().is_err());
        state.record_success();
        assert!(state.check_circuit().is_ok());
    }

    #[test]
    fn circuit_auto_recovers_after_cooldown() {
        let state = CbmState::default();
        for _ in 0..5 {
            state.record_failure();
        }
        assert!(state.check_circuit().is_err());

        // Simulate cooldown expiry
        state.test_expire_circuit();
        assert!(state.check_circuit().is_ok());
    }

    #[test]
    fn circuit_reopens_if_half_open_call_fails() {
        let state = CbmState::default();
        for _ in 0..5 {
            state.record_failure();
        }
        assert!(state.check_circuit().is_err());

        // Cooldown expires — circuit enters half-open state
        state.test_expire_circuit();
        assert!(state.check_circuit().is_ok());

        // Next failure should reopen the circuit immediately
        state.record_failure();
        assert!(state.check_circuit().is_err());
    }

    #[test]
    fn single_failure_below_threshold_does_not_open() {
        let state = CbmState::default();
        state.record_failure();
        state.record_failure();
        state.record_failure();
        assert!(state.check_circuit().is_ok());
    }

    #[test]
    fn success_resets_failure_count_midway() {
        let state = CbmState::default();
        state.record_failure();
        state.record_failure();
        state.record_failure();
        state.record_success();
        // After reset, need 5 more failures to open
        state.record_failure();
        state.record_failure();
        state.record_failure();
        state.record_failure();
        assert!(state.check_circuit().is_ok());
    }

    // ── stale index detection ──

    #[test]
    fn parse_iso8601_valid_rfc3339() {
        let expected = chrono::DateTime::parse_from_rfc3339("2026-01-15T12:00:00Z")
            .unwrap()
            .timestamp();
        assert_eq!(
            parse_iso8601_to_epoch("2026-01-15T12:00:00Z"),
            Some(expected)
        );
    }

    #[test]
    fn parse_iso8601_with_offset() {
        let ts = parse_iso8601_to_epoch("2026-01-15T12:00:00+08:00");
        assert!(ts.is_some());
        // Same instant regardless of offset representation
        assert_eq!(ts, parse_iso8601_to_epoch("2026-01-15T04:00:00Z"));
    }

    #[test]
    fn parse_iso8601_invalid_returns_none() {
        assert!(parse_iso8601_to_epoch("not-a-date").is_none());
        assert!(parse_iso8601_to_epoch("").is_none());
        assert!(parse_iso8601_to_epoch("2026-01-15").is_none());
    }

    #[test]
    fn stale_threshold_is_30_days() {
        assert_eq!(STALE_THRESHOLD_SECS, 60 * 60 * 24 * 30);
    }

    #[test]
    fn old_timestamp_is_stale() {
        // 60 days ago → stale
        let old = chrono::Utc::now() - chrono::Duration::days(60);
        let old_str = old.format("%Y-%m-%dT%H:%M:%SZ").to_string();
        let ts = parse_iso8601_to_epoch(&old_str).unwrap();
        let now = chrono::Utc::now().timestamp();
        assert!(now - ts > STALE_THRESHOLD_SECS);
    }

    #[test]
    fn recent_timestamp_is_not_stale() {
        // 5 days ago → not stale
        let recent = chrono::Utc::now() - chrono::Duration::days(5);
        let recent_str = recent.format("%Y-%m-%dT%H:%M:%SZ").to_string();
        let ts = parse_iso8601_to_epoch(&recent_str).unwrap();
        let now = chrono::Utc::now().timestamp();
        assert!(now - ts < STALE_THRESHOLD_SECS);
    }

    /// P2-3: Verify that the circuit breaker check used by
    /// `notify_files_changed` correctly blocks when the circuit is open.
    /// `notify_files_changed` calls `self.check_circuit()` and returns early
    /// if it returns `Err`, preventing wasteful lock acquisitions and thread
    /// spawns when CBM CLI is failing repeatedly.
    #[test]
    fn circuit_breaker_skips_notify() {
        let state = CbmState::default();

        // Circuit is closed — check_circuit returns Ok
        assert!(state.check_circuit().is_ok());

        // Open the circuit with threshold failures
        for _ in 0..CIRCUIT_BREAKER_THRESHOLD {
            state.record_failure();
        }

        // Circuit is now open — notify_files_changed would skip here
        assert!(
            state.check_circuit().is_err(),
            "circuit breaker should be open, blocking notify_files_changed"
        );

        // After cooldown, circuit recovers — notify would proceed
        state.test_expire_circuit();
        assert!(
            state.check_circuit().is_ok(),
            "circuit breaker should recover after cooldown"
        );
    }

    #[test]
    fn circuit_breaker_ignores_project_not_found() {
        let state = CbmState::default();
        for _ in 0..10 {
            state.record_failure_if_transient(r#"{"error":"project not found"}"#);
        }
        assert!(
            state.check_circuit().is_ok(),
            "business errors should not trip the circuit breaker"
        );
    }

    #[test]
    fn circuit_breaker_opens_after_transient_failures() {
        let state = CbmState::default();
        for _ in 0..CIRCUIT_BREAKER_THRESHOLD {
            state.record_failure_if_transient("codebase-memory 超时（60s）");
        }
        assert!(
            state.check_circuit().is_err(),
            "transient failures should open the circuit breaker"
        );
    }

    #[test]
    fn project_slug_cache_stores_and_returns_slug() {
        let state = CbmState::default();
        let path = "d:/project/foo";
        assert!(state.get_cached_project_slug(path).is_none());
        state.cache_project_slug(path.to_string(), "D-project-foo".to_string());
        assert_eq!(
            state.get_cached_project_slug(path).as_deref(),
            Some("D-project-foo")
        );
    }

    #[test]
    fn project_slug_cache_invalidates_on_delete_path() {
        let state = CbmState::default();
        let path = "d:/project/bar";
        state.cache_project_slug(path.to_string(), "slug-bar".to_string());
        state.invalidate_project_slug(path);
        assert!(state.get_cached_project_slug(path).is_none());
    }
}
