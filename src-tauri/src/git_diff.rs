use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub const MAX_DIFF_BYTES: usize = 200_000;
const MAX_HUNK_LINES: usize = 100;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn git_command(repo_path: &PathBuf) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(repo_path);
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitDiffOptions {
    pub repo_path: String,
    pub file_path: Option<String>,
    pub cached: Option<bool>,
    pub max_lines: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitDiffResult {
    pub files: Vec<FileDiff>,
    pub summary: DiffSummary,
    pub truncated: bool,
    pub truncated_info: Option<String>,
    pub raw_diff: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiffLine {
    pub line_type: String,
    pub content: String,
    pub old_line_no: Option<u32>,
    pub new_line_no: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiffSummary {
    pub total_files: u32,
    pub total_additions: u32,
    pub total_deletions: u32,
}

#[tauri::command]
pub fn get_git_diff(options: GitDiffOptions) -> Result<GitDiffResult, String> {
    let repo_path = PathBuf::from(&options.repo_path);

    if !repo_path.join(".git").exists() {
        return Err(format!("Not a git repository: {}", options.repo_path));
    }

    let mut cmd = git_command(&repo_path);
    cmd.arg("diff");

    if options.cached.unwrap_or(false) {
        cmd.arg("--cached");
    }

    if let Some(ref file_path) = options.file_path {
        cmd.arg("--").arg(file_path);
    }

    use std::io::Read;
    use std::process::Stdio;

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "Failed to spawn git command: {}. Make sure git is installed.",
            e
        )
    })?;

    let mut diff_output_bytes = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        let mut handle = stdout.take(MAX_DIFF_BYTES as u64 + 1);
        handle
            .read_to_end(&mut diff_output_bytes)
            .map_err(|e| format!("Failed to read git output: {}", e))?;
    }

    let is_truncated = diff_output_bytes.len() > MAX_DIFF_BYTES;
    if is_truncated {
        let _ = child.kill();
        diff_output_bytes.truncate(MAX_DIFF_BYTES);
    }

    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait on git child: {}", e))?;

    if !status.success() && !is_truncated {
        let mut stderr = String::new();
        if let Some(mut err_handle) = child.stderr.take() {
            let _ = err_handle.read_to_string(&mut stderr);
        }
        return Err(format!("Git diff failed: {}", stderr));
    }

    let diff_output = String::from_utf8_lossy(&diff_output_bytes).to_string();

    let mut numstat_cmd = git_command(&repo_path);
    numstat_cmd.arg("diff").arg("--numstat");

    if options.cached.unwrap_or(false) {
        numstat_cmd.arg("--cached");
    }

    if let Some(ref file_path) = options.file_path {
        numstat_cmd.arg("--").arg(file_path);
    }

    let numstat_output = numstat_cmd
        .output()
        .map_err(|e| format!("Failed to execute git numstat: {}", e))?;

    let numstat = String::from_utf8_lossy(&numstat_output.stdout).to_string();

    let max_lines = options.max_lines.unwrap_or(1000);
    parse_git_diff(
        &diff_output,
        &numstat,
        max_lines,
        options.file_path.as_deref(),
    )
}

fn is_lockfile(path: &str) -> bool {
    let lockfiles = [
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "Cargo.lock",
        "Gemfile.lock",
        "composer.lock",
        "poetry.lock",
    ];

    lockfiles.iter().any(|&lockfile| {
        path.ends_with(lockfile)
            || path.contains(&format!("/{}", lockfile))
            || path.contains(&format!("\\{}", lockfile))
    })
}

pub fn parse_git_diff(
    diff_output: &str,
    numstat: &str,
    max_lines: u32,
    explicit_file: Option<&str>,
) -> Result<GitDiffResult, String> {
    let mut files: Vec<FileDiff> = Vec::new();
    let mut current_file: Option<FileDiff> = None;
    let mut current_hunk: Option<DiffHunk> = None;
    let mut old_line_no: u32 = 0;
    let mut new_line_no: u32 = 0;

    let mut file_stats: HashMap<String, (u32, u32)> = HashMap::new();
    for line in numstat.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 {
            let additions = parts[0].parse::<u32>().unwrap_or(0);
            let deletions = parts[1].parse::<u32>().unwrap_or(0);
            let file_path = parts[2..].join(" ");
            file_stats.insert(file_path, (additions, deletions));
        }
    }

    for line in diff_output.lines() {
        if line.starts_with("diff --git") {
            if let Some(mut file) = current_file.take() {
                if let Some(hunk) = current_hunk.take() {
                    file.hunks.push(hunk);
                }
                files.push(file);
            }

            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 4 {
                let path = parts[3].trim_start_matches("b/").to_string();
                let (additions, deletions) = file_stats.get(&path).copied().unwrap_or((0, 0));

                current_file = Some(FileDiff {
                    path: path.clone(),
                    old_path: None,
                    status: "modified".to_string(),
                    additions,
                    deletions,
                    hunks: Vec::new(),
                });
            }
        } else if line.starts_with("new file mode") {
            if let Some(ref mut file) = current_file {
                file.status = "added".to_string();
            }
        } else if line.starts_with("deleted file mode") {
            if let Some(ref mut file) = current_file {
                file.status = "deleted".to_string();
            }
        } else if line.starts_with("rename from") {
            if let Some(ref mut file) = current_file {
                file.status = "renamed".to_string();
                file.old_path = Some(line.trim_start_matches("rename from ").to_string());
            }
        } else if line.starts_with("@@") {
            if let Some(hunk) = current_hunk.take() {
                if let Some(ref mut file) = current_file {
                    file.hunks.push(hunk);
                }
            }

            if let Some(hunk_info) = parse_hunk_header(line) {
                old_line_no = hunk_info.0;
                new_line_no = hunk_info.2;
                current_hunk = Some(DiffHunk {
                    old_start: hunk_info.0,
                    old_lines: hunk_info.1,
                    new_start: hunk_info.2,
                    new_lines: hunk_info.3,
                    header: line.to_string(),
                    lines: Vec::new(),
                });
            }
        } else if line.starts_with('+') && !line.starts_with("+++") {
            if let Some(ref mut hunk) = current_hunk {
                hunk.lines.push(DiffLine {
                    line_type: "add".to_string(),
                    content: line[1..].to_string(),
                    old_line_no: None,
                    new_line_no: Some(new_line_no),
                });
                new_line_no += 1;
            }
        } else if line.starts_with('-') && !line.starts_with("---") {
            if let Some(ref mut hunk) = current_hunk {
                hunk.lines.push(DiffLine {
                    line_type: "delete".to_string(),
                    content: line[1..].to_string(),
                    old_line_no: Some(old_line_no),
                    new_line_no: None,
                });
                old_line_no += 1;
            }
        } else if line.starts_with(' ') {
            if let Some(ref mut hunk) = current_hunk {
                hunk.lines.push(DiffLine {
                    line_type: "context".to_string(),
                    content: line[1..].to_string(),
                    old_line_no: Some(old_line_no),
                    new_line_no: Some(new_line_no),
                });
                old_line_no += 1;
                new_line_no += 1;
            }
        }
    }

    if let Some(hunk) = current_hunk {
        if let Some(ref mut file) = current_file {
            file.hunks.push(hunk);
        }
    }
    if let Some(file) = current_file {
        files.push(file);
    }

    let mut total_lines_count = 0u32;
    let mut truncated = false;
    let mut truncated_files = Vec::new();
    let mut filtered_files = Vec::new();

    for mut file in files {
        let is_lock = is_lockfile(&file.path);
        let should_skip_details = is_lock && explicit_file.map_or(true, |ef| ef != file.path);

        if should_skip_details {
            file.hunks.clear();
            filtered_files.push(file);
            continue;
        }

        let mut truncated_hunks = Vec::new();

        for mut hunk in file.hunks {
            let hunk_line_count = hunk.lines.len() as u32;

            if total_lines_count + hunk_line_count > max_lines {
                truncated = true;
                truncated_files.push(file.path.clone());
                break;
            }

            if hunk.lines.len() > MAX_HUNK_LINES {
                hunk.lines.truncate(MAX_HUNK_LINES);
                truncated = true;
            }

            total_lines_count += hunk_line_count;
            truncated_hunks.push(hunk);
        }

        file.hunks = truncated_hunks;
        filtered_files.push(file);

        if truncated {
            break;
        }
    }

    let mut raw_diff = String::new();

    for file in &filtered_files {
        raw_diff.push_str(&format!("diff --git a/{} b/{}\n", file.path, file.path));

        if file.status == "added" {
            raw_diff.push_str("new file mode 100644\n");
        } else if file.status == "deleted" {
            raw_diff.push_str("deleted file mode 100644\n");
        } else if file.status == "renamed" {
            if let Some(ref old_path) = file.old_path {
                raw_diff.push_str(&format!("rename from {}\n", old_path));
                raw_diff.push_str(&format!("rename to {}\n", file.path));
            }
        }

        if file.hunks.is_empty() {
            if is_lockfile(&file.path) {
                raw_diff.push_str(&format!("--- a/{}\n", file.path));
                raw_diff.push_str(&format!("+++ b/{}\n", file.path));
                raw_diff.push_str(&format!(
                    "@@ Lockfile changes: +{} -{} (details omitted) @@\n",
                    file.additions, file.deletions
                ));
            }
            continue;
        }

        raw_diff.push_str(&format!("--- a/{}\n", file.path));
        raw_diff.push_str(&format!("+++ b/{}\n", file.path));

        for hunk in &file.hunks {
            raw_diff.push_str(&hunk.header);
            raw_diff.push('\n');

            for line in &hunk.lines {
                let prefix = match line.line_type.as_str() {
                    "add" => "+",
                    "delete" => "-",
                    _ => " ",
                };
                raw_diff.push_str(&format!("{}{}\n", prefix, line.content));
            }
        }
    }

    let total_files = filtered_files.len() as u32;
    let total_additions: u32 = filtered_files.iter().map(|f| f.additions).sum();
    let total_deletions: u32 = filtered_files.iter().map(|f| f.deletions).sum();

    let truncated_info = if truncated {
        let total_changes = total_additions + total_deletions;
        let remaining_lines = total_changes.saturating_sub(total_lines_count);
        Some(format!(
            "输出已截断。剩余约 {} 行未显示。建议使用 file_path 参数查看特定文件，或增加 max_lines 参数。",
            remaining_lines
        ))
    } else {
        None
    };

    if raw_diff.len() > MAX_DIFF_BYTES {
        truncated = true;
        raw_diff.truncate(MAX_DIFF_BYTES);
        raw_diff.push_str("\n\n... (输出超过 200KB 限制，已截断)");
    }

    Ok(GitDiffResult {
        files: filtered_files,
        summary: DiffSummary {
            total_files,
            total_additions,
            total_deletions,
        },
        truncated,
        truncated_info,
        raw_diff,
    })
}

pub fn parse_hunk_header(line: &str) -> Option<(u32, u32, u32, u32)> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 3 {
        return None;
    }

    let old_part = parts[1].trim_start_matches('-');
    let new_part = parts[2].trim_start_matches('+');

    let old_nums: Vec<&str> = old_part.split(',').collect();
    let new_nums: Vec<&str> = new_part.split(',').collect();

    let old_start = old_nums.get(0)?.parse::<u32>().ok()?;
    let old_lines = old_nums
        .get(1)
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(1);
    let new_start = new_nums.get(0)?.parse::<u32>().ok()?;
    let new_lines = new_nums
        .get(1)
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(1);

    Some((old_start, old_lines, new_start, new_lines))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UndoChangesOptions {
    pub repo_path: String,
    pub file_paths: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UndoChangesResult {
    pub restored_files: Vec<String>,
    pub skipped_files: Vec<String>,
    pub success: bool,
    pub message: String,
}

#[tauri::command]
pub fn undo_changes(options: UndoChangesOptions) -> Result<UndoChangesResult, String> {
    let repo = PathBuf::from(&options.repo_path);

    if !repo.join(".git").exists() {
        return Err(format!("Not a git repository: {}", options.repo_path));
    }

    if options.file_paths.is_empty() {
        return Err("Safety check failed: file_paths cannot be empty. You must explicitly specify which files to restore.".to_string());
    }

    let mut restored_files = Vec::new();
    let mut skipped_files = Vec::new();

    for file_path in &options.file_paths {
        let diff_output = git_command(&repo)
            .args(&["diff", "--", &file_path])
            .output()
            .map_err(|e| format!("Failed to check file status: {}", e))?;

        if diff_output.stdout.is_empty() {
            let staged_diff_output = git_command(&repo)
                .args(&["diff", "--cached", "--", &file_path])
                .output()
                .map_err(|e| format!("Failed to check staged file status: {}", e))?;

            if staged_diff_output.stdout.is_empty() {
                skipped_files.push(file_path.clone());
                continue;
            }
        }

        let restore_result = git_command(&repo)
            .args(&["restore", &file_path])
            .output();

        let success = match restore_result {
            Ok(output) => output.status.success(),
            Err(_) => {
                let checkout_output = git_command(&repo)
                    .args(&["checkout", "--", &file_path])
                    .output()
                    .map_err(|e| format!("Failed to restore file: {}", e))?;

                checkout_output.status.success()
            }
        };

        if success {
            restored_files.push(file_path.clone());
        } else {
            return Err(format!("Failed to restore file: {}", file_path));
        }
    }

    let message = if restored_files.is_empty() {
        "No files were restored (no changes detected)".to_string()
    } else {
        format!("Successfully restored {} file(s)", restored_files.len())
    };

    Ok(UndoChangesResult {
        restored_files,
        skipped_files,
        success: true,
        message,
    })
}
