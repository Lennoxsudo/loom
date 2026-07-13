//! Persistent storage for cumulative token usage / cost statistics.
//! Mirrors the simple Tier-A pattern used by `editor_settings.rs`:
//! a single JSON file under the user's dot-config dir (`~/.loom/usage.json`).

use std::fs;

use serde_json::Value;

#[tauri::command]
pub fn save_usage(usage: String) -> Result<String, String> {
    use crate::config_paths;

    let config_dir = config_paths::dot_config_dir()?;
    fs::create_dir_all(&config_dir).map_err(|e| format!("创建配置目录失败: {}", e))?;

    let config_file = config_dir.join("usage.json");

    let json_value: Value =
        serde_json::from_str(&usage).map_err(|e| format!("JSON解析失败: {}", e))?;

    let formatted_json =
        serde_json::to_string_pretty(&json_value).map_err(|e| format!("JSON格式化失败: {}", e))?;

    fs::write(&config_file, formatted_json).map_err(|e| format!("保存用量数据失败: {}", e))?;

    Ok("用量数据已保存".to_string())
}

#[tauri::command]
pub fn load_usage() -> Result<String, String> {
    use crate::config_paths;

    let config_file = config_paths::resolve_dot_config_file("usage.json")?;

    if !config_file.exists() {
        return Ok("{}".to_string());
    }

    let content = fs::read_to_string(&config_file).map_err(|e| format!("读取用量数据失败: {}", e))?;
    Ok(content)
}
