pub mod cli;
pub mod commands;
mod config;
mod estimate;
mod list_enrich;
pub mod path;
mod project_path;
mod registry;
mod state;
mod storage;
pub mod types;
mod ui;
mod version;

use tauri::Manager;

pub use registry::CbmTaskRegistry;
pub use state::CbmState;
pub use ui::CbmUiState;

/// Stop CBM UI server, cancel background tasks, and terminate in-flight CLI subprocesses on app exit.
pub fn shutdown_all(app: &tauri::AppHandle) {
    // 1. Cancel background tasks — also kills in-flight CLI subprocesses so
    //    that threads blocked in recv_timeout unblock immediately, allowing
    //    wait_all to join them within the 5s budget.
    if let Some(registry) = app.try_state::<CbmTaskRegistry>() {
        registry.cancel_all();
        registry.wait_all(std::time::Duration::from_secs(5));
    }
    // 2. Kill CBM UI process
    if let Some(ui) = app.try_state::<CbmUiState>() {
        let _ = ui.stop();
    }
}
