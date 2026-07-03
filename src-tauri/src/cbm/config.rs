use std::time::Duration;
use tauri::AppHandle;

use super::cli::run_cbm_with_timeout_unlocked;

/// Config set operations don't touch SQLite, so they bypass the RwLock entirely.
const CONFIG_TIMEOUT: Duration = Duration::from_secs(30);

/// Result of a CBM config sync operation.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CbmConfigSyncResult {
    pub success: bool,
    pub errors: Vec<String>,
}

pub fn sync_cbm_config(
    app: &AppHandle,
    auto_index: bool,
    auto_index_limit: Option<u64>,
) -> Result<CbmConfigSyncResult, String> {
    // Sidecar not installed is not a failure — config simply has nowhere to sync.
    if !super::path::cbm_sidecar_available(app) {
        return Ok(CbmConfigSyncResult {
            success: true,
            errors: vec![],
        });
    }

    let mut errors = Vec::new();

    let auto_index_value = if auto_index { "true" } else { "false" };
    if let Err(e) = run_cbm_with_timeout_unlocked(
        app,
        &["config", "set", "auto_index", auto_index_value],
        CONFIG_TIMEOUT,
    ) {
        errors.push(format!("auto_index={auto_index_value}: {e}"));
    }

    if let Some(limit) = auto_index_limit {
        if limit > 0 {
            let limit_str = limit.to_string();
            if let Err(e) = run_cbm_with_timeout_unlocked(
                app,
                &["config", "set", "auto_index_limit", limit_str.as_str()],
                CONFIG_TIMEOUT,
            ) {
                errors.push(format!("auto_index_limit={limit}: {e}"));
            }
        }
    }

    // Best-effort retry for auto_index (transient SQLite lock or sidecar busy).
    if errors.iter().any(|e| e.starts_with("auto_index=")) {
        std::thread::sleep(Duration::from_millis(500));
        if run_cbm_with_timeout_unlocked(
            app,
            &["config", "set", "auto_index", auto_index_value],
            CONFIG_TIMEOUT,
        )
        .is_ok()
        {
            errors.retain(|e| !e.starts_with("auto_index="));
        }
    }

    let success = errors.is_empty();

    // Log failures to debug log for diagnostics.
    if !success {
        for err in &errors {
            let _ = crate::debug_log::append_debug_log_entry(format!("cbm-config sync failed: {err}"));
        }
    }

    Ok(CbmConfigSyncResult { success, errors })
}
