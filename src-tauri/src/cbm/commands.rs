use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use super::path::cbm_sidecar_available as is_sidecar_available;
use super::state::CbmState;
use super::types::{
    build_cli_args, cbm_cli_tool_name, is_valid_graph_action, CbmDeleteResult, CbmIndexedProject,
    CbmScheduleResult, CbmStorageInfo,
};
use super::ui::CbmUiStatus;

#[tauri::command]
pub fn cbm_sidecar_available(app: AppHandle) -> bool {
    is_sidecar_available(&app)
}

#[tauri::command]
pub async fn cbm_graph(
    tool: String,
    action: String,
    payload: Value,
    app: AppHandle,
) -> Result<String, String> {
    if !is_valid_graph_action(&tool, &action) {
        return Err(format!("不支持的 graph 工具/action: {tool}/{action}"));
    }
    if !is_sidecar_available(&app) {
        return Err("codebase-memory sidecar 不可用".into());
    }

    let state = app.state::<CbmState>();
    state.check_circuit()?;

    let cli_tool = cbm_cli_tool_name(&tool, &action)
        .ok_or_else(|| format!("无法映射 CBM CLI: {tool}/{action}"))?;
    let args_json = build_cli_args(&tool, &action, &payload)?;

    // spawn_blocking: run_cbm_cli may block for a long time (e.g. indexing);
    // offload to a blocking thread to avoid stalling the async executor.
    let app_clone = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        super::cli::run_cbm_cli(&app_clone, cli_tool, args_json.as_deref())
    })
    .await
    .map_err(|e| format!("CBM 任务执行失败: {e}"))?;

    match result {
        Ok(output) => {
            state.record_success();
            let output = if cli_tool == "list_projects" {
                super::list_enrich::enrich_list_projects_json(&output).unwrap_or(output)
            } else {
                output
            };
            Ok(output)
        }
        Err(e) => {
            state.record_failure_if_transient(&e);
            Err(super::cli::format_cbm_cli_error(&e))
        }
    }
}

#[tauri::command]
pub async fn cbm_schedule_workspace_index(
    repo_path: String,
    max_files: Option<u64>,
    force: Option<bool>,
    app: AppHandle,
) -> Result<CbmScheduleResult, String> {
    let force_reindex = force.unwrap_or(false);
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app_handle.state::<CbmState>();
        state.schedule_workspace_index(app_handle.clone(), repo_path, max_files, force_reindex)
    })
    .await
    .map_err(|e| format!("cbm_schedule_workspace_index join error: {e}"))?
}

#[tauri::command]
pub async fn cbm_delete_workspace_index(
    repo_path: String,
    enable_code_graph: bool,
    app: AppHandle,
) -> Result<CbmDeleteResult, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app_handle.state::<CbmState>();
        state.delete_workspace_index(&app_handle, repo_path, enable_code_graph)
    })
    .await
    .map_err(|e| format!("cbm_delete_workspace_index join error: {e}"))?
}

#[tauri::command]
pub async fn cbm_list_indexed_projects(app: AppHandle) -> Result<Vec<CbmIndexedProject>, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app_handle.state::<CbmState>();
        state.list_indexed_projects(&app_handle)
    })
    .await
    .map_err(|e| format!("cbm_list_indexed_projects join error: {e}"))?
}

#[tauri::command]
pub async fn cbm_storage_info(app: AppHandle) -> Result<CbmStorageInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cache_dir = super::path::cbm_cache_dir()?;
        let total_bytes = super::storage::cbm_cache_total_bytes()?;
        let sidecar_available = is_sidecar_available(&app);
        let runtime_version = super::path::resolve_cbm_executable(&app)
            .ok()
            .and_then(|path| super::version::read_runtime_version(&path));

        Ok(CbmStorageInfo {
            cache_dir: cache_dir.to_string_lossy().into_owned(),
            total_bytes,
            pinned_version: super::version::CBM_PINNED_VERSION.to_string(),
            runtime_version,
            sidecar_available,
        })
    })
    .await
    .map_err(|e| format!("cbm_storage_info join error: {e}"))?
}

#[tauri::command]
pub fn cbm_sync_config(
    auto_index: bool,
    auto_index_limit: Option<u64>,
    app: AppHandle,
) -> Result<super::config::CbmConfigSyncResult, String> {
    super::config::sync_cbm_config(&app, auto_index, auto_index_limit)
}

#[tauri::command]
pub fn cbm_ui_status(state: State<'_, super::ui::CbmUiState>) -> CbmUiStatus {
    state.status()
}

#[tauri::command]
pub async fn cbm_start_ui(
    app: AppHandle,
) -> Result<CbmUiStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<super::ui::CbmUiState>();
        state.start(&app)
    })
    .await
    .map_err(|e| format!("CBM UI start task failed: {e}"))?
}

#[tauri::command]
pub async fn cbm_stop_ui(
    app: AppHandle,
) -> Result<CbmUiStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<super::ui::CbmUiState>();
        state.stop()
    })
    .await
    .map_err(|e| format!("CBM UI stop task failed: {e}"))?
}
