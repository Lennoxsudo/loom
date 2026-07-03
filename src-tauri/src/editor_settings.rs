#[tauri::command]
pub fn save_editor_settings(settings: String) -> Result<String, String> {
    use std::fs;

    let config_dir = crate::config_paths::dot_config_dir()?;
    fs::create_dir_all(&config_dir).map_err(|e| format!("创建配置目录失败: {}", e))?;

    let config_file = config_dir.join("editor_settings.json");

    let json_value: serde_json::Value =
        serde_json::from_str(&settings).map_err(|e| format!("JSON解析失败: {}", e))?;

    let formatted_json =
        serde_json::to_string_pretty(&json_value).map_err(|e| format!("JSON格式化失败: {}", e))?;

    fs::write(&config_file, formatted_json).map_err(|e| format!("保存配置失败: {}", e))?;

    println!("[Editor] Settings saved to {:?}", config_file);
    Ok("编辑器设置保存成功".to_string())
}

#[tauri::command]
pub fn load_editor_settings() -> Result<String, String> {
    use std::fs;

    let config_file = crate::config_paths::resolve_dot_config_file("editor_settings.json")?;

    if !config_file.exists() {
        return Ok(r#"{"tabSize":4,"autoSaveDelay":3000}"#.to_string());
    }

    let content = fs::read_to_string(&config_file).map_err(|e| format!("读取配置失败: {}", e))?;

    println!("[Editor] Settings loaded from {:?}", config_file);
    Ok(content)
}

pub fn percent_encode_path(s: &str) -> String {
    s.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'~' {
                (b as char).to_string()
            } else {
                format!("%{:02X}", b)
            }
        })
        .collect()
}
