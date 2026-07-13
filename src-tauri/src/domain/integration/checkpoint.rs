//! Action-granularity workspace checkpoints (distinct from git history).
//!
//! Snapshots file state before mutating tool calls so the UI can time-travel
//! restore to any prior action, similar to Cursor / Cline checkpoints.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_FILE_BYTES: u64 = 2_000_000;
const MAX_CHECKPOINTS_PER_SESSION: usize = 80;
const MAX_LABEL_LEN: usize = 200;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn checkpoints_root() -> Result<PathBuf, String> {
    let dir = crate::config_paths::resolve_app_data_subdir("Loom")?.join("checkpoints");
    fs::create_dir_all(&dir).map_err(|e| format!("创建检查点目录失败: {e}"))?;
    Ok(dir)
}

fn session_dir(session_key: &str) -> Result<PathBuf, String> {
    let key = session_key.trim();
    if key.is_empty() {
        return Err("session_key 不能为空".to_string());
    }
    // Hash session key so path stays filesystem-safe across platforms.
    let digest = simple_hash(key);
    let dir = checkpoints_root()?.join(digest);
    fs::create_dir_all(&dir).map_err(|e| format!("创建会话检查点目录失败: {e}"))?;
    Ok(dir)
}

fn simple_hash(input: &str) -> String {
    // FNV-1a 64-bit — good enough for directory names, not crypto.
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in input.as_bytes() {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn blob_name_for_path(path: &str) -> String {
    format!("{}.bin", simple_hash(path))
}

fn normalize_path_key(path: &str) -> String {
    let mut s = path.trim().replace('/', "\\");
    while s.contains("\\\\") {
        s = s.replace("\\\\", "\\");
    }
    #[cfg(windows)]
    {
        s = s.to_lowercase();
    }
    s
}

fn path_under_project(project_path: &str, file_path: &str) -> Result<PathBuf, String> {
    let project = PathBuf::from(project_path.trim());
    if project_path.trim().is_empty() || !project.is_dir() {
        return Err("无效的项目路径".to_string());
    }
    let file = PathBuf::from(file_path.trim());
    if file_path.trim().is_empty() {
        return Err("文件路径不能为空".to_string());
    }

    let project_canon = fs::canonicalize(&project).unwrap_or(project.clone());
    let file_canon = if file.exists() {
        fs::canonicalize(&file).unwrap_or(file.clone())
    } else {
        // For not-yet-existing files, canonicalize parent + join name.
        if let Some(parent) = file.parent() {
            let parent_canon = if parent.as_os_str().is_empty() {
                project_canon.clone()
            } else if parent.exists() {
                fs::canonicalize(parent).unwrap_or(parent.to_path_buf())
            } else {
                parent.to_path_buf()
            };
            parent_canon.join(file.file_name().unwrap_or_default())
        } else {
            file.clone()
        }
    };

    let project_s = project_canon.to_string_lossy().to_string();
    let file_s = file_canon.to_string_lossy().to_string();
    let project_key = normalize_path_key(&project_s);
    let file_key = normalize_path_key(&file_s);
    if !file_key.starts_with(&project_key)
        && !file_key.starts_with(&(project_key.clone() + "\\"))
        && !file_key.starts_with(&(project_key.clone() + "/"))
    {
        // Allow relative paths resolved under project.
        let joined = project_canon.join(file_path.trim());
        let joined_s = normalize_path_key(&joined.to_string_lossy());
        if joined_s.starts_with(&project_key) {
            return Ok(joined);
        }
        return Err(format!("文件不在项目目录内: {file_path}"));
    }
    Ok(file_canon)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointFileInput {
    pub path: String,
    pub existed: bool,
    /// UTF-8 text content when the file existed and is text; null for new/missing.
    pub content: Option<String>,
    #[serde(default)]
    pub is_binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointFileEntry {
    pub path: String,
    pub existed: bool,
    pub is_binary: bool,
    pub byte_len: u64,
    /// Relative blob name under checkpoint dir; empty when !existed or binary skipped.
    pub blob: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointRecord {
    pub id: String,
    pub session_key: String,
    pub project_path: String,
    pub tool_call_id: Option<String>,
    pub tool_name: String,
    pub label: String,
    pub created_at: u64,
    pub files: Vec<CheckpointFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointCreateRequest {
    pub session_key: String,
    pub project_path: String,
    pub tool_call_id: Option<String>,
    pub tool_name: String,
    pub label: Option<String>,
    pub files: Vec<CheckpointFileInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointRestoreRequest {
    pub session_key: String,
    pub checkpoint_id: String,
    pub project_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointRestoreResult {
    pub restored_files: Vec<String>,
    pub deleted_files: Vec<String>,
    pub skipped_files: Vec<String>,
    pub truncated_checkpoint_ids: Vec<String>,
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SessionIndex {
    checkpoints: Vec<CheckpointRecord>,
}

fn index_path(session: &Path) -> PathBuf {
    session.join("index.json")
}

fn load_index(session: &Path) -> Result<SessionIndex, String> {
    let path = index_path(session);
    if !path.exists() {
        return Ok(SessionIndex::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("读取检查点索引失败: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("解析检查点索引失败: {e}"))
}

fn save_index(session: &Path, index: &SessionIndex) -> Result<(), String> {
    let path = index_path(session);
    let raw =
        serde_json::to_string_pretty(index).map_err(|e| format!("序列化检查点索引失败: {e}"))?;
    fs::write(&path, raw).map_err(|e| format!("写入检查点索引失败: {e}"))
}

fn default_label(tool_name: &str, files: &[CheckpointFileInput]) -> String {
    let short = files
        .first()
        .map(|f| {
            let p = f.path.replace('\\', "/");
            p.rsplit('/').next().unwrap_or(p.as_str()).to_string()
        })
        .unwrap_or_else(|| "workspace".to_string());
    let mut label = if files.len() <= 1 {
        format!("{tool_name} · {short}")
    } else {
        format!("{tool_name} · {short} +{}", files.len() - 1)
    };
    if label.chars().count() > MAX_LABEL_LEN {
        label = label.chars().take(MAX_LABEL_LEN).collect();
    }
    label
}

fn write_blob(cp_dir: &Path, path: &str, content: &str) -> Result<(String, u64), String> {
    let name = blob_name_for_path(path);
    let bytes = content.as_bytes();
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(format!(
            "文件过大无法快照 ({} bytes > {MAX_FILE_BYTES}): {path}",
            bytes.len()
        ));
    }
    fs::write(cp_dir.join(&name), bytes).map_err(|e| format!("写入快照失败: {e}"))?;
    Ok((name, bytes.len() as u64))
}

fn remove_checkpoint_dir(session: &Path, id: &str) {
    let dir = session.join(id);
    if dir.exists() {
        let _ = fs::remove_dir_all(&dir);
    }
}

/// Create a checkpoint from pre-tool file snapshots supplied by the host.
#[tauri::command]
pub fn checkpoint_create(request: CheckpointCreateRequest) -> Result<CheckpointRecord, String> {
    let session_key = request.session_key.trim().to_string();
    let project_path = request.project_path.trim().to_string();
    if session_key.is_empty() {
        return Err("session_key 不能为空".to_string());
    }
    if project_path.is_empty() {
        return Err("project_path 不能为空".to_string());
    }
    if request.files.is_empty() {
        return Err("至少需要一个文件快照".to_string());
    }

    let session = session_dir(&session_key)?;
    let id = format!("cp-{}", uuid::Uuid::new_v4());
    let cp_dir = session.join(&id);
    fs::create_dir_all(&cp_dir).map_err(|e| format!("创建检查点目录失败: {e}"))?;

    let tool_name = request.tool_name.trim().to_string();
    let label = request
        .label
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_label(&tool_name, &request.files));

    let mut files = Vec::with_capacity(request.files.len());
    let mut seen = HashMap::new();

    for file in &request.files {
        let resolved = path_under_project(&project_path, &file.path)?;
        let path_str = resolved.to_string_lossy().to_string();
        let key = normalize_path_key(&path_str);
        if seen.contains_key(&key) {
            continue;
        }
        seen.insert(key, true);

        if file.is_binary {
            files.push(CheckpointFileEntry {
                path: path_str,
                existed: file.existed,
                is_binary: true,
                byte_len: 0,
                blob: String::new(),
            });
            continue;
        }

        if !file.existed || file.content.is_none() {
            files.push(CheckpointFileEntry {
                path: path_str,
                existed: false,
                is_binary: false,
                byte_len: 0,
                blob: String::new(),
            });
            continue;
        }

        let content = file.content.as_deref().unwrap_or("");
        match write_blob(&cp_dir, &path_str, content) {
            Ok((blob, byte_len)) => {
                files.push(CheckpointFileEntry {
                    path: path_str,
                    existed: true,
                    is_binary: false,
                    byte_len,
                    blob,
                });
            }
            Err(err) => {
                // Oversized / write failure: keep metadata so restore can skip gracefully.
                let _ = err;
                files.push(CheckpointFileEntry {
                    path: path_str,
                    existed: true,
                    is_binary: true,
                    byte_len: 0,
                    blob: String::new(),
                });
            }
        }
    }

    if files.is_empty() {
        let _ = fs::remove_dir_all(&cp_dir);
        return Err("没有可记录的文件快照".to_string());
    }

    let record = CheckpointRecord {
        id: id.clone(),
        session_key: session_key.clone(),
        project_path,
        tool_call_id: request
            .tool_call_id
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        tool_name,
        label,
        created_at: now_ms(),
        files,
    };

    // Persist per-checkpoint meta for durability.
    let meta_raw =
        serde_json::to_string_pretty(&record).map_err(|e| format!("序列化检查点失败: {e}"))?;
    fs::write(cp_dir.join("meta.json"), meta_raw).map_err(|e| format!("写入检查点元数据失败: {e}"))?;

    let mut index = load_index(&session)?;
    index.checkpoints.push(record.clone());
    index.checkpoints.sort_by_key(|c| c.created_at);

    // Cap session history.
    while index.checkpoints.len() > MAX_CHECKPOINTS_PER_SESSION {
        if let Some(old) = index.checkpoints.first().cloned() {
            remove_checkpoint_dir(&session, &old.id);
            index.checkpoints.remove(0);
        } else {
            break;
        }
    }

    save_index(&session, &index)?;
    Ok(record)
}

#[tauri::command]
pub fn checkpoint_list(session_key: String) -> Result<Vec<CheckpointRecord>, String> {
    let session = session_dir(&session_key)?;
    let index = load_index(&session)?;
    Ok(index.checkpoints)
}

#[tauri::command]
pub fn checkpoint_get(
    session_key: String,
    checkpoint_id: String,
) -> Result<CheckpointRecord, String> {
    let session = session_dir(&session_key)?;
    let index = load_index(&session)?;
    index
        .checkpoints
        .into_iter()
        .find(|c| c.id == checkpoint_id)
        .ok_or_else(|| format!("检查点不存在: {checkpoint_id}"))
}

/// Restore workspace files to the state captured at `checkpoint_id` (before that action).
/// Truncates the checkpoint and all later ones from the session timeline.
#[tauri::command]
pub fn checkpoint_restore(request: CheckpointRestoreRequest) -> Result<CheckpointRestoreResult, String> {
    let session_key = request.session_key.trim().to_string();
    let checkpoint_id = request.checkpoint_id.trim().to_string();
    let project_path = request.project_path.trim().to_string();
    if session_key.is_empty() || checkpoint_id.is_empty() || project_path.is_empty() {
        return Err("session_key / checkpoint_id / project_path 不能为空".to_string());
    }

    let session = session_dir(&session_key)?;
    let mut index = load_index(&session)?;
    index.checkpoints.sort_by_key(|c| c.created_at);

    let start_idx = index
        .checkpoints
        .iter()
        .position(|c| c.id == checkpoint_id)
        .ok_or_else(|| format!("检查点不存在: {checkpoint_id}"))?;

    let slice: Vec<CheckpointRecord> = index.checkpoints[start_idx..].to_vec();

    // For each path, earliest snapshot in the slice is the content at restore point.
    let mut plan: HashMap<String, CheckpointFileEntry> = HashMap::new();
    for cp in &slice {
        for file in &cp.files {
            let key = normalize_path_key(&file.path);
            plan.entry(key).or_insert_with(|| file.clone());
        }
    }

    let mut restored_files = Vec::new();
    let mut deleted_files = Vec::new();
    let mut skipped_files = Vec::new();

    for file in plan.values() {
        let target = match path_under_project(&project_path, &file.path) {
            Ok(p) => p,
            Err(_) => {
                skipped_files.push(file.path.clone());
                continue;
            }
        };

        if !file.existed {
            if target.exists() {
                match fs::remove_file(&target) {
                    Ok(()) => deleted_files.push(target.to_string_lossy().to_string()),
                    Err(_) => {
                        // Try folder removal for create_folder style paths.
                        if target.is_dir() {
                            match fs::remove_dir_all(&target) {
                                Ok(()) => deleted_files.push(target.to_string_lossy().to_string()),
                                Err(_) => skipped_files.push(file.path.clone()),
                            }
                        } else {
                            skipped_files.push(file.path.clone());
                        }
                    }
                }
            } else {
                deleted_files.push(target.to_string_lossy().to_string());
            }
            continue;
        }

        if file.is_binary || file.blob.is_empty() {
            skipped_files.push(file.path.clone());
            continue;
        }

        // Blob lives under the checkpoint that first recorded this path in the slice.
        let blob_cp = slice
            .iter()
            .find(|c| c.files.iter().any(|f| normalize_path_key(&f.path) == normalize_path_key(&file.path) && f.blob == file.blob))
            .map(|c| c.id.as_str())
            .unwrap_or(checkpoint_id.as_str());

        let blob_path = session.join(blob_cp).join(&file.blob);
        let content = match fs::read(&blob_path) {
            Ok(bytes) => bytes,
            Err(_) => {
                skipped_files.push(file.path.clone());
                continue;
            }
        };

        if let Some(parent) = target.parent() {
            let _ = fs::create_dir_all(parent);
        }
        match fs::write(&target, &content) {
            Ok(()) => restored_files.push(target.to_string_lossy().to_string()),
            Err(_) => skipped_files.push(file.path.clone()),
        }
    }

    let truncated_ids: Vec<String> = slice.iter().map(|c| c.id.clone()).collect();
    for id in &truncated_ids {
        remove_checkpoint_dir(&session, id);
    }
    index.checkpoints.truncate(start_idx);
    save_index(&session, &index)?;

    let message = format!(
        "已还原到检查点：写入 {} 个文件，删除 {} 个，跳过 {}",
        restored_files.len(),
        deleted_files.len(),
        skipped_files.len()
    );

    Ok(CheckpointRestoreResult {
        restored_files,
        deleted_files,
        skipped_files,
        truncated_checkpoint_ids: truncated_ids,
        success: true,
        message,
    })
}

#[tauri::command]
pub fn checkpoint_clear_session(session_key: String) -> Result<(), String> {
    let session = session_dir(&session_key)?;
    if session.exists() {
        fs::remove_dir_all(&session).map_err(|e| format!("清除检查点失败: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::sync::Mutex;

    // Serialize tests that touch shared env-based app data paths.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn temp_project(name: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!("loom_cp_test_{name}_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn create_list_restore_roundtrip() {
        let _guard = TEST_LOCK.lock().unwrap();
        let project = temp_project("roundtrip");
        let file = project.join("hello.txt");
        fs::write(&file, "v1").unwrap();

        let session_key = format!("test-session-{}", uuid::Uuid::new_v4());
        let created = checkpoint_create(CheckpointCreateRequest {
            session_key: session_key.clone(),
            project_path: project.to_string_lossy().to_string(),
            tool_call_id: Some("call-1".into()),
            tool_name: "write".into(),
            label: Some("write · hello.txt".into()),
            files: vec![CheckpointFileInput {
                path: file.to_string_lossy().to_string(),
                existed: true,
                content: Some("v1".into()),
                is_binary: false,
            }],
        })
        .expect("create checkpoint");

        // Simulate tool write
        fs::write(&file, "v2").unwrap();

        let list = checkpoint_list(session_key.clone()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, created.id);

        let result = checkpoint_restore(CheckpointRestoreRequest {
            session_key: session_key.clone(),
            checkpoint_id: created.id.clone(),
            project_path: project.to_string_lossy().to_string(),
        })
        .expect("restore");

        assert!(result.success);
        assert_eq!(fs::read_to_string(&file).unwrap(), "v1");
        assert!(checkpoint_list(session_key.clone()).unwrap().is_empty());

        let _ = checkpoint_clear_session(session_key);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn restore_deletes_files_created_after_checkpoint() {
        let _guard = TEST_LOCK.lock().unwrap();
        let project = temp_project("delete_new");
        let new_file = project.join("new.txt");

        let session_key = format!("test-session-{}", uuid::Uuid::new_v4());
        let created = checkpoint_create(CheckpointCreateRequest {
            session_key: session_key.clone(),
            project_path: project.to_string_lossy().to_string(),
            tool_call_id: None,
            tool_name: "write".into(),
            label: None,
            files: vec![CheckpointFileInput {
                path: new_file.to_string_lossy().to_string(),
                existed: false,
                content: None,
                is_binary: false,
            }],
        })
        .unwrap();

        fs::write(&new_file, "brand new").unwrap();
        assert!(new_file.exists());

        checkpoint_restore(CheckpointRestoreRequest {
            session_key: session_key.clone(),
            checkpoint_id: created.id,
            project_path: project.to_string_lossy().to_string(),
        })
        .unwrap();

        assert!(!new_file.exists());
        let _ = checkpoint_clear_session(session_key);
        let _ = fs::remove_dir_all(&project);
    }
}
