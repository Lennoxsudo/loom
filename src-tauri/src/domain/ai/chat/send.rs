use tauri::{AppHandle, Emitter, State};

use super::config::{
    ensure_ai_model, get_active_profile_config, get_anthropic_chat_url,
    get_ollama_chat_url, get_profile_config_by_id, load_ai_config, openai_chat_completion_urls,
};
use super::message_builder::{
    build_anthropic_message_content, build_openai_messages_payload,
};
use super::retry::send_ai_request_with_retry_limit;
use super::stream::{
    dedupe_anthropic_tool_results, merge_consecutive_anthropic_messages,
    validate_anthropic_message_sequence,
};
use super::types::{
    content_as_text, AIConfig, AnthropicContentBlock, AnthropicMessage, ChatMessage, ChatTaskMap,
};

#[tauri::command]
pub async fn generate_conversation_title(
    provider: String,
    model: String,
    user_text: String,
    file_names: Option<Vec<String>>,
    profile_id: Option<String>,
) -> Result<String, String> {
    let config_str = match load_ai_config() {
        Ok(s) if !s.is_empty() => s,
        _ => return Ok(generate_default_title(&user_text, &file_names)),
    };

    let config_json: serde_json::Value = match serde_json::from_str(&config_str) {
        Ok(v) => v,
        Err(_) => return Ok(generate_default_title(&user_text, &file_names)),
    };

    let mut ai_config: AIConfig = match profile_id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
        .and_then(|id| get_profile_config_by_id(&config_json, &provider, id))
        .or_else(|| get_active_profile_config(&config_json, &provider))
        .or_else(|| {
            config_json
                .get("configs")
                .and_then(|configs| configs.get(&provider))
                .and_then(|provider_config| serde_json::from_value(provider_config.clone()).ok())
        }) {
        Some(cfg) => cfg,
        None => return Ok(generate_default_title(&user_text, &file_names)),
    };

    ai_config.model = model;
    if ensure_ai_model(&mut ai_config).is_err() {
        return Ok(generate_default_title(&user_text, &file_names));
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
    {
        Ok(c) => c,
        Err(_) => return Ok(generate_default_title(&user_text, &file_names)),
    };

    let mut prompt = String::new();
    prompt.push_str("请根据以下信息为一段AI对话生成标题。\n");
    prompt.push_str("要求：\n");
    prompt.push_str("- 中文优先\n");
    prompt.push_str("- 5~20字\n");
    prompt.push_str("- 不要加引号，不要加句号\n");
    prompt.push_str("- 不要输出thinking/<thinking>标签、思考过程或JSON\n");
    prompt.push_str("- 只输出标题，不要解释\n\n");
    prompt.push_str("用户首条消息：\n");
    prompt.push_str(user_text.trim());
    prompt.push('\n');

    if let Some(ref names) = file_names {
        let names: Vec<String> = names
            .iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if !names.is_empty() {
            prompt.push_str("\n相关文件名（如有）：\n");
            for n in names {
                prompt.push_str("- ");
                prompt.push_str(&n);
                prompt.push('\n');
            }
        }
    }

    let content = if provider == "anthropic" {
        serde_json::json!([{"type":"text","text": prompt}])
    } else {
        serde_json::Value::String(prompt)
    };

    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content,
        attachments: None,
        tool_calls: None,
        tool_call_id: None,
        tool_name: None,
        tool_args: None,
        thinking: None,
        thinking_started_at: None,
        thinking_ended_at: None,
        thinking_signature: None,
        is_error: None,
        slash_command: None,
    }];

    let result = match provider.as_str() {
        "openai" => send_openai_chat(&client, &ai_config, messages.clone(), 0).await,
        "anthropic" => send_anthropic_chat(&client, &ai_config, messages.clone(), 0).await,
        "ollama" => send_ollama_chat(&client, &ai_config, messages.clone(), 0).await,
        _ => Err(format!("未知的协议类型: {}", provider)),
    };

    match result {
        Ok(title) => Ok(title),
        Err(e) => {
            eprintln!("[title-gen] failed: {}", e);
            Ok(generate_default_title(&user_text, &file_names))
        }
    }
}

pub fn generate_default_title(user_text: &str, file_names: &Option<Vec<String>>) -> String {
    if let Some(files) = file_names {
        let names: Vec<&str> = files
            .iter()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();
        if !names.is_empty() {
            return format!("关于 {}", names[0]);
        }
    }
    let text = user_text.trim();
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len().min(15);
    if len > 0 {
        let title: String = chars[..len].iter().collect();
        if chars.len() > 15 {
            format!("{}...", title)
        } else {
            title
        }
    } else {
        "新对话".to_string()
    }
}

pub async fn send_openai_chat(
    client: &reqwest::Client,
    config: &AIConfig,
    messages: Vec<ChatMessage>,
    max_retries: u32,
) -> Result<String, String> {
    let urls = openai_chat_completion_urls(&config.endpoint);
    if urls.is_empty() {
        return Err("API端点不能为空".to_string());
    }

    let messages_json = build_openai_messages_payload(&messages)?;

    let body = serde_json::json!({
        "model": config.model,
        "messages": messages_json,
        "temperature": 0.7,
    });

    let mut last_error = String::new();

    for (idx, url) in urls.iter().enumerate() {
        let result = send_ai_request_with_retry_limit(|| {
            let mut req = client
                .post(url)
                .header("Authorization", format!("Bearer {}", config.api_key))
                .header("Content-Type", "application/json");

            if let Some(org_id) = &config.organization_id {
                if !org_id.is_empty() {
                    req = req.header("OpenAI-Organization", org_id);
                }
            }

            req.json(&body).send()
        }, max_retries)
        .await;

        let response = match result {
            Ok(response) => response,
            Err(e) => {
                if e.contains("404") && idx + 1 < urls.len() {
                    last_error = e;
                    continue;
                }
                return Err(e);
            }
        };

        let response_json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("解析响应失败: {}", e))?;

        let choice0 = &response_json["choices"][0];
        let message = &choice0["message"];
        let content_value = &message["content"];
        let content = if let Some(s) = content_value.as_str() {
            s.to_string()
        } else if let Some(s) = message["text"].as_str() {
            s.to_string()
        } else if let Some(s) = choice0["text"].as_str() {
            s.to_string()
        } else if !content_value.is_null() {
            content_as_text(content_value)
        } else {
            String::new()
        };

        if content.trim().is_empty() {
            return Err("无法获取响应内容".to_string());
        }

        return Ok(content);
    }

    return Err(if last_error.is_empty() {
        "请求失败: 未找到可用的 OpenAI 兼容端点".to_string()
    } else {
        last_error
    });
}

pub async fn send_anthropic_chat(
    client: &reqwest::Client,
    config: &AIConfig,
    messages: Vec<ChatMessage>,
    max_retries: u32,
) -> Result<String, String> {
    let url = get_anthropic_chat_url(&config.endpoint);

    let mut messages_json: Vec<AnthropicMessage> = Vec::new();
    let mut system_contents: Vec<String> = Vec::new();

    for m in &messages {
        if m.role == "system" {
            if let Ok(content) = build_anthropic_message_content(m) {
                for block in content {
                    if let AnthropicContentBlock::Text { text } = block {
                        system_contents.push(text);
                    }
                }
            }
        } else {
            let role = if m.role == "tool" {
                "user".to_string()
            } else {
                m.role.clone()
            };
            messages_json.push(AnthropicMessage {
                role,
                content: build_anthropic_message_content(m)?,
            });
        }
    }

    let mut messages_json = merge_consecutive_anthropic_messages(messages_json);
    messages_json = dedupe_anthropic_tool_results(messages_json);

    validate_anthropic_message_sequence(&messages_json, " (send_anthropic_chat)")?;

    let mut body = serde_json::json!({
        "model": config.model,
        "max_tokens": 4096,
        "messages": messages_json,
    });

    // Prompt Caching: system prompt 加 cache_control 断点（与 stream.rs 保持一致）
    // 如果包含 [Context Summary] 标记，拆分为两个 text block：
    //   稳定前缀（带缓存） + 摘要后缀（不带缓存），避免压缩摘要使缓存失效。
    if !system_contents.is_empty() {
        let joined = system_contents.join("\n\n");
        let summary_marker = "[Context Summary]";
        let blocks: Vec<serde_json::Value> = if let Some(marker_pos) = joined.find(summary_marker) {
            let prefix_end = marker_pos.saturating_sub(2).max(0);
            let prefix = joined[..prefix_end].trim_end();
            let suffix = joined[prefix_end..].trim_start();
            if prefix.is_empty() {
                vec![serde_json::json!({
                    "type": "text",
                    "text": suffix,
                    "cache_control": { "type": "ephemeral" }
                })]
            } else {
                vec![
                    serde_json::json!({
                        "type": "text",
                        "text": prefix,
                        "cache_control": { "type": "ephemeral" }
                    }),
                    serde_json::json!({
                        "type": "text",
                        "text": suffix,
                    }),
                ]
            }
        } else {
            vec![serde_json::json!({
                "type": "text",
                "text": joined,
                "cache_control": { "type": "ephemeral" }
            })]
        };
        body["system"] = serde_json::json!(blocks);
    }

    let response = send_ai_request_with_retry_limit(|| {
        client
            .post(&url)
            .header("x-api-key", &config.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
    }, max_retries)
    .await?;

    let response_json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let content_value = &response_json["content"];
    let content = content_as_text(content_value);

    if content.trim().is_empty() {
        return Err("无法获取响应内容".to_string());
    }

    Ok(content)
}

pub async fn send_ollama_chat(
    client: &reqwest::Client,
    config: &AIConfig,
    messages: Vec<ChatMessage>,
    max_retries: u32,
) -> Result<String, String> {
    let url = get_ollama_chat_url(&config.endpoint);

    let messages_json: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| {
            let mut item = serde_json::json!({
                "role": m.role,
                "content": content_as_text(&m.content),
            });

            if let Some(id) = &m.tool_call_id {
                item["tool_call_id"] = serde_json::json!(id);
            }
            if let Some(calls) = &m.tool_calls {
                item["tool_calls"] = serde_json::json!(calls);
            }

            item
        })
        .collect();

    let body = serde_json::json!({
        "model": config.model,
        "messages": messages_json,
    });

    let response = send_ai_request_with_retry_limit(|| {
        let mut req = client.post(&url).header("Content-Type", "application/json");
        if !config.api_key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", config.api_key));
        }
        req.json(&body).send()
    }, max_retries)
    .await?;

    let response_json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let choice0 = &response_json["choices"][0];
    let message = &choice0["message"];
    let content_value = &message["content"];
    let content = if let Some(s) = content_value.as_str() {
        s.to_string()
    } else if let Some(s) = message["text"].as_str() {
        s.to_string()
    } else if let Some(s) = choice0["text"].as_str() {
        s.to_string()
    } else if !content_value.is_null() {
        content_as_text(content_value)
    } else {
        String::new()
    };

    if content.trim().is_empty() {
        return Err("无法获取响应内容".to_string());
    }

    Ok(content)
}

#[tauri::command]
pub async fn generate_compact_summary(
    provider: String,
    model: String,
    prompt_text: String,
    messages_json: Option<String>,
    profile_id: Option<String>,
) -> Result<String, String> {
    let config_str = load_ai_config().map_err(|e| e.to_string())?;
    if config_str.is_empty() {
        return Err("AI config not found".to_string());
    }

    let config_json: serde_json::Value =
        serde_json::from_str(&config_str).map_err(|e| format!("Invalid AI config: {}", e))?;

    let mut ai_config: AIConfig = profile_id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
        .and_then(|id| get_profile_config_by_id(&config_json, &provider, id))
        .or_else(|| get_active_profile_config(&config_json, &provider))
        .or_else(|| {
            config_json
                .get("configs")
                .and_then(|configs| configs.get(&provider))
                .and_then(|provider_config| serde_json::from_value(provider_config.clone()).ok())
        })
        .ok_or_else(|| format!("No config for provider: {}", provider))?;

    ai_config.model = model;
    ensure_ai_model(&mut ai_config).map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let mut chat_messages: Vec<ChatMessage> = Vec::new();

    if let Some(json) = messages_json.as_deref().filter(|s| !s.trim().is_empty()) {
        if let Ok(parsed) = serde_json::from_str::<Vec<serde_json::Value>>(json) {
            for item in parsed {
                let role = item
                    .get("role")
                    .and_then(|v| v.as_str())
                    .unwrap_or("user")
                    .to_string();
                let content = item.get("content").cloned().unwrap_or_else(|| {
                    serde_json::Value::String(
                        item.get("text")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                    )
                });
                chat_messages.push(ChatMessage {
                    role,
                    content,
                    attachments: None,
                    tool_calls: None,
                    tool_call_id: item
                        .get("tool_call_id")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    tool_name: item
                        .get("tool_name")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    tool_args: None,
                    thinking: None,
                    thinking_started_at: None,
                    thinking_ended_at: None,
                    thinking_signature: None,
                    is_error: None,
                    slash_command: None,
                });
            }
        }
    }

    let prompt_content = if provider == "anthropic" {
        serde_json::json!([{"type":"text","text": prompt_text}])
    } else {
        serde_json::Value::String(prompt_text)
    };

    chat_messages.push(ChatMessage {
        role: "user".to_string(),
        content: prompt_content,
        attachments: None,
        tool_calls: None,
        tool_call_id: None,
        tool_name: None,
        tool_args: None,
        thinking: None,
        thinking_started_at: None,
        thinking_ended_at: None,
        thinking_signature: None,
        is_error: None,
        slash_command: None,
    });

    let result = match provider.as_str() {
        "openai" => send_openai_chat(&client, &ai_config, chat_messages, 1).await,
        "anthropic" => send_anthropic_chat(&client, &ai_config, chat_messages, 1).await,
        "ollama" => send_ollama_chat(&client, &ai_config, chat_messages, 1).await,
        _ => Err(format!("Unknown provider: {}", provider)),
    };

    result.map(|raw| strip_compact_analysis(&raw))
}

fn strip_compact_analysis(raw: &str) -> String {
    let without = regex::Regex::new(r"(?is)<analysis>.*?</analysis>")
        .ok()
        .map(|re| re.replace_all(raw, "").to_string())
        .unwrap_or_else(|| raw.to_string());

    if let Some(caps) = regex::Regex::new(r"(?is)<summary>(.*?)</summary>")
        .ok()
        .and_then(|re| re.captures(&without))
    {
        if let Some(m) = caps.get(1) {
            return m.as_str().trim().to_string();
        }
    }

    without.trim().to_string()
}

#[tauri::command]
pub async fn cancel_ai_chat(
    app: AppHandle,
    state: State<'_, ChatTaskMap>,
    message_id: String,
) -> Result<(), String> {
    println!("[停止AI对话] 收到停止请求: message_id={}", message_id);

    let mut task_map = state.lock_map();

    let all_keys: Vec<String> = task_map.keys().cloned().collect();
    println!("[停止AI对话] 当前任务映射中的所有ID: {:?}", all_keys);
    println!("[停止AI对话] 任务映射大小: {}", task_map.len());

    if let Some(handle) = task_map.remove(&message_id) {
        println!(
            "[停止AI对话] 找到任务句柄，正在中止: message_id={}",
            message_id
        );
        handle.abort();
        let _ = app.emit(
            "ai-stream-cancelled",
            serde_json::json!({ "message_id": message_id }),
        );
        println!("[停止AI对话] 任务已中止: message_id={}", message_id);
        Ok(())
    } else {
        let msg = format!("[停止AI对话] 未找到任务句柄: message_id={}", message_id);
        println!("{}", msg);
        Ok(())
    }
}
