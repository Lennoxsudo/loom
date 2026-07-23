//! HMAC request signing for Gateway-X runtime (built-in) clients.

use super::config::get_app_data_path;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

type HmacSha256 = Hmac<Sha256>;

pub const BUILTIN_GATEWAY_HOST: &str = "gateway.tanyun.store";
pub const TIMESTAMP_HEADER: &str = "x-gateway-timestamp";
pub const SIGNATURE_HEADER: &str = "x-gateway-signature";
pub const INSTALL_ID_HEADER: &str = "x-gateway-install-id";
const STORAGE_FILE: &str = "builtin-gateway.json";

#[derive(Debug, Clone)]
pub struct BuiltinGatewayCredentials {
    #[allow(dead_code)]
    pub api_key: String,
    pub client_secret: String,
    pub install_id: String,
}

pub fn is_builtin_gateway_endpoint(endpoint: &str) -> bool {
    endpoint.contains(BUILTIN_GATEWAY_HOST)
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn body_hash_hex(body: &[u8]) -> String {
    format!("{:x}", Sha256::digest(body))
}

fn signing_payload(timestamp: u64, method: &str, path: &str, body: &[u8]) -> String {
    format!(
        "{}\n{}\n{}\n{}",
        timestamp,
        method.to_ascii_uppercase(),
        path,
        body_hash_hex(body)
    )
}

pub fn sign_request(secret: &str, method: &str, path: &str, body: &[u8], timestamp: u64) -> String {
    let payload = signing_payload(timestamp, method, path, body);
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(payload.as_bytes());
    format!("v1={:x}", mac.finalize().into_bytes())
}

pub fn path_from_url(url: &str) -> String {
    reqwest::Url::parse(url)
        .map(|u| u.path().to_string())
        .unwrap_or_else(|_| "/".to_string())
}

fn storage_path(app: Option<&tauri::AppHandle>) -> Result<PathBuf, String> {
    if let Some(handle) = app {
        let dir = get_app_data_path(handle.clone())?;
        return Ok(PathBuf::from(dir).join(STORAGE_FILE));
    }
    let app_data = std::env::var("APPDATA")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "无法获取应用数据目录".to_string())?;
    let dir = PathBuf::from(&app_data).join("com.administrator.loom");
    let _ = crate::config_paths::migrate_legacy_app_data_dir(&dir);
    Ok(dir.join(STORAGE_FILE))
}

pub fn load_builtin_credentials(
    app: Option<&tauri::AppHandle>,
) -> Result<Option<BuiltinGatewayCredentials>, String> {
    let path = storage_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("读取内置网关配置失败: {e}"))?;
    parse_builtin_credentials(&content)
}

fn parse_builtin_credentials(content: &str) -> Result<Option<BuiltinGatewayCredentials>, String> {
    let v: serde_json::Value =
        serde_json::from_str(content).map_err(|e| format!("解析内置网关配置失败: {e}"))?;
    let api_key = v
        .get("apiKey")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let client_secret = v
        .get("clientSecret")
        .or_else(|| v.get("client_secret"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let install_id = v
        .get("installId")
        .or_else(|| v.get("install_id"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if api_key.is_empty() || client_secret.is_empty() || install_id.is_empty() {
        return Ok(None);
    }
    Ok(Some(BuiltinGatewayCredentials {
        api_key,
        client_secret,
        install_id,
    }))
}

pub fn require_builtin_credentials(
    endpoint: &str,
    app: Option<&tauri::AppHandle>,
) -> Result<Option<BuiltinGatewayCredentials>, String> {
    if !is_builtin_gateway_endpoint(endpoint) {
        return Ok(None);
    }
    load_builtin_credentials(app)?
        .ok_or_else(|| "内置网关需要重新激活（缺少 clientSecret）".to_string())
        .map(Some)
}

pub fn apply_openai_gateway_auth(
    req: reqwest::RequestBuilder,
    method: &str,
    url: &str,
    body: &[u8],
    api_key: &str,
    creds: Option<&BuiltinGatewayCredentials>,
) -> Result<reqwest::RequestBuilder, String> {
    let req = req.header("Authorization", format!("Bearer {}", api_key));
    let Some(creds) = creds else {
        return Ok(req);
    };
    if creds.client_secret.is_empty() {
        return Err("内置网关需要重新激活（缺少 clientSecret）".into());
    }
    let path = path_from_url(url);
    let ts = now_unix_secs();
    let sig = sign_request(&creds.client_secret, method, &path, body, ts);
    Ok(req
        .header(TIMESTAMP_HEADER, ts.to_string())
        .header(SIGNATURE_HEADER, sig)
        .header(INSTALL_ID_HEADER, &creds.install_id))
}

pub fn build_signed_openai_post_request(
    client: &reqwest::Client,
    url: &str,
    body_bytes: &[u8],
    api_key: &str,
    organization_id: &Option<String>,
    gateway_creds: Option<&BuiltinGatewayCredentials>,
) -> Result<reqwest::Request, String> {
    let mut req = apply_openai_gateway_auth(
        client.post(url),
        "POST",
        url,
        body_bytes,
        api_key,
        gateway_creds,
    )?;
    req = req.header("Content-Type", "application/json");
    if let Some(org_id) = organization_id {
        if !org_id.is_empty() {
            req = req.header("OpenAI-Organization", org_id);
        }
    }
    req.body(body_bytes.to_vec())
        .build()
        .map_err(|e| format!("构建请求失败: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_gateway_x_golden_vector() {
        let sig = sign_request(
            "gwsec_cross_test",
            "POST",
            "/v1/chat/completions",
            br#"{"model":"m","messages":[]}"#,
            1_700_000_000,
        );
        assert_eq!(
            sig,
            "v1=41656aa889587bdda419be40cd2b9e919674e1e422c0d53718c6c740c759d30e"
        );
    }

    #[test]
    fn gateway_x_compatible_vectors() {
        let secret = "gwsec_test";
        let ts = 1_700_000_000u64;
        let get_models = sign_request(secret, "GET", "/v1/models", b"", ts);
        let post_chat = sign_request(
            secret,
            "POST",
            "/v1/chat/completions",
            br#"{"model":"m","messages":[]}"#,
            ts,
        );
        assert_eq!(get_models, sign_request(secret, "GET", "/v1/models", b"", ts));
        assert_ne!(get_models, post_chat);
        assert!(get_models.starts_with("v1=") && get_models.len() == 67);
    }

    #[test]
    fn parse_storage_json() {
        let json = r#"{"installId":"i1","apiKey":"sk-gw-rt-x","clientSecret":"gwsec_y"}"#;
        let creds = parse_builtin_credentials(json).unwrap().unwrap();
        assert_eq!(creds.install_id, "i1");
        assert_eq!(creds.api_key, "sk-gw-rt-x");
        assert_eq!(creds.client_secret, "gwsec_y");
    }
}
