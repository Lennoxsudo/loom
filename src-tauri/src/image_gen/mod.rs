use crate::chat::{load_ai_config_json, openai_images_generations_urls};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenerationConfig {
    pub enabled: Option<bool>,
    pub endpoint: Option<String>,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    pub models: Option<Vec<String>>,
    pub default_model: Option<String>,
    pub default_quality: Option<String>,
    #[serde(rename = "organizationId")]
    pub organization_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateImageRequest {
    pub prompt: String,
    pub project_path: String,
    pub model: Option<String>,
    pub size: Option<String>,
    pub quality: Option<String>,
    pub n: Option<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImageFile {
    pub relative_path: String,
    pub absolute_path: String,
    pub size: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateImageResult {
    pub success: bool,
    pub message: String,
    pub files: Vec<GeneratedImageFile>,
}

#[derive(Debug, Deserialize)]
struct ImagesApiResponse {
    data: Option<Vec<ImagesApiDataItem>>,
    error: Option<ImagesApiError>,
}

#[derive(Debug, Deserialize)]
struct ImagesApiDataItem {
    b64_json: Option<String>,
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ImagesApiError {
    message: Option<String>,
}

fn uses_sensenova_style(endpoint: &str, model: &str) -> bool {
    let endpoint_l = endpoint.to_lowercase();
    let model_l = model.to_lowercase();
    endpoint_l.contains("sensenova") || model_l.contains("sensenova")
}

pub fn default_image_size(endpoint: &str, model: &str) -> &'static str {
    if uses_sensenova_style(endpoint, model) {
        "2752x1536"
    } else {
        "1024x1024"
    }
}

fn build_images_api_payload(
    model: &str,
    prompt: &str,
    size: &str,
    quality: Option<&str>,
    count: u8,
    include_b64_response_format: bool,
) -> serde_json::Value {
    let mut payload = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "n": count,
        "size": size,
    });

    if let Some(quality) = quality.filter(|value| !value.trim().is_empty()) {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert(
                "quality".to_string(),
                serde_json::Value::String(quality.to_string()),
            );
        }
    }

    if include_b64_response_format {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert(
                "response_format".to_string(),
                serde_json::Value::String("b64_json".to_string()),
            );
        }
    }

    payload
}

fn parse_image_generation_config(config_json: &serde_json::Value) -> Result<ImageGenerationConfig, String> {
    let raw = config_json
        .get("imageGeneration")
        .ok_or_else(|| "未配置图片生成，请在设置 → AI 协议中启用并填写生图模型".to_string())?;

    serde_json::from_value(raw.clone())
        .map_err(|e| format!("解析图片生成配置失败: {}", e))
}

fn resolve_image_generation_settings(
    config: &ImageGenerationConfig,
    request: &GenerateImageRequest,
) -> Result<(String, String, String, String, Option<String>, u8), String> {
    if config.enabled != Some(true) {
        return Err("图片生成未启用，请在设置中开启".to_string());
    }

    let endpoint = config
        .endpoint
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    if endpoint.is_empty() {
        return Err("图片生成 API 端点未配置".to_string());
    }

    let api_key = config.api_key.as_deref().unwrap_or("").trim().to_string();
    if api_key.is_empty() {
        return Err("图片生成 API 密钥未配置".to_string());
    }

    let models = config.models.clone().unwrap_or_default();
    let configured_models: Vec<String> = models
        .iter()
        .map(|model| model.trim().to_string())
        .filter(|model| !model.is_empty())
        .collect();

    let first_model = configured_models
        .first()
        .cloned()
        .ok_or_else(|| "未配置生图模型".to_string())?;

    let default_model = config
        .default_model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .filter(|value| configured_models.iter().any(|model| model == value))
        .unwrap_or_else(|| first_model.clone());

    let requested_model = request
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let model = requested_model
        .filter(|value| configured_models.iter().any(|configured| configured == value))
        .map(str::to_string)
        .unwrap_or(default_model);

    let size = request
        .size
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::trim)
        .map(str::to_string)
        .unwrap_or_else(|| default_image_size(&endpoint, &model).to_string());

    let quality = if uses_sensenova_style(&endpoint, &model) {
        None
    } else {
        Some(
            request
                .quality
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(str::trim)
                .map(str::to_string)
                .or_else(|| config.default_quality.clone())
                .unwrap_or_else(|| "standard".to_string()),
        )
    };

    let count = request.n.unwrap_or(1).clamp(1, 4);

    Ok((endpoint, api_key, model, size, quality, count))
}

pub fn build_generated_image_filename(index: usize) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("ai-gen-{}-{}.png", millis, index)
}

enum ImageSource {
    Bytes(Vec<u8>),
    Url(String),
}

fn parse_images_api_sources(body: &str) -> Result<Vec<ImageSource>, String> {
    let parsed: ImagesApiResponse =
        serde_json::from_str(body).map_err(|e| format!("解析图片生成响应失败: {}", e))?;

    if let Some(error) = parsed.error {
        return Err(error
            .message
            .unwrap_or_else(|| "图片生成 API 返回错误".to_string()));
    }

    let items = parsed
        .data
        .ok_or_else(|| "图片生成 API 未返回 data 字段".to_string())?;

    let mut sources = Vec::new();
    for item in items {
        if let Some(b64) = item.b64_json {
            let trimmed = b64.trim();
            if !trimmed.is_empty() {
                let bytes = BASE64_STANDARD
                    .decode(trimmed)
                    .map_err(|e| format!("解码图片 base64 失败: {}", e))?;
                sources.push(ImageSource::Bytes(bytes));
                continue;
            }
        }

        if let Some(url) = item.url {
            let trimmed = url.trim();
            if !trimmed.is_empty() {
                sources.push(ImageSource::Url(trimmed.to_string()));
                continue;
            }
        }
    }

    if sources.is_empty() {
        return Err("图片生成 API 未返回可用图片数据".to_string());
    }

    Ok(sources)
}

async fn download_image_bytes(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载图片失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "下载图片失败: HTTP {} ({})",
            response.status().as_u16(),
            url
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取图片内容失败: {}", e))?;

    if bytes.is_empty() {
        return Err("下载的图片为空".to_string());
    }

    Ok(bytes.to_vec())
}

async fn resolve_image_bytes_from_response(
    client: &reqwest::Client,
    body: &str,
) -> Result<Vec<Vec<u8>>, String> {
    let mut images = Vec::new();

    for source in parse_images_api_sources(body)? {
        match source {
            ImageSource::Bytes(bytes) => images.push(bytes),
            ImageSource::Url(url) => {
                images.push(download_image_bytes(client, &url).await?);
            }
        }
    }

    Ok(images)
}

pub fn parse_images_api_test_response(body: &str) -> Result<(), String> {
    let parsed: ImagesApiResponse =
        serde_json::from_str(body).map_err(|e| format!("解析图片生成响应失败: {}", e))?;

    if let Some(error) = parsed.error {
        return Err(error
            .message
            .unwrap_or_else(|| "图片生成 API 返回错误".to_string()));
    }

    let items = parsed
        .data
        .ok_or_else(|| "图片生成 API 未返回 data 字段".to_string())?;

    let has_image = items.iter().any(|item| {
        item.b64_json
            .as_ref()
            .is_some_and(|value| !value.trim().is_empty())
            || item
                .url
                .as_ref()
                .is_some_and(|value| !value.trim().is_empty())
    });

    if has_image {
        Ok(())
    } else {
        Err("图片生成 API 未返回可用图片数据".to_string())
    }
}

async fn post_images_generation(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    organization_id: Option<&str>,
    payload: serde_json::Value,
) -> Result<String, String> {
    let urls = openai_images_generations_urls(endpoint);
    if urls.is_empty() {
        return Err("图片生成 API 端点无效".to_string());
    }

    let mut last_error = String::new();

    for url in urls {
        let mut request = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json");

        if let Some(org_id) = organization_id {
            if !org_id.trim().is_empty() {
                request = request.header("OpenAI-Organization", org_id.trim());
            }
        }

        match request.json(&payload).send().await {
            Ok(response) => {
                let status = response.status();
                let body = response
                    .text()
                    .await
                    .map_err(|e| format!("读取图片生成响应失败: {}", e))?;

                if status.is_success() {
                    return Ok(body);
                }

                last_error = format!("HTTP {}: {}", status.as_u16(), body);
            }
            Err(error) => {
                last_error = format!("请求图片生成 API 失败: {}", error);
            }
        }
    }

    if last_error.is_empty() {
        Err("图片生成 API 请求失败".to_string())
    } else {
        Err(last_error)
    }
}

async fn request_image_bytes(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    organization_id: Option<&str>,
    model: &str,
    prompt: &str,
    size: &str,
    quality: Option<&str>,
    count: u8,
) -> Result<Vec<Vec<u8>>, String> {
    let sensenova = uses_sensenova_style(endpoint, model);
    let payload = build_images_api_payload(
        model,
        prompt,
        size,
        quality,
        count,
        !sensenova,
    );

    let body = post_images_generation(client, endpoint, api_key, organization_id, payload).await?;
    resolve_image_bytes_from_response(client, &body).await
}

fn write_images_to_public(
    project_path: &str,
    images: Vec<Vec<u8>>,
) -> Result<Vec<GeneratedImageFile>, String> {
    let project = Path::new(project_path.trim());
    if project_path.trim().is_empty() || !project.exists() {
        return Err("请先打开项目工作区后再生成图片".to_string());
    }

    let public_dir = project.join("public");
    fs::create_dir_all(&public_dir)
        .map_err(|e| format!("创建 public 目录失败: {}", e))?;

    let mut files = Vec::new();
    for (index, bytes) in images.into_iter().enumerate() {
        let filename = build_generated_image_filename(index);
        let absolute_path = public_dir.join(&filename);
        fs::write(&absolute_path, &bytes)
            .map_err(|e| format!("写入图片文件失败: {}", e))?;

        let relative_path = format!("public/{}", filename);
        files.push(GeneratedImageFile {
            relative_path,
            absolute_path: absolute_path.to_string_lossy().to_string(),
            size: bytes.len(),
        });
    }

    Ok(files)
}

#[tauri::command]
pub async fn generate_image(request: GenerateImageRequest) -> Result<GenerateImageResult, String> {
    let prompt = request.prompt.trim().to_string();
    if prompt.is_empty() {
        return Ok(GenerateImageResult {
            success: false,
            message: "生图提示词不能为空".to_string(),
            files: Vec::new(),
        });
    }

    let config_json = load_ai_config_json()?;
    let image_config = parse_image_generation_config(&config_json)?;
    let (endpoint, api_key, model, size, quality, count) =
        resolve_image_generation_settings(&image_config, &request)?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let images = request_image_bytes(
        &client,
        &endpoint,
        &api_key,
        image_config.organization_id.as_deref(),
        &model,
        &prompt,
        &size,
        quality.as_deref(),
        count,
    )
    .await?;

    let files = write_images_to_public(&request.project_path, images)?;

    let message = if files.len() == 1 {
        format!("已生成图片: {}", files[0].relative_path)
    } else {
        format!(
            "已生成 {} 张图片: {}",
            files.len(),
            files.iter()
                .map(|file| file.relative_path.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )
    };

    Ok(GenerateImageResult {
        success: true,
        message,
        files,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestImageGenerationConfig {
    pub endpoint: String,
    #[serde(rename = "apiKey")]
    pub api_key: String,
    pub model: String,
    #[serde(rename = "organizationId")]
    pub organization_id: Option<String>,
    pub quality: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestImageGenerationResult {
    pub success: bool,
    pub message: String,
}

const TEST_IMAGE_PROMPT: &str = "A simple solid blue circle on a white background.";

#[tauri::command]
pub async fn test_image_generation(
    config: TestImageGenerationConfig,
) -> Result<TestImageGenerationResult, String> {
    let endpoint = config.endpoint.trim();
    let api_key = config.api_key.trim();
    let model = config.model.trim();

    if endpoint.is_empty() {
        return Ok(TestImageGenerationResult {
            success: false,
            message: "图片生成 API 端点未配置".to_string(),
        });
    }

    if api_key.is_empty() {
        return Ok(TestImageGenerationResult {
            success: false,
            message: "图片生成 API 密钥未配置".to_string(),
        });
    }

    if model.is_empty() {
        return Ok(TestImageGenerationResult {
            success: false,
            message: "未配置生图模型".to_string(),
        });
    }

    let size = default_image_size(endpoint, model);
    let sensenova = uses_sensenova_style(endpoint, model);
    let quality = if sensenova {
        None
    } else {
        config
            .quality
            .as_deref()
            .filter(|value| !value.trim().is_empty())
    };

    let payload = build_images_api_payload(
        model,
        TEST_IMAGE_PROMPT,
        size,
        quality,
        1,
        !sensenova,
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    match post_images_generation(
        &client,
        endpoint,
        api_key,
        config.organization_id.as_deref(),
        payload,
    )
    .await
    {
        Ok(body) => match parse_images_api_test_response(&body) {
            Ok(()) => Ok(TestImageGenerationResult {
                success: true,
                message: format!("生图模型 {} 可用", model),
            }),
            Err(error) => Ok(TestImageGenerationResult {
                success: false,
                message: error,
            }),
        },
        Err(error) => Ok(TestImageGenerationResult {
            success: false,
            message: error,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_generated_image_filename_has_prefix() {
        let name = build_generated_image_filename(2);
        assert!(name.starts_with("ai-gen-"));
        assert!(name.ends_with("-2.png"));
    }

    #[test]
    fn parse_images_api_sources_accepts_url() {
        let body = r#"{"data":[{"url":"https://example.com/image.png"}]}"#;
        let sources = parse_images_api_sources(body).expect("should parse url");
        assert!(matches!(sources[0], ImageSource::Url(_)));
    }

    #[test]
    fn parse_images_api_test_response_accepts_url() {
        let body = r#"{"data":[{"url":"https://example.com/image.png"}]}"#;
        parse_images_api_test_response(body).expect("should accept url");
    }

    #[test]
    fn default_image_size_uses_sensenova_default() {
        assert_eq!(
            default_image_size("https://token.sensenova.cn/v1", "sensenova-u1-fast"),
            "2752x1536"
        );
        assert_eq!(
            default_image_size("https://api.openai.com/v1", "dall-e-3"),
            "1024x1024"
        );
    }
}
