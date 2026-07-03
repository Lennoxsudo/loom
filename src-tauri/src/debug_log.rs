use std::path::PathBuf;

fn debug_log_path() -> PathBuf {
    std::env::temp_dir().join("loom-agent-debug.log")
}

pub(crate) fn append_debug_log_entry(message: String) -> Result<(), String> {
    use std::io::Write;

    let path = debug_log_path();
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("打开调试日志失败: {}", e))?;

    let line = format!("{} {}\n", chrono::Local::now().to_rfc3339(), message);
    file.write_all(line.as_bytes())
        .map_err(|e| format!("写入调试日志失败: {}", e))
}

#[tauri::command]
pub fn debug_log(source: String, message: String) -> Result<(), String> {
    append_debug_log_entry(format!("frontend:{} {}", source, message))
}
