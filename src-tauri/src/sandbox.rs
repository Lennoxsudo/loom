use serde::Deserialize;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxContext {
    pub access_mode: String,
    pub writable_roots: Vec<String>,
    pub network_enabled: bool,
}

impl Default for SandboxContext {
    fn default() -> Self {
        Self {
            access_mode: "auto".to_string(),
            writable_roots: Vec::new(),
            network_enabled: false,
        }
    }
}

pub struct SandboxState {
    pub context: Mutex<SandboxContext>,
}

impl Default for SandboxState {
    fn default() -> Self {
        Self {
            context: Mutex::new(SandboxContext::default()),
        }
    }
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
        }
    }
    normalized
}

fn path_within_roots(path: &Path, roots: &[String]) -> bool {
    if roots.is_empty() {
        return true;
    }

    let normalized_path = normalize_path(path);
    roots.iter().any(|root| {
        let root_path = normalize_path(Path::new(root));
        normalized_path.starts_with(&root_path)
    })
}

impl SandboxContext {
    pub fn validate_write(&self, path: &Path) -> Result<(), String> {
        if self.access_mode == "read_only" {
            return Err("当前访问档位为只读，禁止写入文件".to_string());
        }

        if !path_within_roots(path, &self.writable_roots) {
            return Err(format!(
                "写入路径不在允许的工作区范围内: {}",
                path.display()
            ));
        }

        Ok(())
    }

    pub fn validate_command_allowed(&self) -> Result<(), String> {
        if self.access_mode == "read_only" {
            return Err("当前访问档位为只读，禁止执行命令".to_string());
        }
        Ok(())
    }

    pub fn validate_command_cwd(&self, cwd: Option<&Path>) -> Result<(), String> {
        if self.writable_roots.is_empty() {
            return Ok(());
        }

        let Some(cwd) = cwd else {
            return Ok(());
        };

        if !path_within_roots(cwd, &self.writable_roots) {
            return Err(format!(
                "命令工作目录不在允许范围内: {}",
                cwd.display()
            ));
        }

        Ok(())
    }

    pub fn validate_network(&self, _command: &str) -> Result<(), String> {
        if self.network_enabled {
            return Ok(());
        }

        // Placeholder: network restriction flag is enforced at the policy layer.
        // Full network interception is not implemented yet.
        Ok(())
    }
}

pub fn current_sandbox_context(state: &State<'_, SandboxState>) -> SandboxContext {
    state
        .context
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn set_sandbox_context(
    access_mode: String,
    writable_roots: Vec<String>,
    network_enabled: bool,
    state: State<'_, SandboxState>,
) -> Result<(), String> {
    let mut guard = state
        .context
        .lock()
        .map_err(|_| "沙箱状态锁定失败".to_string())?;

    *guard = SandboxContext {
        access_mode,
        writable_roots,
        network_enabled,
    };

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_only_blocks_writes() {
        let ctx = SandboxContext {
            access_mode: "read_only".to_string(),
            writable_roots: vec!["C:\\project".to_string()],
            network_enabled: false,
        };
        assert!(ctx.validate_write(Path::new("C:\\project\\a.txt")).is_err());
    }

    #[test]
    fn auto_allows_writes_within_root() {
        let ctx = SandboxContext {
            access_mode: "auto".to_string(),
            writable_roots: vec!["C:\\project".to_string()],
            network_enabled: false,
        };
        assert!(ctx
            .validate_write(Path::new("C:\\project\\src\\main.rs"))
            .is_ok());
    }
}
