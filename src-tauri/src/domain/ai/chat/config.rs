use super::types::AIConfig;
use super::types::AutoRoutingConfig;
use std::fs;
use std::path::Path;
use tauri::Manager;

pub fn ensure_ai_model(config: &mut AIConfig) -> Result<(), String> {
    if !config.model.trim().is_empty() {
        return Ok(());
    }

    if let Some(first) = config.models.get(0) {
        if !first.trim().is_empty() {
            config.model = first.clone();
            return Ok(());
        }
    }

    Err("妯″瀷鏈厤缃紝璇峰厛鍦ㄨ缃腑閰嶇疆 models 鎴?model".to_string())
}

pub fn get_active_profile_config(
    config_json: &serde_json::Value,
    provider: &str,
) -> Option<AIConfig> {
    let profiles = config_json.get("profiles")?;
    let provider_profiles = profiles.get(provider)?;
    let active_id = provider_profiles.get("activeId")?.as_str()?;
    let items = provider_profiles.get("items")?.as_array()?;

    for item in items {
        if let Some(item_id) = item.get("id").and_then(|v| v.as_str()) {
            if item_id == active_id {
                if let Ok(cfg) = serde_json::from_value::<AIConfig>(item.clone()) {
                    return Some(cfg);
                }
            }
        }
    }
    None
}

pub fn get_profile_config_by_id(
    config_json: &serde_json::Value,
    provider: &str,
    profile_id: &str,
) -> Option<AIConfig> {
    let profiles = config_json.get("profiles")?;
    let provider_profiles = profiles.get(provider)?;
    let items = provider_profiles.get("items")?.as_array()?;

    for item in items {
        if let Some(item_id) = item.get("id").and_then(|v| v.as_str()) {
            if item_id == profile_id {
                if let Ok(cfg) = serde_json::from_value::<AIConfig>(item.clone()) {
                    return Some(cfg);
                }
            }
        }
    }
    None
}

pub fn push_unique_openai_url(urls: &mut Vec<String>, candidate: String) {
    if candidate.is_empty() {
        return;
    }
    if !urls.iter().any(|url| url == &candidate) {
        urls.push(candidate);
    }
}

pub fn openai_chat_completion_urls(endpoint: &str) -> Vec<String> {
    let endpoint_trimmed = endpoint.trim().trim_end_matches('/');
    if endpoint_trimmed.is_empty() {
        return Vec::new();
    }

    let path = "/chat/completions";
    let mut urls: Vec<String> = Vec::new();

    if endpoint_trimmed.ends_with(path) {
        push_unique_openai_url(&mut urls, endpoint_trimmed.to_string());
        return urls;
    }

    let has_explicit_path = reqwest::Url::parse(endpoint_trimmed)
        .ok()
        .map(|url| url.path() != "/")
        .unwrap_or(true);

    if endpoint_trimmed.ends_with("/v1") {
        push_unique_openai_url(&mut urls, format!("{}{}", endpoint_trimmed, path));
    } else if has_explicit_path {
        push_unique_openai_url(&mut urls, format!("{}{}", endpoint_trimmed, path));
    } else {
        push_unique_openai_url(&mut urls, format!("{}/v1{}", endpoint_trimmed, path));
        push_unique_openai_url(&mut urls, format!("{}{}", endpoint_trimmed, path));
    }

    urls
}

pub fn openai_models_urls(endpoint: &str) -> Vec<String> {
    let endpoint_trimmed = endpoint.trim().trim_end_matches('/');
    if endpoint_trimmed.is_empty() {
        return Vec::new();
    }

    let path = "/models";
    let mut urls: Vec<String> = Vec::new();

    if endpoint_trimmed.ends_with(path) {
        push_unique_openai_url(&mut urls, endpoint_trimmed.to_string());
        return urls;
    }

    if endpoint_trimmed.ends_with("/chat/completions") {
        let base = endpoint_trimmed.trim_end_matches("/chat/completions");
        if base.ends_with("/v1") {
            push_unique_openai_url(&mut urls, format!("{}/models", base));
        } else {
            push_unique_openai_url(&mut urls, format!("{}/v1/models", base));
            push_unique_openai_url(&mut urls, format!("{}/models", base));
        }
        return urls;
    }

    let has_explicit_path = reqwest::Url::parse(endpoint_trimmed)
        .ok()
        .map(|url| url.path() != "/")
        .unwrap_or(true);

    if endpoint_trimmed.ends_with("/v1") {
        push_unique_openai_url(&mut urls, format!("{}{}", endpoint_trimmed, path));
    } else if has_explicit_path {
        push_unique_openai_url(&mut urls, format!("{}{}", endpoint_trimmed, path));
    } else {
        push_unique_openai_url(&mut urls, format!("{}/v1{}", endpoint_trimmed, path));
        push_unique_openai_url(&mut urls, format!("{}{}", endpoint_trimmed, path));
    }

    urls
}

pub fn get_ollama_base_url(endpoint: &str) -> String {
    endpoint
        .trim()
        .trim_end_matches('/')
        .trim_end_matches("/chat/completions")
        .trim_end_matches('/')
        .trim_end_matches("/v1")
        .trim_end_matches('/')
        .to_string()
}

pub fn get_anthropic_models_url(endpoint: &str) -> String {
    let endpoint_trimmed = endpoint.trim().trim_end_matches('/');
    if endpoint_trimmed.ends_with("/models") {
        endpoint_trimmed.to_string()
    } else if endpoint_trimmed.ends_with("/messages") {
        format!("{}/models", endpoint_trimmed.trim_end_matches("/messages"))
    } else if endpoint_trimmed.ends_with("/v1") {
        format!("{}/models", endpoint_trimmed)
    } else {
        format!("{}/v1/models", endpoint_trimmed)
    }
}

pub fn get_ollama_chat_url(endpoint: &str) -> String {
    let endpoint_trimmed = endpoint.trim().trim_end_matches('/');
    if endpoint_trimmed.ends_with("/chat/completions") {
        endpoint_trimmed.to_string()
    } else if endpoint_trimmed.ends_with("/v1") {
        format!("{}/chat/completions", endpoint_trimmed)
    } else {
        format!("{}/v1/chat/completions", endpoint_trimmed)
    }
}

pub fn get_anthropic_chat_url(endpoint: &str) -> String {
    let endpoint_trimmed = endpoint.trim().trim_end_matches('/');
    if endpoint_trimmed.ends_with("/messages") {
        endpoint_trimmed.to_string()
    } else if endpoint_trimmed.ends_with("/v1") {
        format!("{}/messages", endpoint_trimmed)
    } else {
        format!("{}/v1/messages", endpoint_trimmed)
    }
}

pub fn openai_images_generations_urls(endpoint: &str) -> Vec<String> {
    let endpoint_trimmed = endpoint.trim().trim_end_matches('/');
    if endpoint_trimmed.is_empty() {
        return Vec::new();
    }

    let path = "/images/generations";
    let mut urls: Vec<String> = Vec::new();

    if endpoint_trimmed.ends_with(path) {
        push_unique_openai_url(&mut urls, endpoint_trimmed.to_string());
        return urls;
    }

    if endpoint_trimmed.ends_with("/chat/completions") {
        let base = endpoint_trimmed.trim_end_matches("/chat/completions");
        if base.ends_with("/v1") {
            push_unique_openai_url(&mut urls, format!("{}/images/generations", base));
        } else {
            push_unique_openai_url(&mut urls, format!("{}/v1/images/generations", base));
            push_unique_openai_url(&mut urls, format!("{}/images/generations", base));
        }
        return urls;
    }

    let has_explicit_path = reqwest::Url::parse(endpoint_trimmed)
        .ok()
        .map(|url| url.path() != "/")
        .unwrap_or(true);

    if endpoint_trimmed.ends_with("/v1") {
        push_unique_openai_url(&mut urls, format!("{}{}", endpoint_trimmed, path));
    } else if has_explicit_path {
        push_unique_openai_url(&mut urls, format!("{}{}", endpoint_trimmed, path));
    } else {
        push_unique_openai_url(&mut urls, format!("{}/v1{}", endpoint_trimmed, path));
        push_unique_openai_url(&mut urls, format!("{}{}", endpoint_trimmed, path));
    }

    urls
}

pub fn get_ai_config_path() -> String {
    crate::config_paths::resolve_ai_config_path()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|_| {
            crate::config_paths::user_data_config_dir()
                .map(|path| path.join("ai-config.json").to_string_lossy().into_owned())
                .unwrap_or_else(|_| String::new())
        })
}

pub fn load_ai_config_json() -> Result<serde_json::Value, String> {
    let config_path = get_ai_config_path();
    if !Path::new(&config_path).exists() {
        return Err("AI配置未找到，请先在设置中配置".to_string());
    }

    let content = fs::read_to_string(&config_path).map_err(|e| format!("读取配置失败: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("解析配置失败: {}", e))
}

/// Load the auto-routing configuration from the AI config JSON.
/// Returns `None` if the config doesn't exist or doesn't have an autoRouting field.
pub fn load_auto_routing_config(config_json: &serde_json::Value) -> Option<AutoRoutingConfig> {
    let auto_routing = config_json.get("autoRouting")?;
    serde_json::from_value(auto_routing.clone()).ok()
}

/// Check if an error string represents a quota-exhausted error from the retry layer.
pub fn is_quota_exhausted_error_str(error: &str) -> bool {
    error.starts_with(crate::chat::retry::QUOTA_EXHAUSTED_PREFIX)
}

/// Whether auto-routing should attempt the next configured entry for this error.
pub fn is_auto_routing_fallback_error(error: &str) -> bool {
    if is_quota_exhausted_error_str(error) {
        return true;
    }

    let lower = error.to_lowercase();
    const KEYWORDS: &[&str] = &[
        "quota",
        "insufficient_quota",
        "insufficient",
        "exhausted",
        "rate limit",
        "rate_limit",
        "余额",
        "额度",
        "配额",
        "credit",
        "billing",
        "payment required",
        "out of credits",
        "余额不足",
    ];
    if KEYWORDS.iter().any(|keyword| lower.contains(keyword)) {
        return true;
    }

    // Errors surfaced by the retry layer after HTTP failures.
    if lower.contains("api返回错误") || lower.contains("api服务端错误") {
        return true;
    }
    if lower.contains("请求失败（重试") {
        return true;
    }

    false
}

/// Find the index of a routing entry matching the active provider/profile/model.
pub fn find_auto_routing_entry_index(
    routing: &AutoRoutingConfig,
    provider: &str,
    profile_id: Option<&str>,
    model: &str,
) -> Option<usize> {
    if let Some(pid) = profile_id.filter(|value| !value.is_empty()) {
        if let Some(index) = routing.entries.iter().position(|entry| {
            entry.provider == provider && entry.profile_id == pid && entry.model == model
        }) {
            return Some(index);
        }
    }

    routing.entries.iter().position(|entry| {
        entry.provider == provider && entry.model == model
    })
}

#[tauri::command]
pub fn save_ai_config(config: String) -> Result<String, String> {
    let config_dir = crate::config_paths::user_data_config_dir()?;
    let config_path = config_dir.join("ai-config.json");

    fs::create_dir_all(&config_dir).map_err(|e| format!("创建目录失败: {}", e))?;

    let json_value: serde_json::Value =
        serde_json::from_str(&config).map_err(|e| format!("JSON解析失败: {}", e))?;

    let formatted_json =
        serde_json::to_string_pretty(&json_value).map_err(|e| format!("JSON格式化失败: {}", e))?;

    fs::write(&config_path, formatted_json).map_err(|e| format!("保存配置失败: {}", e))?;

    Ok(format!("配置已保存到: {}", config_path.display()))
}

#[tauri::command]
pub fn load_ai_config() -> Result<String, String> {
    let config_path = get_ai_config_path();

    if !Path::new(&config_path).exists() {
        return Ok(String::new());
    }

    fs::read_to_string(config_path).map_err(|e| format!("读取配置失败: {}", e))
}

pub fn get_prompts_path() -> String {
    crate::config_paths::resolve_prompts_path()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|_| {
            crate::config_paths::user_data_config_dir()
                .map(|path| path.join("prompts.json").to_string_lossy().into_owned())
                .unwrap_or_else(|_| String::new())
        })
}

#[tauri::command]
pub fn get_prompts_config_path() -> Result<String, String> {
    Ok(get_prompts_path())
}

#[tauri::command]
pub fn save_prompts(prompts: String) -> Result<String, String> {
    let config_dir = crate::config_paths::user_data_config_dir()?;

    fs::create_dir_all(&config_dir).map_err(|e| format!("创建目录失败: {}", e))?;

    let json_value: serde_json::Value =
        serde_json::from_str(&prompts).map_err(|e| format!("JSON解析失败: {}", e))?;

    let formatted_json =
        serde_json::to_string_pretty(&json_value).map_err(|e| format!("JSON格式化失败: {}", e))?;

    let config_path = config_dir.join("prompts.json");

    fs::write(&config_path, formatted_json).map_err(|e| format!("保存提示词失败: {}", e))?;

    Ok("提示词已保存".to_string())
}

#[tauri::command]
pub fn load_prompts() -> Result<String, String> {
    let config_path = get_prompts_path();

    if !Path::new(&config_path).exists() {
        return Ok("[]".to_string());
    }

    fs::read_to_string(config_path).map_err(|e| format!("读取提示词失败: {}", e))
}

#[tauri::command]
pub fn get_app_data_path(app: tauri::AppHandle) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
    Ok(app_data_dir.to_string_lossy().to_string())
}
