use super::config::{
    get_anthropic_models_url, get_ollama_base_url, openai_models_urls,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct ListModelsConfig {
    pub endpoint: String,
    #[serde(rename = "apiKey")]
    pub api_key: String,
    #[serde(rename = "organizationId")]
    pub organization_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ListModelsResult {
    pub success: bool,
    pub message: String,
    pub models: Vec<String>,
}

#[tauri::command]
pub async fn list_ai_models(provider: String, config: ListModelsConfig) -> Result<ListModelsResult, String> {
    if config.endpoint.trim().is_empty() {
        return Ok(ListModelsResult {
            success: false,
            message: "API端点不能为空".to_string(),
            models: Vec::new(),
        });
    }

    if provider != "ollama" && config.api_key.trim().is_empty() {
        return Ok(ListModelsResult {
            success: false,
            message: "API密钥不能为空".to_string(),
            models: Vec::new(),
        });
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let result = match provider.as_str() {
        "openai" => list_openai_models(&client, &config).await,
        "anthropic" => list_anthropic_models(&client, &config).await,
        "ollama" => list_ollama_models(&client, &config).await,
        _ => Ok(ListModelsResult {
            success: false,
            message: format!("未知的协议类型: {}", provider),
            models: Vec::new(),
        }),
    };

    result
}

async fn list_openai_models(
    client: &reqwest::Client,
    config: &ListModelsConfig,
) -> Result<ListModelsResult, String> {
    let urls = openai_models_urls(&config.endpoint);
    if urls.is_empty() {
        return Ok(ListModelsResult {
            success: false,
            message: "API端点不能为空".to_string(),
            models: Vec::new(),
        });
    }

    let mut last_error = String::new();

    let gateway_creds =
        super::gateway_sign::require_builtin_credentials(&config.endpoint, None)?;

    for (idx, url) in urls.iter().enumerate() {
        let url = url.clone();
        let mut request = super::gateway_sign::apply_openai_gateway_auth(
            client.get(&url),
            "GET",
            &url,
            &[],
            &config.api_key,
            gateway_creds.as_ref(),
        )?;

        if let Some(org_id) = &config.organization_id {
            if !org_id.is_empty() {
                request = request.header("OpenAI-Organization", org_id);
            }
        }

        match request.send().await {
            Ok(response) => {
                if response.status().is_success() {
                    let body = response.text().await.unwrap_or_default();
                    return Ok(parse_openai_models_body(&body));
                }

                let status = response.status();
                let error_text = response.text().await.unwrap_or_default();
                let error_message = format!("拉取失败: HTTP {} {}", status, error_text);

                if status.as_u16() == 404 && idx + 1 < urls.len() {
                    last_error = error_message;
                    continue;
                }

                return Ok(ListModelsResult {
                    success: false,
                    message: error_message,
                    models: Vec::new(),
                });
            }
            Err(e) => {
                let error_message = format!("拉取失败: {}", e);
                if idx + 1 < urls.len() {
                    last_error = error_message;
                    continue;
                }
                return Ok(ListModelsResult {
                    success: false,
                    message: error_message,
                    models: Vec::new(),
                });
            }
        }
    }

    Ok(ListModelsResult {
        success: false,
        message: if last_error.is_empty() {
            "拉取失败: 未找到可用端点".to_string()
        } else {
            last_error
        },
        models: Vec::new(),
    })
}

async fn list_anthropic_models(
    client: &reqwest::Client,
    config: &ListModelsConfig,
) -> Result<ListModelsResult, String> {
    let url = get_anthropic_models_url(&config.endpoint);

    match client
        .get(&url)
        .header("x-api-key", &config.api_key)
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
    {
        Ok(response) => {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            if status.is_success() {
                Ok(parse_anthropic_models_body(&body))
            } else if status.as_u16() == 401 {
                Ok(ListModelsResult {
                    success: false,
                    message: "API密钥无效".to_string(),
                    models: Vec::new(),
                })
            } else {
                Ok(ListModelsResult {
                    success: false,
                    message: format!("拉取失败: HTTP {} {}", status, body),
                    models: Vec::new(),
                })
            }
        }
        Err(e) => Ok(ListModelsResult {
            success: false,
            message: format!("拉取失败: {}", e),
            models: Vec::new(),
        }),
    }
}

async fn list_ollama_models(
    client: &reqwest::Client,
    config: &ListModelsConfig,
) -> Result<ListModelsResult, String> {
    let url = format!("{}/api/tags", get_ollama_base_url(&config.endpoint));

    match client.get(&url).send().await {
        Ok(response) => {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            if status.is_success() {
                Ok(parse_ollama_models_body(&body))
            } else {
                Ok(ListModelsResult {
                    success: false,
                    message: format!("拉取失败: HTTP {} {}", status, body),
                    models: Vec::new(),
                })
            }
        }
        Err(e) => {
            let error_msg = if e.is_connect() {
                "无法连接到 Ollama 服务，请确保 Ollama 已启动".to_string()
            } else if e.is_timeout() {
                "连接超时，请检查 Ollama 服务状态".to_string()
            } else {
                format!("拉取失败: {}", e)
            };
            Ok(ListModelsResult {
                success: false,
                message: error_msg,
                models: Vec::new(),
            })
        }
    }
}

fn sort_models(mut models: Vec<String>) -> ListModelsResult {
    if models.is_empty() {
        return ListModelsResult {
            success: false,
            message: "未获取到模型".to_string(),
            models,
        };
    }
    models.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    ListModelsResult {
        success: true,
        message: format!("已获取 {} 个模型", models.len()),
        models,
    }
}

pub fn parse_openai_models_body(body: &str) -> ListModelsResult {
    let json: serde_json::Value = match serde_json::from_str(body) {
        Ok(value) => value,
        Err(e) => {
            return ListModelsResult {
                success: false,
                message: format!("解析响应失败: {}", e),
                models: Vec::new(),
            };
        }
    };

    let models = json
        .get("data")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(|id| id.as_str()).map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    sort_models(models)
}

pub fn parse_anthropic_models_body(body: &str) -> ListModelsResult {
    let json: serde_json::Value = match serde_json::from_str(body) {
        Ok(value) => value,
        Err(e) => {
            return ListModelsResult {
                success: false,
                message: format!("解析响应失败: {}", e),
                models: Vec::new(),
            };
        }
    };

    let models = json
        .get("data")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(|id| id.as_str()).map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    sort_models(models)
}

pub fn parse_ollama_models_body(body: &str) -> ListModelsResult {
    let json: serde_json::Value = match serde_json::from_str(body) {
        Ok(value) => value,
        Err(e) => {
            return ListModelsResult {
                success: false,
                message: format!("解析响应失败: {}", e),
                models: Vec::new(),
            };
        }
    };

    let models = json
        .get("models")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("name").and_then(|name| name.as_str()).map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    sort_models(models)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_openai_models_extracts_ids() {
        let body = r#"{"data":[{"id":"gpt-4o"},{"id":"gpt-4o-mini"}]}"#;
        let result = parse_openai_models_body(body);
        assert!(result.success);
        assert_eq!(result.models, vec!["gpt-4o", "gpt-4o-mini"]);
    }

    #[test]
    fn parse_ollama_models_extracts_names() {
        let body = r#"{"models":[{"name":"llama3.1"},{"name":"qwen2.5"}]}"#;
        let result = parse_ollama_models_body(body);
        assert!(result.success);
        assert_eq!(result.models, vec!["llama3.1", "qwen2.5"]);
    }
}
