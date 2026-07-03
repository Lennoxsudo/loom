use std::fs;
use std::path::{Path, PathBuf};

const DOT_CONFIG_DIR: &str = ".loom";
const LEGACY_DOT_CONFIG_DIR: &str = ".aiasprrato";
const USER_DATA_CONFIG_DIR: &str = "Loom";
const LEGACY_USER_DATA_CONFIG_DIR: &str = "Aiasprrato";

pub fn user_home_dir() -> Result<PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "无法获取用户目录".to_string())?;
    Ok(PathBuf::from(home))
}

pub fn dot_config_dir() -> Result<PathBuf, String> {
    Ok(user_home_dir()?.join(DOT_CONFIG_DIR))
}

fn legacy_dot_config_dir() -> Result<PathBuf, String> {
    Ok(user_home_dir()?.join(LEGACY_DOT_CONFIG_DIR))
}

pub fn user_data_config_dir() -> Result<PathBuf, String> {
    Ok(user_home_dir()?.join(USER_DATA_CONFIG_DIR))
}

fn legacy_user_data_config_dir() -> Result<PathBuf, String> {
    Ok(user_home_dir()?.join(LEGACY_USER_DATA_CONFIG_DIR))
}

fn copy_file_if_missing(from: &PathBuf, to: &PathBuf) -> Result<(), String> {
    if to.exists() || !from.exists() {
        return Ok(());
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    fs::copy(from, to).map_err(|e| format!("迁移配置文件失败: {e}"))?;
    Ok(())
}

/// Resolve a dot-config file, migrating from ~/.aiasprrato when needed.
pub fn resolve_dot_config_file(file_name: &str) -> Result<PathBuf, String> {
    let new_file = dot_config_dir()?.join(file_name);
    let legacy_file = legacy_dot_config_dir()?.join(file_name);
    copy_file_if_missing(&legacy_file, &new_file)?;
    if new_file.exists() {
        return Ok(new_file);
    }
    if legacy_file.exists() {
        return Ok(legacy_file);
    }
    Ok(new_file)
}

fn migrate_user_data_config_dir() -> Result<(), String> {
    let new_dir = user_data_config_dir()?;
    if new_dir.exists() {
        return Ok(());
    }
    let legacy_dir = legacy_user_data_config_dir()?;
    if !legacy_dir.exists() {
        return Ok(());
    }
    copy_dir_recursive(&legacy_dir, &new_dir)
}

fn copy_dir_recursive(from: &PathBuf, to: &PathBuf) -> Result<(), String> {
    if !from.exists() {
        return Ok(());
    }
    fs::create_dir_all(to).map_err(|e| format!("创建配置目录失败: {e}"))?;
    for entry in fs::read_dir(from).map_err(|e| format!("读取配置目录失败: {e}"))? {
        let entry = entry.map_err(|e| format!("读取配置项失败: {e}"))?;
        let file_type = entry
            .file_type()
            .map_err(|e| format!("读取配置项类型失败: {e}"))?;
        let dest = to.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dest)?;
        } else if file_type.is_file() {
            copy_file_if_missing(&entry.path(), &dest)?;
        }
    }
    Ok(())
}

/// Resolve ~/Loom, migrating from ~/Aiasprrato when needed.
pub fn resolve_user_data_config_dir() -> Result<PathBuf, String> {
    migrate_user_data_config_dir()?;
    let new_dir = user_data_config_dir()?;
    if new_dir.exists() {
        return Ok(new_dir);
    }
    let legacy_dir = legacy_user_data_config_dir()?;
    if legacy_dir.exists() {
        return Ok(legacy_dir);
    }
    Ok(new_dir)
}

pub fn resolve_ai_config_path() -> Result<PathBuf, String> {
    Ok(resolve_user_data_config_dir()?.join("ai-config.json"))
}

pub fn resolve_prompts_path() -> Result<PathBuf, String> {
    Ok(resolve_user_data_config_dir()?.join("prompts.json"))
}

/// Resolve an APPDATA subdir, falling back to the legacy Aiasprrato name.
pub fn resolve_app_data_subdir(dir_name: &str) -> Result<PathBuf, String> {
    let app_data = std::env::var("APPDATA")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    let new_dir = PathBuf::from(&app_data).join(dir_name);
    if new_dir.exists() {
        return Ok(new_dir);
    }
    if dir_name == "loom" {
        let legacy_dir = PathBuf::from(&app_data).join("aiasprrato");
        if legacy_dir.exists() {
            return Ok(legacy_dir);
        }
    }
    Ok(new_dir)
}

const LEGACY_APP_DATA_DIR: &str = "com.administrator.aiasprrato";

/// Migrate Roaming app data from the pre-rename Tauri identifier when needed.
pub fn migrate_legacy_app_data_dir(new_dir: &Path) -> Result<(), String> {
    if new_dir.exists() {
        return Ok(());
    }
    let Some(parent) = new_dir.parent() else {
        return Ok(());
    };
    let legacy_dir = parent.join(LEGACY_APP_DATA_DIR);
    if !legacy_dir.exists() {
        return Ok(());
    }
    copy_dir_recursive(&legacy_dir, &new_dir.to_path_buf())
}
