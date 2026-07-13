use base64::Engine;
use image::ImageFormat;
use std::fs;
use std::path::Path;

use std::collections::HashSet;

use super::types::{
    content_as_text, AnthropicContentBlock, AnthropicImageSource, ChatImageAttachment, ChatMessage,
    OpenAIMessage,
};

pub fn media_type_from_image_format(format: ImageFormat) -> Option<&'static str> {
    match format {
        ImageFormat::Png => Some("image/png"),
        ImageFormat::Jpeg => Some("image/jpeg"),
        ImageFormat::WebP => Some("image/webp"),
        ImageFormat::Gif => Some("image/gif"),
        _ => None,
    }
}

pub fn extension_from_image_format(format: ImageFormat) -> Option<&'static str> {
    match format {
        ImageFormat::Png => Some("png"),
        ImageFormat::Jpeg => Some("jpg"),
        ImageFormat::WebP => Some("webp"),
        ImageFormat::Gif => Some("gif"),
        _ => None,
    }
}

pub fn normalize_path_string(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\")
}

pub fn read_attachment_bytes(attachment: &ChatImageAttachment) -> Result<Vec<u8>, String> {
    fs::read(&attachment.path).map_err(|e| format!("读取图片失败 ({}): {}", attachment.path, e))
}

pub fn build_openai_message_content(message: &ChatMessage) -> Result<serde_json::Value, String> {
    let attachments = message
        .attachments
        .as_ref()
        .map(|v| v.as_slice())
        .unwrap_or(&[]);
    if attachments.is_empty() {
        if message.content.is_string() {
            return Ok(message.content.clone());
        }
        return Ok(serde_json::Value::String(content_as_text(&message.content)));
    }

    let mut parts: Vec<serde_json::Value> = Vec::new();
    let text = content_as_text(&message.content);
    if !text.trim().is_empty() {
        parts.push(serde_json::json!({
            "type": "text",
            "text": text,
        }));
    }

    for attachment in attachments {
        let bytes = read_attachment_bytes(attachment)?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        let media_type = if attachment.media_type.trim().is_empty() {
            "image/png"
        } else {
            attachment.media_type.as_str()
        };
        parts.push(serde_json::json!({
            "type": "image_url",
            "image_url": {
                "url": format!("data:{};base64,{}", media_type, b64)
            }
        }));
    }

    Ok(serde_json::Value::Array(parts))
}

pub fn build_anthropic_message_content(
    message: &ChatMessage,
) -> Result<Vec<AnthropicContentBlock>, String> {
    if message.role == "tool" {
        let tool_use_id = message
            .tool_call_id
            .as_deref()
            .unwrap_or("")
            .to_string();
        if !tool_use_id.is_empty() {
            let content_str = content_as_text(&message.content);
            let content_str = if content_str.trim().is_empty() {
                " ".to_string()
            } else {
                content_str
            };
            return Ok(vec![AnthropicContentBlock::ToolResult {
                tool_use_id,
                content: content_str,
                is_error: message.is_error,
            }]);
        }
    }

    if let serde_json::Value::Array(arr) = &message.content {
        let has_anthropic_blocks = arr.iter().any(|item| {
            if let Some(type_str) = item.get("type").and_then(|v| v.as_str()) {
                matches!(type_str, "tool_result" | "tool_use" | "text" | "image")
            } else {
                false
            }
        });

        if has_anthropic_blocks {
            let mut validated_arr = Vec::new();
            for item in arr {
                let type_str = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                match type_str {
                    "tool_result" => {
                        let tool_use_id = item
                            .get("tool_use_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        if tool_use_id.is_empty() {
                            log::warn!("[Anthropic] tool_result missing tool_use_id, skipping");
                            continue;
                        }

                        let content_str = match item.get("content") {
                            Some(serde_json::Value::String(s)) => {
                                if s.trim().is_empty() {
                                    " ".to_string()
                                } else {
                                    s.clone()
                                }
                            }
                            Some(other) => {
                                let s = match other {
                                    serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
                                        serde_json::to_string(other)
                                            .unwrap_or_else(|_| " ".to_string())
                                    }
                                    _ => other.to_string(),
                                };
                                if s.trim().is_empty() {
                                    " ".to_string()
                                } else {
                                    s
                                }
                            }
                            None => " ".to_string(),
                        };

                        validated_arr.push(AnthropicContentBlock::ToolResult {
                            tool_use_id,
                            content: content_str,
                            is_error: item.get("is_error").and_then(|v| v.as_bool()),
                        });
                    }
                    "tool_use" => {
                        let id = item
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let name = item
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let input = item.get("input").cloned().unwrap_or(serde_json::json!({}));
                        validated_arr.push(AnthropicContentBlock::ToolUse { id, name, input });
                    }
                    "image" => {
                        if let Some(source) = item.get("source").and_then(|v| v.as_object()) {
                            let source_type = source
                                .get("type")
                                .and_then(|v| v.as_str())
                                .unwrap_or("base64")
                                .to_string();
                            let media_type = source
                                .get("media_type")
                                .and_then(|v| v.as_str())
                                .unwrap_or("image/png")
                                .to_string();
                            let data = source
                                .get("data")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();

                            validated_arr.push(AnthropicContentBlock::Image {
                                source: AnthropicImageSource {
                                    source_type,
                                    media_type,
                                    data,
                                },
                            });
                        }
                    }
                    "thinking" => {
                        let thinking_text = item
                            .get("thinking")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let signature = item
                            .get("signature")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        if !thinking_text.is_empty() && !signature.is_empty() {
                            validated_arr.push(AnthropicContentBlock::Thinking {
                                thinking: thinking_text,
                                signature,
                            });
                        } else if !thinking_text.is_empty() {
                            // Fallback: treat signature-less thinking as text
                            validated_arr.push(AnthropicContentBlock::Text { text: thinking_text });
                        }
                    }
                    _ => {
                        let text = item.get("text").and_then(|v| v.as_str()).unwrap_or("");
                        let text = if text.trim().is_empty() {
                            " ".to_string()
                        } else {
                            text.to_string()
                        };
                        validated_arr.push(AnthropicContentBlock::Text { text });
                    }
                }
            }
            return Ok(validated_arr);
        }

        let text = content_as_text(&message.content);
        let text = if text.trim().is_empty() {
            " ".to_string()
        } else {
            text
        };
        let mut blocks = vec![AnthropicContentBlock::Text { text }];
        // Prepend thinking block for assistant messages with thinking signature
        if message.role == "assistant" {
            if let (Some(t), Some(s)) = (&message.thinking, &message.thinking_signature) {
                if !t.is_empty() && !s.is_empty() {
                    blocks.insert(0, AnthropicContentBlock::Thinking {
                        thinking: t.clone(),
                        signature: s.clone(),
                    });
                }
            }
        }
        return Ok(blocks);
    }

    let attachments = message
        .attachments
        .as_ref()
        .map(|v| v.as_slice())
        .unwrap_or(&[]);

    if attachments.is_empty() {
        let text = content_as_text(&message.content);
        let text = if text.trim().is_empty() {
            " ".to_string()
        } else {
            text
        };
        let mut blocks = vec![AnthropicContentBlock::Text { text }];
        if message.role == "assistant" {
            if let (Some(t), Some(s)) = (&message.thinking, &message.thinking_signature) {
                if !t.is_empty() && !s.is_empty() {
                    blocks.insert(0, AnthropicContentBlock::Thinking {
                        thinking: t.clone(),
                        signature: s.clone(),
                    });
                }
            }
        }
        return Ok(blocks);
    }

    let mut parts = Vec::new();
    let text = content_as_text(&message.content);
    if !text.trim().is_empty() {
        parts.push(AnthropicContentBlock::Text { text });
    }

    for attachment in attachments {
        let bytes = read_attachment_bytes(attachment)?;
        let data = base64::engine::general_purpose::STANDARD.encode(bytes);
        let media_type = if attachment.media_type.trim().is_empty() {
            "image/png".to_string()
        } else {
            attachment.media_type.clone()
        };
        parts.push(AnthropicContentBlock::Image {
            source: AnthropicImageSource {
                source_type: "base64".to_string(),
                media_type,
                data,
            },
        });
    }

    if message.role == "assistant" {
        if let (Some(t), Some(s)) = (&message.thinking, &message.thinking_signature) {
            if !t.is_empty() && !s.is_empty() {
                parts.insert(0, AnthropicContentBlock::Thinking {
                    thinking: t.clone(),
                    signature: s.clone(),
                });
            }
        }
    }

    Ok(parts)
}

pub fn build_gemini_message_parts(message: &ChatMessage) -> Result<Vec<serde_json::Value>, String> {
    let mut parts: Vec<serde_json::Value> = Vec::new();
    let text = content_as_text(&message.content);
    if !text.trim().is_empty() {
        parts.push(serde_json::json!({ "text": text }));
    }

    if let Some(attachments) = &message.attachments {
        for attachment in attachments {
            let bytes = read_attachment_bytes(attachment)?;
            let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
            let media_type = if attachment.media_type.trim().is_empty() {
                "image/png"
            } else {
                attachment.media_type.as_str()
            };
            parts.push(serde_json::json!({
                "inline_data": {
                    "mime_type": media_type,
                    "data": b64,
                }
            }));
        }
    }

    if parts.is_empty() {
        parts.push(serde_json::json!({ "text": "" }));
    }

    Ok(parts)
}

pub fn build_gemini_contents(
    messages: &[ChatMessage],
) -> Result<(Vec<serde_json::Value>, Option<serde_json::Value>), String> {
    let mut contents: Vec<serde_json::Value> = Vec::new();
    let mut system_texts: Vec<String> = Vec::new();

    for msg in messages {
        if msg.role == "system" {
            let text = content_as_text(&msg.content);
            if !text.trim().is_empty() {
                system_texts.push(text);
            }
            continue;
        }

        if msg.role == "tool" {
            let tool_name = msg
                .tool_name
                .as_deref()
                .filter(|n| !n.is_empty())
                .map(|n| n.to_string())
                .or_else(|| {
                    msg.tool_call_id.as_ref().and_then(|tc_id| {
                        messages.iter().rev().find_map(|prev| {
                            prev.tool_calls.as_ref().and_then(|tcs| {
                                tcs.iter()
                                    .find(|tc| tc.id == *tc_id)
                                    .map(|tc| tc.function.name.clone())
                            })
                        })
                    })
                })
                .unwrap_or_else(|| "unknown_function".to_string());
            let result_text = content_as_text(&msg.content);
            let response_value: serde_json::Value = serde_json::from_str(&result_text)
                .unwrap_or_else(|_| serde_json::json!({ "result": result_text }));

            let part = serde_json::json!({
                "functionResponse": {
                    "name": tool_name,
                    "response": response_value
                }
            });

            if let Some(last) = contents.last_mut() {
                if last["role"].as_str() == Some("user") {
                    if let Some(arr) = last["parts"].as_array_mut() {
                        arr.push(part);
                        continue;
                    }
                }
            }
            contents.push(serde_json::json!({
                "role": "user",
                "parts": [part]
            }));
            continue;
        }

        if msg.role == "assistant" {
            let mut parts: Vec<serde_json::Value> = Vec::new();

            let text = content_as_text(&msg.content);
            if !text.trim().is_empty() {
                parts.push(serde_json::json!({ "text": text }));
            }

            if let Some(tool_calls) = &msg.tool_calls {
                for tc in tool_calls {
                    let args_str = &tc.function.arguments;
                    let args_value: serde_json::Value =
                        serde_json::from_str(args_str).unwrap_or_else(|_| serde_json::json!({}));
                    parts.push(serde_json::json!({
                        "functionCall": {
                            "name": tc.function.name,
                            "args": args_value
                        }
                    }));
                }
            }

            if parts.is_empty() {
                parts.push(serde_json::json!({ "text": "" }));
            }

            if let Some(last) = contents.last_mut() {
                if last["role"].as_str() == Some("model") {
                    if let Some(arr) = last["parts"].as_array_mut() {
                        arr.extend(parts);
                        continue;
                    }
                }
            }
            contents.push(serde_json::json!({
                "role": "model",
                "parts": parts
            }));
            continue;
        }

        let parts = build_gemini_message_parts(msg)?;

        if let Some(last) = contents.last_mut() {
            if last["role"].as_str() == Some("user") {
                if let Some(arr) = last["parts"].as_array_mut() {
                    arr.extend(parts);
                    continue;
                }
            }
        }
        contents.push(serde_json::json!({
            "role": "user",
            "parts": parts
        }));
    }

    let system_instruction = if system_texts.is_empty() {
        None
    } else {
        Some(serde_json::json!({
            "parts": [{ "text": system_texts.join("\n\n") }]
        }))
    };

    Ok((contents, system_instruction))
}

pub fn build_openai_messages_payload(
    messages: &[ChatMessage],
) -> Result<Vec<OpenAIMessage>, String> {
    let mut known_tool_call_ids: HashSet<String> = HashSet::new();
    for m in messages {
        if m.role == "assistant" {
            if let Some(ref tool_calls) = m.tool_calls {
                for tc in tool_calls {
                    if !tc.id.trim().is_empty() {
                        known_tool_call_ids.insert(tc.id.clone());
                    }
                }
            }
        }
    }

    let mut seen_tool_result_ids: HashSet<String> = HashSet::new();
    let mut filtered_messages: Vec<&ChatMessage> = Vec::new();
    for m in messages {
        if m.role == "tool" {
            if let Some(ref tc_id) = m.tool_call_id {
                if !known_tool_call_ids.contains(tc_id) {
                    continue;
                }
                if seen_tool_result_ids.contains(tc_id) {
                    continue;
                }
                seen_tool_result_ids.insert(tc_id.clone());
            } else {
                continue;
            }
        }
        filtered_messages.push(m);
    }

    let mut messages_json: Vec<OpenAIMessage> = Vec::new();
    for m in &filtered_messages {
        messages_json.push(OpenAIMessage {
            role: m.role.clone(),
            content: build_openai_message_content(m)?,
            tool_call_id: m.tool_call_id.clone(),
            tool_calls: m.tool_calls.clone(),
        });

        if m.role == "assistant" {
            if let Some(ref tool_calls) = m.tool_calls {
                for tc in tool_calls {
                    if !tc.id.trim().is_empty() && !seen_tool_result_ids.contains(&tc.id) {
                        messages_json.push(OpenAIMessage {
                            role: "tool".to_string(),
                            content: serde_json::Value::String("操作已取消".to_string()),
                            tool_call_id: Some(tc.id.clone()),
                            tool_calls: None,
                        });
                        seen_tool_result_ids.insert(tc.id.clone());
                    }
                }
            }
        }
    }

    let mut system_msgs: Vec<OpenAIMessage> = Vec::new();
    let mut other_msgs: Vec<OpenAIMessage> = Vec::new();
    for msg in messages_json {
        if msg.role == "system" {
            system_msgs.push(msg);
        } else {
            other_msgs.push(msg);
        }
    }
    system_msgs.extend(other_msgs);

    Ok(system_msgs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_anthropic_message_content_tool_role() {
        let msg = ChatMessage {
            role: "tool".to_string(),
            content: serde_json::Value::String("success".to_string()),
            attachments: None,
            tool_calls: None,
            tool_call_id: Some("tc_123".to_string()),
            tool_name: Some("test_tool".to_string()),
            tool_args: None,
            thinking: None,
            thinking_started_at: None,
            thinking_ended_at: None,
            thinking_signature: None,
            is_error: None,
        };

        let result = build_anthropic_message_content(&msg).unwrap();
        assert_eq!(result.len(), 1);
        
        match &result[0] {
            AnthropicContentBlock::ToolResult { tool_use_id, content, .. } => {
                assert_eq!(tool_use_id, "tc_123");
                assert_eq!(content, "success");
            }
            _ => panic!("Expected ToolResult block"),
        }
    }
}
