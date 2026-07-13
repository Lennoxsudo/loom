//! Automation module - Scheduled / background task management
//!
//! Provides CRUD for automation tasks, interval/cron-based scheduling via tokio timers,
//! file-change event triggers via notify + globset, and event emission
//! when a task fires so the frontend can deliver prompts into thread loops.

use chrono::{DateTime, Utc};
use croner::Cron;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

use crate::file_watcher::{self, AutomationWatchSpec, WatcherState};

// ── Constants ──────────────────────────────────────────────────────────────

const AUTOMATION_DIR: &str = "automations";
const AUTOMATION_FILE: &str = "tasks.json";
const MAX_RUN_HISTORY: usize = 50;
const CRON_INVALID_SUMMARY: &str = "表达式非法";

// ── Data types ─────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunRecord {
    pub run_at: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IntervalTrigger {
    pub minutes: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CronTrigger {
    pub expression: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeTrigger {
    pub patterns: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AutomationTrigger {
    Interval(IntervalTrigger),
    Cron(CronTrigger),
    #[serde(rename = "file_change")]
    FileChange(FileChangeTrigger),
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AutomationTask {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub trigger: AutomationTrigger,
    pub target_project_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_thread_id: Option<String>,
    pub prompt: String,
    pub access_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<String>,
    #[serde(default)]
    pub run_history: Vec<AutomationRunRecord>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct AutomationFile {
    version: u32,
    updated_at: String,
    tasks: Vec<AutomationTask>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAutomationTaskPayload {
    pub name: String,
    pub trigger: AutomationTrigger,
    pub target_project_path: String,
    #[serde(default)]
    pub target_thread_id: Option<String>,
    pub prompt: String,
    #[serde(default = "default_access_mode")]
    pub access_mode: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_access_mode() -> String {
    "auto".to_string()
}

fn default_enabled() -> bool {
    true
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAutomationTaskPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger: Option<AutomationTrigger>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_project_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_mode: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AutomationTriggeredEvent {
    pub task_id: String,
    pub target_thread_id: Option<String>,
    pub prompt: String,
    pub target_project_path: String,
    pub access_mode: String,
}

// ── Store state ────────────────────────────────────────────────────────────

pub struct AutomationStoreState {
    pub lock: Mutex<()>,
}

impl Default for AutomationStoreState {
    fn default() -> Self {
        Self {
            lock: Mutex::new(()),
        }
    }
}

// ── Internal store ─────────────────────────────────────────────────────────

struct AutomationStore {
    root_dir: PathBuf,
}

impl AutomationStore {
    fn from_app(app: &tauri::AppHandle) -> Result<Self, String> {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
        Ok(Self::new(app_data_dir.join(AUTOMATION_DIR)))
    }

    fn new(root_dir: PathBuf) -> Self {
        Self { root_dir }
    }

    fn ensure_layout(&self) -> Result<(), String> {
        fs::create_dir_all(&self.root_dir)
            .map_err(|e| format!("创建自动化数据目录失败: {e}"))?;
        Ok(())
    }

    fn file_path(&self) -> PathBuf {
        self.root_dir.join(AUTOMATION_FILE)
    }

    fn load_tasks(&self) -> Result<Vec<AutomationTask>, String> {
        self.ensure_layout()?;
        let path = self.file_path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let raw = fs::read_to_string(&path)
            .map_err(|e| format!("读取自动化任务失败: {e}"))?;
        let file: AutomationFile = serde_json::from_str(&raw)
            .map_err(|e| format!("解析自动化任务失败: {e}"))?;
        Ok(file.tasks)
    }

    fn save_tasks(&self, tasks: Vec<AutomationTask>) -> Result<(), String> {
        self.ensure_layout()?;
        let path = self.file_path();
        let payload = AutomationFile {
            version: 1,
            updated_at: Utc::now().to_rfc3339(),
            tasks,
        };
        let json = serde_json::to_string_pretty(&payload)
            .map_err(|e| format!("序列化自动化任务失败: {e}"))?;

        // Atomic write
        let tmp_path = path.with_extension("tmp");
        fs::write(&tmp_path, &json)
            .map_err(|e| format!("写入临时文件失败: {e}"))?;
        let _ = fs::remove_file(&path);
        fs::rename(&tmp_path, &path)
            .map_err(|e| format!("重命名临时文件失败: {e}"))?;
        Ok(())
    }
}

// ── Helper: compute next run timestamp ─────────────────────────────────────

fn compute_next_run_at(trigger: &AutomationTrigger, last_run_at: Option<&str>) -> Option<String> {
    match trigger {
        AutomationTrigger::Interval(interval) => {
            let base = last_run_at
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.timestamp_millis())
                .unwrap_or_else(|| Utc::now().timestamp_millis());
            let next = base + (interval.minutes as i64) * 60_000;
            DateTime::from_timestamp_millis(next).map(|dt| dt.to_rfc3339())
        }
        AutomationTrigger::Cron(cron_trigger) => {
            // Try to parse cron expression and find next occurrence
            let cron = match Cron::new(&cron_trigger.expression).parse() {
                Ok(c) => c,
                Err(_) => return None, // Invalid expression → no next run
            };
            let base: DateTime<Utc> = last_run_at
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.to_utc())
                .unwrap_or_else(Utc::now);
            // find_next_occurrence(start, inclusive=false) → next fire strictly after start
            cron.find_next_occurrence(&base, false)
                .ok()
                .map(|dt| dt.to_rfc3339())
        }
        AutomationTrigger::FileChange(_) => {
            // file_change triggers don't have a predictable next run
            None
        }
    }
}

/// Check if a cron expression has a fire time in the interval (after, now].
/// Returns true if the cron would have fired at least once in that window.
fn cron_fired_in_interval(expression: &str, after: DateTime<Utc>, now: DateTime<Utc>) -> bool {
    let cron = match Cron::new(expression).parse() {
        Ok(c) => c,
        Err(_) => return false,
    };
    // Find the first cron fire time strictly after `after`
    let first_after = match cron.find_next_occurrence(&after, false) {
        Ok(t) => t,
        Err(_) => return false,
    };
    // If that fire time is at or before now, it should have fired
    first_after <= now
}

fn should_record_failure(task: &AutomationTask, summary: &str) -> bool {
    match task.run_history.first() {
        None => true,
        Some(record) => record.status != "failed" || record.summary.as_deref() != Some(summary),
    }
}

fn record_automation_failure(
    app: &tauri::AppHandle,
    task_id: &str,
    summary: &str,
) -> Result<(), String> {
    let store = AutomationStore::from_app(app)?;
    let mut tasks = store.load_tasks()?;
    let now = Utc::now().to_rfc3339();
    let target = tasks
        .iter_mut()
        .find(|t| t.id == task_id)
        .ok_or_else(|| "自动化任务不存在".to_string())?;

    let record = AutomationRunRecord {
        run_at: now.clone(),
        status: "failed".to_string(),
        summary: Some(summary.to_string()),
    };
    target.last_run_at = Some(now);
    target.run_history.insert(0, record);
    if target.run_history.len() > MAX_RUN_HISTORY {
        target.run_history.truncate(MAX_RUN_HISTORY);
    }
    target.updated_at = Utc::now().to_rfc3339();
    target.next_run_at = if target.enabled {
        compute_next_run_at(&target.trigger, target.last_run_at.as_deref())
    } else {
        None
    };

    store.save_tasks(tasks)
}

// ── File-change watcher refresh (delegates to file_watcher.rs) ─────────────
pub fn refresh_file_change_watchers(app: &tauri::AppHandle) {
    let watcher_state: State<'_, WatcherState> = app.state();
    let store = match AutomationStore::from_app(app) {
        Ok(s) => s,
        Err(_) => return,
    };
    let tasks = match store.load_tasks() {
        Ok(t) => t,
        Err(_) => return,
    };

    let specs: Vec<AutomationWatchSpec> = tasks
        .iter()
        .filter(|task| task.enabled && matches!(task.trigger, AutomationTrigger::FileChange(_)))
        .filter_map(|task| {
            let AutomationTrigger::FileChange(fc) = &task.trigger else {
                return None;
            };
            Some(AutomationWatchSpec {
                task_id: task.id.clone(),
                project_path: task.target_project_path.clone(),
                patterns: fc.patterns.clone(),
                target_thread_id: task.target_thread_id.clone(),
                prompt: task.prompt.clone(),
                access_mode: task.access_mode.clone(),
            })
        })
        .collect();

    file_watcher::refresh_automation_file_watchers(app, &specs, &watcher_state);
}

// ── Tauri commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn agent_automation_list(
    app: tauri::AppHandle,
    state: State<'_, AutomationStoreState>,
) -> Result<Vec<AutomationTask>, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "自动化存储锁获取失败".to_string())?;
    let store = AutomationStore::from_app(&app)?;
    store.load_tasks()
}

#[tauri::command]
pub fn agent_automation_create(
    app: tauri::AppHandle,
    state: State<'_, AutomationStoreState>,
    payload: CreateAutomationTaskPayload,
) -> Result<AutomationTask, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "自动化存储锁获取失败".to_string())?;

    let name = payload.name.trim();
    if name.is_empty() {
        return Err("任务名称不能为空".to_string());
    }
    let prompt = payload.prompt.trim();
    if prompt.is_empty() {
        return Err("提示词不能为空".to_string());
    }

    // Validate cron expression if applicable
    if let AutomationTrigger::Cron(ref cron_trigger) = payload.trigger {
        if Cron::new(&cron_trigger.expression).parse().is_err() {
            return Err(format!("Cron 表达式非法: {}", cron_trigger.expression));
        }
    }

    let now = Utc::now().to_rfc3339();
    let next_run_at = if payload.enabled {
        compute_next_run_at(&payload.trigger, None)
    } else {
        None
    };

    let task = AutomationTask {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        enabled: payload.enabled,
        trigger: payload.trigger,
        target_project_path: payload.target_project_path,
        target_thread_id: payload.target_thread_id,
        prompt: prompt.to_string(),
        access_mode: payload.access_mode,
        last_run_at: None,
        next_run_at,
        run_history: Vec::new(),
        created_at: now.clone(),
        updated_at: now,
    };

    let store = AutomationStore::from_app(&app)?;
    let mut tasks = store.load_tasks()?;
    tasks.insert(0, task.clone());
    store.save_tasks(tasks)?;

    // Refresh file-change watchers after creating a task
    refresh_file_change_watchers(&app);

    Ok(task)
}

#[tauri::command]
pub fn agent_automation_update(
    app: tauri::AppHandle,
    state: State<'_, AutomationStoreState>,
    id: String,
    patch: UpdateAutomationTaskPayload,
) -> Result<AutomationTask, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "自动化存储锁获取失败".to_string())?;

    // Validate cron expression if being updated
    if let Some(AutomationTrigger::Cron(ref cron_trigger)) = patch.trigger {
        if Cron::new(&cron_trigger.expression).parse().is_err() {
            return Err(format!("Cron 表达式非法: {}", cron_trigger.expression));
        }
    }

    let store = AutomationStore::from_app(&app)?;
    let mut tasks = store.load_tasks()?;

    let target = tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| "自动化任务不存在".to_string())?;

    if let Some(name) = &patch.name {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("任务名称不能为空".to_string());
        }
        target.name = trimmed.to_string();
    }
    if let Some(enabled) = patch.enabled {
        target.enabled = enabled;
    }
    if let Some(trigger) = patch.trigger {
        target.trigger = trigger;
    }
    if let Some(path) = &patch.target_project_path {
        target.target_project_path = path.clone();
    }
    if patch.target_thread_id.is_some() {
        target.target_thread_id = patch.target_thread_id.clone();
    }
    if let Some(prompt) = &patch.prompt {
        let trimmed = prompt.trim();
        if trimmed.is_empty() {
            return Err("提示词不能为空".to_string());
        }
        target.prompt = trimmed.to_string();
    }
    if let Some(mode) = &patch.access_mode {
        target.access_mode = mode.clone();
    }

    target.updated_at = Utc::now().to_rfc3339();
    target.next_run_at = if target.enabled {
        compute_next_run_at(&target.trigger, target.last_run_at.as_deref())
    } else {
        None
    };

    let updated = target.clone();
    store.save_tasks(tasks)?;

    // Refresh file-change watchers after updating a task
    refresh_file_change_watchers(&app);

    Ok(updated)
}

#[tauri::command]
pub fn agent_automation_delete(
    app: tauri::AppHandle,
    state: State<'_, AutomationStoreState>,
    id: String,
) -> Result<(), String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "自动化存储锁获取失败".to_string())?;

    let store = AutomationStore::from_app(&app)?;
    let mut tasks = store.load_tasks()?;
    let before = tasks.len();
    tasks.retain(|t| t.id != id);
    if tasks.len() == before {
        return Err("自动化任务不存在".to_string());
    }
    store.save_tasks(tasks)?;

    let watcher_state: State<'_, WatcherState> = app.state();
    file_watcher::stop_automation_file_watch(&id, &watcher_state);

    Ok(())
}

#[tauri::command]
pub fn agent_automation_set_enabled(
    app: tauri::AppHandle,
    state: State<'_, AutomationStoreState>,
    id: String,
    enabled: bool,
) -> Result<AutomationTask, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "自动化存储锁获取失败".to_string())?;

    let store = AutomationStore::from_app(&app)?;
    let mut tasks = store.load_tasks()?;

    let target = tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| "自动化任务不存在".to_string())?;

    target.enabled = enabled;
    target.updated_at = Utc::now().to_rfc3339();
    target.next_run_at = if enabled {
        compute_next_run_at(&target.trigger, target.last_run_at.as_deref())
    } else {
        None
    };

    let updated = target.clone();
    store.save_tasks(tasks)?;

    // Refresh file-change watchers (task may have been enabled/disabled)
    refresh_file_change_watchers(&app);

    Ok(updated)
}

#[tauri::command]
pub fn agent_automation_run_now(
    app: tauri::AppHandle,
    state: State<'_, AutomationStoreState>,
    id: String,
) -> Result<(), String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "自动化存储锁获取失败".to_string())?;

    let store = AutomationStore::from_app(&app)?;
    let tasks = store.load_tasks()?;
    let task = tasks
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| "自动化任务不存在".to_string())?;

    // Emit the triggered event for frontend consumption
    let event = AutomationTriggeredEvent {
        task_id: task.id,
        target_thread_id: task.target_thread_id,
        prompt: task.prompt,
        target_project_path: task.target_project_path,
        access_mode: task.access_mode,
    };
    app.emit("agent-automation-triggered", &event)
        .map_err(|e| format!("发射自动化触发事件失败: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn agent_automation_record_run(
    app: tauri::AppHandle,
    state: State<'_, AutomationStoreState>,
    id: String,
    record: AutomationRunRecord,
) -> Result<(), String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "自动化存储锁获取失败".to_string())?;

    let store = AutomationStore::from_app(&app)?;
    let mut tasks = store.load_tasks()?;

    let target = tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| "自动化任务不存在".to_string())?;

    target.last_run_at = Some(record.run_at.clone());
    target.run_history.insert(0, record);
    if target.run_history.len() > MAX_RUN_HISTORY {
        target.run_history.truncate(MAX_RUN_HISTORY);
    }
    target.updated_at = Utc::now().to_rfc3339();
    target.next_run_at = if target.enabled {
        compute_next_run_at(&target.trigger, target.last_run_at.as_deref())
    } else {
        None
    };

    store.save_tasks(tasks)?;
    Ok(())
}

// ── Scheduler: starts background tick for interval + cron tasks ─────────────

/// Spawn a background task that periodically checks interval and cron automations
/// and emits `agent-automation-triggered` events when they fire.
pub fn start_automation_scheduler(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .expect("自动化调度器运行时创建失败");

        rt.block_on(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
            loop {
                interval.tick().await;
                let _ = check_and_fire_scheduled_automations(&app).await;
            }
        });
    });
}

async fn check_and_fire_scheduled_automations(app: &tauri::AppHandle) -> Result<(), String> {
    let store = AutomationStore::from_app(app)?;
    let tasks = store.load_tasks()?;
    let now = Utc::now();

    for task in &tasks {
        if !task.enabled {
            continue;
        }

        let should_fire = match &task.trigger {
            AutomationTrigger::Interval(interval_trigger) => {
                let last_run = task
                    .last_run_at
                    .as_ref()
                    .and_then(|s| DateTime::parse_from_rfc3339(s).ok());

                match last_run {
                    None => true,
                    Some(lr) => {
                        let elapsed = now.signed_duration_since(lr);
                        elapsed.num_minutes() >= interval_trigger.minutes as i64
                    }
                }
            }
            AutomationTrigger::Cron(cron_trigger) => {
                if Cron::new(&cron_trigger.expression).parse().is_err() {
                    if should_record_failure(task, CRON_INVALID_SUMMARY) {
                        let _ = record_automation_failure(app, &task.id, CRON_INVALID_SUMMARY);
                    }
                    false
                } else {
                    let last_run: DateTime<Utc> = task
                        .last_run_at
                        .as_ref()
                        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                        .map(|dt| dt.to_utc())
                        // If never run, check from 1 minute before now (first-run check)
                        .unwrap_or_else(|| now - chrono::Duration::minutes(1));

                    cron_fired_in_interval(&cron_trigger.expression, last_run, now)
                }
            }
            AutomationTrigger::FileChange(_) => {
                // File change triggers are handled by the file watcher, not the scheduler
                false
            }
        };

        if should_fire {
            let event = AutomationTriggeredEvent {
                task_id: task.id.clone(),
                target_thread_id: task.target_thread_id.clone(),
                prompt: task.prompt.clone(),
                target_project_path: task.target_project_path.clone(),
                access_mode: task.access_mode.clone(),
            };
            let _ = app.emit("agent-automation-triggered", &event);

            // Update last_run_at so the same task won't re-fire on the next tick
            let record = AutomationRunRecord {
                run_at: now.to_rfc3339(),
                status: "succeeded".to_string(),
                summary: Some("Auto-triggered".to_string()),
            };
            let store2 = AutomationStore::from_app(app)?;
            let mut tasks2 = store2.load_tasks()?;
            if let Some(t) = tasks2.iter_mut().find(|t| t.id == task.id) {
                t.last_run_at = Some(record.run_at.clone());
                t.run_history.insert(0, record);
                if t.run_history.len() > MAX_RUN_HISTORY {
                    t.run_history.truncate(MAX_RUN_HISTORY);
                }
                t.next_run_at = compute_next_run_at(&t.trigger, t.last_run_at.as_deref());
                let _ = store2.save_tasks(tasks2);
            }
        }
    }

    Ok(())
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        path.push(format!("{prefix}_{nanos}"));
        path
    }

    fn sample_trigger() -> AutomationTrigger {
        AutomationTrigger::Interval(IntervalTrigger { minutes: 30 })
    }

    #[test]
    fn save_and_load_tasks_roundtrip() {
        let root = unique_temp_dir("automation_roundtrip");
        let store = AutomationStore::new(root.clone());

        let task = AutomationTask {
            id: "test-1".to_string(),
            name: "Test Task".to_string(),
            enabled: true,
            trigger: sample_trigger(),
            target_project_path: "/tmp/project".to_string(),
            target_thread_id: None,
            prompt: "Run tests".to_string(),
            access_mode: "auto".to_string(),
            last_run_at: None,
            next_run_at: None,
            run_history: Vec::new(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        };

        store
            .save_tasks(vec![task.clone()])
            .expect("save should succeed");
        let loaded = store.load_tasks().expect("load should succeed");

        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, task.id);
        assert_eq!(loaded[0].name, task.name);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn compute_next_run_interval() {
        let trigger = AutomationTrigger::Interval(IntervalTrigger { minutes: 30 });
        let result = compute_next_run_at(&trigger, None);
        assert!(result.is_some());

        let last = "2026-01-01T12:00:00+00:00";
        let result = compute_next_run_at(&trigger, Some(last));
        assert!(result.is_some());
        // Should be approximately 30 minutes after last run
        assert!(result.unwrap().contains("12:30"));
    }

    #[test]
    fn compute_next_run_cron_valid_expression() {
        let trigger = AutomationTrigger::Cron(CronTrigger {
            expression: "0 */6 * * *".to_string(),
        });
        let result = compute_next_run_at(&trigger, None);
        assert!(
            result.is_some(),
            "Valid cron expression should return a next run time"
        );

        // With a known last_run_at, should find the next occurrence after it
        let last = "2026-01-01T06:00:00+00:00";
        let result = compute_next_run_at(&trigger, Some(last));
        assert!(result.is_some());
        let result_str = result.unwrap();
        // Next run should be at 12:00
        assert!(
            result_str.contains("12:00"),
            "Expected 12:00 in next run, got: {result_str}"
        );
    }

    #[test]
    fn compute_next_run_cron_invalid_expression_returns_none() {
        let trigger = AutomationTrigger::Cron(CronTrigger {
            expression: "invalid cron".to_string(),
        });
        let result = compute_next_run_at(&trigger, None);
        assert!(
            result.is_none(),
            "Invalid cron expression should return None"
        );
    }

    #[test]
    fn cron_fired_in_interval_basic() {
        // Cron every hour at minute 0
        let expression = "0 * * * *";

        // Case 1: last run at 10:00, now at 10:30 → no fire (next fire at 11:00)
        let after = DateTime::parse_from_rfc3339("2026-01-01T10:00:00+00:00")
            .unwrap()
            .to_utc();
        let now = DateTime::parse_from_rfc3339("2026-01-01T10:30:00+00:00")
            .unwrap()
            .to_utc();
        assert!(
            !cron_fired_in_interval(expression, after, now),
            "Should not fire: 10:30 is before 11:00"
        );

        // Case 2: last run at 10:00, now at 11:05 → fire (11:00 is within interval)
        let now = DateTime::parse_from_rfc3339("2026-01-01T11:05:00+00:00")
            .unwrap()
            .to_utc();
        assert!(
            cron_fired_in_interval(expression, after, now),
            "Should fire: 11:00 is between 10:00 and 11:05"
        );
    }

    #[test]
    fn cron_fired_in_interval_cross_hour_boundary() {
        let expression = "0 */6 * * *"; // Every 6 hours at minute 0

        // last run at 00:00, now at 06:05 → fire
        let after = DateTime::parse_from_rfc3339("2026-01-01T00:00:00+00:00")
            .unwrap()
            .to_utc();
        let now = DateTime::parse_from_rfc3339("2026-01-01T06:05:00+00:00")
            .unwrap()
            .to_utc();
        assert!(
            cron_fired_in_interval(expression, after, now),
            "Should fire: 06:00 is between 00:00 and 06:05"
        );
    }

    #[test]
    fn cron_fired_in_interval_cross_day_boundary() {
        let expression = "0 0 * * *"; // Daily at midnight

        // last run at Jan 1 00:00, now at Jan 2 00:05 → fire
        let after = DateTime::parse_from_rfc3339("2026-01-01T00:00:00+00:00")
            .unwrap()
            .to_utc();
        let now = DateTime::parse_from_rfc3339("2026-01-02T00:05:00+00:00")
            .unwrap()
            .to_utc();
        assert!(
            cron_fired_in_interval(expression, after, now),
            "Should fire: Jan 2 00:00 is between Jan 1 00:00 and Jan 2 00:05"
        );
    }

    #[test]
    fn cron_fired_in_interval_invalid_expression() {
        let expression = "not a cron";
        let after = DateTime::parse_from_rfc3339("2026-01-01T00:00:00+00:00")
            .unwrap()
            .to_utc();
        let now = DateTime::parse_from_rfc3339("2026-01-02T00:05:00+00:00")
            .unwrap()
            .to_utc();
        assert!(
            !cron_fired_in_interval(expression, after, now),
            "Invalid cron should never fire"
        );
    }

    #[test]
    fn run_history_capped_at_max() {
        let root = unique_temp_dir("automation_history_cap");
        let _store = AutomationStore::new(root.clone());

        let mut task = AutomationTask {
            id: "test-cap".to_string(),
            name: "Cap Test".to_string(),
            enabled: true,
            trigger: sample_trigger(),
            target_project_path: "/tmp/project".to_string(),
            target_thread_id: None,
            prompt: "Test".to_string(),
            access_mode: "auto".to_string(),
            last_run_at: None,
            next_run_at: None,
            run_history: Vec::new(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        };

        for i in 0..60 {
            task.run_history.insert(
                0,
                AutomationRunRecord {
                    run_at: format!("2026-01-01T{:02}:00:00Z", i),
                    status: "succeeded".to_string(),
                    summary: Some(format!("Run {i}")),
                },
            );
        }
        assert_eq!(task.run_history.len(), 60);

        // Truncate manually as store does
        task.run_history.truncate(MAX_RUN_HISTORY);
        assert_eq!(task.run_history.len(), MAX_RUN_HISTORY);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_and_delete_task() {
        let root = unique_temp_dir("automation_create_delete");
        let store = AutomationStore::new(root.clone());

        let task = AutomationTask {
            id: "task-cd".to_string(),
            name: "CD Task".to_string(),
            enabled: true,
            trigger: sample_trigger(),
            target_project_path: "/tmp/project".to_string(),
            target_thread_id: Some("thread-1".to_string()),
            prompt: "Build and test".to_string(),
            access_mode: "read_only".to_string(),
            last_run_at: None,
            next_run_at: None,
            run_history: Vec::new(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        };

        store.save_tasks(vec![task]).expect("save should succeed");
        let loaded = store.load_tasks().expect("load should succeed");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].target_thread_id, Some("thread-1".to_string()));
        assert_eq!(loaded[0].access_mode, "read_only");

        // Delete
        let mut tasks = loaded;
        tasks.retain(|t| t.id != "task-cd");
        store.save_tasks(tasks).expect("save after delete should succeed");

        let after_delete = store.load_tasks().expect("load should succeed");
        assert!(after_delete.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn file_change_trigger_serialization() {
        let trigger = AutomationTrigger::FileChange(FileChangeTrigger {
            patterns: vec!["**/*.ts".to_string(), "**/*.tsx".to_string()],
        });
        let json = serde_json::to_string(&trigger).expect("serialize should work");
        assert!(json.contains("file_change"));
        assert!(json.contains("**/*.ts"));

        let deserialized: AutomationTrigger =
            serde_json::from_str(&json).expect("deserialize should work");
        if let AutomationTrigger::FileChange(fc) = deserialized {
            assert_eq!(fc.patterns.len(), 2);
        } else {
            panic!("Expected FileChange trigger");
        }
    }

    #[test]
    fn build_glob_matcher_valid_patterns() {
        let patterns = vec!["**/*.ts".to_string(), "**/*.tsx".to_string()];
        let matcher = file_watcher::build_glob_matcher(&patterns);
        assert!(matcher.is_some());
        let m = matcher.unwrap();
        assert!(m.is_match("src/App.ts"));
        assert!(m.is_match("src/App.tsx"));
        assert!(!m.is_match("src/App.js"));
    }

    #[test]
    fn build_glob_matcher_empty_patterns() {
        let patterns: Vec<String> = vec![];
        let matcher = file_watcher::build_glob_matcher(&patterns);
        assert!(matcher.is_none());
    }

    #[test]
    fn build_glob_matcher_invalid_patterns() {
        let patterns = vec!["[invalid".to_string()];
        let matcher = file_watcher::build_glob_matcher(&patterns);
        // Should return None since the only pattern is invalid
        assert!(matcher.is_none());
    }

    #[test]
    fn file_change_debounce_logic() {
        use std::time::{Duration, Instant};

        let now = Instant::now();

        let last_fire: Option<Instant> = None;
        let should_fire = match last_fire {
            None => true,
            Some(lf) => {
                now.duration_since(lf) >= Duration::from_secs(file_watcher::AUTOMATION_FILE_DEBOUNCE_SECS as u64)
            }
        };
        assert!(should_fire, "First fire should always trigger");

        let last_fire = Some(now);
        let should_fire = match last_fire {
            None => true,
            Some(lf) => {
                now.duration_since(lf) >= Duration::from_secs(file_watcher::AUTOMATION_FILE_DEBOUNCE_SECS as u64)
            }
        };
        assert!(!should_fire, "Immediate second fire should be debounced");

        let later = now + Duration::from_secs(file_watcher::AUTOMATION_FILE_DEBOUNCE_SECS as u64 + 1);
        let should_fire = match last_fire {
            None => true,
            Some(lf) => {
                later.duration_since(lf) >= Duration::from_secs(file_watcher::AUTOMATION_FILE_DEBOUNCE_SECS as u64)
            }
        };
        assert!(should_fire, "Fire after debounce period should trigger");
    }

    #[test]
    fn should_record_failure_skips_duplicate_cron_invalid_entries() {
        let task = AutomationTask {
            id: "cron-invalid".to_string(),
            name: "Cron".to_string(),
            enabled: true,
            trigger: AutomationTrigger::Cron(CronTrigger {
                expression: "bad".to_string(),
            }),
            target_project_path: "/tmp/project".to_string(),
            target_thread_id: None,
            prompt: "Test".to_string(),
            access_mode: "auto".to_string(),
            last_run_at: None,
            next_run_at: None,
            run_history: vec![AutomationRunRecord {
                run_at: "2026-01-01T00:00:00Z".to_string(),
                status: "failed".to_string(),
                summary: Some(CRON_INVALID_SUMMARY.to_string()),
            }],
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        };

        assert!(!should_record_failure(&task, CRON_INVALID_SUMMARY));
        assert!(should_record_failure(&task, "other reason"));
    }
}
