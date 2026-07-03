//! Browser module - Browser window management
//!
//! This module contains browser window state, status types, and Tauri commands
//! for browser window automation.

use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

// ============================================================================
// Browser Window State
// ============================================================================

/// Global state for browser window
pub struct BrowserWindowState {
    pub window_label: Arc<Mutex<Option<String>>>,
}

impl Default for BrowserWindowState {
    fn default() -> Self {
        Self {
            window_label: Arc::new(Mutex::new(None)),
        }
    }
}

// ============================================================================
// Browser Window Status
// ============================================================================

/// Status of the browser window
#[derive(Serialize, Clone)]
pub struct BrowserWindowStatus {
    pub is_open: bool,
    pub label: Option<String>,
}

// ============================================================================
// Tauri Commands
// ============================================================================

#[tauri::command]
pub fn open_browser_window(
    app: tauri::AppHandle,
    url: String,
    state: State<BrowserWindowState>,
) -> Result<(), String> {
    println!("[Browser] Opening browser window with URL: {}", url);

    let label = "browser-window";

    // 检查窗口是否已存在
    if let Some(existing) = app.get_webview_window(label) {
        // 窗口已存在，导航到新 URL 并聚焦
        existing
            .navigate(url.parse().map_err(|e| format!("无效的 URL: {}", e))?)
            .map_err(|e| format!("导航失败: {}", e))?;
        existing
            .set_focus()
            .map_err(|e| format!("聚焦失败: {}", e))?;
        return Ok(());
    }

    // 创建新窗口
    let webview_url = WebviewUrl::External(url.parse().map_err(|e| format!("无效的 URL: {}", e))?);

    WebviewWindowBuilder::new(&app, label, webview_url)
        .title("浏览器")
        .inner_size(1200.0, 800.0)
        .center()
        .visible(true)
        .build()
        .map_err(|e| format!("创建窗口失败: {}", e))?;

    // 保存窗口标签
    {
        let mut window_label = state
            .window_label
            .lock()
            .map_err(|_| "锁定失败".to_string())?;
        *window_label = Some(label.to_string());
    }

    Ok(())
}

#[tauri::command]
pub fn navigate_browser(app: tauri::AppHandle, url: String) -> Result<(), String> {
    println!("[Browser] Navigating to: {}", url);

    let label = "browser-window";

    if let Some(window) = app.get_webview_window(label) {
        window
            .navigate(url.parse().map_err(|e| format!("无效的 URL: {}", e))?)
            .map_err(|e| format!("导航失败: {}", e))?;
        Ok(())
    } else {
        Err("浏览器窗口未打开".to_string())
    }
}

#[tauri::command]
pub fn close_browser_window(
    app: tauri::AppHandle,
    state: State<BrowserWindowState>,
) -> Result<(), String> {
    println!("[Browser] Closing browser window");

    let label = "browser-window";

    if let Some(window) = app.get_webview_window(label) {
        window.close().map_err(|e| format!("关闭失败: {}", e))?;
    }

    // 清除状态
    {
        let mut window_label = state
            .window_label
            .lock()
            .map_err(|_| "锁定失败".to_string())?;
        *window_label = None;
    }

    Ok(())
}

#[tauri::command]
pub fn get_browser_status(app: tauri::AppHandle) -> BrowserWindowStatus {
    let label = "browser-window";
    let is_open = app.get_webview_window(label).is_some();

    BrowserWindowStatus {
        is_open,
        label: if is_open {
            Some(label.to_string())
        } else {
            None
        },
    }
}
