use super::config::{get_anthropic_chat_url, openai_chat_completion_urls};
use super::types::{AIConfig, TestResult};

#[tauri::command]
pub async fn test_ai_connection(provider: String, config: AIConfig) -> Result<TestResult, String> {
    if config.endpoint.is_empty() {
        return Ok(TestResult {
            success: false,
            message: "API端点不能为空".to_string(),
        });
    }

    if provider != "ollama" && config.api_key.is_empty() {
        return Ok(TestResult {
            success: false,
            message: "API密钥不能为空".to_string(),
        });
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let result = match provider.as_str() {
        "openai" => test_openai_connection(&client, &config).await,
        "anthropic" => test_anthropic_connection(&client, &config).await,
        "ollama" => test_ollama_connection(&client, &config).await,
        _ => Ok(TestResult {
            success: false,
            message: format!("未知的协议类型: {}", provider),
        }),
    };

    result
}

pub async fn test_openai_connection(
    client: &reqwest::Client,
    config: &AIConfig,
) -> Result<TestResult, String> {
    let urls = openai_chat_completion_urls(&config.endpoint);
    if urls.is_empty() {
        return Ok(TestResult {
            success: false,
            message: "API端点不能为空".to_string(),
        });
    }

    let body = serde_json::json!({
        "model": config.model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 1,
        "temperature": 0.0
    });

    let mut last_error = String::new();

    for (idx, url) in urls.iter().enumerate() {
        let mut request = client
            .post(url)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .header("Content-Type", "application/json");

        if let Some(org_id) = &config.organization_id {
            if !org_id.is_empty() {
                request = request.header("OpenAI-Organization", org_id);
            }
        }

        match request.json(&body).send().await {
            Ok(response) => {
                if response.status().is_success() {
                    return Ok(TestResult {
                        success: true,
                        message: "连接成功".to_string(),
                    });
                }

                let status = response.status();
                let error_text = response.text().await.unwrap_or_default();
                let error_message = format!("连接失败: HTTP {} {}", status, error_text);

                if status.as_u16() == 404 && idx + 1 < urls.len() {
                    last_error = error_message;
                    continue;
                }

                return Ok(TestResult {
                    success: false,
                    message: error_message,
                });
            }
            Err(e) => {
                let error_message = format!("连接失败: {}", e);
                if idx + 1 < urls.len() {
                    last_error = error_message;
                    continue;
                }
                return Ok(TestResult {
                    success: false,
                    message: error_message,
                });
            }
        }
    }

    return Ok(TestResult {
        success: false,
        message: if last_error.is_empty() {
            "连接失败: 未找到可用端点".to_string()
        } else {
            last_error
        },
    });
}

pub async fn test_anthropic_connection(
    client: &reqwest::Client,
    config: &AIConfig,
) -> Result<TestResult, String> {
    let url = get_anthropic_chat_url(&config.endpoint);

    let body = serde_json::json!({
        "model": config.model,
        "max_tokens": 1,
        "messages": [{"role": "user", "content": "test"}]
    });

    match client
        .post(&url)
        .header("x-api-key", &config.api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(response) => {
            let status = response.status();
            if status.is_success() || status.as_u16() == 400 {
                Ok(TestResult {
                    success: true,
                    message: "连接成功！".to_string(),
                })
            } else if status.as_u16() == 401 {
                Ok(TestResult {
                    success: false,
                    message: "API密钥无效".to_string(),
                })
            } else {
                Ok(TestResult {
                    success: false,
                    message: format!("连接失败: HTTP {}", status),
                })
            }
        }
        Err(e) => Ok(TestResult {
            success: false,
            message: format!("连接失败: {}", e),
        }),
    }
}

pub async fn test_ollama_connection(
    client: &reqwest::Client,
    config: &AIConfig,
) -> Result<TestResult, String> {
    let base_url = config
        .endpoint
        .trim()
        .trim_end_matches('/')
        .trim_end_matches("/chat/completions")
        .trim_end_matches('/')
        .trim_end_matches("/v1")
        .trim_end_matches('/');
    let url = format!("{}/api/tags", base_url);

    match client.get(&url).send().await {
        Ok(response) => {
            let status = response.status();
            if status.is_success() {
                Ok(TestResult {
                    success: true,
                    message: "连接成功！Ollama 服务正在运行".to_string(),
                })
            } else {
                Ok(TestResult {
                    success: false,
                    message: format!("连接失败: HTTP {}", status),
                })
            }
        }
        Err(e) => {
            let error_msg = if e.is_connect() {
                "无法连接到 Ollama 服务，请确保 Ollama 已启动".to_string()
            } else if e.is_timeout() {
                "连接超时，请检查 Ollama 服务状态".to_string()
            } else {
                format!("连接失败: {}", e)
            };
            Ok(TestResult {
                success: false,
                message: error_msg,
            })
        }
    }
}
