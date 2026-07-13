//! File Operations module - File system operations and search
//
//! This module contains file operation structures, search types, helper functions,
//! and all file-operation Tauri commands.

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use serde::Serialize;
use std::fs;
use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::Emitter;
use tauri::State;

use crate::sandbox::{self, CallSource, SandboxState};

// ============================================================================
// File Operation History (in-memory, per-session)
// ============================================================================

/// A single file operation history entry
#[derive(Debug, Clone, Serialize)]
pub struct FileOpHistoryEntry {
    pub action: String,
    pub source: Option<String>,
    pub destination: Option<String>,
    pub timestamp: String,
    pub permanent: Option<bool>,
    pub size_bytes: Option<u64>,
    pub success: bool,
    pub error: Option<String>,
}

/// Global in-memory operation history (capped at 100 entries)
static OP_HISTORY: once_cell::sync::Lazy<Mutex<Vec<FileOpHistoryEntry>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(Vec::new()));

const MAX_HISTORY: usize = 100;

fn record_op(entry: FileOpHistoryEntry) {
    if let Ok(mut hist) = OP_HISTORY.lock() {
        hist.push(entry);
        if hist.len() > MAX_HISTORY {
            let excess = hist.len() - MAX_HISTORY;
            hist.drain(0..excess);
        }
    }
}

// ============================================================================
// File Ops Tool - Unified result types
// ============================================================================

/// Result for a single file operation within a batch/glob
#[derive(Debug, Clone, Serialize)]
pub struct FileOpResultItem {
    pub path: String,
    pub success: bool,
    pub error: Option<String>,
    pub size_bytes: Option<u64>,
    /// When conflict="rename", the actual renamed path
    pub renamed_to: Option<String>,
}

/// Aggregate result for file_ops_tool
#[derive(Debug, Clone, Serialize)]
pub struct FileOpsToolResult {
    pub results: Vec<FileOpResultItem>,
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
}

/// Resolve a conflict path: if conflict="rename", find a non-colliding name
fn resolve_conflict_path(dest: &Path, conflict: &str) -> Result<PathBuf, String> {
    if !dest.exists() {
        return Ok(dest.to_path_buf());
    }
    match conflict {
        "overwrite" => {
            if dest.is_dir() {
                fs::remove_dir_all(dest).map_err(|e| format!("删除目标文件夹失败: {}", e))?;
            } else {
                fs::remove_file(dest).map_err(|e| format!("删除目标文件失败: {}", e))?;
            }
            Ok(dest.to_path_buf())
        }
        "rename" => {
            let stem = dest
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let ext = dest
                .extension()
                .map(|s| format!(".{}", s.to_string_lossy()));
            let parent = dest.parent().unwrap_or(Path::new("."));
            let mut idx = 1u32;
            loop {
                let new_name = if let Some(ref ext) = ext {
                    format!("{} ({}){}", stem, idx, ext)
                } else {
                    format!("{} ({})", stem, idx)
                };
                let new_path = parent.join(&new_name);
                if !new_path.exists() {
                    return Ok(new_path);
                }
                idx += 1;
                if idx > 1000 {
                    return Err(format!("无法为 {} 找到可用的重命名路径", dest.display()));
                }
            }
        }
        _ => Err(format!(
            "目标路径已存在: {}。可设置 conflict=\"overwrite\" 或 conflict=\"rename\"",
            dest.display()
        )),
    }
}

/// Get file or directory size
fn get_path_size(path: &Path) -> u64 {
    if path.is_file() {
        fs::metadata(path).map(|m| m.len()).unwrap_or(0)
    } else if path.is_dir() {
        let mut total = 0u64;
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                total += get_path_size(&entry.path());
            }
        }
        total
    } else {
        0
    }
}

/// Perform a single copy operation with conflict handling
fn do_copy(src: &Path, dest: &Path, conflict: &str) -> Result<FileOpResultItem, String> {
    if !src.exists() {
        return Ok(FileOpResultItem {
            path: src.to_string_lossy().to_string(),
            success: false,
            error: Some(format!("源路径不存在: {}", src.display())),
            size_bytes: None,
            renamed_to: None,
        });
    }

    let size = get_path_size(src);
    let final_dest = resolve_conflict_path(dest, conflict)?;

    if let Some(parent) = final_dest.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("无法创建父目录: {}", e))?;
        }
    }

    if src.is_dir() {
        copy_dir_all(src, &final_dest)?;
    } else {
        fs::copy(src, &final_dest).map_err(|e| format!("复制文件失败: {}", e))?;
    }

    let renamed = if final_dest != dest {
        Some(final_dest.to_string_lossy().to_string())
    } else {
        None
    };

    Ok(FileOpResultItem {
        path: src.to_string_lossy().to_string(),
        success: true,
        error: None,
        size_bytes: Some(size),
        renamed_to: renamed,
    })
}

/// Perform a single move operation with conflict handling
fn do_move(src: &Path, dest: &Path, conflict: &str) -> Result<FileOpResultItem, String> {
    if !src.exists() {
        return Ok(FileOpResultItem {
            path: src.to_string_lossy().to_string(),
            success: false,
            error: Some(format!("源路径不存在: {}", src.display())),
            size_bytes: None,
            renamed_to: None,
        });
    }

    let size = get_path_size(src);
    let final_dest = resolve_conflict_path(dest, conflict)?;

    if let Some(parent) = final_dest.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("无法创建父目录: {}", e))?;
        }
    }

    match fs::rename(src, &final_dest) {
        Ok(_) => {}
        Err(_) => {
            // Fallback: copy then delete (cross-device)
            if src.is_dir() {
                copy_dir_all(src, &final_dest)?;
                fs::remove_dir_all(src).map_err(|e| format!("删除源目录失败: {}", e))?;
            } else {
                fs::copy(src, &final_dest).map_err(|e| format!("复制失败: {}", e))?;
                fs::remove_file(src).map_err(|e| format!("删除源文件失败: {}", e))?;
            }
            if !final_dest.exists() {
                return Ok(FileOpResultItem {
                    path: src.to_string_lossy().to_string(),
                    success: false,
                    error: Some("移动后目标不存在".to_string()),
                    size_bytes: Some(size),
                    renamed_to: None,
                });
            }
        }
    }

    let renamed = if final_dest != dest {
        Some(final_dest.to_string_lossy().to_string())
    } else {
        None
    };

    Ok(FileOpResultItem {
        path: src.to_string_lossy().to_string(),
        success: true,
        error: None,
        size_bytes: Some(size),
        renamed_to: renamed,
    })
}

/// Perform a single delete operation
fn do_delete(target: &Path, permanent: bool) -> FileOpResultItem {
    if !target.exists() {
        return FileOpResultItem {
            path: target.to_string_lossy().to_string(),
            success: false,
            error: Some(format!("路径不存在: {}", target.display())),
            size_bytes: None,
            renamed_to: None,
        };
    }

    let size = get_path_size(target);

    if permanent {
        let result = if target.is_dir() {
            fs::remove_dir_all(target).map_err(|e| format!("永久删除文件夹失败: {}", e))
        } else {
            fs::remove_file(target).map_err(|e| format!("永久删除文件失败: {}", e))
        };
        FileOpResultItem {
            path: target.to_string_lossy().to_string(),
            success: result.is_ok(),
            error: result.err(),
            size_bytes: Some(size),
            renamed_to: None,
        }
    } else {
        match trash::delete(target) {
            Ok(()) => FileOpResultItem {
                path: target.to_string_lossy().to_string(),
                success: true,
                error: None,
                size_bytes: Some(size),
                renamed_to: None,
            },
            Err(e) => FileOpResultItem {
                path: target.to_string_lossy().to_string(),
                success: false,
                error: Some(format!(
                    "移入回收站失败: {} (可尝试 permanent: true 强制删除)",
                    e
                )),
                size_bytes: Some(size),
                renamed_to: None,
            },
        }
    }
}

/// Perform a single create_folder operation
fn do_create_folder(path: &Path) -> FileOpResultItem {
    match fs::create_dir_all(path) {
        Ok(()) => FileOpResultItem {
            path: path.to_string_lossy().to_string(),
            success: true,
            error: None,
            size_bytes: None,
            renamed_to: None,
        },
        Err(e) => FileOpResultItem {
            path: path.to_string_lossy().to_string(),
            success: false,
            error: Some(format!("创建文件夹失败: {}", e)),
            size_bytes: None,
            renamed_to: None,
        },
    }
}

/// Expand a glob pattern into matching paths.
/// By default this only matches direct children of the provided folder.
/// Patterns with explicit recursion intent (`**` or path separators) recurse into descendants.
fn expand_glob(glob_pattern: &str, folder: &Path) -> Result<Vec<PathBuf>, String> {
    let normalized_pattern = normalize_glob_pattern(glob_pattern);
    let recursive = normalized_pattern.contains("**") || normalized_pattern.contains('/');
    let glob = GlobBuilder::new(&normalized_pattern)
        .literal_separator(recursive)
        .build()
        .map_err(|e| format!("无效的 glob 模式 '{}': {}", glob_pattern, e))?;
    let compiled: GlobSet = {
        let mut builder = GlobSetBuilder::new();
        builder.add(glob);
        builder
            .build()
            .map_err(|e| format!("编译 glob 失败: {}", e))?
    };

    const SKIP_DIRS: &[&str] = &[
        "node_modules",
        ".git",
        "target",
        "__pycache__",
        ".next",
        ".venv",
        "dist",
        "build",
    ];

    fn recurse(
        dir: &Path,
        root: &Path,
        compiled: &GlobSet,
        matches: &mut Vec<PathBuf>,
        depth: u32,
        recursive: bool,
    ) {
        if depth > 10 {
            return;
        }
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                let file_name = entry.file_name();
                let name_str = file_name.to_string_lossy();

                // Skip well-known heavy directories
                if entry_path.is_dir() && SKIP_DIRS.contains(&name_str.as_ref()) {
                    continue;
                }

                let candidate = if recursive {
                    let rel = entry_path
                        .strip_prefix(root)
                        .unwrap_or(entry_path.as_path());
                    path_to_slash_string(rel)
                } else {
                    name_str.to_string()
                };

                if compiled.is_match(&candidate) {
                    matches.push(entry_path.clone());
                }

                if recursive && entry_path.is_dir() {
                    recurse(&entry_path, root, compiled, matches, depth + 1, recursive);
                }
            }
        }
    }

    let mut matches = Vec::new();
    recurse(folder, folder, &compiled, &mut matches, 0, recursive);
    Ok(matches)
}

// ============================================================================
// File Node - For file tree representation
// ============================================================================

/// Node in the file tree
#[derive(Serialize, Clone)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileNode>>,
    pub children_loaded: bool,
    pub modified_at: i64,
}

// ============================================================================
// Search Types - For content search
// ============================================================================

/// A single search match within a file
#[derive(Serialize, Clone)]
pub struct SearchMatch {
    pub line: usize,
    pub column: usize,
    pub preview: String,
    pub match_len: usize,
    /// Lines before the match (context_lines parameter)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub context_before: Vec<String>,
    /// Lines after the match (context_lines parameter)
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub context_after: Vec<String>,
}

/// Search results for a single file
#[derive(Serialize, Clone)]
pub struct SearchFileResult {
    pub path: String,
    pub matches: Vec<SearchMatch>,
}

// ============================================================================
// File Tree Generation Types
// ============================================================================

/// Node for file tree generation (simplified version)
#[derive(Serialize, Clone)]
pub struct FileTreeNode {
    pub name: String,
    pub is_dir: bool,
    pub children: Vec<FileTreeNode>,
}

/// Result of file tree generation
#[derive(Serialize, Debug)]
pub struct FileTreeResult {
    pub root_path: String,
    pub tree: String,
    pub total_dirs: usize,
    pub total_files: usize,
}

// ============================================================================
// File Info - Metadata
// ============================================================================

/// File metadata information
#[derive(Serialize, Debug)]
pub struct FileInfo {
    pub path: String,
    pub exists: bool,
    pub file_type: String,
    pub size_bytes: u64,
    pub size_human: String,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub accessed: Option<String>,
    pub is_readonly: bool,
    pub permissions: Option<String>,
    pub is_binary: bool,
    pub target_path: Option<String>,
}

// ============================================================================
// Edit File Types
// ============================================================================

/// Request for editing a file
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditFileRequest {
    pub file_path: String,
    pub old_string: String,
    pub new_string: String,
    pub replace_all: Option<bool>,
}

/// Result of editing a file
#[derive(Serialize, Debug)]
pub struct EditFileResult {
    pub success: bool,
    pub summary: String,
    pub replacements_made: usize,
}

/// A single replace block
pub struct ReplaceBlock {
    pub search: String,
    pub replace: String,
}

// ============================================================================
// Read File Tool Types
// ============================================================================

/// Request for reading file content (AI tool)
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileToolRequest {
    pub file_path: String,
    pub max_bytes: Option<usize>,
    pub max_lines: Option<usize>,
    pub start_line: Option<usize>,
    pub encoding: Option<String>,
    /// Search within the file for this keyword and return matching lines with context.
    /// Avoids reading the entire file when only specific sections are needed.
    pub search: Option<String>,
    /// Return N lines around a specific line number (centered context).
    /// Mutually exclusive with start_line; if both are set, around_line takes precedence.
    pub around_line: Option<usize>,
}

/// Binary file metadata returned when a binary file is detected
#[derive(Serialize, Clone)]
pub struct BinaryFileInfo {
    /// MIME type guess (e.g., "image/png", "application/pdf")
    pub mime_type: String,
    /// For images: width in pixels
    pub width: Option<u32>,
    /// For images: height in pixels
    pub height: Option<u32>,
    /// File size in bytes
    pub size_bytes: u64,
}

/// Result of reading file content (AI tool)
#[derive(Serialize)]
pub struct ReadFileToolResult {
    pub content: String,
    pub truncated: bool,
    pub is_binary: bool,
    pub bytes_read: usize,
    pub lines_read: usize,
    /// Detected or used encoding (e.g., "utf-8", "gbk")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encoding_used: Option<String>,
    /// Binary file metadata (only set when is_binary is true)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binary_info: Option<BinaryFileInfo>,
    /// Total lines in the file (only set when search or around_line is used)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_lines: Option<usize>,
}

// ============================================================================
// Glob Search Types
// ============================================================================

/// A glob match result
pub struct GlobMatch {
    pub absolute: String,
    pub relative: String,
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Default directory names to always skip during search
const DEFAULT_EXCLUDE_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    "dist",
    "build",
    "__pycache__",
    ".next",
    ".nuxt",
    "vendor",
    "Pods",
    ".gradle",
    ".idea",
    ".vs",
    "bin",
    "obj",
];

/// Check if an entry name should be skipped based on default excludes.
/// Dot-prefixed names (like .env, .vscode) are NOT skipped by default —
/// they are only skipped if explicitly listed in the exclude set.
pub fn should_skip_entry_name(name: &str) -> bool {
    DEFAULT_EXCLUDE_DIRS.contains(&name)
}

/// Check if an entry name should be skipped, with additional custom excludes.
/// Supports both plain name matching and glob patterns (e.g., "*.log", "App.vue").
pub fn should_skip_entry_with_excludes(name: &str, extra_excludes: &[String]) -> bool {
    if should_skip_entry_name(name) {
        return true;
    }
    for ex in extra_excludes {
        // Exact match first (fast path)
        if name == ex {
            return true;
        }
        // Glob pattern match (e.g., "*.vue", "test_*")
        if ex.contains('*') || ex.contains('?') || ex.contains('[') {
            if let Ok(glob) = GlobBuilder::new(ex).literal_separator(true).build() {
                if let Ok(set) = GlobSetBuilder::new().add(glob).build() {
                    if set.is_match(name) {
                        return true;
                    }
                }
            }
        }
        // Path-style match: if exclude looks like "**/App.vue", match against basename
        if ex.contains('/') || ex.contains('\\') {
            // Strip path prefixes like "**/" and match against basename
            let basename = ex.rsplit(|c| c == '/' || c == '\\').next().unwrap_or(ex);
            if !basename.is_empty() && name == basename {
                return true;
            }
        }
    }
    false
}

/// Convert byte index to column number (1-based)
pub fn byte_index_to_column(s: &str, byte_index: usize) -> usize {
    // Monaco uses 1-based columns.
    s.get(..byte_index).unwrap_or("").chars().count() + 1
}

/// Find all matches of a query in a line
pub fn find_all_matches_in_line(line: &str, query: &str, case_sensitive: bool) -> Vec<usize> {
    if query.is_empty() {
        return Vec::new();
    }

    if case_sensitive {
        let mut indices = Vec::new();
        let mut start = 0usize;
        while start <= line.len() {
            if let Some(rel) = line.get(start..).and_then(|s| s.find(query)) {
                let idx = start + rel;
                indices.push(idx);
                start = idx + query.len();
            } else {
                break;
            }
        }
        return indices;
    }

    // Prefer ASCII-only case folding to keep byte indices stable.
    if line.is_ascii() && query.is_ascii() {
        let line_lower = line.to_ascii_lowercase();
        let query_lower = query.to_ascii_lowercase();
        let mut indices = Vec::new();
        let mut start = 0usize;
        while start <= line_lower.len() {
            if let Some(rel) = line_lower.get(start..).and_then(|s| s.find(&query_lower)) {
                let idx = start + rel;
                indices.push(idx);
                start = idx + query_lower.len();
            } else {
                break;
            }
        }
        return indices;
    }

    let line_lower = line.to_lowercase();
    let query_lower = query.to_lowercase();
    let mut indices = Vec::new();
    let mut start = 0usize;
    while start <= line_lower.len() {
        if let Some(rel) = line_lower.get(start..).and_then(|s| s.find(&query_lower)) {
            let idx = start + rel;
            indices.push(idx);
            start = idx + query_lower.len();
        } else {
            break;
        }
    }
    indices
}

/// Normalize a glob pattern
pub fn normalize_glob_pattern(raw: &str) -> String {
    raw.trim().replace('\\', "/")
}

/// Convert path to slash-separated string
pub fn path_to_slash_string(path: &std::path::Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Format file size for human reading
pub fn format_file_size(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
    let mut size = bytes as f64;
    let mut unit_index = 0;

    while size >= 1024.0 && unit_index < UNITS.len() - 1 {
        size /= 1024.0;
        unit_index += 1;
    }

    if unit_index == 0 {
        format!("{} {}", bytes, UNITS[0])
    } else {
        format!("{:.1} {}", size, UNITS[unit_index])
    }
}

// ============================================================================
// File search implementation
// ============================================================================

/// Highlight a match in a line by wrapping it with ** markers.
/// `start` and `end` are byte offsets. The preview is truncated to `max_len` characters
/// centered around the match if the line is too long.
fn highlight_match(line: &str, start: usize, end: usize, max_len: usize) -> String {
    let highlighted = format!(
        "{}**{}**{}",
        &line[..start],
        &line[start..end],
        &line[end..]
    );

    if highlighted.chars().count() <= max_len {
        return highlighted;
    }

    // Truncate around the match region
    let match_char_start = line[..start].chars().count();
    let _match_char_end = match_char_start + line[start..end].chars().count();
    let half = max_len / 2;
    let ctx_before = half.saturating_sub(2); // leave room for "**" prefix

    let char_indices: Vec<usize> = highlighted.char_indices().map(|(i, _)| i).collect();
    let total_chars = char_indices.len();

    let trim_start = if match_char_start > ctx_before {
        match_char_start - ctx_before
    } else {
        0
    };
    let trim_end = std::cmp::min(trim_start + max_len, total_chars);

    let byte_start = char_indices.get(trim_start).copied().unwrap_or(0);
    let byte_end = char_indices
        .get(trim_end)
        .copied()
        .unwrap_or(highlighted.len());

    let mut s = String::new();
    if trim_start > 0 {
        s.push_str("...");
    }
    s.push_str(&highlighted[byte_start..byte_end]);
    if trim_end < total_chars {
        s.push_str("...");
    }
    s
}

/// Collect up to `n` lines before index `idx` from `all_lines`.
fn collect_context_before(all_lines: &[String], idx: usize, n: usize) -> Vec<String> {
    if n == 0 {
        return Vec::new();
    }
    let start = idx.saturating_sub(n);
    all_lines[start..idx].to_vec()
}

/// Collect up to `n` lines after index `idx` from `all_lines`.
fn collect_context_after(all_lines: &[String], idx: usize, n: usize) -> Vec<String> {
    if n == 0 {
        return Vec::new();
    }
    let end = std::cmp::min(idx + 1 + n, all_lines.len());
    all_lines[idx + 1..end].to_vec()
}

fn search_path(
    path: &Path,
    query: &str,
    case_sensitive: bool,
    max_results: usize,
    max_file_size: u64,
    use_regex: bool,
    file_glob: &Option<GlobSet>,
    extra_excludes: &[String],
    context_lines: usize,
    results: &mut Vec<SearchFileResult>,
    total_matches: &mut usize,
) {
    if *total_matches >= max_results {
        return;
    }

    // Compile regex once if needed, will be passed to line matching
    let re = if use_regex {
        let pattern = if case_sensitive {
            query.to_string()
        } else {
            format!("(?i){}", query)
        };
        match regex::Regex::new(&pattern) {
            Ok(r) => Some(r),
            Err(e) => {
                eprintln!("Invalid regex pattern '{}': {}", query, e);
                return;
            }
        }
    } else {
        None
    };

    let meta = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return,
    };

    if meta.is_dir() {
        if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
            if should_skip_entry_with_excludes(name, extra_excludes) {
                return;
            }
        }

        let entries = match fs::read_dir(path) {
            Ok(e) => e,
            Err(_) => return,
        };

        for entry in entries.flatten() {
            search_path(
                &entry.path(),
                query,
                case_sensitive,
                max_results,
                max_file_size,
                use_regex,
                file_glob,
                extra_excludes,
                context_lines,
                results,
                total_matches,
            );
            if *total_matches >= max_results {
                return;
            }
        }

        return;
    }

    if !meta.is_file() {
        return;
    }

    if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
        if should_skip_entry_with_excludes(name, extra_excludes) {
            return;
        }
    }

    // Apply glob filter: if a glob pattern is provided, skip files that don't match
    if let Some(ref glob_set) = file_glob {
        if !glob_set.is_match(path) {
            return;
        }
    }

    if meta.len() > max_file_size {
        return;
    }

    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return,
    };
    let reader = std::io::BufReader::new(file);

    // Read all lines into memory for context_lines support
    let all_lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();

    let match_len = query.chars().count();
    let mut file_matches: Vec<SearchMatch> = Vec::new();

    for (idx, line) in all_lines.iter().enumerate() {
        if *total_matches >= max_results {
            break;
        }

        if let Some(ref re) = re {
            // Regex mode: find all matches using the compiled regex
            for m in re.find_iter(line) {
                if *total_matches >= max_results {
                    break;
                }
                let column = line[..m.start()].chars().count() + 1;
                let preview = highlight_match(line, m.start(), m.end(), 200);

                // Collect context lines
                let context_before = collect_context_before(&all_lines, idx, context_lines);
                let context_after = collect_context_after(&all_lines, idx, context_lines);

                file_matches.push(SearchMatch {
                    line: idx + 1,
                    column,
                    preview,
                    match_len: m.as_str().chars().count(),
                    context_before,
                    context_after,
                });
                *total_matches += 1;
            }
        } else {
            // Plain text mode (existing logic)
            let indices = find_all_matches_in_line(line, query, case_sensitive);
            for byte_idx in indices {
                if *total_matches >= max_results {
                    break;
                }

                let column = byte_index_to_column(line, byte_idx);
                let byte_end = byte_idx + query.len();
                let preview = highlight_match(line, byte_idx, byte_end, 200);

                // Collect context lines
                let context_before = collect_context_before(&all_lines, idx, context_lines);
                let context_after = collect_context_after(&all_lines, idx, context_lines);

                file_matches.push(SearchMatch {
                    line: idx + 1,
                    column,
                    preview,
                    match_len,
                    context_before,
                    context_after,
                });
                *total_matches += 1;
            }
        }
    }

    if !file_matches.is_empty() {
        results.push(SearchFileResult {
            path: path.to_string_lossy().to_string(),
            matches: file_matches,
        });
    }
}

#[tauri::command]
pub fn search_in_folder(
    folder_path: String,
    query: String,
    case_sensitive: bool,
    max_results: usize,
    max_file_size: u64,
    use_regex: Option<bool>,
    file_glob: Option<String>,
    exclude: Option<String>,
    context_lines: Option<usize>,
    source: Option<String>,
    sandbox_state: State<'_, SandboxState>,
) -> Result<Vec<SearchFileResult>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    let root = Path::new(&folder_path);
    if !root.exists() {
        return Err("folder does not exist".to_string());
    }

    // P0: validate read access for AI-originated calls
    sandbox::current_sandbox_context(&sandbox_state)
        .validate_read(root, CallSource::from_str(source.as_deref()))?;

    search_in_folder_impl(
        folder_path,
        query,
        case_sensitive,
        max_results,
        max_file_size,
        use_regex,
        file_glob,
        exclude,
        context_lines,
    )
}

/// Core implementation without sandbox validation — callers must validate beforehand.
pub fn search_in_folder_impl(
    folder_path: String,
    query: String,
    case_sensitive: bool,
    max_results: usize,
    max_file_size: u64,
    use_regex: Option<bool>,
    file_glob: Option<String>,
    exclude: Option<String>,
    context_lines: Option<usize>,
) -> Result<Vec<SearchFileResult>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    let root = Path::new(&folder_path);
    if !root.exists() {
        return Err("folder does not exist".to_string());
    }

    // Build a GlobSet from the file_glob parameter if provided
    let glob_set: Option<GlobSet> = match file_glob {
        Some(ref glob_str) if !glob_str.trim().is_empty() => {
            // Support comma-separated glob patterns (e.g., "*.ts,*.tsx")
            let mut builder = GlobSetBuilder::new();
            for pattern in glob_str.split(',') {
                let p = pattern.trim();
                if p.is_empty() {
                    continue;
                }
                match GlobBuilder::new(p).case_insensitive(true).build() {
                    Ok(g) => builder.add(g),
                    Err(e) => {
                        eprintln!("Invalid glob pattern '{}': {}", p, e);
                        continue;
                    }
                };
            }
            match builder.build() {
                Ok(gs) => Some(gs),
                Err(e) => {
                    eprintln!("Failed to build glob set: {}", e);
                    None
                }
            }
        }
        _ => None,
    };

    // Parse exclude parameter: comma-separated directory names
    let extra_excludes: Vec<String> = match exclude {
        Some(ref ex) if !ex.trim().is_empty() => ex
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        _ => Vec::new(),
    };

    let ctx = context_lines.unwrap_or(0);

    let mut results: Vec<SearchFileResult> = Vec::new();
    let mut total_matches: usize = 0;
    let max_results = max_results.max(1).min(50_000);
    let max_file_size = max_file_size.max(1);

    search_path(
        root,
        q,
        case_sensitive,
        max_results,
        max_file_size,
        use_regex.unwrap_or(false),
        &glob_set,
        &extra_excludes,
        ctx,
        &mut results,
        &mut total_matches,
    );

    Ok(results)
}

// ============================================================================
// Glob search implementation
// ============================================================================

fn walk_and_match_glob(
    path: &Path,
    root: &Path,
    globset: &GlobSet,
    max_candidates: usize,
    extra_excludes: &[String],
    current_depth: usize,
    max_depth: Option<usize>,
    results: &mut Vec<GlobMatch>,
) {
    if results.len() >= max_candidates {
        return;
    }

    // If max_depth is set and we've exceeded it, stop recursing
    if let Some(md) = max_depth {
        if current_depth > md {
            return;
        }
    }

    let meta = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return,
    };

    if meta.is_dir() {
        if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
            if should_skip_entry_with_excludes(name, extra_excludes) {
                return;
            }
        }

        let entries = match fs::read_dir(path) {
            Ok(e) => e,
            Err(_) => return,
        };

        for entry in entries.flatten() {
            walk_and_match_glob(
                &entry.path(),
                root,
                globset,
                max_candidates,
                extra_excludes,
                current_depth + 1,
                max_depth,
                results,
            );
            if results.len() >= max_candidates {
                return;
            }
        }

        return;
    }

    if !meta.is_file() {
        return;
    }

    if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
        if should_skip_entry_with_excludes(name, extra_excludes) {
            return;
        }
    }

    let rel = path.strip_prefix(root).unwrap_or(path);
    let rel_slash = path_to_slash_string(rel);
    if globset.is_match(&rel_slash) {
        results.push(GlobMatch {
            absolute: path_to_slash_string(path),
            relative: rel_slash,
        });
    }
}

#[tauri::command]
pub fn glob_search_files(
    root_path: String,
    pattern: String,
    max_results: Option<usize>,
    exclude: Option<String>,
    max_depth: Option<usize>,
    source: Option<String>,
    sandbox_state: State<'_, SandboxState>,
) -> Result<Vec<String>, String> {
    let p = pattern.trim();
    if p.is_empty() {
        return Ok(Vec::new());
    }

    let root = Path::new(&root_path);
    if !root.exists() {
        return Err("root path does not exist".to_string());
    }

    // P0: validate read access for AI-originated calls
    sandbox::current_sandbox_context(&sandbox_state)
        .validate_read(root, CallSource::from_str(source.as_deref()))?;

    glob_search_files_impl(root_path, pattern, max_results, exclude, max_depth)
}

/// Core implementation without sandbox validation — callers must validate beforehand.
pub fn glob_search_files_impl(
    root_path: String,
    pattern: String,
    max_results: Option<usize>,
    exclude: Option<String>,
    max_depth: Option<usize>,
) -> Result<Vec<String>, String> {
    let p = pattern.trim();
    if p.is_empty() {
        return Ok(Vec::new());
    }

    let root = Path::new(&root_path);
    if !root.exists() {
        return Err("root path does not exist".to_string());
    }

    let normalized_pattern = normalize_glob_pattern(p);
    let glob = GlobBuilder::new(&normalized_pattern)
        .case_insensitive(true)
        .build()
        .map_err(|e| format!("invalid pattern: {}", e))?;
    let mut builder = GlobSetBuilder::new();
    builder.add(glob);
    let globset = builder
        .build()
        .map_err(|e| format!("invalid pattern: {}", e))?;

    // Parse exclude parameter: comma-separated directory names
    let extra_excludes: Vec<String> = match exclude {
        Some(ref ex) if !ex.trim().is_empty() => ex
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        _ => Vec::new(),
    };

    // Determine max_depth: if not explicitly set, infer from pattern.
    // Patterns without `**` or path separators only match direct children (depth 1).
    // Patterns with `**` or `/` allow unlimited depth.
    let effective_max_depth = match max_depth {
        Some(d) => Some(d),
        None => {
            // If pattern contains `**` or any path separator, allow unlimited recursion
            if normalized_pattern.contains("**") || normalized_pattern.contains('/') {
                None // unlimited
            } else {
                // Simple pattern like "*.ts" — only match in root directory
                Some(1)
            }
        }
    };

    let limit = max_results.unwrap_or(50).max(1).min(50_000);
    let candidate_limit = std::cmp::max(limit * 20, 1000).min(10_000);
    let mut candidates: Vec<GlobMatch> = Vec::new();
    walk_and_match_glob(
        root,
        root,
        &globset,
        candidate_limit,
        &extra_excludes,
        0,
        effective_max_depth,
        &mut candidates,
    );

    candidates.sort_by(|a, b| {
        let depth_a = a.relative.matches('/').count();
        let depth_b = b.relative.matches('/').count();
        depth_a
            .cmp(&depth_b)
            .then_with(|| a.relative.len().cmp(&b.relative.len()))
            .then_with(|| a.relative.cmp(&b.relative))
    });

    let results = candidates
        .into_iter()
        .take(limit)
        .map(|item| item.absolute)
        .collect();

    Ok(results)
}

// ============================================================================
// Directory reading
// ============================================================================

// 辅助函数：读取目录（仅一层，children 懒加载）
pub fn read_dir_shallow(path: &str) -> Vec<FileNode> {
    let mut nodes = Vec::new();

    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let path_buf = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = path_buf.is_dir();
            let path_str = path_buf.to_string_lossy().to_string();
            let modified_at = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);

            // children 懒加载：初次只返回一层；文件夹 children_loaded=false
            let children = None;
            let children_loaded = !is_dir;

            nodes.push(FileNode {
                name,
                path: path_str,
                is_dir,
                children,
                children_loaded,
                modified_at,
            });
        }
    }
    // 让文件夹排在文件前面，好看一点
    nodes.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));

    nodes
}

// Tauri 命令：供前端调用
#[tauri::command]
pub fn open_folder(
    folder_path: String,
    source: Option<String>,
    sandbox_state: State<'_, SandboxState>,
) -> Vec<FileNode> {
    // P0: validate read access for AI-originated calls
    if sandbox::current_sandbox_context(&sandbox_state)
        .validate_read(Path::new(&folder_path), CallSource::from_str(source.as_deref()))
        .is_err()
    {
        return Vec::new();
    }
    read_dir_shallow(&folder_path)
}

// Tauri 命令：懒加载读取某个文件夹的 children
#[tauri::command]
pub fn read_folder_children(
    folder_path: String,
    source: Option<String>,
    sandbox_state: State<'_, SandboxState>,
) -> Vec<FileNode> {
    // P0: validate read access for AI-originated calls
    if sandbox::current_sandbox_context(&sandbox_state)
        .validate_read(Path::new(&folder_path), CallSource::from_str(source.as_deref()))
        .is_err()
    {
        return Vec::new();
    }
    read_dir_shallow(&folder_path)
}

// ============================================================================
// File reading and writing
// ============================================================================

#[tauri::command]
pub fn read_file_content(
    file_path: String,
    source: Option<String>,
    sandbox_state: State<'_, SandboxState>,
) -> Result<String, String> {
    // P0: validate read access for AI-originated calls
    sandbox::current_sandbox_context(&sandbox_state)
        .validate_read(Path::new(&file_path), CallSource::from_str(source.as_deref()))?;

    read_file_content_impl(&file_path)
}

/// Core implementation without sandbox validation — callers must validate beforehand.
pub fn read_file_content_impl(file_path: &str) -> Result<String, String> {
    let file = match fs::File::open(file_path) {
        Ok(f) => f,
        Err(err) => return Err(format!("读取失败: {}", err)),
    };

    // Binary file detection: sample first 1024 bytes for null bytes
    let mut reader = std::io::BufReader::new(file);
    let mut sample = [0u8; 1024];
    let sample_len = reader.read(&mut sample).unwrap_or(0);
    let is_binary = sample[..sample_len].iter().any(|b| *b == 0);

    if is_binary {
        return Err("二进制文件，无法以文本方式读取".to_string());
    }

    // Re-open and read the full content with lossy UTF-8 conversion
    // to handle files with minor encoding issues gracefully
    let bytes = match fs::read(file_path) {
        Ok(b) => b,
        Err(err) => return Err(format!("读取失败: {}", err)),
    };

    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
pub fn read_file_content_tool(
    req: ReadFileToolRequest,
    source: Option<String>,
    sandbox_state: State<'_, SandboxState>,
) -> Result<ReadFileToolResult, String> {
    // P0: validate read access for AI-originated calls
    sandbox::current_sandbox_context(&sandbox_state)
        .validate_read(Path::new(&req.file_path), CallSource::from_str(source.as_deref()))?;

    read_file_content_tool_impl(req)
}

/// Core implementation without sandbox validation — callers must validate beforehand.
pub fn read_file_content_tool_impl(
    req: ReadFileToolRequest,
) -> Result<ReadFileToolResult, String> {
    let file = fs::File::open(&req.file_path).map_err(|e| format!("读取失败: {}", e))?;
    let file_size = file.metadata().map(|m| m.len()).unwrap_or(0);

    let mut reader = std::io::BufReader::new(file);
    let mut sample = [0u8; 1024];
    let sample_len = reader.read(&mut sample).unwrap_or(0);
    let is_binary = sample[..sample_len].iter().any(|b| *b == 0);

    if is_binary {
        // Extract binary file metadata
        let binary_info = extract_binary_info(&req.file_path, &sample[..sample_len], file_size);
        let mime = binary_info.mime_type.clone();
        return Ok(ReadFileToolResult {
            content: format!(
                "Binary file ({}). Type: {}, Size: {} bytes{}",
                req.file_path,
                mime,
                file_size,
                match (&binary_info.width, &binary_info.height) {
                    (Some(w), Some(h)) => format!(", Dimensions: {}x{}", w, h),
                    _ => String::new(),
                }
            ),
            truncated: false,
            is_binary: true,
            bytes_read: 0,
            lines_read: 0,
            encoding_used: None,
            binary_info: Some(binary_info),
            total_lines: None,
        });
    }

    // Read the raw bytes first
    let bytes = fs::read(&req.file_path).map_err(|e| format!("读取失败: {}", e))?;

    // Decode with the specified encoding, falling back to UTF-8 lossy
    let (content, encoding_used) = match req.encoding.as_deref() {
        Some("gbk") | Some("gb2312") | Some("gb18030") => {
            let (cow, enc, _had_errors) = encoding_rs::GBK.decode(&bytes);
            (cow.to_string(), enc.name().to_string())
        }
        Some("big5") => {
            let (cow, enc, _had_errors) = encoding_rs::BIG5.decode(&bytes);
            (cow.to_string(), enc.name().to_string())
        }
        Some("shift_jis") | Some("shift-jis") | Some("sjis") => {
            let (cow, enc, _had_errors) = encoding_rs::SHIFT_JIS.decode(&bytes);
            (cow.to_string(), enc.name().to_string())
        }
        Some("euc-jp") => {
            let (cow, enc, _had_errors) = encoding_rs::EUC_JP.decode(&bytes);
            (cow.to_string(), enc.name().to_string())
        }
        Some("euc-kr") => {
            let (cow, enc, _had_errors) = encoding_rs::EUC_KR.decode(&bytes);
            (cow.to_string(), enc.name().to_string())
        }
        Some("iso-8859-1") | Some("latin1") | Some("latin-1") => {
            let (cow, enc, _had_errors) = encoding_rs::WINDOWS_1252.decode(&bytes);
            (cow.to_string(), enc.name().to_string())
        }
        Some("utf-16le") | Some("utf-16-le") => {
            let (cow, enc, _had_errors) = encoding_rs::UTF_16LE.decode(&bytes);
            (cow.to_string(), enc.name().to_string())
        }
        Some("utf-16be") | Some("utf-16-be") => {
            let (cow, enc, _had_errors) = encoding_rs::UTF_16BE.decode(&bytes);
            (cow.to_string(), enc.name().to_string())
        }
        // Default: UTF-8 with lossy conversion
        _ => {
            // Auto-detect encoding for non-UTF-8 files
            let lossy = String::from_utf8_lossy(&bytes);
            let has_replacement = lossy.contains('\u{fffd}');
            let detected = if has_replacement {
                // Try common CJK encodings as fallback
                try_detect_encoding(&bytes)
            } else {
                "utf-8".to_string()
            };
            (lossy.to_string(), detected)
        }
    };

    let all_lines: Vec<&str> = content.lines().collect();
    let total_lines_count = all_lines.len();

    // === Mode 1: In-file search ===
    if let Some(ref search_query) = req.search {
        return search_within_file(
            &all_lines,
            search_query,
            &req,
            total_lines_count,
            &encoding_used,
        );
    }

    // === Mode 2: around_line ===
    if let Some(center_line) = req.around_line {
        return read_around_line(
            &all_lines,
            center_line,
            &req,
            total_lines_count,
            &encoding_used,
        );
    }

    // === Mode 3: Standard line/byte range read ===
    let start_line = req.start_line.unwrap_or(1).max(1);
    let max_lines = req.max_lines.unwrap_or(2000);
    let max_bytes = req.max_bytes.unwrap_or(200_000);
    let mut result_lines: Vec<String> = Vec::new();
    let mut bytes_so_far = 0usize;
    let mut truncated = false;

    for (idx, line) in all_lines.iter().enumerate() {
        let line_num = idx + 1;
        if line_num < start_line {
            continue;
        }

        let line_with_newline = format!("{}\n", line);
        if bytes_so_far + line_with_newline.len() > max_bytes {
            truncated = true;
            break;
        }

        result_lines.push(line_with_newline.clone());
        bytes_so_far += line_with_newline.len();

        if result_lines.len() >= max_lines {
            truncated = true;
            break;
        }
    }

    let result_content = result_lines.join("");
    let lines_read = result_lines.len();

    Ok(ReadFileToolResult {
        content: result_content,
        truncated,
        is_binary: false,
        bytes_read: bytes_so_far,
        lines_read,
        encoding_used: Some(encoding_used),
        binary_info: None,
        total_lines: None,
    })
}

/// Extract metadata from binary files (images, etc.)
fn extract_binary_info(path: &str, _sample: &[u8], file_size: u64) -> BinaryFileInfo {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    // Try image metadata using the `image` crate
    let (mime_type, width, height) = if matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "tiff" | "tif"
    ) {
        let mime = match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "bmp" => "image/bmp",
            "ico" => "image/x-icon",
            "tiff" | "tif" => "image/tiff",
            _ => "image/unknown",
        }
        .to_string();

        // Try to read image dimensions from the full file
        match image::ImageReader::open(path) {
            Ok(reader) => match reader.into_dimensions() {
                Ok((w, h)) => (mime, Some(w), Some(h)),
                Err(_) => (mime, None, None),
            },
            Err(_) => (mime, None, None),
        }
    } else {
        // Guess MIME from extension
        let mime = match ext.as_str() {
            "pdf" => "application/pdf",
            "zip" => "application/zip",
            "tar" | "gz" | "bz2" | "xz" => "application/x-tar",
            "7z" => "application/x-7z-compressed",
            "rar" => "application/vnd.rar",
            "exe" | "dll" => "application/x-msdownload",
            "so" | "dylib" => "application/x-sharedlib",
            "mp3" => "audio/mpeg",
            "mp4" => "video/mp4",
            "wav" => "audio/wav",
            "woff" | "woff2" | "ttf" | "otf" => "font/*",
            "sqlite" | "db" => "application/x-sqlite3",
            _ => "application/octet-stream",
        };
        (mime.to_string(), None, None)
    };

    BinaryFileInfo {
        mime_type,
        width,
        height,
        size_bytes: file_size,
    }
}

/// Try to detect the encoding of bytes that failed UTF-8 decoding.
/// Returns the encoding name or "utf-8" if no match found.
fn try_detect_encoding(bytes: &[u8]) -> String {
    // Try common CJK encodings in order of likelihood
    let candidates: &[(&str, &encoding_rs::Encoding)] = &[
        ("gbk", encoding_rs::GBK),
        ("big5", encoding_rs::BIG5),
        ("shift_jis", encoding_rs::SHIFT_JIS),
        ("euc-jp", encoding_rs::EUC_JP),
        ("euc-kr", encoding_rs::EUC_KR),
        ("utf-16le", encoding_rs::UTF_16LE),
        ("utf-16be", encoding_rs::UTF_16BE),
    ];

    for (_name, encoding) in candidates {
        let (decoded, _, had_errors) = encoding.decode(bytes);
        if !had_errors {
            // Simple heuristic: if decoding has no errors and produces mostly printable text
            let text = decoded.as_ref();
            let printable_ratio = text
                .chars()
                .filter(|c| !c.is_control() || *c == '\n' || *c == '\r' || *c == '\t')
                .count() as f64
                / text.chars().count().max(1) as f64;
            if printable_ratio > 0.9 {
                return encoding.name().to_string();
            }
        }
    }

    "utf-8".to_string()
}

/// Search within a file for a keyword, returning matching lines with context.
fn search_within_file(
    all_lines: &[&str],
    query: &str,
    req: &ReadFileToolRequest,
    total_lines: usize,
    encoding_used: &str,
) -> Result<ReadFileToolResult, String> {
    let context_lines = 3; // lines of context around each match
    let max_matches = req.max_lines.unwrap_or(50);
    let case_sensitive = req.encoding.is_some(); // use encoding presence as a proxy (rare); default case-insensitive
    let query_lower = query.to_lowercase();

    let mut result_lines: Vec<String> = Vec::new();
    let mut bytes_so_far = 0usize;
    let max_bytes = req.max_bytes.unwrap_or(200_000);
    let mut truncated = false;
    let mut match_count = 0;
    let mut last_end = 0usize; // track last printed line to avoid overlap

    for (idx, line) in all_lines.iter().enumerate() {
        if match_count >= max_matches {
            truncated = true;
            break;
        }

        let is_match = if case_sensitive {
            line.contains(query)
        } else {
            line.to_lowercase().contains(&query_lower)
        };

        if is_match {
            let line_num = idx + 1;
            let ctx_start = last_end.max(line_num.saturating_sub(context_lines));
            let ctx_end = (line_num + context_lines).min(total_lines);

            // Add separator if there's a gap from previous context
            if ctx_start > last_end && last_end > 0 {
                result_lines.push("  ...\n".to_string());
            }

            for i in ctx_start..ctx_end {
                let current_line = all_lines.get(i - 1).map(|s| *s).unwrap_or("");
                if i == line_num {
                    let highlighted = format!(">> {}: {}\n", i, current_line);
                    if bytes_so_far + highlighted.len() > max_bytes {
                        truncated = true;
                        break;
                    }
                    bytes_so_far += highlighted.len();
                    result_lines.push(highlighted);
                } else {
                    let ctx_line = format!("   {}: {}\n", i, current_line);
                    if bytes_so_far + ctx_line.len() > max_bytes {
                        truncated = true;
                        break;
                    }
                    bytes_so_far += ctx_line.len();
                    result_lines.push(ctx_line);
                }
            }

            match_count += 1;
            last_end = ctx_end;
        }

        if truncated {
            break;
        }
    }

    let content = format!(
        "Search results for \"{}\" ({} matches in {} lines):\n\n{}",
        query,
        match_count,
        total_lines,
        result_lines.join("")
    );

    Ok(ReadFileToolResult {
        content,
        truncated,
        is_binary: false,
        bytes_read: bytes_so_far,
        lines_read: match_count,
        encoding_used: Some(encoding_used.to_string()),
        binary_info: None,
        total_lines: Some(total_lines),
    })
}

/// Read lines around a specific line number with context.
fn read_around_line(
    all_lines: &[&str],
    center_line: usize,
    req: &ReadFileToolRequest,
    total_lines: usize,
    encoding_used: &str,
) -> Result<ReadFileToolResult, String> {
    let context_lines = req.max_lines.unwrap_or(20); // default 20 lines around
    let max_bytes = req.max_bytes.unwrap_or(200_000);

    let start = center_line.saturating_sub(context_lines).max(1);
    let end = (center_line + context_lines).min(total_lines);

    let mut result_lines: Vec<String> = Vec::new();
    let mut bytes_so_far = 0usize;
    let mut truncated = false;

    for i in start..=end {
        if let Some(line) = all_lines.get(i - 1) {
            let line_with_num = format!("{}\n", line);
            if bytes_so_far + line_with_num.len() > max_bytes {
                truncated = true;
                break;
            }
            bytes_so_far += line_with_num.len();
            result_lines.push(line_with_num);
        }
    }

    let content = result_lines.join("");
    let lines_read = result_lines.len();

    Ok(ReadFileToolResult {
        content,
        truncated,
        is_binary: false,
        bytes_read: bytes_so_far,
        lines_read,
        encoding_used: Some(encoding_used.to_string()),
        binary_info: None,
        total_lines: Some(total_lines),
    })
}

/// Result of a write operation with optional summary for large files
#[derive(Debug, Clone, Serialize)]
pub struct WriteFileResult {
    pub path: String,
    pub bytes_written: u64,
    pub lines: Option<u64>,
    pub duration_ms: Option<u64>,
    pub skipped: bool,
    pub reason: Option<String>,
}

#[tauri::command]
pub fn write_file_content(
    app: tauri::AppHandle,
    file_path: String,
    content: String,
    append: Option<bool>,
    prepend: Option<bool>,
    if_not_exists: Option<bool>,
    template_vars: Option<std::collections::HashMap<String, String>>,
    source: Option<String>,
    sandbox_state: State<'_, SandboxState>,
) -> Result<WriteFileResult, String> {
    use std::time::Instant;
    let start = Instant::now();

    let path = PathBuf::from(&file_path);
    sandbox::current_sandbox_context(&sandbox_state)
        .validate_write(&path, CallSource::from_str(source.as_deref()))?;

    // if_not_exists check
    if if_not_exists.unwrap_or(false) && path.exists() {
        return Ok(WriteFileResult {
            path: file_path,
            bytes_written: 0,
            lines: None,
            duration_ms: None,
            skipped: true,
            reason: Some("文件已存在，因 if_not_exists=true 跳过写入".to_string()),
        });
    }

    // Template variable substitution: replace {{key}} with value
    let final_content = if let Some(vars) = template_vars {
        let mut result = content.clone();
        for (key, value) in vars {
            let placeholder = format!("{{{{{}}}}}", key); // {{key}}
            result = result.replace(&placeholder, &value);
        }
        result
    } else {
        content
    };

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("保存失败: 无法创建目录 {}: {}", parent.display(), err))?;
        }
    }

    let is_append = append.unwrap_or(false);
    let is_prepend = prepend.unwrap_or(false);

    if is_append && is_prepend {
        return Err("append 和 prepend 不能同时为 true".to_string());
    }

    if is_append {
        // Append mode: open file in append mode, create if not exists
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|err| format!("追加写入失败: {}", err))?;
        file.write_all(final_content.as_bytes())
            .map_err(|err| format!("追加写入失败: {}", err))?;
    } else if is_prepend {
        // Prepend mode: read existing content, write new content + existing
        let existing = if path.exists() {
            fs::read_to_string(&path).map_err(|err| format!("读取文件失败: {}", err))?
        } else {
            String::new()
        };
        // Atomic write for prepend
        let combined = format!("{}{}", final_content, existing);
        write_atomic(&path, &combined)?;
    } else {
        // Overwrite mode (default) — always use atomic write
        write_atomic(&path, &final_content)?;
    }

    let elapsed = start.elapsed();
    let bytes_written = final_content.len() as u64;
    let line_count = final_content.lines().count() as u64;

    // For large files (>10KB), include detailed summary; for smaller, just lines
    let (lines, duration_ms) = if bytes_written > 10_000 {
        (Some(line_count), Some(elapsed.as_millis() as u64))
    } else {
        (Some(line_count), None)
    };

    let _ = app.emit(
        "file-changed",
        serde_json::json!({ "paths": vec![path.to_string_lossy().to_string()] }),
    );

    Ok(WriteFileResult {
        path: file_path,
        bytes_written,
        lines,
        duration_ms,
        skipped: false,
        reason: None,
    })
}

/// Write content atomically: write to temp file first, then rename
fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("无效路径: {}", path.display()))?;
    let temp_name = format!(".~tmp_{}", uuid_suffix());
    let temp_path = parent.join(&temp_name);

    // Write to temp file
    fs::write(&temp_path, content).map_err(|err| format!("写入临时文件失败: {}", err))?;

    // Rename temp to target (atomic on same filesystem)
    fs::rename(&temp_path, path).map_err(|err| {
        // Clean up temp file on rename failure
        let _ = fs::remove_file(&temp_path);
        format!("重命名临时文件失败: {}", err)
    })?;

    Ok(())
}

/// Generate a short unique suffix for temp file names
fn uuid_suffix() -> String {
    use std::time::SystemTime;
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{:x}{:x}", dur.as_secs(), dur.subsec_nanos())
}

#[tauri::command]
pub fn create_file(
    app: tauri::AppHandle,
    file_path: String,
    source: Option<String>,
    sandbox_state: State<'_, SandboxState>,
) -> Result<(), String> {
    sandbox::current_sandbox_context(&sandbox_state)
        .validate_write(std::path::Path::new(&file_path), CallSource::from_str(source.as_deref()))?;
    println!("正在创建文件: {}", file_path);
    match fs::write(&file_path, "") {
        Ok(_) => {
            let _ = app.emit(
                "file-changed",
                serde_json::json!({ "paths": vec![file_path] }),
            );
            Ok(())
        }
        Err(err) => Err(format!("创建文件失败: {}", err)),
    }
}

#[tauri::command]
pub fn create_folder(
    app: tauri::AppHandle,
    folder_path: String,
    source: Option<String>,
    sandbox_state: State<'_, SandboxState>,
) -> Result<(), String> {
    sandbox::current_sandbox_context(&sandbox_state)
        .validate_write(Path::new(&folder_path), CallSource::from_str(source.as_deref()))?;
    println!("正在创建文件夹: {}", folder_path);
    match fs::create_dir_all(&folder_path) {
        Ok(_) => {
            let _ = app.emit(
                "file-changed",
                serde_json::json!({ "paths": vec![folder_path] }),
            );
            Ok(())
        }
        Err(err) => Err(format!("创建文件夹失败: {}", err)),
    }
}

// ============================================================================
// File editing / patch functions
// ============================================================================

pub fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    if !dst.exists() {
        fs::create_dir_all(dst).map_err(|e| format!("无法创建目标目录: {}", e))?;
    }

    let entries = fs::read_dir(src).map_err(|e| format!("读取目录失败: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = entry.file_name();
        let target = dst.join(file_name);

        if path.is_dir() {
            copy_dir_all(&path, &target)?;
        } else {
            fs::copy(&path, &target).map_err(|e| format!("复制失败: {}", e))?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn check_git_repo(path: String) -> Result<bool, String> {
    let project_path = Path::new(&path);
    Ok(project_path.join(".git").exists())
}

fn is_windows_reserved_filename(name: &str) -> bool {
    if !cfg!(windows) {
        return false;
    }
    let base = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(name);
    let stem = base.split('.').next().unwrap_or(base);
    let upper = stem.to_ascii_uppercase();
    match upper.as_str() {
        "CON" | "PRN" | "AUX" | "NUL" => true,
        _ => {
            if upper.len() == 4 {
                let prefix = &upper[..3];
                let ch = upper.as_bytes()[3];
                (prefix == "COM" || prefix == "LPT") && (b'1'..=b'9').contains(&ch)
            } else {
                false
            }
        }
    }
}

pub fn find_windows_reserved_names_in_repo(repo_path: &Path) -> Vec<String> {
    if !cfg!(windows) {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(repo_path) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_windows_reserved_filename(&name) {
            found.push(name);
        }
    }
    found.sort();
    found.dedup();
    found
}

#[tauri::command]
pub fn find_windows_reserved_repo_files(path: String) -> Result<Vec<String>, String> {
    let repo = Path::new(&path);
    if !repo.is_dir() {
        return Err("路径不是目录".to_string());
    }
    Ok(find_windows_reserved_names_in_repo(repo))
}

pub fn apply_search_replace(content: &str, blocks: &[ReplaceBlock]) -> Result<String, String> {
    let mut normalized = content.replace("\r\n", "\n");
    let line_ending = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let ends_with_newline = content.ends_with('\n');
    let has_bom = normalized.starts_with('\u{feff}');

    if has_bom {
        normalized = normalized.trim_start_matches('\u{feff}').to_string();
    }

    for block in blocks {
        let search = block.search.replace("\r\n", "\n");
        let replace = block.replace.replace("\r\n", "\n");
        if search.is_empty() {
            return Err("SEARCH block cannot be empty".to_string());
        }
        if !normalized.contains(&search) {
            return Err("SEARCH block not found".to_string());
        }
        normalized = normalized.replacen(&search, &replace, 1);
    }

    let mut result = if line_ending == "\r\n" {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    };

    if ends_with_newline && !result.ends_with(line_ending) {
        result.push_str(line_ending);
    }
    if has_bom {
        result = format!("\u{feff}{}", result);
    }
    Ok(result)
}

pub fn apply_search_replace_all(
    content: &str,
    search: &str,
    replace: &str,
) -> Result<String, String> {
    let mut normalized = content.replace("\r\n", "\n");
    let line_ending = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let ends_with_newline = content.ends_with('\n');
    let has_bom = normalized.starts_with('\u{feff}');

    if has_bom {
        normalized = normalized.trim_start_matches('\u{feff}').to_string();
    }

    let search_normalized = search.replace("\r\n", "\n");
    let replace_normalized = replace.replace("\r\n", "\n");

    if search_normalized.is_empty() {
        return Err("search string cannot be empty".to_string());
    }

    if !normalized.contains(&search_normalized) {
        return Err("search string not found".to_string());
    }

    // Replace all occurrences
    normalized = normalized.replace(&search_normalized, &replace_normalized);

    // Restore line endings
    let mut result = if line_ending == "\r\n" {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    };

    if ends_with_newline && !result.ends_with(line_ending) {
        result.push_str(line_ending);
    }
    if has_bom {
        result = format!("\u{feff}{}", result);
    }

    Ok(result)
}

#[tauri::command]
pub fn edit_file(
    app: tauri::AppHandle,
    req: EditFileRequest,
    source: Option<String>,
    sandbox_state: State<'_, SandboxState>,
) -> Result<EditFileResult, String> {
    sandbox::current_sandbox_context(&sandbox_state)
        .validate_write(Path::new(&req.file_path), CallSource::from_str(source.as_deref()))?;
    // Read file
    let path = PathBuf::from(&req.file_path);
    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    // Validate old_string is not empty
    if req.old_string.is_empty() {
        return Err("old_string cannot be empty".to_string());
    }

    // Pre-check: old_string must exist in the original content.
    // We also check after \r\n normalization to catch mismatches early.
    if !content.contains(&req.old_string) {
        // Try with \r\n normalized to \n — LLM may send Unix-style line endings
        let content_norm = content.replace("\r\n", "\n");
        let old_norm = req.old_string.replace("\r\n", "\n");
        if !content_norm.contains(&old_norm) {
            return Err(format!("old_string not found in file: {}", req.file_path));
        }
    }

    // Count occurrences before replacement (on normalized content for accuracy)
    let is_replace_all = req.replace_all.unwrap_or(false);
    let content_norm = content.replace("\r\n", "\n");
    let old_norm = req.old_string.replace("\r\n", "\n");
    let occurrence_count = content_norm.matches(&old_norm as &str).count();

    if occurrence_count == 0 {
        return Err(format!("old_string not found in file: {}", req.file_path));
    }

    // For single-replace mode, old_string must match exactly once
    if !is_replace_all && occurrence_count > 1 {
        return Err(format!(
            "old_string matches {} locations in file (expected 1). Use replace_all=true to replace all, or provide more context to make old_string unique.",
            occurrence_count
        ));
    }

    // Perform replacement using existing apply_search_replace logic
    let updated = if is_replace_all {
        apply_search_replace_all(&content, &req.old_string, &req.new_string)?
    } else {
        let blocks = vec![ReplaceBlock {
            search: req.old_string.clone(),
            replace: req.new_string.clone(),
        }];
        apply_search_replace(&content, &blocks)?
    };

    // Post-replace verification: ensure old_string no longer exists and new_string exists
    let updated_norm = updated.replace("\r\n", "\n");
    let new_norm = req.new_string.replace("\r\n", "\n");

    if is_replace_all {
        // After replace_all, old_string should be completely gone
        if updated_norm.contains(&old_norm) {
            return Err(format!(
                "Post-replace verification failed: old_string still present in file after replace_all. This may indicate a Unicode or encoding mismatch."
            ));
        }
    }

    if !new_norm.is_empty() && !updated_norm.contains(&new_norm) {
        return Err(format!(
            "Post-replace verification failed: new_string not found in file after replacement. The edit may not have been applied correctly."
        ));
    }

    let replacements_made = if is_replace_all { occurrence_count } else { 1 };

    // Atomic write (temp file + rename)
    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, &updated).map_err(|e| format!("Failed to write temp file: {}", e))?;

    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to remove original: {}", e))?;
    }

    fs::rename(&tmp_path, &path).map_err(|e| format!("Failed to rename temp file: {}", e))?;

    // Emit file-changed event
    let _ = app.emit(
        "file-changed",
        serde_json::json!({ "paths": vec![req.file_path.clone()] }),
    );

    Ok(EditFileResult {
        success: true,
        summary: format!(
            "Replaced {} occurrence(s) in {}",
            replacements_made, req.file_path
        ),
        replacements_made,
    })
}

// ============================================================================
// File tree generation
// ============================================================================

fn build_file_tree(
    path: &Path,
    current_depth: usize,
    max_depth: usize,
    dirs_only: bool,
) -> Vec<FileTreeNode> {
    if current_depth >= max_depth {
        return Vec::new();
    }

    let entries = match fs::read_dir(path) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    let mut nodes = Vec::new();

    for entry in entries.flatten() {
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // 跳过应该忽略的文件/目录
        if should_skip_entry_name(&name) {
            continue;
        }

        let is_dir = entry_path.is_dir();

        // 如果是 dirs_only 模式且不是目录，跳过
        if dirs_only && !is_dir {
            continue;
        }

        let children = if is_dir {
            build_file_tree(&entry_path, current_depth + 1, max_depth, dirs_only)
        } else {
            Vec::new()
        };

        nodes.push(FileTreeNode {
            name,
            is_dir,
            children,
        });
    }

    // 排序：目录在前，然后按名称排序
    nodes.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    nodes
}

fn format_tree_recursive(
    nodes: &[FileTreeNode],
    prefix: &str,
    _is_last: bool,
    output: &mut String,
    total_dirs: &mut usize,
    total_files: &mut usize,
) {
    for (i, node) in nodes.iter().enumerate() {
        let is_last_item = i == nodes.len() - 1;
        let connector = if is_last_item {
            "└── "
        } else {
            "├── "
        };
        let suffix = if node.is_dir { "/" } else { "" };

        output.push_str(prefix);
        output.push_str(connector);
        output.push_str(&node.name);
        output.push_str(suffix);
        output.push('\n');

        if node.is_dir {
            *total_dirs += 1;
        } else {
            *total_files += 1;
        }

        if !node.children.is_empty() {
            let new_prefix = if is_last_item {
                format!("{}    ", prefix)
            } else {
                format!("{}│   ", prefix)
            };

            format_tree_recursive(
                &node.children,
                &new_prefix,
                is_last_item,
                output,
                total_dirs,
                total_files,
            );
        }
    }
}

#[tauri::command]
pub fn get_file_tree(
    root_path: Option<String>,
    max_depth: Option<usize>,
    dirs_only: Option<bool>,
    source: Option<String>,
    sandbox_state: State<'_, SandboxState>,
) -> Result<FileTreeResult, String> {
    let path_str = root_path.ok_or("未指定根目录路径")?;
    let path = Path::new(&path_str);

    if !path.exists() {
        return Err(format!("路径不存在: {}", path_str));
    }

    if !path.is_dir() {
        return Err(format!("路径不是目录: {}", path_str));
    }

    // P0: validate read access for AI-originated calls
    sandbox::current_sandbox_context(&sandbox_state)
        .validate_read(path, CallSource::from_str(source.as_deref()))?;

    get_file_tree_impl(Some(path_str), max_depth, dirs_only)
}

/// Core implementation without sandbox validation — callers must validate beforehand.
pub fn get_file_tree_impl(
    root_path: Option<String>,
    max_depth: Option<usize>,
    dirs_only: Option<bool>,
) -> Result<FileTreeResult, String> {
    let path_str = root_path.ok_or("未指定根目录路径")?;
    let path = Path::new(&path_str);

    if !path.exists() {
        return Err(format!("路径不存在: {}", path_str));
    }

    if !path.is_dir() {
        return Err(format!("路径不是目录: {}", path_str));
    }

    let depth = max_depth.unwrap_or(3).max(1).min(10);
    let dirs_only_flag = dirs_only.unwrap_or(false);

    let nodes = build_file_tree(path, 0, depth, dirs_only_flag);

    let mut tree_output = String::new();
    tree_output.push_str(&format!("项目根目录: {}\n", path_str));

    let mut total_dirs = 0;
    let mut total_files = 0;

    format_tree_recursive(
        &nodes,
        "",
        false,
        &mut tree_output,
        &mut total_dirs,
        &mut total_files,
    );

    tree_output.push('\n');
    if dirs_only_flag {
        tree_output.push_str(&format!("总计: {} 个目录", total_dirs));
    } else {
        tree_output.push_str(&format!(
            "总计: {} 个目录, {} 个文件",
            total_dirs, total_files
        ));
    }

    Ok(FileTreeResult {
        root_path: path_str,
        tree: tree_output,
        total_dirs,
        total_files,
    })
}

// ============================================================================
// File info
// ============================================================================

fn format_system_time(time: std::time::SystemTime) -> String {
    use chrono::{DateTime, Local};
    let datetime: DateTime<Local> = time.into();
    datetime.format("%Y-%m-%d %H:%M:%S").to_string()
}

#[cfg(unix)]
fn format_unix_permissions(mode: u32) -> String {
    fn triplet(mode: u32, offset: u32) -> String {
        let r = if mode & (0o4 << offset) != 0 {
            'r'
        } else {
            '-'
        };
        let w = if mode & (0o2 << offset) != 0 {
            'w'
        } else {
            '-'
        };
        let x = if mode & (0o1 << offset) != 0 {
            'x'
        } else {
            '-'
        };
        format!("{}{}{}", r, w, x)
    }

    let user = triplet(mode, 6);
    let group = triplet(mode, 3);
    let other = triplet(mode, 0);
    format!("{}{}{}", user, group, other)
}

fn get_permissions_string(metadata: &fs::Metadata) -> Option<String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = metadata.permissions().mode();
        Some(format_unix_permissions(mode))
    }

    #[cfg(not(unix))]
    {
        if metadata.permissions().readonly() {
            Some("readonly".to_string())
        } else {
            Some("read-write".to_string())
        }
    }
}

#[tauri::command]
pub fn get_file_info(
    path: String,
    source: Option<String>,
    sandbox_state: State<'_, SandboxState>,
) -> Result<FileInfo, String> {
    let path_obj = Path::new(&path);

    // P0: validate read access for AI-originated calls (check before returning info)
    if path_obj.exists() {
        sandbox::current_sandbox_context(&sandbox_state)
            .validate_read(path_obj, CallSource::from_str(source.as_deref()))?;
    }

    get_file_info_impl(path)
}

/// Core implementation without sandbox validation — callers must validate beforehand.
pub fn get_file_info_impl(path: String) -> Result<FileInfo, String> {
    let path_obj = Path::new(&path);

    if !path_obj.exists() {
        return Ok(FileInfo {
            path: path.clone(),
            exists: false,
            file_type: "unknown".to_string(),
            size_bytes: 0,
            size_human: "0 B".to_string(),
            created: None,
            modified: None,
            accessed: None,
            is_readonly: false,
            permissions: None,
            is_binary: false,
            target_path: None,
        });
    }

    // 使用 symlink_metadata 来检测符号链接
    let symlink_metadata =
        fs::symlink_metadata(path_obj).map_err(|e| format!("无法获取文件元数据: {}", e))?;

    let is_symlink = symlink_metadata.file_type().is_symlink();
    let target_path = if is_symlink {
        fs::read_link(path_obj)
            .ok()
            .map(|p| p.to_string_lossy().to_string())
    } else {
        None
    };

    // 获取实际文件的元数据（跟随符号链接）
    let metadata = fs::metadata(path_obj).map_err(|e| format!("无法获取文件元数据: {}", e))?;

    let file_type = if is_symlink {
        "symlink"
    } else if metadata.is_file() {
        "file"
    } else if metadata.is_dir() {
        "directory"
    } else {
        "unknown"
    }
    .to_string();

    let size_bytes = metadata.len();
    let size_human = format_file_size(size_bytes);

    // 检测是否为二进制文件（仅对普通文件）
    let is_binary = if metadata.is_file() && size_bytes > 0 {
        match fs::File::open(path_obj) {
            Ok(mut file) => {
                let mut buffer = [0u8; 1024];
                let bytes_read = file.read(&mut buffer).unwrap_or(0);
                // 检查是否包含 NULL 字节
                buffer[..bytes_read].contains(&0)
            }
            Err(_) => false,
        }
    } else {
        false
    };

    let created = metadata.created().ok().map(format_system_time);
    let modified = metadata.modified().ok().map(format_system_time);
    let accessed = metadata.accessed().ok().map(format_system_time);

    let is_readonly = metadata.permissions().readonly();
    let permissions = get_permissions_string(&metadata);

    Ok(FileInfo {
        path: path.clone(),
        exists: true,
        file_type,
        size_bytes,
        size_human,
        created,
        modified,
        accessed,
        is_readonly,
        permissions,
        is_binary,
        target_path,
    })
}

// ============================================================================
// Copy / Move / Delete file or folder
// ============================================================================

/// Helper function to resolve a path relative to root_path.
///
/// Phase 2: when `root_path` is set, absolute paths and `../` escapes that
/// leave the root are rejected (closes absolute-path / traversal bypass).
pub fn resolve_path_with_root(root_path: &Option<String>, path: &str) -> Result<PathBuf, String> {
    match root_path {
        Some(root) if !root.trim().is_empty() => {
            // Note: do not audit here — call sites may be User UI; AI denials are
            // logged in tool_executor / frontend `audit_path_denied`.
            crate::security::context::resolve_under_root(path, Some(root.as_str()))
        }
        _ => {
            let path_buf = PathBuf::from(path);
            if path_buf.is_absolute() {
                Ok(path_buf)
            } else {
                Err("root_path is required for relative paths".to_string())
            }
        }
    }
}

#[tauri::command]
pub fn copy_file_or_folder(
    app: tauri::AppHandle,
    source: String,
    destination: String,
    overwrite: Option<bool>,
    root_path: Option<String>,
    op_source: Option<String>,
    sandbox_state: State<'_, SandboxState>,
) -> Result<(), String> {
    let src = resolve_path_with_root(&root_path, &source)?;
    let dest = resolve_path_with_root(&root_path, &destination)?;
    let sandbox_ctx = sandbox::current_sandbox_context(&sandbox_state);
    let call_src = CallSource::from_str(op_source.as_deref());
    sandbox_ctx.validate_write(&src, call_src)?;
    sandbox_ctx.validate_write(&dest, call_src)?;
    let should_overwrite = overwrite.unwrap_or(false);

    if !src.exists() {
        return Err(format!("源路径不存在: {}", source));
    }

    if dest.exists() {
        if !should_overwrite {
            return Err(format!(
                "目标路径已存在: {}。如需覆盖请设置 overwrite: true",
                destination
            ));
        }
        if dest.is_dir() {
            fs::remove_dir_all(&dest).map_err(|e| format!("删除目标文件夹失败: {}", e))?;
        } else {
            fs::remove_file(&dest).map_err(|e| format!("删除目标文件失败: {}", e))?;
        }
    }

    if let Some(parent) = dest.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("无法创建父目录: {}", e))?;
        }
    }

    if src.is_dir() {
        copy_dir_all(&src, &dest)?;
    } else {
        fs::copy(&src, &dest).map_err(|e| format!("复制文件失败: {}", e))?;
    }

    let _ = app.emit(
        "file-changed",
        serde_json::json!({ "paths": vec![dest.to_string_lossy().to_string()] }),
    );

    Ok(())
}

#[tauri::command]
pub fn move_file_or_folder(
    app: tauri::AppHandle,
    old_path: String,
    new_path: String,
    overwrite: Option<bool>,
    root_path: Option<String>,
    op_source: Option<String>,
    sandbox_state: State<'_, SandboxState>,
) -> Result<(), String> {
    println!(
        "\u{6b63}\u{5728}\u{79fb}\u{52a8}: {} -> {}",
        old_path, new_path
    );

    let src = resolve_path_with_root(&root_path, &old_path)?;
    let dest = resolve_path_with_root(&root_path, &new_path)?;
    let sandbox_ctx = sandbox::current_sandbox_context(&sandbox_state);
    let call_src = CallSource::from_str(op_source.as_deref());
    sandbox_ctx.validate_write(&src, call_src)?;
    sandbox_ctx.validate_write(&dest, call_src)?;
    let should_overwrite = overwrite.unwrap_or(false);

    if !src.exists() {
        return Err(format!(
            "\u{6e90}\u{8def}\u{5f84}\u{4e0d}\u{5b58}\u{5728}: {}",
            old_path
        ));
    }

    if dest.exists() {
        if !should_overwrite {
            return Err(format!(
                "目标路径已存在: {}。如需覆盖请设置 overwrite: true",
                new_path
            ));
        }
        if dest.is_dir() {
            fs::remove_dir_all(&dest).map_err(|e| format!("删除目标文件夹失败: {}", e))?;
        } else {
            fs::remove_file(&dest).map_err(|e| format!("删除目标文件失败: {}", e))?;
        }
    }

    if let Some(parent) = dest.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("无法创建父目录: {}", e))?;
        }
    }

    match fs::rename(&src, &dest) {
        Ok(_) => {
            let _ = app.emit(
                "file-changed",
                serde_json::json!({ "paths": vec![src.to_string_lossy().to_string(), dest.to_string_lossy().to_string()] }),
            );
            Ok(())
        }
        Err(err) => {
            if src.is_dir() {
                copy_dir_all(&src, &dest)?;
                fs::remove_dir_all(&src).map_err(|e| format!("删除源目录失败: {}", e))?;
            } else {
                fs::copy(&src, &dest).map_err(|e| format!("复制失败: {}", e))?;
                fs::remove_file(&src).map_err(|e| format!("删除源文件失败: {}", e))?;
            }
            if !dest.exists() {
                return Err(format!("移动失败: {}", err));
            }
            let _ = app.emit(
                "file-changed",
                serde_json::json!({ "paths": vec![src.to_string_lossy().to_string(), dest.to_string_lossy().to_string()] }),
            );
            Ok(())
        }
    }
}

#[tauri::command]
pub fn delete_file_or_folder(
    app: tauri::AppHandle,
    path: String,
    permanent: Option<bool>,
    root_path: Option<String>,
    op_source: Option<String>,
    sandbox_state: State<'_, SandboxState>,
) -> Result<(), String> {
    let target = resolve_path_with_root(&root_path, &path)?;
    sandbox::current_sandbox_context(&sandbox_state)
        .validate_write(&target, CallSource::from_str(op_source.as_deref()))?;

    if !target.exists() {
        return Err(format!("路径不存在: {}", path));
    }

    if permanent.unwrap_or(false) {
        if target.is_dir() {
            fs::remove_dir_all(&target).map_err(|e| format!("永久删除文件夹失败: {}", e))?;
        } else {
            fs::remove_file(&target).map_err(|e| format!("永久删除文件失败: {}", e))?;
        }
        let _ = app.emit(
            "file-changed",
            serde_json::json!({ "paths": vec![target.to_string_lossy().to_string()] }),
        );
        return Ok(());
    }

    trash::delete(&target)
        .map_err(|e| format!("移入回收站失败: {} (可尝试 permanent: true 强制删除)", e))?;

    let _ = app.emit(
        "file-changed",
        serde_json::json!({ "paths": vec![target.to_string_lossy().to_string()] }),
    );

    Ok(())
}

// ============================================================================
// Unified file_ops_tool - supports batch, glob, conflict, history, restore
// ============================================================================

#[tauri::command]
pub fn file_ops_tool(
    app: tauri::AppHandle,
    action: String,
    path: Option<String>,
    paths: Option<Vec<String>>,
    source: Option<String>,
    destination: Option<String>,
    glob: Option<String>,
    folder_path: Option<String>,
    permanent: Option<bool>,
    conflict: Option<String>,
    root_path: Option<String>,
    op_source: Option<String>,
    sandbox_state: State<'_, SandboxState>,
) -> Result<FileOpsToolResult, String> {
    let conflict_mode = conflict.unwrap_or_else(|| "error".to_string());
    let is_permanent = permanent.unwrap_or(false);

    // --- action: history ---
    if action == "history" {
        let limit = path
            .as_deref()
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(20);
        let entries = if let Ok(hist) = OP_HISTORY.lock() {
            hist.iter().rev().take(limit).cloned().collect::<Vec<_>>()
        } else {
            vec![]
        };
        // Return history as a special result with text in error field (reuse structure)
        let results: Vec<FileOpResultItem> = entries
            .iter()
            .map(|e| FileOpResultItem {
                path: format!(
                    "[{}] {}{}{}",
                    e.timestamp,
                    e.action,
                    e.source
                        .as_deref()
                        .map(|s| format!(" {}", s))
                        .unwrap_or_default(),
                    e.destination
                        .as_deref()
                        .map(|d| format!(" -> {}", d))
                        .unwrap_or_default(),
                ),
                success: e.success,
                error: e.error.clone(),
                size_bytes: e.size_bytes,
                renamed_to: None,
            })
            .collect();
        let total = results.len();
        let succeeded = results.iter().filter(|r| r.success).count();
        return Ok(FileOpsToolResult {
            results,
            total,
            succeeded,
            failed: total - succeeded,
        });
    }

    // --- action: restore ---
    if action == "restore" {
        // trash crate doesn't support programmatic restore.
        // On Windows, we try using PowerShell to restore from recycle bin.
        let restore_path = path
            .as_deref()
            .or(source.as_deref())
            .ok_or("restore 需要提供 path 参数 (原始路径)")?;

        // P2: Restore spawns a subprocess — must go through sandbox validation
        let sandbox_ctx = sandbox::current_sandbox_context(&sandbox_state);
        sandbox_ctx.validate_command_allowed()?;
        // Restore target must be within writable roots (it's a write operation)
        sandbox_ctx.validate_write(std::path::Path::new(restore_path), CallSource::from_str(op_source.as_deref()))?;
        crate::audit_log::log_decision(
            "ai", "restore", restore_path, "allowed", None, &sandbox_ctx.access_mode,
        );

        #[cfg(target_os = "windows")]
        {
            let ps_script = format!(
                r#"
                $shell = New-Object -ComObject Shell.Application
                $recycleBin = $shell.NameSpace(0x0a)
                foreach ($item in $recycleBin.Items()) {{
                    if ($item.ExtendedProperty("System.OriginalFileName") -eq "{}") {{
                        $item.InvokeVerb()
                        break
                    }}
                }}
                "#,
                restore_path.replace('\\', "\\\\").replace('"', "\\\"")
            );
            let mut cmd = std::process::Command::new("powershell");
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", &ps_script]);
            // P2: Sanitize environment — strip secrets, inject whitelist only
            crate::terminal::apply_sanitized_env(&mut cmd);
            // P2: Assign to Job Object for OS-level isolation
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            let output = cmd
                .output()
                .map_err(|e| format!("执行 PowerShell 恢复失败: {}", e))?;

            let restored = output.status.success();
            if restored {
                let _ = app.emit(
                    "file-changed",
                    serde_json::json!({ "paths": vec![restore_path.to_string()] }),
                );
                record_op(FileOpHistoryEntry {
                    action: "restore".to_string(),
                    source: Some(restore_path.to_string()),
                    destination: None,
                    timestamp: chrono_now_str(),
                    permanent: None,
                    size_bytes: None,
                    success: true,
                    error: None,
                });
                return Ok(FileOpsToolResult {
                    results: vec![FileOpResultItem {
                        path: restore_path.to_string(),
                        success: true,
                        error: None,
                        size_bytes: None,
                        renamed_to: None,
                    }],
                    total: 1,
                    succeeded: 1,
                    failed: 0,
                });
            }
        }

        return Err("从回收站恢复失败: 当前平台不支持自动恢复，请手动从回收站还原".to_string());
    }

    // --- Collect target paths ---
    let mut resolved_paths: Vec<PathBuf> = Vec::new();
    let mut source_dest_pairs: Vec<(PathBuf, PathBuf)> = Vec::new();

    // Glob expansion
    if let Some(ref glob_pattern) = glob {
        // When both path and glob are provided, use path as the scope folder for glob
        let folder = if let Some(ref fp) = folder_path {
            resolve_path_with_root(&root_path, fp)?
        } else if let Some(ref p) = path {
            resolve_path_with_root(&root_path, p)?
        } else if let Some(ref rp) = root_path {
            PathBuf::from(rp)
        } else {
            return Err("glob 操作需要 path、folder_path 或 root_path 参数".to_string());
        };
        let expanded = expand_glob(glob_pattern, &folder)?;
        if expanded.is_empty() {
            return Ok(FileOpsToolResult {
                results: vec![FileOpResultItem {
                    path: glob_pattern.clone(),
                    success: false,
                    error: Some(format!("glob '{}' 未匹配任何文件", glob_pattern)),
                    size_bytes: None,
                    renamed_to: None,
                }],
                total: 1,
                succeeded: 0,
                failed: 1,
            });
        }
        resolved_paths = expanded;
    }

    // Batch paths
    if let Some(ref p_arr) = paths {
        for p in p_arr {
            resolved_paths.push(resolve_path_with_root(&root_path, p)?);
        }
    }

    // Single path (for delete / create_folder)
    // When glob is also provided, path was already used as the glob scope folder — don't add it again
    if let Some(ref p) = path {
        if glob.is_none() && (action == "delete" || action == "create_folder") {
            resolved_paths.push(resolve_path_with_root(&root_path, p)?);
        }
    }

    // Source/destination for copy/move
    if action == "copy" || action == "move" {
        if let (Some(ref src), Some(ref dst)) = (&source, &destination) {
            let src_path = resolve_path_with_root(&root_path, src)?;
            let dst_path = resolve_path_with_root(&root_path, dst)?;

            // If we have resolved_paths from glob/batch, use destination as base dir
            if !resolved_paths.is_empty() {
                for src_p in &resolved_paths {
                    let file_name = src_p.file_name().unwrap_or_default();
                    let dst_p = dst_path.join(file_name);
                    source_dest_pairs.push((src_p.clone(), dst_p));
                }
            } else {
                source_dest_pairs.push((src_path, dst_path));
            }
        } else if !resolved_paths.is_empty() && destination.is_some() {
            // Batch/glob copy/move: paths[] or glob results + destination (no explicit source)
            let dst_path = resolve_path_with_root(&root_path, destination.as_deref().unwrap())?;
            for src_p in &resolved_paths {
                let file_name = src_p.file_name().unwrap_or_default();
                let dst_p = dst_path.join(file_name);
                source_dest_pairs.push((src_p.clone(), dst_p));
            }
        } else if resolved_paths.is_empty() {
            return Err(format!("{} 操作需要 source 和 destination 参数", action));
        } else {
            return Err(format!(
                "{} 操作的 glob/batch 模式需要 destination 参数作为目标目录",
                action
            ));
        }
    }

    let sandbox_ctx = sandbox::current_sandbox_context(&sandbox_state);
    let call_src = CallSource::from_str(op_source.as_deref());
    for p in &resolved_paths {
        sandbox_ctx.validate_write(p, call_src)?;
    }
    for (src, dst) in &source_dest_pairs {
        sandbox_ctx.validate_write(src, call_src)?;
        sandbox_ctx.validate_write(dst, call_src)?;
    }

    // --- Execute operations ---
    let mut results: Vec<FileOpResultItem> = Vec::new();
    let mut changed_paths: Vec<String> = Vec::new();

    match action.as_str() {
        "copy" => {
            for (src, dst) in &source_dest_pairs {
                let result = do_copy(src, dst, &conflict_mode)?;
                if result.success {
                    changed_paths.push(
                        result
                            .renamed_to
                            .as_deref()
                            .unwrap_or(&dst.to_string_lossy())
                            .to_string(),
                    );
                }
                results.push(result);
            }
        }
        "move" => {
            for (src, dst) in &source_dest_pairs {
                let result = do_move(src, dst, &conflict_mode)?;
                if result.success {
                    changed_paths.push(src.to_string_lossy().to_string());
                    changed_paths.push(
                        result
                            .renamed_to
                            .as_deref()
                            .unwrap_or(&dst.to_string_lossy())
                            .to_string(),
                    );
                }
                results.push(result);
            }
        }
        "delete" => {
            for target in &resolved_paths {
                let result = do_delete(target, is_permanent);
                if result.success {
                    changed_paths.push(target.to_string_lossy().to_string());
                }
                results.push(result);
            }
        }
        "create_folder" => {
            for target in &resolved_paths {
                let result = do_create_folder(target);
                if result.success {
                    changed_paths.push(target.to_string_lossy().to_string());
                }
                results.push(result);
            }
        }
        _ => {
            return Err(format!(
                "不支持的操作 '{}'. 可用: copy, move, delete, create_folder, history, restore",
                action
            ));
        }
    }

    let succeeded = results.iter().filter(|r| r.success).count();
    let failed = results.len() - succeeded;

    // Emit file-changed event
    if !changed_paths.is_empty() {
        let _ = app.emit(
            "file-changed",
            serde_json::json!({ "paths": changed_paths }),
        );
    }

    // Record in history
    for r in &results {
        if r.success {
            record_op(FileOpHistoryEntry {
                action: action.clone(),
                source: Some(r.path.clone()),
                destination: r.renamed_to.clone(),
                timestamp: chrono_now_str(),
                permanent: if action == "delete" {
                    Some(is_permanent)
                } else {
                    None
                },
                size_bytes: r.size_bytes,
                success: true,
                error: None,
            });
        } else {
            record_op(FileOpHistoryEntry {
                action: action.clone(),
                source: Some(r.path.clone()),
                destination: None,
                timestamp: chrono_now_str(),
                permanent: if action == "delete" {
                    Some(is_permanent)
                } else {
                    None
                },
                size_bytes: r.size_bytes,
                success: false,
                error: r.error.clone(),
            });
        }
    }

    Ok(FileOpsToolResult {
        results,
        total: succeeded + failed,
        succeeded,
        failed,
    })
}

/// Simple timestamp helper
fn chrono_now_str() -> String {
    use std::time::SystemTime;
    let duration = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    // Simple ISO-ish format from epoch millis
    let secs = duration.as_secs();
    let millis = duration.subsec_millis();
    format!("{}.{:03}", secs, millis)
}

#[cfg(test)]
mod tests {
    use super::{expand_glob, find_windows_reserved_names_in_repo, is_windows_reserved_filename};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn windows_reserved_filename_detection() {
        assert!(is_windows_reserved_filename("nul"));
        assert!(is_windows_reserved_filename("NUL.txt"));
        assert!(is_windows_reserved_filename("COM1"));
        assert!(!is_windows_reserved_filename("null"));
        assert!(!is_windows_reserved_filename("README.md"));
    }

    #[test]
    fn find_windows_reserved_names_in_repo_is_empty_on_non_windows() {
        if cfg!(windows) {
            return;
        }
        let dir = temp_dir("reserved_non_windows");
        assert!(find_windows_reserved_names_in_repo(&dir).is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    fn temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("loom_{name}_{unique}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn expand_glob_is_non_recursive_by_default() {
        let dir = temp_dir("glob_direct");
        let nested = dir.join("nested");
        fs::create_dir_all(&nested).unwrap();
        let top_file = dir.join("top.txt");
        let nested_file = nested.join("deep.txt");
        fs::write(&top_file, "top").unwrap();
        fs::write(&nested_file, "deep").unwrap();

        let matches = expand_glob("*.txt", &dir).unwrap();

        assert!(matches.contains(&top_file));
        assert!(!matches.contains(&nested_file));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn expand_glob_recurses_when_pattern_is_explicitly_recursive() {
        let dir = temp_dir("glob_recursive");
        let nested = dir.join("nested");
        fs::create_dir_all(&nested).unwrap();
        let nested_file = nested.join("deep.txt");
        fs::write(&nested_file, "deep").unwrap();

        let matches = expand_glob("nested/*.txt", &dir).unwrap();

        assert!(matches.contains(&nested_file));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn read_only_sandbox_blocks_create_file_target_path() {
        use crate::sandbox::SandboxContext;

let ctx = SandboxContext {
access_mode: "read_only".to_string(),
writable_roots: vec!["C:\\project".to_string()],
readable_roots: vec![],
network_enabled: false,
};
        assert!(ctx
            .validate_write(std::path::Path::new("C:\\project\\new.txt"), crate::sandbox::CallSource::Ai)
            .is_err());
    }
}
