//! Built-in model channel (Gateway-X) HTTP helpers.
//! Requests run on the Rust side so the webview never hits CORS.

use super::gateway_sign::{apply_openai_gateway_auth, load_builtin_credentials};
use serde::Serialize;
use serde_json::Value;

const BUILTIN_GATEWAY_BASE: &str = "https://gateway.tanyun.store/v1";
const BUILTIN_GATEWAY_ORIGIN: &str = "https://gateway.tanyun.store";

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))
}

#[derive(Debug, Serialize)]
pub struct BuiltinHealthResult {
    pub ok: bool,
}

#[derive(Debug, Serialize)]
pub struct BuiltinActivateResult {
    pub api_key: String,
    pub client_secret: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    pub client_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quotas: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct BuiltinModelsResult {
    pub models: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct BuiltinQuotaResult {
    pub quotas: Value,
    pub usage: Value,
    pub remaining: Value,
}

#[tauri::command]
pub async fn builtin_gateway_health() -> Result<BuiltinHealthResult, String> {
    let client = build_client()?;
    let url = format!("{}/healthz", BUILTIN_GATEWAY_ORIGIN);
    match client.get(&url).send().await {
        Ok(res) => Ok(BuiltinHealthResult {
            ok: res.status().is_success(),
        }),
        Err(_) => Ok(BuiltinHealthResult { ok: false }),
    }
}

#[tauri::command]
pub async fn builtin_gateway_activate(
    invite_code: String,
    install_id: String,
) -> Result<BuiltinActivateResult, String> {
    let code = invite_code.trim();
    let install = install_id.trim();
    if code.is_empty() {
        return Err("Invite code is required".to_string());
    }
    if install.is_empty() {
        return Err("install_id is required".to_string());
    }

    let client = build_client()?;
    let url = format!("{}/activate", BUILTIN_GATEWAY_BASE);
    let body = serde_json::json!({
        "invite_code": code,
        "install_id": install,
    });

    let res = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Activation request failed: {}", e))?;

    let status = res.status();
    let text = res
        .text()
        .await
        .map_err(|e| format!("Failed to read activation response: {}", e))?;

    let json: Value = if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or(Value::Null)
    };

    if !status.is_success() {
        let msg = json
            .get("message")
            .and_then(|v| v.as_str())
            .or_else(|| json.get("error").and_then(|v| v.as_str()))
            .or_else(|| {
                json.get("error")
                    .and_then(|v| v.get("message"))
                    .and_then(|v| v.as_str())
            })
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                if text.trim().is_empty() {
                    format!("Activation failed ({})", status.as_u16())
                } else {
                    text
                }
            });
        return Err(msg);
    }

    let api_key = json
        .get("api_key")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let client_secret = json
        .get("client_secret")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let client_id = json
        .get("client_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if api_key.is_empty() || client_secret.is_empty() || client_id.is_empty() {
        return Err(
            "Activation response missing api_key, client_secret, or client_id".to_string(),
        );
    }

    Ok(BuiltinActivateResult {
        api_key,
        client_secret,
        endpoint: json
            .get("endpoint")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        client_id,
        quotas: json.get("quotas").cloned(),
    })
}

#[tauri::command]
pub async fn builtin_gateway_list_models(api_key: String) -> Result<BuiltinModelsResult, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("api_key is required".to_string());
    }

    let creds = load_builtin_credentials(None)?
        .ok_or_else(|| "内置网关需要重新激活（缺少 clientSecret）".to_string())?;

    let client = build_client()?;
    let url = format!("{}/models", BUILTIN_GATEWAY_BASE);
    let req = apply_openai_gateway_auth(
        client.get(&url),
        "GET",
        &url,
        &[],
        key,
        Some(&creds),
    )?;
    let res = req
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to list models: {}", e))?;

    let status = res.status();
    if status.as_u16() == 401 {
        return Err("UNAUTHORIZED".to_string());
    }
    if !status.is_success() {
        return Err(format!("Failed to list models ({})", status.as_u16()));
    }

    let json: Value = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse models response: {}", e))?;

    let mut models = Vec::new();
    if let Some(data) = json.get("data").and_then(|v| v.as_array()) {
        for item in data {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                let trimmed = id.trim();
                if !trimmed.is_empty() {
                    models.push(trimmed.to_string());
                }
            }
        }
    }

    Ok(BuiltinModelsResult { models })
}

#[tauri::command]
pub async fn builtin_gateway_get_quota(api_key: String) -> Result<BuiltinQuotaResult, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("api_key is required".to_string());
    }

    let creds = load_builtin_credentials(None)?
        .ok_or_else(|| "内置网关需要重新激活（缺少 clientSecret）".to_string())?;

    let client = build_client()?;
    let url = format!("{}/quota", BUILTIN_GATEWAY_BASE);
    let req = apply_openai_gateway_auth(
        client.get(&url),
        "GET",
        &url,
        &[],
        key,
        Some(&creds),
    )?;
    let res = req
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to load quota: {}", e))?;

    let status = res.status();
    if status.as_u16() == 401 {
        return Err("UNAUTHORIZED".to_string());
    }
    if !status.is_success() {
        return Err(format!("Failed to load quota ({})", status.as_u16()));
    }

    let json: Value = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse quota response: {}", e))?;

    let quotas = json.get("quotas").cloned().unwrap_or(Value::Null);
    let usage = json.get("usage").cloned().unwrap_or(Value::Null);
    let remaining = json.get("remaining").cloned().unwrap_or(Value::Null);
    if !quotas.is_object() || !usage.is_object() || !remaining.is_object() {
        return Err("Invalid quota response".to_string());
    }

    Ok(BuiltinQuotaResult {
        quotas,
        usage,
        remaining,
    })
}
