//! Git 工作区 UI：状态、暂存、提交、分支、日志、合并冲突相关命令。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn git_command(repo: &Path) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(repo)
        .env("LC_ALL", "C")
        .env("LANG", "C");
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn validate_repo(repo_path: &str) -> Result<PathBuf, String> {
    let repo = PathBuf::from(repo_path);
    if !repo.is_dir() {
        return Err("无效的仓库路径".to_string());
    }
    if !repo.join(".git").exists() {
        return Err("当前目录不是 Git 仓库".to_string());
    }
    Ok(repo)
}

fn run_git(repo: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    git_command(repo)
        .args(args)
        .output()
        .map_err(|e| format!("无法执行 git: {}。请确认已安装 Git 并加入 PATH。", e))
}

fn git_stderr_message(output: &std::process::Output) -> String {
    let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let out = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !err.is_empty() {
        err
    } else if !out.is_empty() {
        out
    } else {
        "git 命令失败".to_string()
    }
}

/// 将用户传入的仓库内相对路径规范为 git 可用的相对路径（正斜杠），并防止目录穿越。
fn sanitize_repo_relative_paths(repo: &Path, paths: &[String]) -> Result<Vec<String>, String> {
    let canon_repo = repo
        .canonicalize()
        .map_err(|e| format!("无法解析仓库路径: {}", e))?;
    let mut out = Vec::new();
    for p in paths {
        if p.is_empty() {
            continue;
        }
        if p.contains("..") {
            return Err(format!("非法路径: {}", p));
        }
        let joined = repo.join(p);
        let canon = joined
            .canonicalize()
            .map_err(|_| format!("路径不存在或无法访问: {}", p))?;
        if !canon.starts_with(&canon_repo) {
            return Err(format!("路径越出仓库范围: {}", p));
        }
        let rel = canon
            .strip_prefix(&canon_repo)
            .map_err(|_| "无法计算相对路径".to_string())?;
        let rel_s = rel.to_string_lossy().replace('\\', "/");
        out.push(rel_s);
    }
    if out.is_empty() {
        return Err("路径列表为空".to_string());
    }
    Ok(out)
}

/// 与 `sanitize_repo_relative_paths` 类似，但不要求目标文件已存在于工作区（供 `git blame` / `git show` 使用）。
fn sanitize_repo_relative_path_for_git(repo: &Path, p: &str) -> Result<String, String> {
    let t = p.trim();
    if t.is_empty() {
        return Err("路径列表为空".to_string());
    }
    if t.contains("..") {
        return Err(format!("非法路径: {}", p));
    }
    let canon_repo = repo
        .canonicalize()
        .map_err(|e| format!("无法解析仓库路径: {}", e))?;
    let rel_s = t.replace('\\', "/");
    let joined = repo.join(&rel_s);
    if let Ok(canon) = joined.canonicalize() {
        if !canon.starts_with(&canon_repo) {
            return Err(format!("路径越出仓库范围: {}", p));
        }
        return Ok(rel_s);
    }
    if let Some(parent) = joined.parent() {
        let parent_canon = parent
            .canonicalize()
            .map_err(|_| format!("路径不存在或无法访问: {}", p))?;
        if !parent_canon.starts_with(&canon_repo) {
            return Err(format!("路径越出仓库范围: {}", p));
        }
        return Ok(rel_s);
    }
    Err(format!("路径不存在或无法访问: {}", p))
}

fn sanitize_branch_ref(name: &str) -> Result<String, String> {
    let t = name.trim();
    if t.is_empty() || t.len() > 240 {
        return Err("无效的分支名".to_string());
    }
    if t.contains('\n') || t.contains('\r') || t.contains("..") {
        return Err("无效的分支名".to_string());
    }
    Ok(t.to_string())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEntry {
    /// 原始状态行中的路径展示（含重命名 `a -> b`）
    pub display_path: String,
    /// 工作区中实际文件相对路径（用于打开文件）
    pub file_path: String,
    pub index_status: String,
    pub worktree_status: String,
    pub conflict: bool,
    pub untracked: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkspaceStatus {
    pub is_repo: bool,
    pub branch: String,
    pub upstream_name: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub merge_in_progress: bool,
    pub rebase_in_progress: bool,
    pub entries: Vec<GitStatusEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkspaceSnapshot {
    pub is_repo: bool,
    pub status: Option<GitWorkspaceStatus>,
    pub branches: Vec<GitBranchInfo>,
    pub commits: Vec<GitLogEntry>,
    pub conflicted: Vec<String>,
}

/// 规范化 `git status --porcelain` 中的路径：去掉首尾引号、统一正斜杠（配合 `core.quotePath=false` 可避免大部分异常编码）。
fn normalize_porcelain_path_segment(raw: &str) -> String {
    let t = raw.trim();
    let inner = if t.len() >= 2 && t.starts_with('"') && t.ends_with('"') && t.matches('"').count() == 2 {
        &t[1..t.len() - 1]
    } else {
        t
    };
    inner.replace('\\', "/")
}

fn parse_status_porcelain_line(line: &str) -> Option<GitStatusEntry> {
    let line = line.trim_end();
    if line.is_empty() {
        return None;
    }
    // 忽略 .gitignore 等 `!!` 行（极少数环境）
    if line.starts_with("!!") {
        return None;
    }
    let chars: Vec<char> = line.chars().collect();
    if chars.len() < 4 {
        return None;
    }
    let x = chars[0];
    let y = chars[1];
    if chars[2] != ' ' {
        return None;
    }
    let rest = line[3..].trim();
    if rest.is_empty() {
        return None;
    }

    let (file_path, display_path) = if let Some(idx) = rest.find(" -> ") {
        let old_raw = rest[..idx].trim();
        let new_raw = rest[idx + 4..].trim();
        let new_p = normalize_porcelain_path_segment(new_raw);
        (new_p, format!("{} -> {}", old_raw, new_raw))
    } else {
        let p = normalize_porcelain_path_segment(rest);
        let disp = normalize_porcelain_path_segment(rest);
        (p, disp)
    };

    let untracked = x == '?' && y == '?';
    let conflict =
        x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D');

    Some(GitStatusEntry {
        display_path,
        file_path,
        index_status: x.to_string(),
        worktree_status: y.to_string(),
        conflict,
        untracked,
    })
}

fn read_branch(repo: &Path) -> String {
    let out = git_command(repo)
        .args(["branch", "--show-current"])
        .output();
    match out {
        Ok(o) if o.status.success() => {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if s.is_empty() {
                "(detached)".to_string()
            } else {
                s
            }
        }
        _ => "(unknown)".to_string(),
    }
}

fn upstream_ahead_behind(repo: &Path) -> (Option<String>, u32, u32) {
    let up = git_command(repo)
        .args(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        .output();
    let Ok(up_out) = up else {
        return (None, 0, 0);
    };
    if !up_out.status.success() {
        return (None, 0, 0);
    }
    let upstream = String::from_utf8_lossy(&up_out.stdout).trim().to_string();
    if upstream.is_empty() || upstream == "@{u}" {
        return (None, 0, 0);
    }

    let ahead = git_command(repo)
        .args(["rev-list", "--count", &format!("{}..HEAD", upstream)])
        .output();
    let behind = git_command(repo)
        .args(["rev-list", "--count", &format!("HEAD..{}", upstream)])
        .output();

    let a = ahead
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse().ok())
        .unwrap_or(0);
    let b = behind
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse().ok())
        .unwrap_or(0);

    (Some(upstream), a, b)
}

fn merge_rebase_flags(repo: &Path) -> (bool, bool) {
    let git_dir = if let Ok(out) = git_command(repo)
        .args(["rev-parse", "--git-dir"])
        .output()
    {
        if out.status.success() {
            let rel = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !rel.is_empty() {
                Some(repo.join(rel))
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let Some(git_dir) = git_dir else {
        return (false, false);
    };
    let merge = git_dir.join("MERGE_HEAD").exists();
    let rebase = git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists();
    (merge, rebase)
}

#[tauri::command]
pub fn git_workspace_status(repo_path: String) -> Result<GitWorkspaceStatus, String> {
    let repo = validate_repo(&repo_path)?;

    let status_out = run_git(&repo, &[
        "-c",
        "core.quotePath=false",
        "status",
        "--porcelain=v1",
    ])?;
    if !status_out.status.success() {
        return Err(git_stderr_message(&status_out));
    }

    let mut entries = Vec::new();
    let text = String::from_utf8_lossy(&status_out.stdout);
    for line in text.lines() {
        if let Some(e) = parse_status_porcelain_line(line) {
            entries.push(e);
        }
    }

    let branch = read_branch(&repo);
    let (upstream_name, ahead, behind) = upstream_ahead_behind(&repo);
    let (merge_in_progress, rebase_in_progress) = merge_rebase_flags(&repo);

    Ok(GitWorkspaceStatus {
        is_repo: true,
        branch,
        upstream_name,
        ahead,
        behind,
        merge_in_progress,
        rebase_in_progress,
        entries,
    })
}

fn build_git_workspace_snapshot(
    repo_path: String,
    limit: Option<u32>,
) -> Result<GitWorkspaceSnapshot, String> {
    let repo = validate_repo(&repo_path)?;
    let status = git_workspace_status(repo_path.clone())?;
    let branches = git_workspace_list_branches(repo_path.clone())
        .map(|result| result.branches)
        .unwrap_or_default();
    let commits = git_workspace_log(repo_path.clone(), limit)?.commits;
    let conflicted = if status.merge_in_progress || status.rebase_in_progress {
        git_workspace_list_conflicted(repo_path)?.into_iter().collect()
    } else {
        Vec::new()
    };

    let _ = repo;

    Ok(GitWorkspaceSnapshot {
        is_repo: true,
        status: Some(status),
        branches,
        commits,
        conflicted,
    })
}

#[tauri::command]
pub async fn git_workspace_snapshot(
    repo_path: String,
    limit: Option<u32>,
) -> Result<GitWorkspaceSnapshot, String> {
    tokio::task::spawn_blocking(move || match validate_repo(&repo_path) {
        Ok(_) => build_git_workspace_snapshot(repo_path, limit),
        Err(_) => Ok(GitWorkspaceSnapshot {
            is_repo: false,
            status: None,
            branches: Vec::new(),
            commits: Vec::new(),
            conflicted: Vec::new(),
        }),
    })
    .await
    .map_err(|e| format!("git workspace snapshot task failed: {}", e))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPathsOptions {
    pub repo_path: String,
    pub paths: Vec<String>,
}

#[tauri::command]
pub fn git_workspace_stage(options: GitPathsOptions) -> Result<(), String> {
    let repo = validate_repo(&options.repo_path)?;
    let paths = sanitize_repo_relative_paths(&repo, &options.paths)?;
    let mut args: Vec<String> = vec!["add".into(), "--".into()];
    args.extend(paths);
    let status = git_command(&repo)
        .args(&args.iter().map(|s| s.as_str()).collect::<Vec<_>>())
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("git add 失败".to_string())
    }
}

#[tauri::command]
pub fn git_workspace_unstage(options: GitPathsOptions) -> Result<(), String> {
    let repo = validate_repo(&options.repo_path)?;
    let paths = sanitize_repo_relative_paths(&repo, &options.paths)?;
    let mut args: Vec<String> = vec!["restore".into(), "--staged".into(), "--".into()];
    args.extend(paths.clone());
    let st = git_command(&repo)
        .args(&args.iter().map(|s| s.as_str()).collect::<Vec<_>>())
        .status();
    match st {
        Ok(s) if s.success() => Ok(()),
        _ => {
            let mut alt: Vec<String> = vec!["reset".into(), "-q".into(), "HEAD".into(), "--".into()];
            alt.extend(paths);
            let st2 = git_command(&repo)
                .args(&alt.iter().map(|s| s.as_str()).collect::<Vec<_>>())
                .status()
                .map_err(|e| e.to_string())?;
            if st2.success() {
                Ok(())
            } else {
                Err("取消暂存失败".to_string())
            }
        }
    }
}

#[tauri::command]
pub fn git_workspace_stage_all(repo_path: String) -> Result<(), String> {
    let repo = validate_repo(&repo_path)?;
    let out = run_git(&repo, &["add", "-A"])?;
    if out.status.success() {
        Ok(())
    } else {
        Err(git_stderr_message(&out))
    }
}

#[tauri::command]
pub fn git_workspace_unstage_all(repo_path: String) -> Result<(), String> {
    let repo = validate_repo(&repo_path)?;
    let out = run_git(&repo, &["restore", "--staged", "."])?;
    if out.status.success() {
        Ok(())
    } else {
        let out2 = run_git(&repo, &["reset", "-q", "HEAD", "."])?;
        if out2.status.success() {
            Ok(())
        } else {
            Err(git_stderr_message(&out2))
        }
    }
}

#[tauri::command]
pub fn git_workspace_discard_all(repo_path: String) -> Result<(), String> {
    let repo = validate_repo(&repo_path)?;

    let _ = git_workspace_unstage_all(repo_path.clone());

    let out = run_git(&repo, &["restore", "."])?;
    if out.status.success() {
        Ok(())
    } else {
        let out2 = run_git(&repo, &["checkout", "--", "."])?;
        if out2.status.success() {
            Ok(())
        } else {
            Err(git_stderr_message(&out2))
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitOptions {
    pub repo_path: String,
    pub message: String,
}

#[tauri::command]
pub fn git_workspace_commit(options: GitCommitOptions) -> Result<(), String> {
    let repo = validate_repo(&options.repo_path)?;
    let msg = options.message.trim();
    if msg.is_empty() {
        return Err("提交说明不能为空".to_string());
    }
    if msg.len() > 50_000 {
        return Err("提交说明过长".to_string());
    }
    let out = git_command(&repo)
        .args(["commit", "-m", msg])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(git_stderr_message(&out))
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchesResult {
    pub branches: Vec<GitBranchInfo>,
}

#[tauri::command]
pub fn git_workspace_list_branches(repo_path: String) -> Result<GitBranchesResult, String> {
    let repo = validate_repo(&repo_path)?;
    let out = run_git(&repo, &["branch", "-a", "--no-color"])?;
    if !out.status.success() {
        return Err(git_stderr_message(&out));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut branches = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let is_current = line.starts_with('*');
        let rest = line.trim_start_matches('*').trim();
        if rest.is_empty() {
            continue;
        }
        // 跳过 detached HEAD 提示行
        if rest.starts_with('(') {
            continue;
        }
        let is_remote = rest.starts_with("remotes/");
        branches.push(GitBranchInfo {
            name: rest.to_string(),
            is_current,
            is_remote,
        });
    }
    Ok(GitBranchesResult { branches })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCheckoutOptions {
    pub repo_path: String,
    pub branch: String,
}

#[tauri::command]
pub fn git_workspace_checkout(options: GitCheckoutOptions) -> Result<(), String> {
    let repo = validate_repo(&options.repo_path)?;
    let b = sanitize_branch_ref(&options.branch)?;

    // remotes/origin/foo -> 尝试创建本地 foo 跟踪
    let mut out = if b.starts_with("remotes/") {
        let short = b.strip_prefix("remotes/").unwrap_or(&b);
        let local_name = short
            .rsplit_once('/')
            .map(|(_, name)| name.to_string())
            .unwrap_or_else(|| short.to_string());
        git_command(&repo)
            .args(["switch", "-c", &local_name, &b])
            .output()
    } else {
        git_command(&repo)
            .args(["switch", &b])
            .output()
    };

    if let Ok(ref o) = out {
        if o.status.success() {
            return Ok(());
        }
    }

    // 回退 git checkout
    out = if b.starts_with("remotes/") {
        let short = b.strip_prefix("remotes/").unwrap_or(&b);
        let local_name = short
            .rsplit_once('/')
            .map(|(_, name)| name.to_string())
            .unwrap_or_else(|| short.to_string());
        git_command(&repo)
            .args(["checkout", "-b", &local_name, &b])
            .output()
    } else {
        git_command(&repo)
            .args(["checkout", &b])
            .output()
    };

    match out {
        Ok(o) if o.status.success() => Ok(()),
        Ok(o) => Err(git_stderr_message(&o)),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitLogEntry {
    pub hash: String,
    pub subject: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogResult {
    pub commits: Vec<GitLogEntry>,
}

#[tauri::command]
pub fn git_workspace_log(repo_path: String, limit: Option<u32>) -> Result<GitLogResult, String> {
    let repo = validate_repo(&repo_path)?;
    let n = limit.unwrap_or(40).min(200);
    let n_str = n.to_string();
    let pretty = format!(
        "--pretty=format:%H{sep}%s{sep}%an{sep}%ai",
        sep = '\x1f'
    );
    let out = git_command(&repo)
        .args(["log", "-n", n_str.as_str(), pretty.as_str()])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(git_stderr_message(&out));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut commits = Vec::new();
    for line in text.lines() {
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('\x1f').collect();
        if parts.len() >= 4 {
            commits.push(GitLogEntry {
                hash: parts[0].to_string(),
                subject: parts[1].to_string(),
                author: parts[2].to_string(),
                date: parts[3].to_string(),
            });
        }
    }
    Ok(GitLogResult { commits })
}

#[tauri::command]
pub fn git_workspace_abort_merge(repo_path: String) -> Result<(), String> {
    let repo = validate_repo(&repo_path)?;
    let out = run_git(&repo, &["merge", "--abort"])?;
    if out.status.success() {
        return Ok(());
    }
    let out2 = run_git(&repo, &["rebase", "--abort"])?;
    if out2.status.success() {
        Ok(())
    } else {
        Err(git_stderr_message(&out))
    }
}

#[tauri::command]
pub fn git_workspace_merge_continue(repo_path: String) -> Result<(), String> {
    let repo = validate_repo(&repo_path)?;
    let (_, rebase) = merge_rebase_flags(&repo);
    let out = if rebase {
        git_command(&repo)
            .args(["rebase", "--continue"])
            .output()
    } else {
        git_command(&repo)
            .args(["merge", "--continue", "--no-edit"])
            .output()
    }
    .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(git_stderr_message(&out))
    }
}

#[tauri::command]
pub fn git_workspace_list_conflicted(repo_path: String) -> Result<Vec<String>, String> {
    let repo = validate_repo(&repo_path)?;
    let out = run_git(&repo, &["diff", "--name-only", "--diff-filter=U"])?;
    if !out.status.success() {
        return Err(git_stderr_message(&out));
    }
    let files: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    Ok(files)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPrepareDiffOptions {
    pub repo_path: String,
    pub file_path: String,
    pub kind: String,
    pub commit_hash: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPreparedDiff {
    pub original_content: String,
    pub modified_content: String,
}

fn read_git_blob(repo: &Path, rel: &str, source: &str) -> Result<String, String> {
    match source {
        "head" => {
            let spec = format!("HEAD:{}", rel.replace('\\', "/"));
            let out = git_command(repo)
                .args(["show", &spec])
                .output()
                .map_err(|e| e.to_string())?;
            if out.status.success() {
                Ok(String::from_utf8_lossy(&out.stdout).to_string())
            } else {
                Ok(String::new())
            }
        }
        "index" => {
            let out = git_command(repo)
                .args(["ls-files", "-s", "--", rel])
                .output()
                .map_err(|e| e.to_string())?;
            if !out.status.success() {
                return Ok(String::new());
            }
            let line = String::from_utf8_lossy(&out.stdout);
            let first = line.lines().next().unwrap_or("").trim();
            if first.is_empty() {
                return Ok(String::new());
            }
            let parts: Vec<&str> = first.split_whitespace().collect();
            if parts.len() < 2 {
                return Ok(String::new());
            }
            let oid = parts[1];
            let blob = git_command(repo)
                .args(["cat-file", "-p", oid])
                .output()
                .map_err(|e| e.to_string())?;
            if blob.status.success() {
                Ok(String::from_utf8_lossy(&blob.stdout).to_string())
            } else {
                Ok(String::new())
            }
        }
        _ => Err("source must be head or index".to_string()),
    }
}

fn read_git_show_blob(repo: &Path, rev: &str, rel: &str) -> Result<String, String> {
    let spec = format!("{}:{}", rev, rel.replace('\\', "/"));
    let out = git_command(repo)
        .args(["show", &spec])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Ok(String::new())
    }
}

fn validate_commit_hash(hash: &str) -> Result<String, String> {
    let t = hash.trim();
    if t.len() < 7 || t.len() > 40 {
        return Err("无效的提交哈希".to_string());
    }
    if !t.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("无效的提交哈希".to_string());
    }
    Ok(t.to_string())
}

fn stash_ref(index: u32) -> String {
    format!("stash@{{{}}}", index)
}

fn read_git_output_limited(repo: &Path, args: &[&str]) -> Result<(String, bool), String> {
    use std::io::Read;
    use std::process::Stdio;

    let mut cmd = git_command(repo);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("无法执行 git: {}", e))?;

    let mut output_bytes = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        let mut handle = stdout.take(crate::git_diff::MAX_DIFF_BYTES as u64 + 1);
        handle
            .read_to_end(&mut output_bytes)
            .map_err(|e| format!("读取 git 输出失败: {}", e))?;
    }

    let is_truncated = output_bytes.len() > crate::git_diff::MAX_DIFF_BYTES;
    if is_truncated {
        let _ = child.kill();
        output_bytes.truncate(crate::git_diff::MAX_DIFF_BYTES);
    }

    let status = child
        .wait()
        .map_err(|e| format!("等待 git 进程失败: {}", e))?;

    if !status.success() && !is_truncated {
        let mut stderr = String::new();
        if let Some(mut err_handle) = child.stderr.take() {
            let _ = err_handle.read_to_string(&mut stderr);
        }
        return Err(if stderr.trim().is_empty() {
            "git 命令失败".to_string()
        } else {
            stderr.trim().to_string()
        });
    }

    Ok((String::from_utf8_lossy(&output_bytes).to_string(), is_truncated))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub commit_hash: String,
    pub author: String,
    pub date: String,
    pub line_no: u32,
    pub content: String,
}

fn parse_blame_porcelain(stdout: &str) -> Vec<BlameLine> {
    let mut lines_out = Vec::new();
    let mut current_hash = String::new();
    let mut current_line_no: u32 = 0;
    let mut meta_by_hash: HashMap<String, (String, String)> = HashMap::new();

    for line in stdout.lines() {
        if line.starts_with('\t') {
            let (author, date) = meta_by_hash
                .get(&current_hash)
                .cloned()
                .unwrap_or_else(|| (String::new(), String::new()));
            lines_out.push(BlameLine {
                commit_hash: current_hash.clone(),
                author,
                date,
                line_no: current_line_no,
                content: line[1..].to_string(),
            });
            continue;
        }

        if line.len() >= 40 && line.chars().take(40).all(|c| c.is_ascii_hexdigit()) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 {
                current_hash = parts[0].to_string();
                if let Ok(n) = parts[2].parse::<u32>() {
                    current_line_no = n;
                }
            }
            continue;
        }

        if let Some(rest) = line.strip_prefix("author ") {
            if !rest.starts_with('<') && !current_hash.is_empty() {
                meta_by_hash
                    .entry(current_hash.clone())
                    .or_insert((String::new(), String::new()))
                    .0 = rest.to_string();
            }
            continue;
        }

        if let Some(rest) = line.strip_prefix("author-time ") {
            if !current_hash.is_empty() {
                meta_by_hash
                    .entry(current_hash.clone())
                    .or_insert((String::new(), String::new()))
                    .1 = rest.to_string();
            }
        }
    }

    lines_out
}

#[tauri::command]
pub async fn git_workspace_blame(
    repo_path: String,
    file_path: String,
) -> Result<Vec<BlameLine>, String> {
    tokio::task::spawn_blocking(move || {
        let repo = validate_repo(&repo_path)?;
        let rel = sanitize_repo_relative_path_for_git(&repo, &file_path)?;

        let out = run_git(&repo, &["blame", "--porcelain", "--", &rel])?;
        if !out.status.success() {
            return Err(git_stderr_message(&out));
        }

        Ok(parse_blame_porcelain(&String::from_utf8_lossy(&out.stdout)))
    })
    .await
    .map_err(|e| format!("git workspace blame task failed: {}", e))?
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitMeta {
    pub hash: String,
    pub subject: String,
    pub author: String,
    pub date: String,
    pub body: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFileSummary {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDetail {
    pub meta: GitCommitMeta,
    pub files: Vec<GitCommitFileSummary>,
    pub truncated: bool,
    pub truncated_info: Option<String>,
}

fn parse_commit_show_meta(stdout: &str) -> Result<GitCommitMeta, String> {
    let trimmed = stdout.trim_end();
    let parts: Vec<&str> = trimmed.split('\x1f').collect();
    if parts.len() < 4 {
        return Err("无法解析提交元数据".to_string());
    }
    let body = parts
        .get(4)
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    Ok(GitCommitMeta {
        hash: parts[0].to_string(),
        subject: parts[1].to_string(),
        author: parts[2].to_string(),
        date: parts[3].to_string(),
        body,
    })
}

fn build_commit_detail(
    repo: &Path,
    hash: &str,
    max_lines: u32,
) -> Result<GitCommitDetail, String> {
    let pretty = format!(
        "--pretty=format:%H{sep}%s{sep}%an{sep}%ai{sep}%b",
        sep = '\x1f'
    );
    let meta_out = git_command(repo)
        .args(["show", "-s", pretty.as_str()])
        .arg(hash)
        .output()
        .map_err(|e| e.to_string())?;
    if !meta_out.status.success() {
        return Err(git_stderr_message(&meta_out));
    }

    let meta = parse_commit_show_meta(&String::from_utf8_lossy(&meta_out.stdout))?;

    let (diff_output, diff_truncated) = read_git_output_limited(
        repo,
        &[
            "-c",
            "core.quotePath=false",
            "show",
            hash,
            "--first-parent",
            "--pretty=format:",
            "-p",
            "--no-color",
        ],
    )?;

    let numstat_out = git_command(repo)
        .args([
            "-c",
            "core.quotePath=false",
            "show",
            hash,
            "--first-parent",
            "--pretty=format:",
            "--numstat",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    let numstat = if numstat_out.status.success() {
        String::from_utf8_lossy(&numstat_out.stdout).to_string()
    } else {
        String::new()
    };

    let parsed = crate::git_diff::parse_git_diff(&diff_output, &numstat, max_lines, None)?;
    let files: Vec<GitCommitFileSummary> = parsed
        .files
        .into_iter()
        .map(|f| GitCommitFileSummary {
            path: f.path,
            old_path: f.old_path,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
        })
        .collect();

    let mut truncated = parsed.truncated || diff_truncated;
    let mut truncated_info = parsed.truncated_info;
    if diff_truncated {
        truncated = true;
        truncated_info = Some(format!(
            "diff 输出超过 {} 字节限制，已截断",
            crate::git_diff::MAX_DIFF_BYTES
        ));
    }

    Ok(GitCommitDetail {
        meta,
        files,
        truncated,
        truncated_info,
    })
}

#[tauri::command]
pub async fn git_workspace_commit_detail(
    repo_path: String,
    hash: String,
    limit: Option<u32>,
) -> Result<GitCommitDetail, String> {
    tokio::task::spawn_blocking(move || {
        let repo = validate_repo(&repo_path)?;
        let hash = validate_commit_hash(&hash)?;
        let max_lines = limit.unwrap_or(1000);
        build_commit_detail(&repo, &hash, max_lines)
    })
    .await
    .map_err(|e| format!("git workspace commit detail task failed: {}", e))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCreateBranchOptions {
    pub repo_path: String,
    pub name: String,
    pub start_point: Option<String>,
}

#[tauri::command]
pub fn git_workspace_create_branch(options: GitCreateBranchOptions) -> Result<(), String> {
    let repo = validate_repo(&options.repo_path)?;
    let name = sanitize_branch_ref(&options.name)?;

    let resolved_start = if let Some(ref start) = options.start_point {
        let start = start.trim();
        if start.is_empty() {
            return Err("无效的起始引用".to_string());
        } else if start.chars().all(|c| c.is_ascii_hexdigit()) && start.len() >= 7 && start.len() <= 40
        {
            Some(validate_commit_hash(start)?)
        } else {
            Some(sanitize_branch_ref(start)?)
        }
    } else {
        None
    };

    let out = if let Some(ref start) = resolved_start {
        git_command(&repo)
            .args(["switch", "-c", &name, start])
            .output()
    } else {
        git_command(&repo)
            .args(["switch", "-c", &name])
            .output()
    }
    .map_err(|e| e.to_string())?;

    if out.status.success() {
        return Ok(());
    }

    let out2 = if let Some(ref start) = resolved_start {
        git_command(&repo)
            .args(["branch", &name, start])
            .output()
    } else {
        git_command(&repo).args(["branch", &name]).output()
    }
    .map_err(|e| e.to_string())?;

    if out2.status.success() {
        Ok(())
    } else {
        Err(git_stderr_message(&out2))
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDeleteBranchOptions {
    pub repo_path: String,
    pub name: String,
    pub force: Option<bool>,
}

#[tauri::command]
pub fn git_workspace_delete_branch(options: GitDeleteBranchOptions) -> Result<(), String> {
    let repo = validate_repo(&options.repo_path)?;
    let name = sanitize_branch_ref(&options.name)?;
    if name.starts_with("remotes/") {
        return Err("不能删除远程分支引用".to_string());
    }
    let current = read_branch(&repo);
    if current == name {
        return Err("不能删除当前分支".to_string());
    }
    let flag = if options.force.unwrap_or(false) {
        "-D"
    } else {
        "-d"
    };
    let out = run_git(&repo, &["branch", flag, &name])?;
    if out.status.success() {
        Ok(())
    } else {
        Err(git_stderr_message(&out))
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRenameBranchOptions {
    pub repo_path: String,
    pub new_name: String,
}

#[tauri::command]
pub fn git_workspace_rename_branch(options: GitRenameBranchOptions) -> Result<(), String> {
    let repo = validate_repo(&options.repo_path)?;
    let new_name = sanitize_branch_ref(&options.new_name)?;
    let out = run_git(&repo, &["branch", "-m", &new_name])?;
    if out.status.success() {
        Ok(())
    } else {
        Err(git_stderr_message(&out))
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashSaveOptions {
    pub repo_path: String,
    pub message: Option<String>,
}

#[tauri::command]
pub fn git_workspace_stash_save(options: GitStashSaveOptions) -> Result<(), String> {
    let repo = validate_repo(&options.repo_path)?;
    let out = if let Some(ref msg) = options.message {
        let m = msg.trim();
        if m.is_empty() {
            run_git(&repo, &["stash", "push"])?
        } else if m.len() > 5000 {
            return Err("stash 说明过长".to_string());
        } else {
            run_git(&repo, &["stash", "push", "-m", m])?
        }
    } else {
        run_git(&repo, &["stash", "push"])?
    };
    if out.status.success() {
        Ok(())
    } else {
        Err(git_stderr_message(&out))
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitStashEntry {
    pub index: u32,
    pub message: String,
    pub branch: String,
    pub date: String,
}

#[tauri::command]
pub fn git_workspace_stash_list(repo_path: String) -> Result<Vec<GitStashEntry>, String> {
    let repo = validate_repo(&repo_path)?;
    let pretty = format!(
        "--format=%gd{sep}%gs{sep}%ci",
        sep = '\x1f'
    );
    let out = git_command(&repo)
        .args(["stash", "list", pretty.as_str()])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(git_stderr_message(&out));
    }

    let mut entries = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('\x1f').collect();
        if parts.len() < 3 {
            continue;
        }
        let ref_part = parts[0].trim();
        let index = ref_part
            .strip_prefix("stash@{")
            .and_then(|s| s.strip_suffix('}'))
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(entries.len() as u32);
        entries.push(GitStashEntry {
            index,
            message: parts[1].to_string(),
            branch: String::new(),
            date: parts[2].to_string(),
        });
    }
    Ok(entries)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashIndexOptions {
    pub repo_path: String,
    pub index: u32,
}

#[tauri::command]
pub fn git_workspace_stash_pop(options: GitStashIndexOptions) -> Result<(), String> {
    let repo = validate_repo(&options.repo_path)?;
    let stash = stash_ref(options.index);
    let out = run_git(&repo, &["stash", "pop", &stash])?;
    if out.status.success() {
        Ok(())
    } else {
        Err(git_stderr_message(&out))
    }
}

#[tauri::command]
pub fn git_workspace_stash_apply(options: GitStashIndexOptions) -> Result<(), String> {
    let repo = validate_repo(&options.repo_path)?;
    let stash = stash_ref(options.index);
    let out = run_git(&repo, &["stash", "apply", &stash])?;
    if out.status.success() {
        Ok(())
    } else {
        Err(git_stderr_message(&out))
    }
}

#[tauri::command]
pub fn git_workspace_stash_drop(options: GitStashIndexOptions) -> Result<(), String> {
    let repo = validate_repo(&options.repo_path)?;
    let stash = stash_ref(options.index);
    let out = run_git(&repo, &["stash", "drop", &stash])?;
    if out.status.success() {
        Ok(())
    } else {
        Err(git_stderr_message(&out))
    }
}

#[tauri::command]
pub async fn git_workspace_prepare_diff(
    options: GitPrepareDiffOptions,
) -> Result<GitPreparedDiff, String> {
    tokio::task::spawn_blocking(move || {
        let repo = validate_repo(&options.repo_path)?;
        let paths = sanitize_repo_relative_paths(&repo, &[options.file_path.clone()])?;
        let rel = paths
            .into_iter()
            .next()
            .ok_or_else(|| "file path is empty".to_string())?;
        let abs = repo.join(&rel);

        match options.kind.as_str() {
            "staged" => Ok(GitPreparedDiff {
                original_content: read_git_blob(&repo, &rel, "head")?,
                modified_content: read_git_blob(&repo, &rel, "index")?,
            }),
            "unstaged" => Ok(GitPreparedDiff {
                original_content: read_git_blob(&repo, &rel, "index")?,
                modified_content: fs::read_to_string(&abs).unwrap_or_default(),
            }),
            "untracked" => Ok(GitPreparedDiff {
                original_content: String::new(),
                modified_content: fs::read_to_string(&abs).unwrap_or_default(),
            }),
            "commit" => {
                let hash = options
                    .commit_hash
                    .as_deref()
                    .ok_or_else(|| "commit_hash is required for commit diff".to_string())?;
                let hash = validate_commit_hash(hash)?;
                let parent_spec = format!("{}^", hash);
                let original = read_git_show_blob(&repo, &parent_spec, &rel)?;
                let modified = read_git_show_blob(&repo, &hash, &rel)?;
                Ok(GitPreparedDiff {
                    original_content: original,
                    modified_content: modified,
                })
            }
            _ => Err("kind must be staged, unstaged, untracked, or commit".to_string()),
        }
    })
    .await
    .map_err(|e| format!("git workspace prepare diff task failed: {}", e))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushOptions {
    pub repo_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSyncRemoteResult {
    pub pulled: bool,
    pub pushed: bool,
    pub ahead: u32,
    pub behind: u32,
}

/// `git push`（使用当前分支已配置的 upstream；首次推送需在命令行设置或使用带 `-u` 的推送）。
#[tauri::command]
pub fn git_workspace_push(options: GitPushOptions) -> Result<(), String> {
    let repo = validate_repo(&options.repo_path)?;
    let out = run_git(&repo, &["push"])?;
    if out.status.success() {
        Ok(())
    } else {
        Err(git_stderr_message(&out))
    }
}

#[tauri::command]
pub async fn git_workspace_sync_remote(
    options: GitPushOptions,
) -> Result<GitSyncRemoteResult, String> {
    tokio::task::spawn_blocking(move || {
        let repo = validate_repo(&options.repo_path)?;

        let fetch = run_git(&repo, &["fetch", "--prune"])?;
        if !fetch.status.success() {
            return Err(git_stderr_message(&fetch));
        }

        let (upstream_name, mut ahead, mut behind) = upstream_ahead_behind(&repo);
        if upstream_name.is_none() {
            return Err("No upstream branch configured for the current branch.".to_string());
        }

        let mut pulled = false;
        let mut pushed = false;

        if behind > 0 {
            let pull_args: &[&str] = if ahead > 0 {
                &["pull", "--rebase"]
            } else {
                &["pull", "--ff-only"]
            };
            let pull = run_git(&repo, pull_args)?;
            if !pull.status.success() {
                return Err(git_stderr_message(&pull));
            }
            pulled = true;
            let (_, next_ahead, next_behind) = upstream_ahead_behind(&repo);
            ahead = next_ahead;
            behind = next_behind;
        }

        if ahead > 0 {
            let push = run_git(&repo, &["push"])?;
            if !push.status.success() {
                return Err(git_stderr_message(&push));
            }
            pushed = true;
            let (_, next_ahead, next_behind) = upstream_ahead_behind(&repo);
            ahead = next_ahead;
            behind = next_behind;
        }

        Ok(GitSyncRemoteResult {
            pulled,
            pushed,
            ahead,
            behind,
        })
    })
    .await
    .map_err(|e| format!("git workspace sync remote task failed: {}", e))?
}

/// 撤销最近一次提交，改动保留在暂存区（`git reset --soft HEAD~1`）。已推送的提交请勿使用。
#[tauri::command]
pub fn git_workspace_undo_last_commit(repo_path: String) -> Result<(), String> {
    let repo = validate_repo(&repo_path)?;
    let out = run_git(&repo, &["reset", "--soft", "HEAD~1"])?;
    if out.status.success() {
        Ok(())
    } else {
        Err(git_stderr_message(&out))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_commit_hash_accepts_short_and_full() {
        assert!(validate_commit_hash("abc1234").is_ok());
        assert!(validate_commit_hash("abcdef0123456789abcdef0123456789abcdef0").is_ok());
    }

    #[test]
    fn validate_commit_hash_rejects_invalid() {
        assert!(validate_commit_hash("abc").is_err());
        assert!(validate_commit_hash("ghijklm").is_err());
        assert!(validate_commit_hash("abc1234; rm -rf").is_err());
    }

    #[test]
    fn sanitize_branch_ref_rejects_traversal() {
        assert!(sanitize_branch_ref("feature/../main").is_err());
        assert!(sanitize_branch_ref("").is_err());
    }

    #[test]
    fn parse_blame_porcelain_extracts_lines() {
        let sample = "\
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 2 1
author Alice
author-time 1700000000
filename src/foo.ts
\tconst x = 1;
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2 3 1
author Bob
author-time 1700000100
filename src/foo.ts
\tconst y = 2;
";
        let lines = parse_blame_porcelain(sample);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].commit_hash, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        assert_eq!(lines[0].author, "Alice");
        assert_eq!(lines[0].line_no, 2);
        assert_eq!(lines[0].content, "const x = 1;");
        assert_eq!(lines[1].author, "Bob");
        assert_eq!(lines[1].content, "const y = 2;");
    }

    #[test]
    fn parse_blame_porcelain_reuses_cached_meta_for_repeated_commit() {
        let sample = "\
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1
author Alice
author-time 1700000000
filename src/foo.ts
\tline a1
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 1 2 1
author Bob
author-time 1700000100
filename src/foo.ts
\tline b1
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 3 1
\tline a2
";
        let lines = parse_blame_porcelain(sample);
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].author, "Alice");
        assert_eq!(lines[0].date, "1700000000");
        assert_eq!(lines[1].author, "Bob");
        assert_eq!(lines[1].date, "1700000100");
        assert_eq!(lines[2].commit_hash, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        assert_eq!(lines[2].author, "Alice");
        assert_eq!(lines[2].date, "1700000000");
        assert_eq!(lines[2].content, "line a2");
    }

    #[test]
    fn parse_commit_show_meta_preserves_multiline_body() {
        let stdout = format!(
            "abc1234{sep}subject{sep}Author{sep}2024-01-01 12:00:00 +0800{sep}line one\nline two\nline three",
            sep = '\x1f'
        );
        let meta = parse_commit_show_meta(&stdout).expect("parse meta");
        assert_eq!(meta.hash, "abc1234");
        assert_eq!(meta.body.as_deref(), Some("line one\nline two\nline three"));
    }

    /// Merge commits: `git show` without `--first-parent` yields empty diff/numstat.
    /// build_commit_detail passes `--first-parent`; this sample is typical first-parent patch output.
    #[test]
    fn parse_git_diff_accepts_first_parent_merge_style_patch() {
        let diff = "\
diff --git a/src/lib.rs b/src/lib.rs
index 1111111..2222222 100644
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,4 @@
 fn main() {
+    println!(\"merged\");
 }
";
        let numstat = "1\t0\tsrc/lib.rs";
        let parsed = crate::git_diff::parse_git_diff(diff, numstat, 1000, None).expect("parse");
        assert_eq!(parsed.files.len(), 1);
        assert_eq!(parsed.files[0].path, "src/lib.rs");
        assert_eq!(parsed.files[0].additions, 1);
    }

    /// With `core.quotePath=false`, git numstat uses literal UTF-8 paths (not octal escapes).
    #[test]
    fn parse_git_diff_preserves_non_ascii_numstat_path() {
        let diff = "\
diff --git a/src/你好.ts b/src/你好.ts
index 1111111..2222222 100644
--- a/src/你好.ts
+++ b/src/你好.ts
@@ -1 +1,2 @@
 line
+added
";
        let numstat = "1\t0\tsrc/你好.ts";
        let parsed = crate::git_diff::parse_git_diff(diff, numstat, 1000, None).expect("parse");
        assert_eq!(parsed.files.len(), 1);
        assert_eq!(parsed.files[0].path, "src/你好.ts");
        assert_eq!(parsed.files[0].additions, 1);
    }
}
