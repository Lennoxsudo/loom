//! Git worktree isolation for subagents.

use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn git_command(repo: &Path) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(repo).env("LC_ALL", "C").env("LANG", "C");
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

fn home_dir() -> Result<PathBuf, String> {
    if cfg!(windows) {
        std::env::var("USERPROFILE")
            .map(PathBuf::from)
            .map_err(|_| "无法解析用户主目录".to_string())
    } else {
        std::env::var("HOME")
            .map(PathBuf::from)
            .map_err(|_| "无法解析用户主目录".to_string())
    }
}

#[tauri::command]
pub fn get_claude_user_agents_dir() -> Result<String, String> {
    let agents_dir = home_dir()?.join(".claude").join("agents");
    std::fs::create_dir_all(&agents_dir).map_err(|e| format!("创建 agents 目录失败: {}", e))?;
    Ok(agents_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_subagent_worktree(project_path: String) -> Result<String, String> {
    let repo = validate_repo(&project_path)?;
    let id = uuid::Uuid::new_v4().to_string();
    let short_id = &id[..8];
    let branch_name = format!("subagent/{}", short_id);
    let worktree_name = format!("loom-subagent-{}", short_id);

    let parent = repo
        .parent()
        .ok_or_else(|| "无法解析仓库父目录".to_string())?;
    let worktree_path = parent.join(worktree_name);

    if worktree_path.exists() {
        return Err(format!("工作树路径已存在: {}", worktree_path.display()));
    }

    let output = git_command(&repo)
        .args([
            "worktree",
            "add",
            "-b",
            &branch_name,
            worktree_path.to_str().unwrap_or_default(),
            "HEAD",
        ])
        .output()
        .map_err(|e| format!("无法执行 git worktree: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git worktree add 失败: {}", err.trim()));
    }

    Ok(worktree_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn cleanup_subagent_worktree(worktree_path: String, had_changes: bool) -> Result<(), String> {
    let path = PathBuf::from(&worktree_path);
    if !path.exists() {
        return Ok(());
    }

    let repo_git = path.join(".git");
    let repo_root = if repo_git.is_file() {
        let content = std::fs::read_to_string(&repo_git).map_err(|e| e.to_string())?;
        let gitdir_line = content
            .lines()
            .find(|l| l.starts_with("gitdir:"))
            .ok_or_else(|| "无效的 worktree .git 文件".to_string())?;
        let gitdir = gitdir_line
            .trim_start_matches("gitdir:")
            .trim()
            .replace('/', std::path::MAIN_SEPARATOR_STR);
        PathBuf::from(gitdir)
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.to_path_buf())
            .ok_or_else(|| "无法解析主仓库路径".to_string())?
    } else {
        return Err("路径不是 git worktree".to_string());
    };

    if had_changes {
        let _ = git_command(&repo_root)
            .args(["worktree", "remove", "--force", &worktree_path])
            .output();
    } else {
        let output = git_command(&repo_root)
            .args(["worktree", "remove", &worktree_path])
            .output()
            .map_err(|e| format!("无法执行 git worktree remove: {}", e))?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            let _ = git_command(&repo_root)
                .args(["worktree", "remove", "--force", &worktree_path])
                .output();
            if !err.is_empty() {
                return Err(format!("git worktree remove 失败: {}", err.trim()));
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn run_subagent_hooks(_event: String, _payload: serde_json::Value) -> Result<(), String> {
    // Lifecycle hook stub — full hook integration deferred to rules/hooks config.
    Ok(())
}
