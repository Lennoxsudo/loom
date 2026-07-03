//! Enrich CBM `list_projects` JSON — CBM omits `indexed_at` in list output (see
//! codebase-memory `build_project_json_entry`). We derive it from `.db` mtime.

use std::fs;
use std::path::Path;

use chrono::{DateTime, Utc};
use serde_json::{Map, Value};

use super::path::cbm_cache_dir;
use super::project_path::resolve_stored_repo_path;

fn format_mtime_iso(path: &Path) -> Option<String> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    let dt: DateTime<Utc> = modified.into();
    Some(dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

fn enrich_project_entry(obj: &mut Map<String, Value>, cache_dir: &Path) {
    if let Some(root) = obj.get("root_path").and_then(|v| v.as_str()) {
        if !root.is_empty() {
            let root_owned = root.to_string();
            let display = resolve_stored_repo_path(&root_owned);
            let show_invoke = display != root_owned;
            obj.insert("repo_path".to_string(), Value::String(display));
            if obj.get("invoke_path").is_none() && show_invoke {
                obj.insert("invoke_path".to_string(), Value::String(root_owned));
            }
        }
    } else if let Some(repo) = obj.get("repo_path").and_then(|v| v.as_str()) {
        if !repo.is_empty() {
            obj.insert(
                "repo_path".to_string(),
                Value::String(resolve_stored_repo_path(repo)),
            );
        }
    }

    if let Some(nodes) = obj.get("nodes").cloned() {
        obj.entry("node_count".to_string()).or_insert(nodes);
    }
    if let Some(edges) = obj.get("edges").cloned() {
        obj.entry("edge_count".to_string()).or_insert(edges);
    }

    let has_timestamp = obj
        .get("indexed_at")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.is_empty())
        || obj
            .get("created_at")
            .and_then(|v| v.as_str())
            .is_some_and(|s| !s.is_empty());

    if has_timestamp {
        return;
    }

    let Some(slug) = obj.get("name").and_then(|v| v.as_str()) else {
        return;
    };
    if slug.is_empty() {
        return;
    }

    let db_path = cache_dir.join(format!("{slug}.db"));
    if let Some(iso) = format_mtime_iso(&db_path) {
        obj.insert("indexed_at".to_string(), Value::String(iso));
    }
}

fn enrich_projects_value(value: &mut Value, cache_dir: &Path) {
    match value {
        Value::Object(root) => {
            if let Some(projects) = root.get_mut("projects").and_then(|v| v.as_array_mut()) {
                for item in projects.iter_mut() {
                    if let Some(obj) = item.as_object_mut() {
                        enrich_project_entry(obj, cache_dir);
                    }
                }
            }
        }
        Value::Array(items) => {
            for item in items.iter_mut() {
                if let Some(obj) = item.as_object_mut() {
                    enrich_project_entry(obj, cache_dir);
                }
            }
        }
        _ => {}
    }
}

/// Add `repo_path`, `node_count`/`edge_count` aliases, and `indexed_at` from `.db` mtime.
pub fn enrich_list_projects_json(raw: &str) -> Result<String, String> {
    let mut value: Value =
        serde_json::from_str(raw).map_err(|e| format!("list_projects JSON 解析失败: {e}"))?;
    let cache_dir = cbm_cache_dir()?;
    enrich_projects_value(&mut value, &cache_dir);
    serde_json::to_string(&value).map_err(|e| format!("list_projects JSON 序列化失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn enrich_adds_repo_path_and_counts_aliases() {
        let raw = r#"{"projects":[{"name":"D-foo","root_path":"D:/foo","nodes":10,"edges":20}]}"#;
        let cache_dir = cbm_cache_dir().expect("cache dir");
        let db_path = cache_dir.join("D-foo.db");
        let mut file = std::fs::File::create(&db_path).expect("create db");
        file.write_all(b"test").expect("write db");

        let enriched = enrich_list_projects_json(raw).expect("enrich");
        let value: Value = serde_json::from_str(&enriched).expect("parse");
        let project = &value["projects"][0];
        assert_eq!(project["repo_path"], "D:/foo");
        assert_eq!(project["node_count"], 10);
        assert_eq!(project["edge_count"], 20);
        assert!(project["indexed_at"]
            .as_str()
            .is_some_and(|s| !s.is_empty()));

        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn enrich_resolves_invoke_path_when_alias_recorded() {
        let invoke = "C:/Users/me/AppData/Roaming/Loom/cbm/invoke-links/abc123def456";
        let original = r"d:\project\酷态科";
        super::super::project_path::record_invoke_path_alias(original, invoke).expect("record");

        let raw = serde_json::json!({
            "projects": [{
                "name": "C-Users-me-invoke",
                "root_path": invoke,
                "nodes": 1,
                "edges": 2
            }]
        })
        .to_string();
        let cache_dir = cbm_cache_dir().expect("cache dir");
        let db_path = cache_dir.join("C-Users-me-invoke.db");
        let _ = std::fs::File::create(&db_path);

        let enriched = enrich_list_projects_json(&raw).expect("enrich");
        let value: Value = serde_json::from_str(&enriched).expect("parse");
        assert_eq!(value["projects"][0]["repo_path"], original);

        let _ = std::fs::remove_file(db_path);
    }
}
