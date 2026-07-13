//! Application startup: sandbox OS init, migrations, audit log path, automation.

use tauri::Manager;

/// Run once during `tauri::Builder::setup`.
pub fn run(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // P1: Initialize OS-level sandbox (Windows Job Object)
    crate::sandbox_os::init_sandbox();

    if let Ok(app_data_dir) = app.path().app_data_dir() {
        let _ = crate::config_paths::migrate_legacy_app_data_dir(&app_data_dir);
    }

    // P2: Configure on-disk audit log persistence so sandbox
    // decisions survive application restarts.
    if let Ok(config_dir) = crate::config_paths::dot_config_dir() {
        let _ = std::fs::create_dir_all(&config_dir);
        crate::audit_log::set_log_file(config_dir.join("audit.log"));
    }

    // Explicit window icon (decode embedded PNG to RGBA)
    // Path is relative to this file: src/app/setup.rs → src-tauri/icons/
    let icon_bytes = include_bytes!("../../icons/icon.png");
    if let Ok(img) = image::load_from_memory(icon_bytes) {
        let rgba = img.to_rgba8();
        let (w, h) = rgba.dimensions();
        let icon = tauri::image::Image::new_owned(rgba.into_raw(), w, h);
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_icon(icon);
        }
    }

    // Automation scheduler (background thread, interval/cron)
    crate::automation::start_automation_scheduler(app.handle().clone());

    // file_change trigger watchers
    crate::automation::refresh_file_change_watchers(app.handle());

    Ok(())
}
