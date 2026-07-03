use crate::chat::{
    extension_from_image_format, media_type_from_image_format, ChatImageAttachment,
    ChatMessage as Message,
};
use crate::normalize_path_string as normalize_path;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;
use uuid::Uuid;

const MAX_CHAT_IMAGE_BYTES: usize = 10 * 1024 * 1024; // 10MB

#[derive(Debug, Deserialize)]
pub struct SaveChatImagePayload {
    #[serde(default)]
    pub bytes: Vec<u8>,
    #[serde(rename = "mediaType")]
    #[serde(default)]
    pub media_type: Option<String>,
    #[serde(rename = "fileName")]
    #[serde(default)]
    pub file_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SaveChatImageFromPathPayload {
    pub path: String,
    #[serde(rename = "fileName")]
    #[serde(default)]
    pub file_name: Option<String>,
}

pub fn get_chat_images_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {}", e))?;

    let images_dir = app_data_dir.join("chat-images");
    if !images_dir.exists() {
        fs::create_dir_all(&images_dir).map_err(|e| format!("创建图片目录失败: {}", e))?;
    }
    Ok(images_dir)
}

fn build_image_meta_from_path(
    path: &Path,
    file_name: Option<String>,
) -> Result<ChatImageAttachment, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取图片失败: {}", e))?;
    if bytes.len() > MAX_CHAT_IMAGE_BYTES {
        return Err(format!(
            "图片超过大小限制: {}MB",
            MAX_CHAT_IMAGE_BYTES / 1024 / 1024
        ));
    }

    let format = image::guess_format(&bytes).map_err(|e| format!("无法识别图片格式: {}", e))?;
    let media_type = media_type_from_image_format(format)
        .ok_or_else(|| "仅支持 PNG / JPEG / WEBP / GIF 图片".to_string())?
        .to_string();

    let dimensions =
        image::image_dimensions(path).map_err(|e| format!("读取图片尺寸失败: {}", e))?;
    let sha = format!("{:x}", Sha256::digest(&bytes));
    let default_name = path
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        .map(String::from);

    Ok(ChatImageAttachment {
        id: format!("img_{}", &sha[..12]),
        attachment_type: "image".to_string(),
        path: normalize_path(path),
        media_type,
        width: dimensions.0,
        height: dimensions.1,
        size: bytes.len() as u64,
        sha256: sha,
        file_name: file_name.or(default_name),
    })
}

fn persist_chat_image_bytes(
    app: &tauri::AppHandle,
    bytes: &[u8],
    media_type: Option<&str>,
    file_name: Option<String>,
) -> Result<ChatImageAttachment, String> {
    if bytes.is_empty() {
        return Err("图片数据为空".to_string());
    }
    if bytes.len() > MAX_CHAT_IMAGE_BYTES {
        return Err(format!(
            "单张图片最大支持 {}MB",
            MAX_CHAT_IMAGE_BYTES / 1024 / 1024
        ));
    }

    let format = image::guess_format(bytes).map_err(|e| format!("无法识别图片格式: {}", e))?;
    let ext = extension_from_image_format(format)
        .ok_or_else(|| "仅支持 PNG / JPEG / WEBP / GIF 图片".to_string())?;

    if let Some(configured_media) = media_type {
        if !configured_media.trim().is_empty() {
            match configured_media {
                "image/png" | "image/jpeg" | "image/webp" | "image/gif" => {}
                _ => return Err("仅支持 PNG / JPEG / WEBP / GIF 图片".to_string()),
            }
        }
    }

    let sha = format!("{:x}", Sha256::digest(bytes));
    let images_dir = get_chat_images_dir(app)?;
    let filename = format!("{}.{}", sha, ext);
    let target_path = images_dir.join(filename);

    if !target_path.exists() {
        fs::write(&target_path, bytes).map_err(|e| format!("保存图片失败: {}", e))?;
    }

    build_image_meta_from_path(&target_path, file_name)
}

#[tauri::command]
pub fn save_chat_image(
    app: tauri::AppHandle,
    payload: SaveChatImagePayload,
) -> Result<ChatImageAttachment, String> {
    persist_chat_image_bytes(
        &app,
        &payload.bytes,
        payload.media_type.as_deref(),
        payload.file_name,
    )
}

#[tauri::command]
pub fn save_chat_image_from_path(
    app: tauri::AppHandle,
    payload: SaveChatImageFromPathPayload,
) -> Result<ChatImageAttachment, String> {
    let source_path = PathBuf::from(payload.path.trim());
    if !source_path.is_file() {
        return Err("图片文件不存在".to_string());
    }

    let bytes =
        fs::read(&source_path).map_err(|e| format!("读取图片失败 ({}): {}", payload.path, e))?;
    let fallback_name = source_path
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        .map(String::from);

    persist_chat_image_bytes(&app, &bytes, None, payload.file_name.or(fallback_name))
}

// ==================== Conversation Management ====================

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PendingFileChange {
    id: String,
    file_path: String,
    #[serde(default)]
    existed_before: Option<bool>,
    before_content: Option<String>,
    after_content: String,
    tool_name: String,
    #[serde(default)]
    old_snippet: Option<String>,
    #[serde(default)]
    new_snippet: Option<String>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Conversation {
    id: String,
    title: String,
    filename: String,
    created_at: DateTime<Utc>,
    last_used_at: DateTime<Utc>,
    provider: String,
    model: String,
    messages: Vec<Message>,
    #[serde(rename = "pendingChanges", default)]
    pending_changes: Vec<PendingFileChange>,
    #[serde(rename = "compactState", default)]
    compact_state: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ConversationMeta {
    id: String,
    title: String,
    filename: String,
    last_used_at: DateTime<Utc>,
}

// 获取对话存储目录（跨平台）
fn get_conversations_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {}", e))?;

    let conv_dir = app_data_dir.join("conversations");

    if !conv_dir.exists() {
        fs::create_dir_all(&conv_dir).map_err(|e| format!("创建对话目录失败: {}", e))?;
    }

    Ok(conv_dir)
}

// 获取对话存储路径（用于调试）
#[tauri::command]
pub fn get_conversations_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = get_conversations_dir(&app)?;
    Ok(dir.to_string_lossy().to_string())
}

/// Validate that a filename is a safe, non-escaping conversation filename.
///
/// Rejects any filename containing path separators (`/`, `\`), parent directory
/// references (`..`), or that doesn't end in `.json`. This prevents path
/// traversal attacks when frontend-supplied filenames are joined with the
/// conversations directory.
fn validate_conversation_filename(filename: &str) -> Result<(), String> {
    if filename.is_empty() {
        return Err("文件名不能为空".to_string());
    }
    if filename.contains('/') || filename.contains('\\') {
        return Err(format!("文件名不能包含路径分隔符: {}", filename));
    }
    if filename.contains("..") {
        return Err(format!("文件名不能包含父目录引用: {}", filename));
    }
    if !filename.ends_with(".json") {
        return Err(format!("文件名必须以 .json 结尾: {}", filename));
    }
    Ok(())
}

// 清理文件名中的非法字符
fn sanitize_filename(title: &str) -> String {
    title
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect::<String>()
        .trim()
        .chars()
        .take(50)
        .collect()
}

// 生成文件名
fn generate_filename(title: &str) -> String {
    let sanitized = sanitize_filename(title);
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    format!("{}_{}.json", sanitized, timestamp)
}

// 列出所有对话
#[tauri::command]
pub fn list_conversations(app: tauri::AppHandle) -> Result<Vec<ConversationMeta>, String> {
    let dir = get_conversations_dir(&app)?;
    let mut conversations = Vec::new();

    let entries = fs::read_dir(&dir).map_err(|e| format!("读取目录失败: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(conv) = parse_conversation_lenient(&content) {
                    conversations.push(ConversationMeta {
                        id: conv.id,
                        title: conv.title,
                        filename: conv.filename,
                        last_used_at: conv.last_used_at,
                    });
                }
            }
        }
    }

    // 按最后使用时间排序（最新的在前）
    conversations.sort_by(|a, b| b.last_used_at.cmp(&a.last_used_at));
    Ok(conversations)
}

/// Fix incomplete \\uXXXX hex escapes inside JSON string literals.
///
/// When a conversation file is corrupted by truncated streaming output,
/// it may contain incomplete Unicode escapes like `\\u00` or `\\u` without
/// the required 4 hex digits. This function replaces such incomplete
/// escapes with the Unicode replacement character (U+FFFD).
///
/// Only processes escapes inside JSON string literals (between `"` quotes)
/// to avoid modifying structural characters or keys.
fn fix_incomplete_hex_escapes(json: &str) -> String {
    let chars: Vec<char> = json.chars().collect();
    let len = chars.len();
    let mut result = String::with_capacity(json.len());
    let mut i = 0;
    let mut in_string = false;

    while i < len {
        let ch = chars[i];

        if !in_string {
            result.push(ch);
            if ch == '"' {
                in_string = true;
            }
            i += 1;
            continue;
        }

        // Inside a JSON string
        if ch == '\\' {
            // Look ahead to check for \u escape
            if i + 1 < len && chars[i + 1] == 'u' {
                let start = i;
                i += 2; // skip \u

                let mut hex_count = 0;
                while hex_count < 4 && i < len {
                    if chars[i].is_ascii_hexdigit() {
                        hex_count += 1;
                        i += 1;
                    } else {
                        break;
                    }
                }

                if hex_count == 4 {
                    // Valid \uXXXX — also check for surrogate pair \uXXXX\uXXXX
                    if i + 1 < len && chars[i] == '\\' && chars[i + 1] == 'u' {
                        let surrogate_start = i;
                        i += 2;
                        let mut surrogate_hex = 0;
                        while surrogate_hex < 4 && i < len {
                            if chars[i].is_ascii_hexdigit() {
                                surrogate_hex += 1;
                                i += 1;
                            } else {
                                break;
                            }
                        }
                        if surrogate_hex == 4 {
                            // Valid surrogate pair
                            for j in start..i {
                                result.push(chars[j]);
                            }
                        } else {
                            // Incomplete surrogate — emit first \uXXXX + replacement
                            for j in start..surrogate_start {
                                result.push(chars[j]);
                            }
                            result.push('\u{FFFD}');
                        }
                    } else {
                        // Valid standalone \uXXXX
                        for j in start..i {
                            result.push(chars[j]);
                        }
                    }
                } else {
                    // Incomplete \u escape — replace with U+FFFD
                    result.push('\u{FFFD}');
                }
            } else if i + 1 < len {
                // Other escape sequences like \\, \n, \t, etc. — keep as-is
                result.push(ch);
                result.push(chars[i + 1]);
                i += 2;
            } else {
                // Lone backslash at end of string
                result.push('\u{FFFD}');
                i += 1;
            }
        } else if ch == '"' {
            result.push(ch);
            in_string = false;
            i += 1;
        } else {
            result.push(ch);
            i += 1;
        }
    }

    result
}

/// Parse a Conversation from a JSON string, with fallback to fix incomplete
/// hex escapes. Returns the parsed Conversation and whether a repair was applied.
fn parse_conversation_lenient(content: &str) -> Result<Conversation, String> {
    match serde_json::from_str::<Conversation>(content) {
        Ok(c) => Ok(c),
        Err(first_err) => {
            let fixed = fix_incomplete_hex_escapes(content);
            match serde_json::from_str::<Conversation>(&fixed) {
                Ok(c) => Ok(c),
                Err(_) => {
                    // Last resort: parse as raw Value then convert
                    match serde_json::from_str::<serde_json::Value>(&fixed) {
                        Ok(value) => serde_json::from_value::<Conversation>(value)
                            .map_err(|e| format!("解析对话失败: {}", e)),
                        Err(_) => Err(format!("解析对话失败: {}", first_err)),
                    }
                }
            }
        }
    }
}

// 加载对话
#[tauri::command]
pub fn load_conversation(app: tauri::AppHandle, filename: String) -> Result<Conversation, String> {
    validate_conversation_filename(&filename)?;
    let path = get_conversations_dir(&app)?.join(&filename);
    let content = fs::read_to_string(&path).map_err(|e| format!("读取对话失败: {}", e))?;

    let mut conv = parse_conversation_lenient(&content)?;

    // 更新使用时间
    conv.last_used_at = Utc::now();
    save_conversation_internal(&app, &conv)?;

    Ok(conv)
}

// 保存对话（内部函数）
fn save_conversation_internal(
    app: &tauri::AppHandle,
    conversation: &Conversation,
) -> Result<(), String> {
    validate_conversation_filename(&conversation.filename)?;
    let path = get_conversations_dir(app)?.join(&conversation.filename);
    let json =
        serde_json::to_string_pretty(conversation).map_err(|e| format!("序列化对话失败: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("保存对话失败: {}", e))?;
    Ok(())
}

// 保存对话（Tauri命令）
#[tauri::command]
pub fn save_conversation(app: tauri::AppHandle, conversation: Conversation) -> Result<(), String> {
    save_conversation_internal(&app, &conversation)
}

fn collect_conversation_image_paths(conversation: &Conversation) -> HashSet<String> {
    let mut refs = HashSet::new();
    for message in &conversation.messages {
        if let Some(attachments) = &message.attachments {
            for attachment in attachments {
                if attachment.attachment_type == "image" && !attachment.path.trim().is_empty() {
                    refs.insert(normalize_path(Path::new(attachment.path.as_str())));
                }
            }
        }
    }
    refs
}

fn collect_agent_state_image_paths(root: &serde_json::Value) -> HashSet<String> {
    let mut refs = HashSet::new();

    let conversations = root
        .get("conversations")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    for conversation in conversations {
        let messages = conversation
            .get("messages")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();

        for message in messages {
            let attachments = message
                .get("attachments")
                .and_then(|value| value.as_array())
                .cloned()
                .unwrap_or_default();

            for attachment in attachments {
                let Some(path) = attachment.get("path").and_then(|value| value.as_str()) else {
                    continue;
                };
                let trimmed = path.trim();
                if trimmed.is_empty() {
                    continue;
                }

                let attachment_type = attachment
                    .get("type")
                    .or_else(|| attachment.get("attachmentType"))
                    .or_else(|| attachment.get("attachment_type"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("image");

                if attachment_type != "image" {
                    continue;
                }

                refs.insert(normalize_path(Path::new(trimmed)));
            }
        }
    }

    refs
}

fn collect_all_image_references(
    app: &tauri::AppHandle,
    exclude_filename: Option<&str>,
) -> Result<HashSet<String>, String> {
    let dir = get_conversations_dir(app)?;
    let mut refs = HashSet::new();

    let entries = fs::read_dir(&dir).map_err(|e| format!("读取目录失败: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }

        let file_name = match path.file_name().and_then(|s| s.to_str()) {
            Some(name) => name,
            None => continue,
        };
        if exclude_filename.is_some_and(|exclude| exclude == file_name) {
            continue;
        }

        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let conv = match parse_conversation_lenient(&content) {
            Ok(c) => c,
            Err(_) => continue,
        };

        refs.extend(collect_conversation_image_paths(&conv));
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
    let agent_states_dir = app_data_dir.join("agent-data").join("states");
    if agent_states_dir.exists() {
        let state_entries = fs::read_dir(&agent_states_dir)
            .map_err(|e| format!("读取 Agent 状态目录失败: {}", e))?;
        for entry in state_entries {
            let entry = entry.map_err(|e| format!("读取 Agent 状态条目失败: {}", e))?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }

            let raw = match fs::read_to_string(&path) {
                Ok(content) => content,
                Err(_) => continue,
            };
            let root = match serde_json::from_str::<serde_json::Value>(&raw) {
                Ok(value) => value,
                Err(_) => continue,
            };

            refs.extend(collect_agent_state_image_paths(&root));
        }
    }

    Ok(refs)
}

pub fn cleanup_unreferenced_image_paths(
    app: &tauri::AppHandle,
    candidate_paths: &HashSet<String>,
    exclude_filename: Option<&str>,
) -> Result<u32, String> {
    if candidate_paths.is_empty() {
        return Ok(0);
    }

    let images_dir = get_chat_images_dir(app)?;
    let images_root = normalize_path(&images_dir);
    let referenced = collect_all_image_references(app, exclude_filename)?;

    let mut deleted = 0;
    for candidate in candidate_paths {
        if referenced.contains(candidate) {
            continue;
        }

        let path = PathBuf::from(candidate);
        let normalized = normalize_path(&path);
        if !normalized.starts_with(&images_root) {
            continue;
        }

        if fs::remove_file(&path).is_ok() {
            deleted += 1;
        }
    }

    Ok(deleted)
}

#[tauri::command]
pub fn cleanup_orphan_chat_images(app: tauri::AppHandle) -> Result<u32, String> {
    let images_dir = get_chat_images_dir(&app)?;
    let referenced = collect_all_image_references(&app, None)?;
    let mut deleted = 0;

    let entries = fs::read_dir(&images_dir).map_err(|e| format!("读取图片目录失败: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取图片条目失败: {}", e))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let normalized = normalize_path(&path);
        if referenced.contains(&normalized) {
            continue;
        }

        if fs::remove_file(&path).is_ok() {
            deleted += 1;
        }
    }

    Ok(deleted)
}

#[tauri::command]
pub fn cleanup_unreferenced_chat_images(
    app: tauri::AppHandle,
    candidate_paths: Vec<String>,
) -> Result<u32, String> {
    let candidates: HashSet<String> = candidate_paths
        .iter()
        .map(|path| path.trim())
        .filter(|path| !path.is_empty())
        .map(|path| normalize_path(Path::new(path)))
        .collect();
    cleanup_unreferenced_image_paths(&app, &candidates, None)
}

// 创建新对话
#[tauri::command]
pub fn create_conversation(
    app: tauri::AppHandle,
    title: String,
    provider: String,
    model: String,
) -> Result<Conversation, String> {
    let filename = generate_filename(&title);
    let conv = Conversation {
        id: Uuid::new_v4().to_string(),
        title,
        filename,
        created_at: Utc::now(),
        last_used_at: Utc::now(),
        provider,
        model,
        messages: Vec::new(),
        pending_changes: Vec::new(),
        compact_state: None,
    };

    save_conversation_internal(&app, &conv)?;
    Ok(conv)
}

// 删除对话
#[tauri::command]
pub fn delete_conversation(app: tauri::AppHandle, filename: String) -> Result<(), String> {
    validate_conversation_filename(&filename)?;
    let path = get_conversations_dir(&app)?.join(&filename);
    let mut candidate_paths = HashSet::new();

    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(conv) = parse_conversation_lenient(&content) {
            candidate_paths = collect_conversation_image_paths(&conv);
        }
    }

    fs::remove_file(&path).map_err(|e| format!("删除对话失败: {}", e))?;
    let _ = cleanup_unreferenced_image_paths(&app, &candidate_paths, Some(&filename));
    Ok(())
}

// 清理7天前的对话
#[tauri::command]
pub fn cleanup_old_conversations(app: tauri::AppHandle) -> Result<u32, String> {
    let dir = get_conversations_dir(&app)?;
    let cutoff = Utc::now() - Duration::days(7);
    let mut deleted = 0;
    let mut deleted_image_candidates: HashSet<String> = HashSet::new();

    let entries = fs::read_dir(&dir).map_err(|e| format!("读取目录失败: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(conv) = parse_conversation_lenient(&content) {
                    if conv.last_used_at < cutoff {
                        if fs::remove_file(&path).is_ok() {
                            deleted_image_candidates
                                .extend(collect_conversation_image_paths(&conv));
                            deleted += 1;
                        }
                    }
                }
            }
        }
    }

    let _ = cleanup_unreferenced_image_paths(&app, &deleted_image_candidates, None);

    Ok(deleted)
}

// 重命名对话
#[tauri::command]
pub fn rename_conversation(
    app: tauri::AppHandle,
    old_filename: String,
    new_title: String,
) -> Result<Conversation, String> {
    validate_conversation_filename(&old_filename)?;
    let old_path = get_conversations_dir(&app)?.join(&old_filename);
    let content = fs::read_to_string(&old_path).map_err(|e| format!("读取对话失败: {}", e))?;
    let mut conv = parse_conversation_lenient(&content)?;

    // 生成新文件名
    let new_filename = generate_filename(&new_title);
    let new_path = get_conversations_dir(&app)?.join(&new_filename);

    // 更新对话信息
    conv.title = new_title;
    conv.filename = new_filename;
    conv.last_used_at = Utc::now();

    // 保存到新文件
    let json = serde_json::to_string_pretty(&conv).map_err(|e| format!("序列化对话失败: {}", e))?;
    fs::write(&new_path, json).map_err(|e| format!("保存对话失败: {}", e))?;

    // 删除旧文件
    fs::remove_file(&old_path).map_err(|e| format!("删除旧文件失败: {}", e))?;

    Ok(conv)
}
