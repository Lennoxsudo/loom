use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{async_runtime::JoinHandle, Emitter};

pub struct ChatTaskMap(pub Arc<Mutex<HashMap<String, JoinHandle<()>>>>);

impl ChatTaskMap {
    pub fn lock_map(&self) -> std::sync::MutexGuard<'_, HashMap<String, JoinHandle<()>>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[derive(Debug, Default)]
pub struct StreamResult {
    pub tool_calls: Vec<serde_json::Value>,
    /// Token usage statistics extracted from the API response.
    /// Used for method 11 (token estimation calibration) and
    /// method 12 (cached/uncached token billing).
    #[allow(dead_code)]
    pub usage: Option<TokenUsage>,
    /// Thinking blocks collected from the Anthropic extended thinking stream.
    /// Each block is a JSON object: {"type":"thinking","thinking":"...","signature":"..."}
    /// Used to persist thinking blocks for multi-turn tool conversations.
    pub thinking_blocks: Vec<serde_json::Value>,
}

/// Token usage statistics from the API response.
/// For Anthropic, includes cache_read_input_tokens and cache_creation_input_tokens.
/// For OpenAI, includes prompt_tokens and completion_tokens.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct TokenUsage {
    /// Total input (prompt) tokens reported by the API
    pub input_tokens: Option<u64>,
    /// Total output (completion) tokens reported by the API
    pub output_tokens: Option<u64>,
    /// Anthropic: tokens read from cache (cheap, 10% of normal)
    pub cache_read_input_tokens: Option<u64>,
    /// Anthropic: tokens written to cache (expensive, 125% of normal)
    pub cache_creation_input_tokens: Option<u64>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ToolCallFunction {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: ToolCallFunction,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ChatImageAttachment {
    pub id: String,
    #[serde(rename = "type")]
    pub attachment_type: String,
    pub path: String,
    #[serde(rename = "mediaType")]
    pub media_type: String,
    pub width: u32,
    pub height: u32,
    pub size: u64,
    pub sha256: String,
    #[serde(rename = "fileName")]
    #[serde(default)]
    pub file_name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OpenAIMessage {
    pub role: String,
    pub content: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type")]
pub enum AnthropicContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image { source: AnthropicImageSource },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        is_error: Option<bool>,
    },
    /// Anthropic Extended Thinking block.
    /// `thinking` contains the thinking text, `signature` is the cryptographic
    /// signature required for multi-turn thinking conversations.
    #[serde(rename = "thinking")]
    Thinking {
        thinking: String,
        signature: String,
    },
}

#[derive(Debug, Serialize, Clone)]
pub struct AnthropicImageSource {
    #[serde(rename = "type")]
    pub source_type: String,
    pub media_type: String,
    pub data: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct AnthropicMessage {
    pub role: String,
    pub content: Vec<AnthropicContentBlock>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: serde_json::Value,
    #[serde(default)]
    pub attachments: Option<Vec<ChatImageAttachment>>,
    #[serde(default)]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(default)]
    pub tool_call_id: Option<String>,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub tool_args: Option<serde_json::Value>,
    /// Whether this tool result message represents an error.
    /// Used for Anthropic's `tool_result.is_error` flag.
    #[serde(default)]
    pub is_error: Option<bool>,
    #[serde(default)]
    pub thinking: Option<String>,
    #[serde(default, rename = "thinkingStartedAt")]
    pub thinking_started_at: Option<i64>,
    #[serde(default, rename = "thinkingEndedAt")]
    pub thinking_ended_at: Option<i64>,
    /// Cryptographic signature from Anthropic Extended Thinking.
    /// Required to send thinking blocks back in follow-up requests.
    #[serde(default, rename = "thinkingSignature")]
    pub thinking_signature: Option<String>,
    /// Slash skill invocation metadata (bubble short form vs expanded content)
    #[serde(default, rename = "slashCommand")]
    pub slash_command: Option<serde_json::Value>,
}

#[derive(Deserialize, Clone)]
pub struct AIConfig {
    pub endpoint: String,
    #[serde(rename = "apiKey")]
    pub api_key: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(rename = "organizationId")]
    pub organization_id: Option<String>,
}

/// An entry in the auto-routing fallback chain.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AutoRoutingEntry {
    pub provider: String,
    #[serde(rename = "profileId")]
    pub profile_id: String,
    pub model: String,
}

/// Auto-routing configuration for fallback between providers.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AutoRoutingConfig {
    pub enabled: bool,
    pub entries: Vec<AutoRoutingEntry>,
}

#[derive(Serialize)]
pub struct TestResult {
    pub success: bool,
    pub message: String,
}

pub fn content_as_text(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => "".to_string(),
        serde_json::Value::Array(arr) => {
            let mut out = String::new();
            for (i, v) in arr.iter().enumerate() {
                if let Some(text) = v.get("text").and_then(|t| t.as_str()) {
                    if i > 0 {
                        out.push('\n');
                    }
                    out.push_str(text);
                    continue;
                }
                if let Some(text) = v.get("content").and_then(|t| t.as_str()) {
                    if i > 0 {
                        out.push('\n');
                    }
                    out.push_str(text);
                    continue;
                }
                if let Some(text) = v.as_str() {
                    if i > 0 {
                        out.push('\n');
                    }
                    out.push_str(text);
                    continue;
                }
                if i > 0 {
                    out.push('\n');
                }
                out.push_str(&v.to_string());
            }
            out
        }
        other => other.to_string(),
    }
}

pub fn find_first_tag(haystack: &str, tags: &[&str]) -> Option<(usize, usize)> {
    let haystack_bytes = haystack.as_bytes();
    let mut best: Option<(usize, usize)> = None;

    for tag in tags {
        let tag_bytes = tag.as_bytes();
        if tag_bytes.is_empty() || tag_bytes.len() > haystack_bytes.len() {
            continue;
        }

        let search_end = haystack_bytes.len() - tag_bytes.len();
        for start in 0..=search_end {
            let matches = haystack_bytes[start..start + tag_bytes.len()]
                .iter()
                .zip(tag_bytes.iter())
                .all(|(a, b)| a.eq_ignore_ascii_case(b));
            if matches {
                match best {
                    Some((best_pos, _)) if start >= best_pos => {}
                    _ => best = Some((start, tag_bytes.len())),
                }
                break;
            }
        }
    }

    best
}

pub const THINKING_START_TAGS: &[&str] = &["<thinking>", "<think>"];
pub const THINKING_END_TAGS: &[&str] = &["</thinking>", "</think>"];
/// Longest start tag: `<think>`
pub const THINKING_START_TAG_KEEP: usize = 8;
/// Longest end tag: `</think>`
pub const THINKING_END_TAG_KEEP: usize = 21;

pub struct ThinkingTagStreamState {
    pub in_thinking_tag: bool,
    pub pending: String,
}

impl ThinkingTagStreamState {
    pub fn new() -> Self {
        Self {
            in_thinking_tag: false,
            pending: String::new(),
        }
    }

    pub fn push_content(
        &mut self,
        app: &tauri::AppHandle,
        message_id: &str,
        content: &str,
    ) {
        if !self.in_thinking_tag && self.pending.is_empty() && !content.contains('<') {
            emit_filtered_chunk(app, message_id, content, "content");
            return;
        }

        self.pending.push_str(content);

        loop {
            if self.in_thinking_tag {
                if let Some((end_pos, end_len)) =
                    find_first_tag(self.pending.as_str(), THINKING_END_TAGS)
                {
                    let thinking_part = self.pending[..end_pos].to_string();
                    if !thinking_part.is_empty() {
                        emit_filtered_chunk(app, message_id, &thinking_part, "thinking");
                    }
                    self.pending = self.pending[end_pos + end_len..].to_string();
                    self.in_thinking_tag = false;
                    continue;
                }

                if self.pending.len() > THINKING_END_TAG_KEEP {
                    let mut split_at = self.pending.len().saturating_sub(THINKING_END_TAG_KEEP);
                    while split_at > 0 && !self.pending.is_char_boundary(split_at) {
                        split_at -= 1;
                    }
                    let emit_part = self.pending[..split_at].to_string();
                    self.pending = self.pending[split_at..].to_string();
                    if !emit_part.is_empty() {
                        emit_filtered_chunk(app, message_id, &emit_part, "thinking");
                    }
                }
                break;
            } else if let Some((start_pos, start_len)) =
                find_first_tag(self.pending.as_str(), THINKING_START_TAGS)
            {
                let before_thinking = self.pending[..start_pos].to_string();
                if !before_thinking.is_empty() {
                    emit_filtered_chunk(app, message_id, &before_thinking, "content");
                }
                self.pending = self.pending[start_pos + start_len..].to_string();
                self.in_thinking_tag = true;
                continue;
            } else if self.pending.len() > THINKING_START_TAG_KEEP {
                let mut split_at = self.pending.len().saturating_sub(THINKING_START_TAG_KEEP);
                while split_at > 0 && !self.pending.is_char_boundary(split_at) {
                    split_at -= 1;
                }
                let emit_part = self.pending[..split_at].to_string();
                self.pending = self.pending[split_at..].to_string();
                if !emit_part.is_empty() {
                    emit_filtered_chunk(app, message_id, &emit_part, "content");
                }
            }
            break;
        }
    }

    pub fn flush_pending(&mut self, app: &tauri::AppHandle, message_id: &str) {
        if self.pending.is_empty() {
            return;
        }
        let chunk_type = if self.in_thinking_tag {
            "thinking"
        } else {
            "content"
        };
        emit_filtered_chunk(app, message_id, &self.pending, chunk_type);
        self.pending.clear();
    }
}

pub fn emit_filtered_chunk(
    app: &tauri::AppHandle,
    message_id: &str,
    chunk: &str,
    chunk_type: &str,
) {
    let _ = app.emit(
        "ai-stream-chunk",
        serde_json::json!({
            "message_id": message_id,
            "chunk": chunk,
            "chunk_type": chunk_type
        }),
    );
}

const OPENAI_REASONING_FIELD_KEYS: &[&str] = &["reasoning_content", "reasoning", "thinking"];

/// Prefer incremental `delta` reasoning fields; only fall back to `message` when delta is absent.
/// Many OpenAI-compatible proxies mirror the same chunk in both fields, which would duplicate UI output.
pub fn pick_openai_compatible_reasoning_chunk<'a>(
    choice: &'a serde_json::Value,
    key: &str,
) -> Option<&'a str> {
    let from_delta = choice
        .get("delta")
        .and_then(|delta| delta.get(key))
        .and_then(|value| value.as_str())
        .filter(|text| !text.is_empty());

    if from_delta.is_some() {
        return from_delta;
    }

    choice
        .get("message")
        .and_then(|message| message.get(key))
        .and_then(|value| value.as_str())
        .filter(|text| !text.is_empty())
}

/// Pick the first non-empty dedicated reasoning field for this SSE event.
pub fn pick_first_openai_compatible_reasoning_chunk<'a>(
    choice: &'a serde_json::Value,
) -> Option<&'a str> {
    for key in OPENAI_REASONING_FIELD_KEYS {
        if let Some(reasoning) = pick_openai_compatible_reasoning_chunk(choice, key) {
            return Some(reasoning);
        }
    }
    None
}

pub fn pick_openai_compatible_content_chunk<'a>(choice: &'a serde_json::Value) -> Option<&'a str> {
    if let Some(delta) = choice.get("delta") {
        if let Some(content) = delta
            .get("content")
            .and_then(|value| value.as_str())
            .filter(|text| !text.is_empty())
        {
            return Some(content);
        }
        if let Some(text) = delta
            .get("text")
            .and_then(|value| value.as_str())
            .filter(|text| !text.is_empty())
        {
            return Some(text);
        }
    }

    if let Some(message) = choice.get("message") {
        if let Some(content) = message
            .get("content")
            .and_then(|value| value.as_str())
            .filter(|text| !text.is_empty())
        {
            return Some(content);
        }
        if let Some(text) = message
            .get("text")
            .and_then(|value| value.as_str())
            .filter(|text| !text.is_empty())
        {
            return Some(text);
        }
    }

    None
}

pub struct ReasoningStreamState {
    accumulated: String,
}

impl ReasoningStreamState {
    pub fn new() -> Self {
        Self {
            accumulated: String::new(),
        }
    }

    pub fn is_active(&self) -> bool {
        !self.accumulated.is_empty()
    }

    pub fn accumulated(&self) -> &str {
        &self.accumulated
    }

    /// Emit only the incremental slice for cumulative or delta reasoning streams.
    pub fn push_and_emit(
        &mut self,
        app: &tauri::AppHandle,
        message_id: &str,
        chunk: &str,
    ) -> Option<String> {
        if chunk.is_empty() {
            return None;
        }

        let incremental = if self.accumulated.is_empty() {
            chunk.to_string()
        } else if chunk.starts_with(&self.accumulated) {
            chunk[self.accumulated.len()..].to_string()
        } else {
            chunk.to_string()
        };

        if incremental.is_empty() {
            if chunk.len() > self.accumulated.len() {
                self.accumulated = chunk.to_string();
            }
            return None;
        }

        if self.accumulated.is_empty() || chunk.starts_with(&self.accumulated) {
            self.accumulated = chunk.to_string();
        } else {
            self.accumulated.push_str(&incremental);
        }

        emit_filtered_chunk(app, message_id, &incremental, "thinking");
        Some(incremental)
    }
}

fn has_inline_think_tags(content: &str) -> bool {
    THINKING_START_TAGS
        .iter()
        .any(|tag| content.contains(tag))
        || THINKING_END_TAGS.iter().any(|tag| content.contains(tag))
}

fn strip_inline_think_wrappers(content: &str) -> String {
    let mut text = content.to_string();
    for tag in THINKING_START_TAGS {
        text = text.replace(tag, "");
    }
    for tag in THINKING_END_TAGS {
        text = text.replace(tag, "");
    }
    text
}

fn is_content_mirror_of_reasoning(
    reasoning_chunk: &str,
    content: &str,
    accumulated: &str,
) -> bool {
    if content.is_empty() {
        return true;
    }
    if content == reasoning_chunk {
        return true;
    }
    if !accumulated.is_empty() && (content == accumulated || accumulated.ends_with(content)) {
        return true;
    }
    if has_inline_think_tags(content) {
        let stripped = strip_inline_think_wrappers(content);
        if stripped.is_empty() {
            return true;
        }
        if stripped == reasoning_chunk || stripped == accumulated {
            return true;
        }
        if !accumulated.is_empty() && accumulated.ends_with(&stripped) {
            return true;
        }
    }
    false
}

/// Unified OpenAI-compatible delta handling for dedicated reasoning + content streams.
pub fn process_openai_compatible_choice_delta(
    app: &tauri::AppHandle,
    message_id: &str,
    choice: &serde_json::Value,
    reasoning_state: &mut ReasoningStreamState,
    thinking_tags: &mut ThinkingTagStreamState,
) {
    let reasoning_emitted = pick_first_openai_compatible_reasoning_chunk(choice)
        .and_then(|reasoning| reasoning_state.push_and_emit(app, message_id, reasoning));

    let Some(content) = pick_openai_compatible_content_chunk(choice) else {
        return;
    };

    if let Some(ref emitted) = reasoning_emitted {
        if is_content_mirror_of_reasoning(emitted, content, reasoning_state.accumulated()) {
            return;
        }
        if reasoning_state.is_active() {
            if has_inline_think_tags(content) {
                return;
            }
            emit_filtered_chunk(app, message_id, content, "content");
            return;
        }
    }

    thinking_tags.push_content(app, message_id, content);
}
pub fn finalize_tool_args(raw_args: &str) -> String {
    raw_args.to_string()
}

#[cfg(test)]
mod openai_reasoning_chunk_tests {
    use super::{
        is_content_mirror_of_reasoning, pick_first_openai_compatible_reasoning_chunk,
        pick_openai_compatible_reasoning_chunk,
    };
    use serde_json::json;

    #[test]
    fn prefers_delta_reasoning_over_message_mirror() {
        let choice = json!({
            "delta": { "reasoning_content": "npm" },
            "message": { "reasoning_content": "npm" }
        });
        assert_eq!(
            pick_openai_compatible_reasoning_chunk(&choice, "reasoning_content"),
            Some("npm")
        );
    }

    #[test]
    fn falls_back_to_message_reasoning_when_delta_missing() {
        let choice = json!({
            "delta": {},
            "message": { "reasoning_content": "final reasoning" }
        });
        assert_eq!(
            pick_openai_compatible_reasoning_chunk(&choice, "reasoning_content"),
            Some("final reasoning")
        );
    }

    #[test]
    fn ignores_empty_reasoning_fields() {
        let choice = json!({
            "delta": { "reasoning_content": "" },
            "message": { "reasoning_content": "backup" }
        });
        assert_eq!(
            pick_openai_compatible_reasoning_chunk(&choice, "reasoning_content"),
            Some("backup")
        );
    }

    #[test]
    fn picks_only_first_reasoning_field_per_event() {
        let choice = json!({
            "delta": {
                "reasoning_content": "We ",
                "reasoning": "We ",
                "thinking": "We "
            }
        });
        assert_eq!(
            pick_first_openai_compatible_reasoning_chunk(&choice),
            Some("We ")
        );
    }

    #[test]
    fn reasoning_stream_state_handles_incremental_and_cumulative_chunks() {
        let mut accumulated = String::new();

        let mut apply = |chunk: &str| -> String {
            if accumulated.is_empty() {
                accumulated = chunk.to_string();
                return chunk.to_string();
            }
            if chunk.starts_with(&accumulated) {
                let incremental = chunk[accumulated.len()..].to_string();
                accumulated = chunk.to_string();
                return incremental;
            }
            accumulated.push_str(chunk);
            chunk.to_string()
        };

        assert_eq!(apply("We"), "We");
        assert_eq!(apply("We need"), " need");
        assert_eq!(accumulated, "We need");
    }

    #[test]
    fn detects_content_mirror_of_reasoning() {
        assert!(is_content_mirror_of_reasoning("We ", "We ", "We "));
        assert!(is_content_mirror_of_reasoning(
            "We ",
            "We We ",
            "We We "
        ));
        assert!(is_content_mirror_of_reasoning(
            "We ",
            "We ",
            "We need "
        ));
        assert!(!is_content_mirror_of_reasoning(
            "We ",
            "Answer text",
            "We need "
        ));
    }
}
