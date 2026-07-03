//! File Watcher module - File system monitoring
//
//! This module contains file watcher state, external watcher management,
//! and helper functions for file system monitoring.

use globset::{Glob, GlobSet, GlobSetBuilder};
use notify::{Config, Event, RecursiveMode, Watcher};
use notify::{PollWatcher, RecommendedWatcher};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::mpsc::channel;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::{Duration as StdDuration, UNIX_EPOCH};
use tauri::{Emitter, Manager, State};
// ============================================================================
// External Watcher - For watching specific files outside project root
// ============================================================================

/// Enum to hold different watcher types
pub enum ExternalWatcherKind {
    Recommended(RecommendedWatcher),
    Poll(PollWatcher),
}

/// External file watcher for specific files
pub struct ExternalWatcher {
    // RAII: watcher field holds the watcher alive; not read directly.
    #[allow(dead_code)]
    pub watcher: ExternalWatcherKind,
    pub stop_tx: Sender<()>,
}

/// File watcher for automation file_change triggers (kept alive in state map).
pub struct AutomationFileWatcher {
    // RAII: watcher field holds the watcher alive; not read directly.
    #[allow(dead_code)]
    watcher: ExternalWatcherKind,
    stop_tx: Sender<()>,
    config_fingerprint: String,
}

/// Minimum time between two file_change automation triggers for the same task (seconds).
pub const AUTOMATION_FILE_DEBOUNCE_SECS: i64 = 30;

#[derive(Clone, Debug)]
pub struct AutomationWatchSpec {
    pub task_id: String,
    pub project_path: String,
    pub patterns: Vec<String>,
    pub target_thread_id: Option<String>,
    pub prompt: String,
    pub access_mode: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AutomationTriggeredPayload {
    task_id: String,
    target_thread_id: Option<String>,
    prompt: String,
    target_project_path: String,
    access_mode: String,
}

// ============================================================================
// Watcher State - Global file watching state
// ============================================================================

/// Global state for file system watching
pub struct WatcherState {
    /// Main project watcher
    pub watcher: Arc<Mutex<Option<RecommendedWatcher>>>,
    /// Stop signal sender for main watcher
    pub stop_tx: Arc<Mutex<Option<Sender<()>>>>,
    /// External file watchers (keyed by normalized path)
    pub external_watchers: Arc<Mutex<HashMap<String, ExternalWatcher>>>,
    /// Automation file_change watchers (keyed by task id)
    pub automation_watchers: Arc<Mutex<HashMap<String, AutomationFileWatcher>>>,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self {
            watcher: Arc::new(Mutex::new(None)),
            stop_tx: Arc::new(Mutex::new(None)),
            external_watchers: Arc::new(Mutex::new(HashMap::new())),
            automation_watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Normalize a path for use as a watch key
pub fn normalize_watch_key(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// Build a globset matcher from glob patterns relative to a project root.
pub fn build_glob_matcher(patterns: &[String]) -> Option<GlobSet> {
    if patterns.is_empty() {
        return None;
    }
    let mut builder = GlobSetBuilder::new();
    let mut added = 0;
    for pattern in patterns {
        match Glob::new(pattern) {
            Ok(glob) => {
                builder.add(glob);
                added += 1;
            }
            Err(_) => continue,
        }
    }
    if added == 0 {
        return None;
    }
    builder.build().ok()
}

fn automation_watch_fingerprint(spec: &AutomationWatchSpec) -> String {
    format!(
        "{}|{}",
        normalize_watch_key(&spec.project_path),
        spec.patterns.join(",")
    )
}

fn should_skip_watched_path(path_str: &str) -> bool {
    path_str.contains("node_modules") || path_str.contains(".git") || path_str.contains("target")
}

/// Stop a single automation file_change watcher.
pub fn stop_automation_file_watch(task_id: &str, state: &WatcherState) {
    let mut guard = state
        .automation_watchers
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some(handle) = guard.remove(task_id) {
        let _ = handle.stop_tx.send(());
    }
}

/// Start watching a project path for automation file_change triggers.
fn start_automation_file_watch(
    app: tauri::AppHandle,
    spec: AutomationWatchSpec,
    fingerprint: String,
    state: &WatcherState,
) -> Result<(), String> {
    let matcher = match build_glob_matcher(&spec.patterns) {
        Some(m) => m,
        None => return Ok(()),
    };

    let project_path_buf = Path::new(&spec.project_path);
    if !project_path_buf.exists() {
        return Ok(());
    }

    let project_path_for_glob = spec.project_path.replace('\\', "/");
    let (stop_tx, stop_rx) = channel::<()>();
    let (event_tx, event_rx) = channel::<notify::Result<Event>>();

    let event_tx_for_recommended = event_tx.clone();
    let event_tx_for_poll = event_tx;
    let mut watcher = match RecommendedWatcher::new(
        move |res| {
            let _ = event_tx_for_recommended.send(res);
        },
        Config::default().with_poll_interval(StdDuration::from_millis(1000)),
    ) {
        Ok(w) => ExternalWatcherKind::Recommended(w),
        Err(_) => {
            let w = PollWatcher::new(
                move |res| {
                    let _ = event_tx_for_poll.send(res);
                },
                Config::default()
                    .with_poll_interval(StdDuration::from_millis(500))
                    .with_compare_contents(true),
            )
            .map_err(|e| format!("创建自动化监听器失败: {e}"))?;
            ExternalWatcherKind::Poll(w)
        }
    };

    match &mut watcher {
        ExternalWatcherKind::Recommended(w) => {
            w.watch(project_path_buf, RecursiveMode::Recursive)
                .map_err(|e| format!("启动自动化监听失败: {e}"))?;
        }
        ExternalWatcherKind::Poll(w) => {
            w.watch(project_path_buf, RecursiveMode::Recursive)
                .map_err(|e| format!("启动自动化监听失败: {e}"))?;
        }
    }

    let app_clone = app.clone();
    let task_id = spec.task_id.clone();
    let emit_payload = AutomationTriggeredPayload {
        task_id: spec.task_id.clone(),
        target_thread_id: spec.target_thread_id.clone(),
        prompt: spec.prompt.clone(),
        target_project_path: spec.project_path.clone(),
        access_mode: spec.access_mode.clone(),
    };

    std::thread::spawn(move || {
        let mut last_fire: Option<std::time::Instant> = None;

        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }

            let mut matched = false;
            while let Ok(result) = event_rx.try_recv() {
                if let Ok(event) = result {
                    for path in event.paths {
                        let path_str = path.to_string_lossy().to_string();
                        if should_skip_watched_path(&path_str) {
                            continue;
                        }
                        let norm_path = path_str.replace('\\', "/");
                        let relative = norm_path
                            .strip_prefix(&project_path_for_glob)
                            .map(|rel| rel.trim_start_matches('/').to_string())
                            .unwrap_or_else(|| norm_path.clone());
                        if matcher.is_match(&relative) {
                            matched = true;
                            break;
                        }
                    }
                }
                if matched {
                    break;
                }
            }

            if matched {
                let should_fire = match last_fire {
                    None => true,
                    Some(lf) => {
                        lf.elapsed() >= StdDuration::from_secs(AUTOMATION_FILE_DEBOUNCE_SECS as u64)
                    }
                };
                if should_fire {
                    last_fire = Some(std::time::Instant::now());
                    let _ = app_clone.emit("agent-automation-triggered", &emit_payload);
                }
            }

            std::thread::sleep(StdDuration::from_millis(200));
        }
    });

    let mut guard = state
        .automation_watchers
        .lock()
        .map_err(|_| "锁定自动化监听器失败".to_string())?;
    guard.insert(
        task_id,
        AutomationFileWatcher {
            watcher,
            stop_tx,
            config_fingerprint: fingerprint,
        },
    );

    Ok(())
}

/// Sync automation file_change watchers with the desired task set.
pub fn refresh_automation_file_watchers(
    app: &tauri::AppHandle,
    specs: &[AutomationWatchSpec],
    state: &WatcherState,
) {
    let desired: HashMap<String, (AutomationWatchSpec, String)> = specs
        .iter()
        .map(|spec| {
            let fingerprint = automation_watch_fingerprint(spec);
            (spec.task_id.clone(), (spec.clone(), fingerprint))
        })
        .collect();

    let to_stop: Vec<String> = {
        let guard = state
            .automation_watchers
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        guard
            .iter()
            .filter_map(|(task_id, watcher)| {
                match desired.get(task_id) {
                    None => Some(task_id.clone()),
                    Some((_, fingerprint)) if fingerprint != &watcher.config_fingerprint => {
                        Some(task_id.clone())
                    }
                    _ => None,
                }
            })
            .collect()
    };

    for task_id in to_stop {
        stop_automation_file_watch(&task_id, state);
    }

    let existing: std::collections::HashSet<String> = {
        let guard = state
            .automation_watchers
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        guard.keys().cloned().collect()
    };

    for (task_id, (spec, fingerprint)) in desired {
        if existing.contains(&task_id) {
            continue;
        }
        let _ = start_automation_file_watch(app.clone(), spec, fingerprint, state);
    }
}

// ============================================================================
// Tauri Commands
// ============================================================================

#[tauri::command]
pub fn watch_file(
    app: tauri::AppHandle,
    path: String,
    state: State<'_, WatcherState>,
) -> Result<(), String> {
    let target = Path::new(&path);
    let target_dir = target
        .parent()
        .ok_or_else(|| format!("无法获取文件目录: {}", path))?;
    if !target_dir.exists() {
        return Err(format!("文件目录不存在: {}", target_dir.display()));
    }

    let key = normalize_watch_key(&path);
    {
        let guard = state
            .external_watchers
            .lock()
            .map_err(|_| "锁定失败".to_string())?;
        if guard.contains_key(&key) {
            return Ok(());
        }
    }

    let (stop_tx, stop_rx) = channel::<()>();
    let (event_tx, event_rx) = channel::<notify::Result<Event>>();
    let app_clone = app.clone();
    let path_for_thread = path.clone();
    let target_path_norm = normalize_watch_key(&path);
    let target_dir_norm = normalize_watch_key(&target_dir.to_string_lossy().to_string());

    let event_tx_for_recommended = event_tx.clone();
    let event_tx_for_poll = event_tx;
    let mut watcher = match RecommendedWatcher::new(
        move |res| {
            let _ = event_tx_for_recommended.send(res);
        },
        Config::default(),
    ) {
        Ok(w) => ExternalWatcherKind::Recommended(w),
        Err(_) => {
            let w = PollWatcher::new(
                move |res| {
                    let _ = event_tx_for_poll.send(res);
                },
                Config::default()
                    .with_poll_interval(StdDuration::from_millis(200))
                    .with_compare_contents(true),
            )
            .map_err(|e| format!("创建监听器失败: {}", e))?;
            ExternalWatcherKind::Poll(w)
        }
    };

    match &mut watcher {
        ExternalWatcherKind::Recommended(w) => {
            w.watch(target_dir, RecursiveMode::NonRecursive)
                .map_err(|e| format!("启动监听失败: {}", e))?;
        }
        ExternalWatcherKind::Poll(w) => {
            w.watch(target_dir, RecursiveMode::NonRecursive)
                .map_err(|e| format!("启动监听失败: {}", e))?;
        }
    }

    let use_poll_fallback = matches!(&watcher, ExternalWatcherKind::Recommended(_));

    std::thread::spawn(move || {
        fn fingerprint(path: &str) -> (bool, u64, u128) {
            match fs::metadata(path) {
                Ok(meta) => {
                    let len = meta.len();
                    let mtime = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u128)
                        .unwrap_or(0);
                    (true, len, mtime)
                }
                Err(_) => (false, 0, 0),
            }
        }

        let mut pending_paths: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut last_emit = std::time::Instant::now();
        let mut last_poll = std::time::Instant::now();
        let mut dirty = false;
        let mut last_event = std::time::Instant::now();
        let mut last_known = fingerprint(&path_for_thread);

        loop {
            if stop_rx.try_recv().is_ok() {
                println!(
                    "[FS Watcher] Stopping external watcher for: {}",
                    path_for_thread
                );
                break;
            }

            while let Ok(result) = event_rx.try_recv() {
                if let Ok(event) = result {
                    let mut should_refresh_target = false;
                    for path in event.paths {
                        let path_str = path.to_string_lossy().to_string();
                        let normalized = normalize_watch_key(&path_str);
                        if normalized == target_path_norm {
                            should_refresh_target = true;
                        } else if let Some(parent) = Path::new(&path_str).parent() {
                            let parent_norm =
                                normalize_watch_key(&parent.to_string_lossy().to_string());
                            if parent_norm == target_dir_norm {
                                should_refresh_target = true;
                            }
                        }
                    }
                    if should_refresh_target {
                        dirty = true;
                        last_event = std::time::Instant::now();
                    }
                }
            }

            if use_poll_fallback {
                let now = std::time::Instant::now();
                let poll_due = now.duration_since(last_poll) >= StdDuration::from_millis(500);
                let dirty_due =
                    dirty && now.duration_since(last_event) >= StdDuration::from_millis(150);
                if poll_due || dirty_due {
                    let current = fingerprint(&path_for_thread);
                    if current != last_known {
                        pending_paths.insert(path_for_thread.clone());
                        last_known = current;
                    }
                    if poll_due {
                        last_poll = now;
                    }
                    if dirty_due {
                        dirty = false;
                    }
                }
            } else if dirty {
                if last_event.elapsed() >= StdDuration::from_millis(150) {
                    pending_paths.insert(path_for_thread.clone());
                    dirty = false;
                }
            }

            if !pending_paths.is_empty() && last_emit.elapsed() >= StdDuration::from_millis(200) {
                let paths: Vec<String> = pending_paths.drain().collect();
                println!(
                    "[FS Watcher] Emitting file-changed for {} paths (external)",
                    paths.len()
                );
                let _ = app_clone.emit("file-changed", serde_json::json!({ "paths": paths }));
                last_emit = std::time::Instant::now();
            }

            std::thread::sleep(StdDuration::from_millis(50));
        }
    });

    let mut guard = state
        .external_watchers
        .lock()
        .map_err(|_| "锁定失败".to_string())?;
    guard.insert(key, ExternalWatcher { watcher, stop_tx });

    Ok(())
}

#[tauri::command]
pub fn unwatch_file(path: String, state: State<'_, WatcherState>) -> Result<(), String> {
    let key = normalize_watch_key(&path);
    let mut guard = state
        .external_watchers
        .lock()
        .map_err(|_| "锁定失败".to_string())?;
    if let Some(handle) = guard.remove(&key) {
        let _ = handle.stop_tx.send(());
    }
    Ok(())
}

#[tauri::command]
pub fn start_watching(
    app: tauri::AppHandle,
    path: String,
    state: State<'_, WatcherState>,
) -> Result<(), String> {
    println!("[FS Watcher] Starting to watch: {}", path);

    // 先停止旧的监听
    {
        let mut stop_tx = state.stop_tx.lock().map_err(|_| "锁定失败".to_string())?;
        if let Some(tx) = stop_tx.take() {
            let _ = tx.send(());
        }
    }
    {
        let mut watcher_guard = state.watcher.lock().map_err(|_| "锁定失败".to_string())?;
        *watcher_guard = None;
    }

    let (stop_tx, stop_rx) = channel::<()>();

    // 保存 stop_tx
    {
        let mut tx_guard = state.stop_tx.lock().map_err(|_| "锁定失败".to_string())?;
        *tx_guard = Some(stop_tx);
    }

    let app_clone = app.clone();
    let path_for_thread = path.clone();

    // 创建事件通道
    let (event_tx, event_rx) = channel::<notify::Result<Event>>();

    let watcher = RecommendedWatcher::new(
        move |res| {
            let _ = event_tx.send(res);
        },
        Config::default().with_poll_interval(StdDuration::from_millis(500)),
    )
    .map_err(|e| format!("创建监听器失败: {}", e))?;

    // 保存 watcher
    {
        let mut watcher_guard = state.watcher.lock().map_err(|_| "锁定失败".to_string())?;
        *watcher_guard = Some(watcher);
    }

    // 开始监听
    {
        let mut watcher_guard = state.watcher.lock().map_err(|_| "锁定失败".to_string())?;
        if let Some(ref mut w) = *watcher_guard {
            w.watch(Path::new(&path), RecursiveMode::Recursive)
                .map_err(|e| format!("启动监听失败: {}", e))?;
        }
    }

    // 启动事件处理线程
    std::thread::spawn(move || {
        let mut pending_paths: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut last_emit = std::time::Instant::now();

        loop {
            // 检查是否停止
            if stop_rx.try_recv().is_ok() {
                println!("[FS Watcher] Stopping watcher for: {}", path_for_thread);
                break;
            }

            // 处理事件（非阻塞）
            while let Ok(result) = event_rx.try_recv() {
                if let Ok(event) = result {
                    for path in event.paths {
                        let path_str = path.to_string_lossy().to_string();
                        // 忽略 node_modules, .git, target 等目录
                        if path_str.contains("node_modules")
                            || path_str.contains(".git")
                            || path_str.contains("target")
                        {
                            continue;
                        }
                        pending_paths.insert(path_str);
                    }
                }
            }

            // 去抖动：每 200ms 批量发送一次
            if !pending_paths.is_empty() && last_emit.elapsed() >= StdDuration::from_millis(200) {
                let paths: Vec<String> = pending_paths.drain().collect();
                println!(
                    "[FS Watcher] Emitting file-changed for {} paths",
                    paths.len()
                );
                let _ = app_clone.emit("file-changed", serde_json::json!({ "paths": paths }));
                if let Some(cbm) = app_clone.try_state::<crate::cbm::CbmState>() {
                    cbm.notify_files_changed(app_clone.clone(), path_for_thread.clone());
                }
                last_emit = std::time::Instant::now();
            }

            std::thread::sleep(StdDuration::from_millis(50));
        }
    });

    Ok(())
}

#[tauri::command]
pub fn stop_watching(state: State<'_, WatcherState>) -> Result<(), String> {
    println!("[FS Watcher] Stopping watcher");

    // 发送停止信号
    {
        let mut stop_tx = state.stop_tx.lock().map_err(|_| "锁定失败".to_string())?;
        if let Some(tx) = stop_tx.take() {
            let _ = tx.send(());
        }
    }

    // 清除 watcher
    {
        let mut watcher_guard = state.watcher.lock().map_err(|_| "锁定失败".to_string())?;
        *watcher_guard = None;
    }

    // 停止外部文件监听器
    {
        let mut external = state
            .external_watchers
            .lock()
            .map_err(|_| "锁定失败".to_string())?;
        for (_, handle) in external.drain() {
            let _ = handle.stop_tx.send(());
        }
    }

    Ok(())
}

#[cfg(test)]
mod automation_file_watch_tests {
    use super::*;

    #[test]
    fn build_glob_matcher_matches_relative_paths() {
        let patterns = vec!["**/*.ts".to_string(), "**/*.tsx".to_string()];
        let matcher = build_glob_matcher(&patterns).expect("matcher");
        assert!(matcher.is_match("src/App.ts"));
        assert!(matcher.is_match("src/App.tsx"));
        assert!(!matcher.is_match("src/App.js"));
    }

    #[test]
    fn automation_watch_fingerprint_changes_when_patterns_change() {
        let spec_a = AutomationWatchSpec {
            task_id: "task-1".to_string(),
            project_path: "D:/project/a".to_string(),
            patterns: vec!["**/*.ts".to_string()],
            target_thread_id: None,
            prompt: "run".to_string(),
            access_mode: "auto".to_string(),
        };
        let spec_b = AutomationWatchSpec {
            patterns: vec!["**/*.tsx".to_string()],
            ..spec_a.clone()
        };
        assert_ne!(
            automation_watch_fingerprint(&spec_a),
            automation_watch_fingerprint(&spec_b)
        );
    }
}
