//! CBM project slug derivation and invoke-link path resolution.
//!
//! When Windows non-ASCII paths are indexed via `invoke-links` junctions, CBM stores
//! the junction path and derives slugs from it. We resolve back to the user's real
//! repo path for list output and map path-derived slugs to actual CBM slugs.

use std::fs;
use std::path::Path;

use serde_json::{Map, Value};

use super::path::{cbm_cache_dir, normalize_repo_path, strip_extended_path_prefix};

const INVOKE_LINKS_SEGMENT: &str = "invoke-links";
const ALIASES_FILE: &str = "path-aliases.json";

fn is_safe_project_byte(b: u8) -> bool {
    (b'a'..=b'z').contains(&b)
        || (b'A'..=b'Z').contains(&b)
        || (b'0'..=b'9').contains(&b)
        || b == b'.'
        || b == b'_'
        || b == b'-'
}

fn collapse_repeated(input: &str, ch: char) -> String {
    let mut out = String::with_capacity(input.len());
    let mut prev = '\0';
    for c in input.chars() {
        if c == ch && prev == ch {
            continue;
        }
        out.push(c);
        prev = c;
    }
    out
}

/// Mirror CBM `cbm_project_name_from_path` (byte-wise, validator-safe).
pub fn cbm_project_name_from_path(abs_path: &str) -> String {
    let trimmed = abs_path.trim();
    if trimmed.is_empty() {
        return "root".to_string();
    }

    let mut bytes = trimmed.replace('\\', "/").into_bytes();
    for b in bytes.iter_mut() {
        if !is_safe_project_byte(*b) {
            *b = b'-';
        }
    }

    let mut path = String::from_utf8_lossy(&bytes).into_owned();
    path = collapse_repeated(&path, '-');
    path = collapse_repeated(&path, '.');
    path = path.trim_start_matches(|c| c == '-' || c == '.').to_string();
    while path.ends_with('-') {
        path.pop();
    }

    if path.is_empty() {
        "root".to_string()
    } else {
        path
    }
}

pub fn is_invoke_link_path(path: &str) -> bool {
    path.to_lowercase().contains(INVOKE_LINKS_SEGMENT)
}

/// Resolve a stored CBM `root_path` to the user-facing repo path.
pub fn resolve_stored_repo_path(stored: &str) -> String {
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if let Some(original) = lookup_invoke_alias(trimmed) {
        return original;
    }

    if is_invoke_link_path(trimmed) {
        if let Ok(canonical) = Path::new(trimmed).canonicalize() {
            return strip_extended_path_prefix(&canonical.to_string_lossy());
        }
    }

    trimmed.to_string()
}

fn aliases_path() -> Result<std::path::PathBuf, String> {
    Ok(cbm_cache_dir()?.join(ALIASES_FILE))
}

fn load_aliases() -> Map<String, Value> {
    let Ok(path) = aliases_path() else {
        return Map::new();
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return Map::new();
    };
    serde_json::from_str::<Value>(&raw)
        .ok()
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

fn save_aliases(map: &Map<String, Value>) -> Result<(), String> {
    let path = aliases_path()?;
    let json = serde_json::to_string_pretty(&Value::Object(map.clone()))
        .map_err(|e| format!("path-aliases 序列化失败: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("path-aliases 写入失败: {e}"))
}

fn repo_path_from_project_entry(project: &Value) -> Option<String> {
    for key in ["repo_path", "root_path", "path", "root", "project_path"] {
        if let Some(value) = project.get(key).and_then(|v| v.as_str()) {
            return Some(value.to_string());
        }
    }
    None
}

/// Persist original → invoke mapping when CBM CLI args are adapted for Unicode paths.
pub fn record_invoke_path_alias(original: &str, invoke: &str) -> Result<(), String> {
    let orig = original.trim();
    let inv = invoke.trim();
    if orig.is_empty() || inv.is_empty() || normalize_repo_path(orig) == normalize_repo_path(inv) {
        return Ok(());
    }

    let mut map = load_aliases();
    let by_invoke = map
        .entry("by_invoke".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if let Some(obj) = by_invoke.as_object_mut() {
        obj.insert(normalize_repo_path(inv), Value::String(orig.to_string()));
    }
    save_aliases(&map)
}

fn lookup_invoke_alias(stored: &str) -> Option<String> {
    let key = normalize_repo_path(stored);
    let map = load_aliases();
    map.get("by_invoke")?
        .as_object()?
        .get(&key)?
        .as_str()
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

/// Map a user-facing slug (derived from the real repo path) to the actual CBM slug.
pub fn resolve_project_slug_alias(requested: &str, projects: &[&Value]) -> Option<String> {
    let trimmed = requested.trim();
    if trimmed.is_empty() {
        return None;
    }

    for project in projects {
        let actual = project.get("name").and_then(|v| v.as_str())?;
        if actual == trimmed {
            return Some(actual.to_string());
        }
    }

    for project in projects {
        let actual = project.get("name").and_then(|v| v.as_str())?;
        let stored = repo_path_from_project_entry(project)?;
        let user_path = resolve_stored_repo_path(&stored);
        if cbm_project_name_from_path(&user_path) == trimmed {
            return Some(actual.to_string());
        }
    }

    let map = load_aliases();
    let aliases = map.get("slug_aliases")?.as_object()?;
    aliases
        .get(trimmed)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_name_windows_path() {
        assert_eq!(
            cbm_project_name_from_path(r"C:\Users\dev\project"),
            "C-Users-dev-project"
        );
    }

    #[test]
    fn project_name_unix_path() {
        assert_eq!(
            cbm_project_name_from_path("/Users/dev/my-project"),
            "Users-dev-my-project"
        );
    }

    #[test]
    fn project_name_empty_is_root() {
        assert_eq!(cbm_project_name_from_path(""), "root");
    }

    #[test]
    fn project_name_non_ascii_bytes_become_dashes() {
        let name = cbm_project_name_from_path(r"d:\project\酷态科");
        assert!(!name.contains('酷'));
        assert!(name.contains("project"));
    }

    #[test]
    fn resolve_project_slug_alias_maps_user_path_derived_slug() {
        let original = r"d:\project\酷态科";
        let invoke = "C:/Users/me/AppData/Roaming/Loom/cbm/invoke-links/abc123";
        let actual_slug = "C-Users-me-AppData-Roaming-Loom-cbm-invoke-links-abc123";
        record_invoke_path_alias(original, invoke).expect("record");

        let projects = vec![serde_json::json!({
            "name": actual_slug,
            "root_path": invoke
        })];
        let refs: Vec<&Value> = projects.iter().collect();
        let derived = cbm_project_name_from_path(original);
        assert_eq!(
            resolve_project_slug_alias(&derived, &refs).as_deref(),
            Some(actual_slug)
        );
    }
}
