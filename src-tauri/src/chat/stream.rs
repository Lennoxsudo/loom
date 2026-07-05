use futures::StreamExt;
use std::collections::{HashMap, HashSet};
use std::str;
use std::time::Duration;
use tauri::{Emitter, State};

use super::config::{
    ensure_ai_model, get_active_profile_config, get_anthropic_chat_url, get_gemini_chat_url,
    get_ollama_chat_url, get_profile_config_by_id, load_ai_config, load_auto_routing_config,
    find_auto_routing_entry_index, is_auto_routing_fallback_error, openai_chat_completion_urls,
};
use super::message_builder::{
    build_anthropic_message_content, build_gemini_contents, build_openai_messages_payload,
};
use super::retry::send_ai_request_with_retry;
use super::types::{
    content_as_text, emit_filtered_chunk, finalize_tool_args, process_openai_compatible_choice_delta,
    AIConfig, AnthropicContentBlock, AnthropicMessage, AutoRoutingConfig, ChatMessage, ChatTaskMap,
    ReasoningStreamState, StreamResult, ThinkingTagStreamState, TokenUsage,
};

/// Decode a network chunk safely across UTF-8 byte boundaries.
///
/// `utf8_buf` holds leftover bytes from previous chunks that form an
/// incomplete multi-byte UTF-8 sequence. We append the new chunk, then
/// decode as much as we can from the front. Any trailing bytes that
/// don't form a complete character are left in `utf8_buf` for the next call.
fn decode_chunk_to_string(chunk: &[u8], utf8_buf: &mut Vec<u8>) -> String {
    utf8_buf.extend_from_slice(chunk);
    if utf8_buf.is_empty() {
        return String::new();
    }

    // Find the longest valid UTF-8 prefix.
    // str::from_utf8 returns Ok for the whole buffer if it's valid, or Err
    // with the position of the first invalid byte. In the streaming case
    // that invalid byte is the start of an incomplete multi-byte sequence
    // at the tail, so everything before it is valid.
    let valid_up_to = match str::from_utf8(utf8_buf) {
        Ok(_) => utf8_buf.len(),
        Err(e) => e.valid_up_to(),
    };

    if valid_up_to == 0 {
        // Even the first byte isn't valid UTF-8 on its own — it must be a
        // continuation byte from a previous chunk that we already partially
        // consumed. Wait for more bytes.
        return String::new();
    }

    let result = unsafe { str::from_utf8_unchecked(&utf8_buf[..valid_up_to]) }.to_string();
    utf8_buf.drain(..valid_up_to);
    result
}

pub fn validate_anthropic_message_sequence(
    messages_json: &[AnthropicMessage],
    context: &str,
) -> Result<(), String> {
    if let Some(first) = messages_json.first() {
        if first.role == "assistant" {
            return Err(format!(
                "[Anthropic Validation] 首条非 system 消息不能为 assistant 角色，\
                前端应通过 ensureAnthropicLeadingUser 修复此问题。{}",
                context
            ));
        }
    }
    Ok(())
}

fn apply_provider_tool_choice(
    body: &mut serde_json::Value,
    provider: &str,
    tool_choice: &Option<serde_json::Value>,
) {
    match provider {
        "anthropic" => {
            body["tool_choice"] = tool_choice
                .clone()
                .unwrap_or_else(|| serde_json::json!({ "type": "auto" }));
        }
        "gemini" => {
            body["toolConfig"] = serde_json::json!({
                "functionCallingConfig": {
                    "mode": "AUTO"
                }
            });
        }
        _ => {
            body["tool_choice"] = tool_choice
                .clone()
                .unwrap_or_else(|| serde_json::json!("auto"));
        }
    }
}

#[tauri::command]
pub async fn send_ai_chat_stream(
    app: tauri::AppHandle,
    state: State<'_, ChatTaskMap>,
    provider: String,
    message_id: String,
    model: String,
    messages: Vec<ChatMessage>,
    tools: Option<serde_json::Value>,
    tool_choice: Option<serde_json::Value>,
    tool_chain_config: Option<crate::tool_executor::ToolChainConfig>,
    profile_id: Option<String>,
    enable_auto_routing: Option<bool>,
) -> Result<(), String> {
    // 加载AI配置
    let config_str = load_ai_config().map_err(|e| format!("加载配置失败: {}", e))?;

    if config_str.is_empty() {
        return Err("未找到AI配置，请先在设置中配置".to_string());
    }

    let config_json: serde_json::Value =
        serde_json::from_str(&config_str).map_err(|e| format!("解析配置失败: {}", e))?;

    // 配置查找优先级：
    // 1. 如果指定了 profile_id，按 profile_id 查找（Agent 请求隔离）
    // 2. 否则从激活的 profile 获取配置（ChatPanel 等全局场景）
    // 3. 最后 fallback 到 configs 中的配置
    let profile_config = if let Some(ref pid) = profile_id {
        // Agent 指定了 profileId，优先使用该 profile 的 endpoint/apiKey
        get_profile_config_by_id(&config_json, &provider, pid)
            .or_else(|| get_active_profile_config(&config_json, &provider))
    } else {
        get_active_profile_config(&config_json, &provider)
    };

    let mut ai_config: AIConfig = if let Some(config) = profile_config {
        config
    } else {
        // 如果没有激活的 profile，则使用 configs 中的配置
        let provider_config = config_json["configs"][&provider].clone();
        serde_json::from_value(provider_config)
            .map_err(|e| format!("解析{}配置失败: {}", provider, e))?
    };

    ai_config.model = model;

    ensure_ai_model(&mut ai_config)?;

    // Only honor auto-routing fallback when the caller explicitly selected auto mode.
    let auto_routing_config = if enable_auto_routing.unwrap_or(false) {
        load_auto_routing_config(&config_json)
    } else {
        None
    };
    let config_json_for_task = config_json.clone();

    // 创建HTTP客户端
    // SSE 流式响应不应设置整体 timeout（从请求开始到响应体读取完毕的总时间），
    // 否则 AI 思考时间过长会导致连接被强制中断。
    // 只设置 connect_timeout（连接建立超时），流式读取不设超时限制。
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let app_handle = app.clone();
    let task_map = ChatTaskMap(state.0.clone());
    let msg_id = message_id.clone();
    let msg_id_cls = message_id.clone();
    let tc_config = tool_chain_config.unwrap_or_default();

    // Spawn a background task
    let handle = tauri::async_runtime::spawn(async move {
        let result = run_stream_with_tool_chain(
            &app_handle,
            &client,
            &ai_config,
            &provider,
            profile_id.as_deref(),
            &msg_id,
            messages,
            tools,
            tool_choice,
            &tc_config,
            &config_json_for_task,
            auto_routing_config,
        )
        .await;

        // 如果出错，发送错误事件
        if let Err(e) = result {
            let _ = app_handle.emit(
                "ai-stream-error",
                serde_json::json!({ "error": e, "message_id": msg_id }),
            );
        }

        // 任务完成后移除handle
        task_map.lock_map().remove(&msg_id_cls);
    });

    // 若同一 message_id 已有进行中的任务，先中止旧任务再启动新流
    {
        let mut task_map = state.lock_map();
        if let Some(old_handle) = task_map.remove(&message_id) {
            old_handle.abort();
        }
        task_map.insert(message_id.clone(), handle);
    }

    Ok(())
}

/// Run a streaming request with automatic tool chain orchestration and optional auto-routing fallback.
///
/// When the AI responds with tool calls that are all backend-executable
/// (read-only tools like read_file, list_directory, etc.), this function
/// executes them locally and re-invokes the AI stream with the results,
/// avoiding frontend round-trips. The loop continues until:
/// - The AI responds without tool calls (final answer)
/// - Some tool calls are NOT backend-executable (fall through to frontend)
/// - The max_rounds cap is reached
///
/// When a recoverable provider error is detected and auto_routing_config is enabled,
/// the function will automatically fall back to the next provider in the list.
pub async fn run_stream_with_tool_chain(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    config: &AIConfig,
    provider: &str,
    initial_profile_id: Option<&str>,
    message_id: &str,
    initial_messages: Vec<ChatMessage>,
    tools: Option<serde_json::Value>,
    tool_choice: Option<serde_json::Value>,
    tc_config: &crate::tool_executor::ToolChainConfig,
    config_json: &serde_json::Value,
    auto_routing_config: Option<AutoRoutingConfig>,
) -> Result<(), String> {
    use crate::tool_executor;

    let mut messages = initial_messages;
    let mut round = 0u32;
    let orchestration_enabled = tc_config.enable_backend_orchestration;
    let max_rounds = tc_config.max_rounds;
    let project_path = tc_config.project_path.as_deref();

    // Track the current provider/config for potential auto-routing fallback
    let mut current_provider = provider.to_string();
    let mut current_config = config.clone();
    let mut current_profile_id = initial_profile_id.map(|value| value.to_string());
    // Keep track of which auto-routing entries we've already tried (by index)
    let mut tried_entry_indices: Vec<usize> = Vec::new();

    loop {
        let intercept_active = orchestration_enabled && round < max_rounds;

        // When orchestration intercepts, suppress the ai-stream-complete event
        // from the stream function — we'll emit our own events instead.
        // Only the final round (where orchestration does NOT intercept) should
        // let the stream function emit ai-stream-complete normally.
        let suppress = intercept_active;

        // Run the actual stream — each function now returns StreamResult
        // containing any collected tool_calls.
        let stream_result = match current_provider.as_str() {
            "anthropic" => {
                send_anthropic_stream(
                    app,
                    client,
                    &current_config,
                    message_id,
                    messages.clone(),
                    tools.clone(),
                    tool_choice.clone(),
                    suppress,
                )
                .await
            }
            "openai" => {
                send_openai_stream(
                    app,
                    client,
                    &current_config,
                    message_id,
                    messages.clone(),
                    tools.clone(),
                    tool_choice.clone(),
                    suppress,
                )
                .await
            }
            "gemini" => {
                send_gemini_stream(
                    app,
                    client,
                    &current_config,
                    message_id,
                    messages.clone(),
                    tools.clone(),
                    tool_choice.clone(),
                    suppress,
                )
                .await
            }
            "ollama" => {
                send_ollama_stream(
                    app,
                    client,
                    &current_config,
                    message_id,
                    messages.clone(),
                    tools.clone(),
                    tool_choice.clone(),
                    suppress,
                )
                .await
            }
            _ => Err(format!("未知的协议类型: {}", current_provider)),
        };

        // Handle stream error with potential auto-routing fallback
        let sr = match stream_result {
            Ok(sr) => sr,
            Err(e) => {
                if is_auto_routing_fallback_error(&e) {
                    if let Some(ref routing) = auto_routing_config {
                        if routing.enabled && !routing.entries.is_empty() {
                            if let Some(current_idx) = find_auto_routing_entry_index(
                                routing,
                                &current_provider,
                                current_profile_id.as_deref(),
                                &current_config.model,
                            ) {
                                if !tried_entry_indices.contains(&current_idx) {
                                    tried_entry_indices.push(current_idx);
                                }
                            }

                            let from_provider = current_provider.clone();
                            let from_model = current_config.model.clone();
                            let mut fallback_used = false;

                            for (entry_idx, entry) in routing.entries.iter().enumerate() {
                                if tried_entry_indices.contains(&entry_idx) {
                                    continue;
                                }

                                if let Some(fallback_config) = get_profile_config_by_id(
                                    config_json,
                                    &entry.provider,
                                    &entry.profile_id,
                                ) {
                                    let mut new_config = fallback_config;
                                    new_config.model = entry.model.clone();

                                    if let Err(model_err) = ensure_ai_model(&mut new_config) {
                                        log::warn!(
                                            "[AutoRouting] Entry {} ({}/{}) has invalid model: {}",
                                            entry_idx,
                                            entry.provider,
                                            entry.profile_id,
                                            model_err
                                        );
                                        tried_entry_indices.push(entry_idx);
                                        continue;
                                    }

                                    let _ = app.emit(
                                        "ai-provider-switched",
                                        serde_json::json!({
                                            "message_id": message_id,
                                            "from_provider": from_provider,
                                            "from_model": from_model,
                                            "to_provider": entry.provider,
                                            "to_model": entry.model,
                                        }),
                                    );

                                    log::info!(
                                        "[AutoRouting] Switching from {}/{} to {}/{}",
                                        from_provider,
                                        from_model,
                                        entry.provider,
                                        entry.model,
                                    );

                                    current_provider = entry.provider.clone();
                                    current_profile_id = Some(entry.profile_id.clone());
                                    current_config = new_config;
                                    tried_entry_indices.push(entry_idx);
                                    fallback_used = true;

                                    break;
                                } else {
                                    log::warn!(
                                        "[AutoRouting] Entry {} ({}/{}) config not found",
                                        entry_idx,
                                        entry.provider,
                                        entry.profile_id,
                                    );
                                    tried_entry_indices.push(entry_idx);
                                }
                            }

                            if fallback_used {
                                continue;
                            }

                            let _ = app.emit(
                                "ai-stream-error",
                                serde_json::json!({
                                    "error": "所有自动路由配置均不可用，请检查设置或增加配额。",
                                    "message_id": message_id,
                                }),
                            );
                            return Err("所有自动路由配置均不可用，请检查设置或增加配额。".to_string());
                        }
                    }
                }

                let _ = app.emit(
                    "ai-stream-error",
                    serde_json::json!({ "error": e.clone(), "message_id": message_id }),
                );
                return Err(e);
            }
        };

        // If orchestration is not active, the stream function already emitted
        // ai-stream-complete (suppress=false), so we're done.
        if !intercept_active {
            return Ok(());
        }

        // Check if there were tool calls
        if sr.tool_calls.is_empty() {
            // No tool calls — emit the final ai-stream-complete ourselves
            // since we suppressed it in the stream function.
            let mut complete_data = serde_json::json!({ "message_id": message_id });
            // Include the actual provider/model used (may differ from initial if auto-routing switched)
            complete_data["provider"] = serde_json::json!(current_provider);
            complete_data["model"] = serde_json::json!(current_config.model);
            if let Some(first_block) = sr.thinking_blocks.first() {
                if let Some(sig) = first_block.get("signature").and_then(|v| v.as_str()) {
                    complete_data["thinking_signature"] = serde_json::json!(sig);
                }
            }
            let _ = app.emit("ai-stream-complete", complete_data);
            return Ok(());
        }

        // Check if ALL tool calls are backend-executable
        if !tool_executor::all_tools_backend_executable(&sr.tool_calls) {
            // Mixed or non-backend tools — emit ai-stream-complete with tool_calls
            // so the frontend can handle the non-backend ones.
            let mut complete_data = serde_json::json!({
                "message_id": message_id
            });
            complete_data["tool_calls"] = serde_json::json!(sr.tool_calls);
            // Include the actual provider/model used
            complete_data["provider"] = serde_json::json!(current_provider);
            complete_data["model"] = serde_json::json!(current_config.model);
            if let Some(first_block) = sr.thinking_blocks.first() {
                if let Some(sig) = first_block.get("signature").and_then(|v| v.as_str()) {
                    complete_data["thinking_signature"] = serde_json::json!(sig);
                }
            }
            let _ = app.emit("ai-stream-complete", complete_data);
            log::info!(
                "[ToolChain] Round {} - Not all tools backend-executable, falling through to frontend",
                round + 1
            );
            return Ok(());
        }

        // All tools are backend-executable! Execute them here.
        round += 1;
        log::info!(
            "[ToolChain] Round {} - Executing {} tool(s) backend-side",
            round,
            sr.tool_calls.len()
        );

        let sandbox_ctx = crate::sandbox::app_sandbox_context(app);
        let results = tool_executor::execute_all_tools(
            &sr.tool_calls,
            project_path,
            tc_config.app_data_path.as_deref(),
            &sandbox_ctx,
        );

        // Emit progress event for each tool execution
        for result in &results {
            let preview = if result.output.chars().count() > 200 {
                format!("{}...", result.output.chars().take(200).collect::<String>())
            } else {
                result.output.clone()
            };

            let _ = app.emit(
                "ai-tool-executed",
                serde_json::json!({
                    "message_id": message_id,
                    "tool_name": result.tool_name,
                    "tool_call_id": result.tool_call_id,
                    "result_preview": preview,
                    "success": result.success,
                    "round": round,
                    "total_rounds_so_far": round
                }),
            );
        }

        // Emit orchestration-round event so the frontend knows an intermediate
        // round completed (without finalizing the message or executing tools).
        let _ = app.emit(
            "ai-orchestration-round",
            serde_json::json!({
                "message_id": message_id,
                "round": round,
                "tool_count": sr.tool_calls.len(),
            }),
        );

		        // Build tool result messages and append to conversation
		        let tool_result_messages = tool_executor::build_tool_result_messages(
		            "", // content is already streamed to frontend
		            &sr.tool_calls,
		            &results,
		            &current_provider,
		            &sr.thinking_blocks, // thinking blocks collected from stream
		        );
        messages.extend(tool_result_messages);

        // Post-tool-call delay: allow frontend to display tool results
        // before the next AI request streams in.
        if let Some(delay_ms) = tc_config.tool_call_delay_ms {
            if delay_ms > 0 {
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            }
        }

        // Continue the loop — next iteration will send the updated messages to the AI
        log::info!(
            "[ToolChain] Round {} complete, continuing with {} messages",
            round,
            messages.len()
        );
    }
}

// 检查模型是否支持 extended thinking
pub fn anthropic_model_supports_thinking(model: &str) -> bool {
    let m = model.to_lowercase();
    m.contains("claude-3-7")
        || m.contains("claude-3.7")
        || m.contains("sonnet-4")
        || m.contains("opus-4")
        || m.contains("claude-4")
}

// 合并连续相同角色的 Anthropic 消息（避免 API 拒绝连续同角色消息）
pub fn merge_consecutive_anthropic_messages(
    messages: Vec<AnthropicMessage>,
) -> Vec<AnthropicMessage> {
    let mut merged: Vec<AnthropicMessage> = Vec::new();

    for mut msg in messages {
        let should_merge = if let Some(last) = merged.last() {
            last.role == msg.role
        } else {
            false
        };

        if should_merge {
            let last = merged.last_mut().unwrap();
            last.content.append(&mut msg.content);
        } else {
            merged.push(msg);
        }
    }

    merged
}

// 去重同一 tool_use_id 的 tool_result，避免 Anthropic 400 Improperly formed request
//
// 两遍扫描算法：
//   第一遍：预收集所有 assistant 的 tool_use_id 和 user 消息中已有的 tool_result_id，
//           以便正确判断哪些 tool_use 真正缺失结果。
//   第二遍：执行去重和补充逻辑，只有真正缺失 tool_result 的 tool_use 才补充占位。
pub fn dedupe_anthropic_tool_results(messages: Vec<AnthropicMessage>) -> Vec<AnthropicMessage> {
    // ── 第一遍：预扫描 ──
    // 所有 assistant 中声明的 tool_use id
    let mut all_tool_use_ids: HashSet<String> = HashSet::new();
    // 所有 user 消息中已有的 tool_result id（即有实际结果的）
    let mut existing_tool_result_ids: HashSet<String> = HashSet::new();

    for msg in &messages {
        if msg.role == "assistant" {
            for item in &msg.content {
                if let AnthropicContentBlock::ToolUse { id, .. } = item {
                    let id = id.trim().to_string();
                    if !id.is_empty() {
                        all_tool_use_ids.insert(id);
                    }
                }
            }
        } else if msg.role == "user" {
            for item in &msg.content {
                if let AnthropicContentBlock::ToolResult { tool_use_id, .. } = item {
                    let id = tool_use_id.trim().to_string();
                    if !id.is_empty() {
                        existing_tool_result_ids.insert(id);
                    }
                }
            }
        }
    }

    // ── 第二遍：去重 + 补充 ──
    let mut seen_tool_result_ids: HashSet<String> = HashSet::new();
    let mut deduped: Vec<AnthropicMessage> = Vec::with_capacity(messages.len());

    for mut msg in messages {
        if msg.role != "user" {
            if msg.role == "assistant" {
                // 收集该 assistant 消息声明的 tool_use id
                let mut declared_tool_use_ids: Vec<String> = Vec::new();
                for item in &msg.content {
                    if let AnthropicContentBlock::ToolUse { id, .. } = item {
                        let id = id.trim().to_string();
                        if !id.is_empty() {
                            declared_tool_use_ids.push(id);
                        }
                    }
                }
                deduped.push(msg);

                // 只对真正缺失 tool_result 的 tool_use 补充占位
                // （即在 user 消息中找不到对应 tool_result 的 tool_use）
                let missing_ids: Vec<String> = declared_tool_use_ids
                    .into_iter()
                    .filter(|id| !existing_tool_result_ids.contains(id))
                    .filter(|id| !seen_tool_result_ids.contains(id))
                    .collect();
                if !missing_ids.is_empty() {
                    let mut placeholder_content: Vec<AnthropicContentBlock> = Vec::new();
                    for id in &missing_ids {
                        log::warn!(
                            "[Anthropic] supplementing missing tool_result for tool_use_id={}",
                            id
                        );
	                        placeholder_content.push(AnthropicContentBlock::ToolResult {
	                            tool_use_id: id.clone(),
	                            content: "操作已取消".to_string(),
	                            is_error: None,
	                        });
                        seen_tool_result_ids.insert(id.clone());
                    }
                    deduped.push(AnthropicMessage {
                        role: "user".to_string(),
                        content: placeholder_content,
                    });
                }
                continue;
            }

            deduped.push(msg);
            continue;
        }

        // msg.role == "user": 过滤重复/孤儿 tool_result
        msg.content.retain(|item| {
            if let AnthropicContentBlock::ToolResult { tool_use_id, .. } = item {
                if !all_tool_use_ids.contains(tool_use_id) {
                    log::warn!(
                        "[Anthropic] orphan tool_result dropped (no prior tool_use): tool_use_id={}",
                        tool_use_id
                    );
                    return false;
                }
                if seen_tool_result_ids.contains(tool_use_id) {
                    log::warn!(
                        "[Anthropic] duplicate tool_result dropped: tool_use_id={}",
                        tool_use_id
                    );
                    return false;
                }
                seen_tool_result_ids.insert(tool_use_id.clone());
            }
            true
        });

        if msg.content.is_empty() {
            continue;
        }

        deduped.push(msg);
    }

    deduped
}

// Anthropic流式API (支持extended thinking和工具调用)
pub async fn send_anthropic_stream(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    config: &AIConfig,
    message_id: &str,
    messages: Vec<ChatMessage>,
    tools: Option<serde_json::Value>,
    tool_choice: Option<serde_json::Value>,
    suppress_complete_event: bool,
) -> Result<StreamResult, String> {
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

    // 合并连续相同角色的消息（如多个 tool_result 合并为单条 user 消息）
    let mut messages_json = merge_consecutive_anthropic_messages(messages_json);
    messages_json = dedupe_anthropic_tool_results(messages_json);

    // Anthropic 要求第一条消息必须是 user —— 由前端保证，后端仅校验
    validate_anthropic_message_sequence(&messages_json, &format!(" MessageID: {}", message_id))?;

    // Extended Thinking: 在支持 thinking 的模型上始终启用。
    // thinking signature 已通过 signature_delta SSE 事件收集，并随 assistant
    // 消息的 thinking block 回传，因此多轮 + 工具场景不再受限制。
    let use_thinking = anthropic_model_supports_thinking(&config.model);

    let mut body = if use_thinking {
        serde_json::json!({
            "model": config.model,
            "max_tokens": 16000,
            "messages": messages_json,
            "stream": true,
            "thinking": {
                "type": "enabled",
                "budget_tokens": 10000
            }
        })
    } else {
        serde_json::json!({
            "model": config.model,
            "max_tokens": 8192,
            "messages": messages_json,
            "stream": true
        })
    };

	    // Prompt Caching: system prompt 加 cache_control 断点。
	    // system 是最稳定的前缀（agent.description + catalog + skills 等），
	    // 加 ephemeral 缓存后，5 分钟内的后续请求可命中 cache_read，延迟与费用大幅降低。
	    //
	    // 方法 9 的压缩摘要是通过 [Context Summary] 标记追加到 system 文本末尾的。
	    // 如果存在该标记，将 system 拆分为两个 text block：
	    //   - 第一个 block：稳定前缀（带 cache_control），可命中缓存
	    //   - 第二个 block：摘要后缀（不带 cache_control），不会污染缓存前缀
	    // 避免每次压缩都导致 system 缓存失效。
	    if !system_contents.is_empty() {
	        let joined = system_contents.join("\n\n");
	        let summary_marker = "[Context Summary]";
	        let blocks: Vec<serde_json::Value> = if let Some(marker_pos) = joined.find(summary_marker) {
	            // 找到标记位置，往前截取到上一个换行符（去掉标记前的空行）
	            let prefix_end = marker_pos
	                .saturating_sub(2) // skip "\n\n" before marker
	                .max(0);
	            let prefix = joined[..prefix_end].trim_end();
	            let suffix = joined[prefix_end..].trim_start();
	            if prefix.is_empty() {
	                // 标记在最前面，没有稳定前缀可缓存
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
	            // 没有摘要标记，直接作为单一缓存块
	            vec![serde_json::json!({
	                "type": "text",
	                "text": joined,
	                "cache_control": { "type": "ephemeral" }
	            })]
	        };
	        body["system"] = serde_json::json!(blocks);
	    }

    // Prompt Caching: 工具定义末尾加 cache_control 断点。
    // 工具定义在会话中通常不变，缓存后可避免每次重复处理数千 token 的 schema。
    let has_tools = tools
        .as_ref()
        .map(|v| match v {
            serde_json::Value::Array(arr) => !arr.is_empty(),
            _ => !v.is_null(),
        })
        .unwrap_or(false);
    if let Some(tools_value) = tools {
        if let Some(tools_arr) = tools_value.as_array() {
            let mut tools_with_cache = tools_arr.clone();
            // 在最后一个工具定义上加 cache_control
            if let Some(last_tool) = tools_with_cache.last_mut() {
                last_tool["cache_control"] = serde_json::json!({ "type": "ephemeral" });
            }
            body["tools"] = serde_json::json!(tools_with_cache);
        } else {
            body["tools"] = tools_value.clone();
        }
        apply_provider_tool_choice(&mut body, "anthropic", &tool_choice);
        log::debug!(
            "[Anthropic] Tools count: {}",
            tools_value.as_array().map(|arr| arr.len()).unwrap_or(0)
        );
    }

    // Prompt Caching: 历史消息缓存断点。
    // 在倒数第三条消息的最后一个 content block 上添加 cache_control，
    // 使旧消息前缀能命中缓存，长对话时只有新增消息需要全量计费。
    // Anthropic 最多支持 4 个 cache 断点，当前已用 2 个（system + tools），这里用第 3 个。
    // 只有当消息数 >= 4 时才添加（否则没有足够的历史值得缓存）。
    if let Some(messages_arr) = body["messages"].as_array_mut() {
        if messages_arr.len() >= 4 {
            let breakpoint_idx = messages_arr.len() - 3;
            if let Some(msg) = messages_arr.get_mut(breakpoint_idx) {
                if let Some(content_arr) = msg["content"].as_array_mut() {
                    if let Some(last_block) = content_arr.last_mut() {
                        last_block["cache_control"] =
                            serde_json::json!({ "type": "ephemeral" });
                        log::debug!(
                            "[Anthropic] Added cache_control breakpoint at message index {} (of {})",
                            breakpoint_idx,
                            messages_arr.len()
                        );
                    }
                }
            }
        }
    }

    // anthropic-version 是协议版本 header，Anthropic 仅接受 "2023-06-01"。
    // Extended thinking / tool use 等功能通过 request body 控制，与该 header 无关。
    const ANTHROPIC_API_VERSION: &str = "2023-06-01";

    log::debug!(
        "[Anthropic] Request messages count: {}, has_tools: {}, use_thinking: {}",
        messages_json.len(),
        has_tools,
        use_thinking
    );
    log::debug!(
        "[Anthropic] Request body: {}",
        serde_json::to_string_pretty(&body).unwrap_or_default()
    );

    let response = send_ai_request_with_retry(|| {
        client
            .post(&url)
            .header("x-api-key", &config.api_key)
            .header("anthropic-version", ANTHROPIC_API_VERSION)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
    })
    .await?;

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut utf8_buf: Vec<u8> = Vec::new();

    let mut tool_calls: Vec<serde_json::Value> = Vec::new();
    let mut tool_use_id_by_index: HashMap<u64, String> = HashMap::new();
    let mut tool_args_buffers: HashMap<String, String> = HashMap::new();
    let mut tool_call_vec_index_by_id: HashMap<String, usize> = HashMap::new();

    // 方法 11/12：从 SSE 事件中提取 token usage 信息。
    // Anthropic 在 message_delta 和 message_start 事件中返回 usage。
    let mut captured_usage: Option<TokenUsage> = None;

    // Extended Thinking: 收集 thinking blocks 及其 signature
    let mut current_thinking_text: String = String::new();
    let mut current_thinking_signature: Option<String> = None;
    let mut collected_thinking_blocks: Vec<serde_json::Value> = Vec::new();

    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(chunk) => {
                let chunk_str = decode_chunk_to_string(&chunk, &mut utf8_buf);
                buffer.push_str(&chunk_str);

                // 处理SSE格式的数据
                while let Some(line_end) = buffer.find("\n\n") {
                    let event_data = buffer[..line_end].to_string();
                    buffer = buffer[line_end + 2..].to_string();

                    for line in event_data.lines() {
                        if line.starts_with("data: ") {
                            let json_str = &line[6..];
                            if json_str == "[DONE]" {
                                continue;
                            }

                            if let Ok(event) = serde_json::from_str::<serde_json::Value>(json_str) {
                                let event_type = event["type"].as_str().unwrap_or("");

                                match event_type {
                                    // 方法 11/12：提取 usage 信息。
                                    // message_start 含 input_tokens, cache_creation_input_tokens
                                    // message_delta 含 output_tokens, cache_read_input_tokens
                                    "message_start" => {
                                        if let Some(usage) = event.get("message").and_then(|m| m.get("usage")) {
                                            let input_tokens = usage["input_tokens"].as_u64();
                                            let cache_creation = usage["cache_creation_input_tokens"].as_u64();
                                            let cache_read = usage["cache_read_input_tokens"].as_u64();
                                            if input_tokens.is_some() || cache_creation.is_some() || cache_read.is_some() {
                                                captured_usage = Some(TokenUsage {
                                                    input_tokens,
                                                    output_tokens: None,
                                                    cache_read_input_tokens: cache_read,
                                                    cache_creation_input_tokens: cache_creation,
                                                });
                                                log::debug!(
                                                    "[Anthropic] message_start usage: input={}, cache_creation={}, cache_read={}",
                                                    input_tokens.unwrap_or(0),
                                                    cache_creation.unwrap_or(0),
                                                    cache_read.unwrap_or(0)
                                                );
                                            }
                                        }
                                    }
                                    "message_delta" => {
                                        // message_delta 含最终的 output_tokens 和可能的 cache_read_input_tokens
                                        if let Some(usage) = event.get("usage") {
                                            let output_tokens = usage["output_tokens"].as_u64();
                                            if let Some(out) = output_tokens {
                                                if let Some(ref mut u) = captured_usage {
                                                    u.output_tokens = Some(out);
                                                } else {
                                                    captured_usage = Some(TokenUsage {
                                                        input_tokens: None,
                                                        output_tokens: Some(out),
                                                        cache_read_input_tokens: None,
                                                        cache_creation_input_tokens: None,
                                                    });
                                                }
                                            }
                                            // cache_read 也可能在 message_delta 中出现
                                            let cache_read = usage["cache_read_input_tokens"].as_u64();
                                            if let Some(cr) = cache_read {
                                                if let Some(ref mut u) = captured_usage {
                                                    u.cache_read_input_tokens = Some(cr);
                                                }
                                            }
                                        }
                                    }
	                                    "content_block_start" => {
	                                        let block_type =
	                                            event["content_block"]["type"].as_str().unwrap_or("");

	                                        // 处理 Extended Thinking 块：重置 accumulated 文本和 signature
	                                        if block_type == "thinking" {
	                                            current_thinking_text.clear();
	                                            current_thinking_signature = None;
	                                            // content_block_start 中可能已有初始 thinking 文本
	                                            if let Some(initial) = event["content_block"]["thinking"].as_str() {
	                                                current_thinking_text.push_str(initial);
	                                            }
	                                        }

	                                        // 处理工具调用块
	                                        if block_type == "tool_use" {
                                            let index = event["index"].as_u64().unwrap_or(0);
                                            let id = event["content_block"]["id"]
                                                .as_str()
                                                .unwrap_or("")
                                                .to_string();
                                            let name = event["content_block"]["name"]
                                                .as_str()
                                                .unwrap_or("")
                                                .to_string();
                                            tool_use_id_by_index.insert(index, id.clone());
                                            tool_args_buffers
                                                .entry(id.clone())
                                                .or_insert_with(String::new);

                                            let input = &event["content_block"]["input"]; // may be null/empty; can also be streamed in deltas
                                            let args_str = if !input.is_null() {
                                                serde_json::to_string(input)
                                                    .unwrap_or_else(|_| "{}".to_string())
                                            } else {
                                                "{}".to_string()
                                            };

                                            let tool_call = serde_json::json!({
                                                "id": id,
                                                "type": "function",
                                                "function": {
                                                    "name": name,
                                                    "arguments": args_str
                                                }
                                            });
                                            let pos = tool_calls.len();
                                            if let Some(tool_id) = tool_call["id"].as_str() {
                                                tool_call_vec_index_by_id
                                                    .insert(tool_id.to_string(), pos);
                                            }
                                            tool_calls.push(tool_call);
                                        }
                                    }
	                                    "content_block_delta" => {
	                                        let delta = &event["delta"];
	                                        let delta_type = delta["type"].as_str().unwrap_or("");

	                                        if delta_type == "thinking_delta" {
	                                            if let Some(thinking) = delta["thinking"].as_str() {
	                                                // Accumulate thinking text for block reconstruction
	                                                current_thinking_text.push_str(thinking);
	                                                emit_filtered_chunk(
	                                                    app, message_id, thinking, "thinking",
	                                                );
	                                            }
	                                        } else if delta_type == "signature_delta" {
	                                            // Capture thinking signature (required for multi-turn thinking)
	                                            if let Some(sig) = delta["signature"].as_str() {
	                                                current_thinking_signature = Some(sig.to_string());
	                                            }
	                                        } else if delta_type == "text_delta" {
                                            if let Some(text) = delta["text"].as_str() {
                                                emit_filtered_chunk(
                                                    app, message_id, text, "content",
                                                );
                                            }
                                        } else if delta_type == "input_json_delta" {
                                            let index = event["index"].as_u64().unwrap_or(0);
                                            if let Some(tool_id) =
                                                tool_use_id_by_index.get(&index).cloned()
                                            {
                                                if let Some(partial) =
                                                    delta["partial_json"].as_str()
                                                {
                                                    let buf = tool_args_buffers
                                                        .entry(tool_id)
                                                        .or_insert_with(String::new);
                                                    buf.push_str(partial);
                                                }
                                            }
                                        }
                                    }
	                                    "message_stop" => {
	                                        // finalize tool arguments from streamed partial_json
	                                        for (tool_id, partial) in tool_args_buffers.iter() {
	                                            if partial.trim().is_empty() {
	                                                continue;
	                                            }
	                                            if let Some(pos) =
	                                                tool_call_vec_index_by_id.get(tool_id)
	                                            {
	                                                let repaired = finalize_tool_args(partial);
	                                                if let Ok(val) =
	                                                    serde_json::from_str::<serde_json::Value>(
	                                                        &repaired,
	                                                    )
	                                                {
	                                                    let normalized = serde_json::to_string(&val)
	                                                        .unwrap_or_else(|_| repaired.clone());
	                                                    tool_calls[*pos]["function"]["arguments"] =
	                                                        serde_json::json!(normalized);
	                                                } else {
	                                                    tool_calls[*pos]["function"]["arguments"] =
	                                                        serde_json::json!(repaired);
	                                                }
	                                            }
	                                        }

	                                        // 构建 thinking blocks（用于多轮对话中的 thinking block 回传）
	                                        collected_thinking_blocks.clear();
	                                        if !current_thinking_text.is_empty() {
	                                            if let Some(ref sig) = current_thinking_signature {
	                                                collected_thinking_blocks.push(serde_json::json!({
	                                                    "type": "thinking",
	                                                    "thinking": current_thinking_text,
	                                                    "signature": sig,
	                                                }));
	                                            }
	                                        }

	                                        // 发送完成事件，包含工具调用信息（如果有）
	                                        let mut complete_data = serde_json::json!({
	                                            "message_id": message_id
	                                        });

	                                        if !tool_calls.is_empty() {
	                                            complete_data["tool_calls"] =
	                                                serde_json::json!(tool_calls);
	                                        }

	                                        // Extended Thinking: 将 signature 回传前端供持久化
	                                        if let Some(ref sig) = current_thinking_signature {
	                                            complete_data["thinking_signature"] =
	                                                serde_json::json!(sig);
	                                        }

	                                        // 方法 11/12：将 usage 信息附加到完成事件中回传前端
                                        if let Some(ref usage) = captured_usage {
                                            complete_data["usage"] = serde_json::json!({
                                                "input_tokens": usage.input_tokens,
                                                "output_tokens": usage.output_tokens,
                                                "cache_read_input_tokens": usage.cache_read_input_tokens,
                                                "cache_creation_input_tokens": usage.cache_creation_input_tokens,
                                            });
                                        }

                                        if !suppress_complete_event {
                                            let _ = app.emit("ai-stream-complete", complete_data);
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                let _ = app.emit(
                    "ai-stream-error",
                    serde_json::json!({ "error": format!("流读取失败: {}", e), "message_id": message_id }),
                );
                return Err(format!("流读取失败: {}", e));
            }
        }
    }

    Ok(StreamResult { tool_calls, usage: captured_usage, thinking_blocks: collected_thinking_blocks })
}

// OpenAI流式API (支持工具调用)
pub async fn send_openai_stream(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    config: &AIConfig,
    message_id: &str,
    messages: Vec<ChatMessage>,
    tools: Option<serde_json::Value>,
    tool_choice: Option<serde_json::Value>,
    suppress_complete_event: bool,
) -> Result<StreamResult, String> {
    let url = openai_chat_completion_urls(&config.endpoint)
        .into_iter()
        .next()
        .unwrap_or_else(|| format!("{}/chat/completions", config.endpoint.trim_end_matches('/')));

    // 使用与 send_openai_chat 相同的共享函数构建消息数组，
    // 不再在后端注入任何 system 提示（thinking prompt 等职责已移至前端）。
    let messages_json = build_openai_messages_payload(&messages)?;

    let mut body = serde_json::json!({
        "model": config.model,
        "messages": messages_json,
        "stream": true,
        "temperature": 0.7
    });

    // 如果提供了工具定义，添加到请求中
    if let Some(tools_value) = tools {
        body["tools"] = tools_value;
        apply_provider_tool_choice(&mut body, "openai", &tool_choice);
    }

    let response = send_ai_request_with_retry(|| {
        let mut req = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .header("Content-Type", "application/json");

        if let Some(org_id) = &config.organization_id {
            if !org_id.is_empty() {
                req = req.header("OpenAI-Organization", org_id);
            }
        }

        req.json(&body).send()
    })
    .await?;

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut utf8_buf: Vec<u8> = Vec::new();
    let mut thinking_tags = ThinkingTagStreamState::new();
    let mut reasoning_state = ReasoningStreamState::new();
    let mut tool_calls: Vec<serde_json::Value> = Vec::new();
    let mut complete_emitted = false;
    // 方法 11/12：OpenAI 流式响应在最后一个 chunk 中返回 usage
    let mut captured_usage: Option<TokenUsage> = None;

    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(chunk) => {
                let chunk_str = decode_chunk_to_string(&chunk, &mut utf8_buf);
                buffer.push_str(&chunk_str);

                loop {
                    let boundary_nl = buffer.find("\n\n");
                    let boundary_crlf = buffer.find("\r\n\r\n");
                    let (line_end, sep_len) = match (boundary_nl, boundary_crlf) {
                        (None, None) => break,
                        (Some(a), None) => (a, 2usize),
                        (None, Some(b)) => (b, 4usize),
                        (Some(a), Some(b)) => {
                            if a <= b {
                                (a, 2usize)
                            } else {
                                (b, 4usize)
                            }
                        }
                    };

                    let event_data = buffer[..line_end].to_string();
                    buffer = buffer[line_end + sep_len..].to_string();

                    for line in event_data.lines() {
                        if line.starts_with("data: ") {
                            let json_str = line[6..].trim();
                            if json_str == "[DONE]" {
                                thinking_tags.flush_pending(app, message_id);

                                // 为缺少 id 的 tool_calls 生成唯一 id（部分 OpenAI 兼容 API 可能不返回 id）
                                for (i, tc) in tool_calls.iter_mut().enumerate() {
                                    if tc["id"].as_str().unwrap_or("").is_empty() {
                                        tc["id"] = serde_json::json!(format!(
                                            "call_{}{}",
                                            message_id.replace("-", "").replace("_", ""),
                                            i
                                        ));
                                    }
                                }

                                // 发送完成事件，包含工具调用信息（如果有）
                                let mut complete_data = serde_json::json!({
                                    "message_id": message_id
                                });

                                if !tool_calls.is_empty() {
                                    complete_data["tool_calls"] = serde_json::json!(tool_calls);
                                }

                                // 方法 11/12：附加 usage 信息
                                if let Some(ref usage) = captured_usage {
                                    complete_data["usage"] = serde_json::json!({
                                        "input_tokens": usage.input_tokens,
                                        "output_tokens": usage.output_tokens,
                                        "cache_read_input_tokens": usage.cache_read_input_tokens,
                                        "cache_creation_input_tokens": usage.cache_creation_input_tokens,
                                    });
                                }

                                if !suppress_complete_event {
                                    let _ = app.emit("ai-stream-complete", complete_data);
                                }
                                complete_emitted = true;
                                continue;
                            }

                            if let Ok(event) = serde_json::from_str::<serde_json::Value>(json_str) {
                                // 方法 11/12：提取 usage（OpenAI 在最后一个 chunk 中返回）
                                if let Some(usage) = event.get("usage") {
                                    if !usage.is_null() {
                                        let prompt = usage["prompt_tokens"].as_u64();
                                        let completion = usage["completion_tokens"].as_u64();
                                        if prompt.is_some() || completion.is_some() {
                                            captured_usage = Some(TokenUsage {
                                                input_tokens: prompt,
                                                output_tokens: completion,
                                                cache_read_input_tokens: None,
                                                cache_creation_input_tokens: None,
                                            });
                                        }
                                    }
                                }
                                // 检查工具调用
                                if let Some(delta_tool_calls) =
                                    event["choices"][0]["delta"]["tool_calls"].as_array()
                                {
                                    for tool_call_delta in delta_tool_calls {
                                        if let Some(index) = tool_call_delta["index"].as_u64() {
                                            let idx = index as usize;

                                            // 确保tool_calls数组足够大
                                            while tool_calls.len() <= idx {
                                                tool_calls.push(serde_json::json!({
                                                    "id": "",
                                                    "type": "function",
                                                    "function": {
                                                        "name": "",
                                                        "arguments": ""
                                                    }
                                                }));
                                            }

                                            // 累积工具调用信息
                                            if let Some(id) = tool_call_delta["id"].as_str() {
                                                tool_calls[idx]["id"] = serde_json::json!(id);
                                            }
                                            if let Some(func) =
                                                tool_call_delta["function"].as_object()
                                            {
                                                if let Some(name) =
                                                    func.get("name").and_then(|v| v.as_str())
                                                {
                                                    if !name.is_empty() {
                                                        tool_calls[idx]["function"]["name"] =
                                                            serde_json::json!(name);
                                                    }
                                                }
                                                if let Some(args) =
                                                    func.get("arguments").and_then(|v| v.as_str())
                                                {
                                                    let current_args = tool_calls[idx]["function"]
                                                        ["arguments"]
                                                        .as_str()
                                                        .unwrap_or("");
                                                    tool_calls[idx]["function"]["arguments"] = serde_json::json!(
                                                        format!("{}{}", current_args, args)
                                                    );
                                                }
                                            }
                                        }
                                    }
                                }

                                if let Some(message_tool_calls) =
                                    event["choices"][0]["message"]["tool_calls"].as_array()
                                {
                                    if !message_tool_calls.is_empty() {
                                        tool_calls = message_tool_calls.clone();
                                    }
                                }

                                if let Some(fc) = event["choices"][0]["delta"]["function_call"]
                                    .as_object()
                                    .or_else(|| {
                                        event["choices"][0]["message"]["function_call"].as_object()
                                    })
                                {
                                    if tool_calls.is_empty() {
                                        tool_calls.push(serde_json::json!({
                                            "id": "legacy_function_call_0",
                                            "type": "function",
                                            "function": {
                                                "name": "",
                                                "arguments": ""
                                            }
                                        }));
                                    }

                                    if let Some(name) = fc.get("name").and_then(|v| v.as_str()) {
                                        if !name.is_empty() {
                                            tool_calls[0]["function"]["name"] = serde_json::json!(name);
                                        }
                                    }
                                    if let Some(args) = fc.get("arguments").and_then(|v| v.as_str())
                                    {
                                        let current_args = tool_calls[0]["function"]["arguments"]
                                            .as_str()
                                            .unwrap_or("");
                                        tool_calls[0]["function"]["arguments"] =
                                            serde_json::json!(format!("{}{}", current_args, args));
                                    }
                                }

                                // 检查reasoning_content (支持o1系列、DeepSeek R1等)
                                process_openai_compatible_choice_delta(
                                    app,
                                    message_id,
                                    &event["choices"][0],
                                    &mut reasoning_state,
                                    &mut thinking_tags,
                                );
                            }
                        }
                    }
                }
            }
            Err(e) => {
                let _ = app.emit(
                    "ai-stream-error",
                    serde_json::json!({ "error": format!("流读取失败: {}", e), "message_id": message_id }),
                );
                return Err(format!("流读取失败: {}", e));
            }
        }
    }
    // 处理 buffer 中残余的数据（最后一个事件可能没有以 \n\n 结尾）
    if !buffer.is_empty() {
        for line in buffer.lines() {
            if line.starts_with("data: ") {
                let json_str = line[6..].trim();
                if json_str == "[DONE]" {
                    thinking_tags.flush_pending(app, message_id);

                    // 为缺少 id 的 tool_calls 生成唯一 id（部分 OpenAI 兼容 API 可能不返回 id）
                    for (i, tc) in tool_calls.iter_mut().enumerate() {
                        if tc["id"].as_str().unwrap_or("").is_empty() {
                            tc["id"] = serde_json::json!(format!(
                                "call_{}{}",
                                message_id.replace("-", "").replace("_", ""),
                                i
                            ));
                        }
                    }

                    // 发送完成事件
                    let mut complete_data = serde_json::json!({
                        "message_id": message_id
                    });
                    if !tool_calls.is_empty() {
                        complete_data["tool_calls"] = serde_json::json!(tool_calls);
                    }
                    // 方法 11/12：附加 usage 信息
                    if let Some(ref usage) = captured_usage {
                        complete_data["usage"] = serde_json::json!({
                            "input_tokens": usage.input_tokens,
                            "output_tokens": usage.output_tokens,
                            "cache_read_input_tokens": usage.cache_read_input_tokens,
                            "cache_creation_input_tokens": usage.cache_creation_input_tokens,
                        });
                    }
                    if !suppress_complete_event {
                        let _ = app.emit("ai-stream-complete", complete_data);
                    }
                    complete_emitted = true;
                } else if let Ok(event) = serde_json::from_str::<serde_json::Value>(json_str) {
                    if let Some(delta_tool_calls) =
                        event["choices"][0]["delta"]["tool_calls"].as_array()
                    {
                        for tool_call_delta in delta_tool_calls {
                            if let Some(index) = tool_call_delta["index"].as_u64() {
                                let idx = index as usize;
                                while tool_calls.len() <= idx {
                                    tool_calls.push(serde_json::json!({
                                        "id": "",
                                        "type": "function",
                                        "function": {
                                            "name": "",
                                            "arguments": ""
                                        }
                                    }));
                                }
                                if let Some(id) = tool_call_delta["id"].as_str() {
                                    tool_calls[idx]["id"] = serde_json::json!(id);
                                }
                                if let Some(func) = tool_call_delta["function"].as_object() {
                                    if let Some(name) = func.get("name").and_then(|v| v.as_str()) {
                                        if !name.is_empty() {
                                            tool_calls[idx]["function"]["name"] =
                                                serde_json::json!(name);
                                        }
                                    }
                                    if let Some(args) =
                                        func.get("arguments").and_then(|v| v.as_str())
                                    {
                                        let current_args = tool_calls[idx]["function"]["arguments"]
                                            .as_str()
                                            .unwrap_or("");
                                        tool_calls[idx]["function"]["arguments"] =
                                            serde_json::json!(format!("{}{}", current_args, args));
                                    }
                                }
                            }
                        }
                    }

                    if let Some(message_tool_calls) =
                        event["choices"][0]["message"]["tool_calls"].as_array()
                    {
                        if !message_tool_calls.is_empty() {
                            tool_calls = message_tool_calls.clone();
                        }
                    }

                    if let Some(fc) = event["choices"][0]["delta"]["function_call"]
                        .as_object()
                        .or_else(|| event["choices"][0]["message"]["function_call"].as_object())
                    {
                        if tool_calls.is_empty() {
                            tool_calls.push(serde_json::json!({
                                "id": "legacy_function_call_0",
                                "type": "function",
                                "function": {
                                    "name": "",
                                    "arguments": ""
                                }
                            }));
                        }

                        if let Some(name) = fc.get("name").and_then(|v| v.as_str()) {
                            if !name.is_empty() {
                                tool_calls[0]["function"]["name"] = serde_json::json!(name);
                            }
                        }
                        if let Some(args) = fc.get("arguments").and_then(|v| v.as_str()) {
                            let current_args = tool_calls[0]["function"]["arguments"]
                                .as_str()
                                .unwrap_or("");
                            tool_calls[0]["function"]["arguments"] =
                                serde_json::json!(format!("{}{}", current_args, args));
                        }
                    }

                    process_openai_compatible_choice_delta(
                        app,
                        message_id,
                        &event["choices"][0],
                        &mut reasoning_state,
                        &mut thinking_tags,
                    );
                }
            }
        }
    }

    thinking_tags.flush_pending(app, message_id);

    if !complete_emitted {
        // 为缺少 id 的 tool_calls 生成唯一 id（部分 OpenAI 兼容 API 可能不返回 id）
        for (i, tc) in tool_calls.iter_mut().enumerate() {
            if tc["id"].as_str().unwrap_or("").is_empty() {
                tc["id"] = serde_json::json!(format!(
                    "call_{}{}",
                    message_id.replace("-", "").replace("_", ""),
                    i
                ));
            }
        }

        let mut complete_data = serde_json::json!({
            "message_id": message_id
        });
        if !tool_calls.is_empty() {
            complete_data["tool_calls"] = serde_json::json!(tool_calls);
        }
        // 方法 11/12：附加 usage 信息
        if let Some(ref usage) = captured_usage {
            complete_data["usage"] = serde_json::json!({
                "input_tokens": usage.input_tokens,
                "output_tokens": usage.output_tokens,
                "cache_read_input_tokens": usage.cache_read_input_tokens,
                "cache_creation_input_tokens": usage.cache_creation_input_tokens,
            });
        }
        if !suppress_complete_event {
            let _ = app.emit("ai-stream-complete", complete_data);
        }
    }

    Ok(StreamResult { tool_calls, usage: captured_usage, thinking_blocks: Vec::new() })
}

// Gemini流式API (支持工具调用)

fn process_gemini_sse_event_data(
    app: &tauri::AppHandle,
    message_id: &str,
    event_data: &str,
    tool_calls: &mut Vec<serde_json::Value>,
    tool_call_keys: &mut HashSet<String>,
) {
    for line in event_data.lines() {
        if line.starts_with("data: ") {
            let json_str = &line[6..];

            if let Ok(event) = serde_json::from_str::<serde_json::Value>(json_str) {
                if let Some(parts) = event["candidates"][0]["content"]["parts"].as_array() {
                    for part in parts {
                        if let Some(text) = part["text"].as_str() {
                            let chunk_type =
                                if part.get("thought").and_then(|v| v.as_bool()) == Some(true) {
                                    "thinking"
                                } else {
                                    "content"
                                };
                            emit_filtered_chunk(app, message_id, text, chunk_type);
                        }

                        if let Some(function_call) = part["functionCall"].as_object() {
                            let name = function_call
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            if name.trim().is_empty() {
                                continue;
                            }

                            let args_value = function_call
                                .get("args")
                                .cloned()
                                .unwrap_or_else(|| serde_json::json!({}));
                            let args_str = serde_json::to_string(&args_value)
                                .unwrap_or_else(|_| "{}".to_string());
                            let key = format!("{}|{}", name, args_str);
                            if tool_call_keys.contains(&key) {
                                continue;
                            }
                            tool_call_keys.insert(key);

                            let idx = tool_calls.len();
                            tool_calls.push(serde_json::json!({
                                "id": format!("gemini_tool_call_{}", idx),
                                "type": "function",
                                "function": {
                                    "name": name,
                                    "arguments": args_str
                                }
                            }));
                        }
                    }
                }
            }
        }
    }
}

pub async fn send_gemini_stream(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    config: &AIConfig,
    message_id: &str,
    messages: Vec<ChatMessage>,
    tools: Option<serde_json::Value>,
    tool_choice: Option<serde_json::Value>,
    suppress_complete_event: bool,
) -> Result<StreamResult, String> {
    let mut url = get_gemini_chat_url(&config.endpoint, &config.model);
    // 将 :generateContent 替换为 :streamGenerateContent
    if url.contains(":generateContent") {
        url = url.replace(":generateContent", ":streamGenerateContent");
    }
    // 添加 alt=sse 参数以获取 SSE 流式格式
    if !url.contains("alt=sse") {
        if url.contains('?') {
            url.push_str("&alt=sse");
        } else {
            url.push_str("?alt=sse");
        }
    }

    let (contents, system_instruction) = build_gemini_contents(&messages)?;

    let mut body = serde_json::json!({
        "contents": contents,
    });

    if let Some(si) = system_instruction {
        body["systemInstruction"] = si;
    }

    // 如果提供了工具定义，添加到请求中（Gemini格式）
    if let Some(tools_value) = tools {
        body["tools"] = tools_value;
        apply_provider_tool_choice(&mut body, "gemini", &tool_choice);
    }

    let response = send_ai_request_with_retry(|| {
        client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("x-goog-api-key", &config.api_key)
            .json(&body)
            .send()
    })
    .await?;

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut utf8_buf: Vec<u8> = Vec::new();
    let mut tool_calls: Vec<serde_json::Value> = Vec::new();
    let mut tool_call_keys: HashSet<String> = HashSet::new();

    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(chunk) => {
                let chunk_str = decode_chunk_to_string(&chunk, &mut utf8_buf);
                buffer.push_str(&chunk_str);

                while let Some(line_end) = buffer.find("\n\n") {
                    let event_data = buffer[..line_end].to_string();
                    buffer = buffer[line_end + 2..].to_string();

                    process_gemini_sse_event_data(
                        app,
                        message_id,
                        &event_data,
                        &mut tool_calls,
                        &mut tool_call_keys,
                    );
                }
            }
            Err(e) => {
                let _ = app.emit(
                    "ai-stream-error",
                    serde_json::json!({ "error": format!("流读取失败: {}", e), "message_id": message_id }),
                );
                return Err(format!("流读取失败: {}", e));
            }
        }
    }

    // 处理 buffer 中残余的数据（最后一个事件可能没有以 \n\n 结尾）
    if !buffer.is_empty() {
        process_gemini_sse_event_data(
            app,
            message_id,
            &buffer,
            &mut tool_calls,
            &mut tool_call_keys,
        );
    }

    if !suppress_complete_event {
        let _ = app.emit(
            "ai-stream-complete",
            if tool_calls.is_empty() {
                serde_json::json!({
                    "message_id": message_id
                })
            } else {
                serde_json::json!({
                    "message_id": message_id,
                    "tool_calls": tool_calls
                })
            },
        );
    }

    Ok(StreamResult { tool_calls, usage: None, thinking_blocks: Vec::new() })
}

// Ollama流式API (使用OpenAI兼容格式)
pub async fn send_ollama_stream(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    config: &AIConfig,
    message_id: &str,
    messages: Vec<ChatMessage>,
    tools: Option<serde_json::Value>,
    tool_choice: Option<serde_json::Value>,
    suppress_complete_event: bool,
) -> Result<StreamResult, String> {
    // Ollama 使用 OpenAI 兼容的 API
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

    let mut body = serde_json::json!({
        "model": config.model,
        "messages": messages_json,
        "stream": true,
    });

    // 如果提供了工具定义，添加到请求中
    if let Some(tools_value) = tools {
        body["tools"] = tools_value;
        apply_provider_tool_choice(&mut body, "ollama", &tool_choice);
    }

    let response = send_ai_request_with_retry(|| {
        let mut req = client.post(&url).header("Content-Type", "application/json");
        if !config.api_key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", config.api_key));
        }
        req.json(&body).send()
    })
    .await?;

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut utf8_buf: Vec<u8> = Vec::new();
    let mut tool_calls: Vec<serde_json::Value> = Vec::new();
    let mut complete_emitted = false;
    let mut thinking_tags = ThinkingTagStreamState::new();
    let mut reasoning_state = ReasoningStreamState::new();
    // 方法 11/12：Ollama (OpenAI 兼容) 在最后一个 chunk 中返回 usage
    let mut captured_usage: Option<TokenUsage> = None;

    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(chunk) => {
                let chunk_str = decode_chunk_to_string(&chunk, &mut utf8_buf);
                buffer.push_str(&chunk_str);

                loop {
                    let boundary_nl = buffer.find("\n\n");
                    let boundary_crlf = buffer.find("\r\n\r\n");
                    let (line_end, sep_len) = match (boundary_nl, boundary_crlf) {
                        (None, None) => break,
                        (Some(a), None) => (a, 2usize),
                        (None, Some(b)) => (b, 4usize),
                        (Some(a), Some(b)) => {
                            if a <= b {
                                (a, 2usize)
                            } else {
                                (b, 4usize)
                            }
                        }
                    };

                    let event_data = buffer[..line_end].to_string();
                    buffer = buffer[line_end + sep_len..].to_string();

                    for line in event_data.lines() {
                        if line.starts_with("data: ") {
                            let json_str = line[6..].trim();
                            if json_str == "[DONE]" {
                                thinking_tags.flush_pending(app, message_id);
                                // 为缺少 id 的 tool_calls 生成唯一 id（Ollama 可能不返回 id）
                                for (i, tc) in tool_calls.iter_mut().enumerate() {
                                    if tc["id"].as_str().unwrap_or("").is_empty() {
                                        tc["id"] =
                                            serde_json::json!(format!("ollama_tool_call_{}", i));
                                    }
                                }

                                let mut complete_data = serde_json::json!({
                                    "message_id": message_id
                                });

                                if !tool_calls.is_empty() {
                                    complete_data["tool_calls"] = serde_json::json!(tool_calls);
                                }

                                // 方法 11/12：附加 usage 信息
                                if let Some(ref usage) = captured_usage {
                                    complete_data["usage"] = serde_json::json!({
                                        "input_tokens": usage.input_tokens,
                                        "output_tokens": usage.output_tokens,
                                        "cache_read_input_tokens": usage.cache_read_input_tokens,
                                        "cache_creation_input_tokens": usage.cache_creation_input_tokens,
                                    });
                                }

                                if !suppress_complete_event {
                                    let _ = app.emit("ai-stream-complete", complete_data);
                                }
                                complete_emitted = true;
                                continue;
                            }

                            if let Ok(event) = serde_json::from_str::<serde_json::Value>(json_str) {
                                // 方法 11/12：提取 usage（Ollama 在最后一个 chunk 中返回）
                                if let Some(usage) = event.get("usage") {
                                    if !usage.is_null() {
                                        let prompt = usage["prompt_tokens"].as_u64();
                                        let completion = usage["completion_tokens"].as_u64();
                                        if prompt.is_some() || completion.is_some() {
                                            captured_usage = Some(TokenUsage {
                                                input_tokens: prompt,
                                                output_tokens: completion,
                                                cache_read_input_tokens: None,
                                                cache_creation_input_tokens: None,
                                            });
                                        }
                                    }
                                }
                                // 处理工具调用
                                if let Some(delta_tool_calls) =
                                    event["choices"][0]["delta"]["tool_calls"].as_array()
                                {
                                    for tool_call_delta in delta_tool_calls {
                                        if let Some(index) = tool_call_delta["index"].as_u64() {
                                            let idx = index as usize;

                                            while tool_calls.len() <= idx {
                                                tool_calls.push(serde_json::json!({
                                                    "id": "",
                                                    "type": "function",
                                                    "function": {
                                                        "name": "",
                                                        "arguments": ""
                                                    }
                                                }));
                                            }

                                            if let Some(id) = tool_call_delta["id"].as_str() {
                                                tool_calls[idx]["id"] = serde_json::json!(id);
                                            }
                                            if let Some(func) =
                                                tool_call_delta["function"].as_object()
                                            {
                                                if let Some(name) =
                                                    func.get("name").and_then(|v| v.as_str())
                                                {
                                                    if !name.is_empty() {
                                                        tool_calls[idx]["function"]["name"] =
                                                            serde_json::json!(name);
                                                    }
                                                }
                                                // Ollama 可能返回字符串或对象的 arguments
                                                let args_str = func
                                                    .get("arguments")
                                                    .and_then(|v| v.as_str())
                                                    .map(|s| s.to_string())
                                                    .or_else(|| {
                                                        func.get("arguments")
                                                            .filter(|v| v.is_object())
                                                            .map(|v| v.to_string())
                                                    });
                                                if let Some(args) = args_str {
                                                    let current_args = tool_calls[idx]["function"]
                                                        ["arguments"]
                                                        .as_str()
                                                        .unwrap_or("");
                                                    tool_calls[idx]["function"]["arguments"] = serde_json::json!(
                                                        format!("{}{}", current_args, args)
                                                    );
                                                }
                                            }
                                        }
                                    }
                                }

                                // 处理 message.tool_calls（Ollama 可能在 message 而非 delta 中返回完整 tool_calls）
                                if let Some(message_tool_calls) =
                                    event["choices"][0]["message"]["tool_calls"].as_array()
                                {
                                    if !message_tool_calls.is_empty() {
                                        // 将 message.tool_calls 中的 arguments 对象转为字符串
                                        tool_calls = message_tool_calls
                                            .iter()
                                            .map(|tc| {
                                                let mut tc = tc.clone();
                                                if let Some(func) = tc.get_mut("function") {
                                                    if let Some(args) = func.get("arguments") {
                                                        if args.is_object() {
                                                            func["arguments"] =
                                                                serde_json::json!(args.to_string());
                                                        }
                                                    }
                                                }
                                                tc
                                            })
                                            .collect();
                                    }
                                }

                                // 检查 reasoning_content (支持思考过程显示)
                                process_openai_compatible_choice_delta(
                                    app,
                                    message_id,
                                    &event["choices"][0],
                                    &mut reasoning_state,
                                    &mut thinking_tags,
                                );
                            }
                        }
                    }
                }
            }
            Err(e) => {
                let _ = app.emit(
                    "ai-stream-error",
                    serde_json::json!({ "error": format!("流读取失败: {}", e), "message_id": message_id }),
                );
                return Err(format!("流读取失败: {}", e));
            }
        }
    }

    thinking_tags.flush_pending(app, message_id);

    // 如果没有收到 [DONE]，手动发送完成事件
    if !complete_emitted {
        // 为缺少 id 的 tool_calls 生成唯一 id（Ollama 可能不返回 id）
        for (i, tc) in tool_calls.iter_mut().enumerate() {
            if tc["id"].as_str().unwrap_or("").is_empty() {
                tc["id"] = serde_json::json!(format!("ollama_tool_call_{}", i));
            }
        }

        let mut complete_data = serde_json::json!({
            "message_id": message_id
        });

        if !tool_calls.is_empty() {
            complete_data["tool_calls"] = serde_json::json!(tool_calls);
        }

        // 方法 11/12：附加 usage 信息
        if let Some(ref usage) = captured_usage {
            complete_data["usage"] = serde_json::json!({
                "input_tokens": usage.input_tokens,
                "output_tokens": usage.output_tokens,
                "cache_read_input_tokens": usage.cache_read_input_tokens,
                "cache_creation_input_tokens": usage.cache_creation_input_tokens,
            });
        }

        if !suppress_complete_event {
            let _ = app.emit("ai-stream-complete", complete_data);
        }
    }

    Ok(StreamResult { tool_calls, usage: captured_usage, thinking_blocks: Vec::new() })
}
