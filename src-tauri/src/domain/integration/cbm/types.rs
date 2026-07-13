use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CbmPathStatus {
    Ok,
    Missing,
    NotDirectory,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CbmIndexStatus {
    Ready,
    Indexing,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CbmIndexedProject {
    pub repo_path: String,
    pub display_name: String,
    pub indexed_at: Option<String>,
    pub node_count: Option<u64>,
    pub path_status: CbmPathStatus,
    pub index_status: CbmIndexStatus,
    pub is_stale: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CbmScheduleStatus {
    Scheduled,
    InProgress,
    AlreadyIndexed,
    SkippedEmpty,
    SkippedUnavailable,
    SkippedTooLarge,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CbmScheduleResult {
    pub status: CbmScheduleStatus,
    pub repo_path: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CbmDeleteStatus {
    Deleted,
    NotFound,
    SkippedDisabled,
    SkippedUnavailable,
    SkippedInProgress,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CbmDeleteResult {
    pub status: CbmDeleteStatus,
    pub repo_path: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CbmStorageInfo {
    pub cache_dir: String,
    pub total_bytes: u64,
    pub pinned_version: String,
    pub runtime_version: Option<String>,
    pub sidecar_available: bool,
}

/// Map (frontend tool, action) → CBM CLI tool name.
pub fn cbm_cli_tool_name(graph_tool: &str, action: &str) -> Option<&'static str> {
    match (graph_tool, action) {
        ("graph_index", "index") => Some("index_repository"),
        ("graph_index", "status") => Some("index_status"),
        ("graph_index", "list") => Some("list_projects"),
        ("graph_index", "delete") => Some("delete_project"),
        ("graph_query", "search") => Some("search_graph"),
        ("graph_query", "snippet") => Some("get_code_snippet"),
        ("graph_query", "query") => Some("query_graph"),
        ("graph_query", "schema") => Some("get_graph_schema"),
        ("graph_query", "code") => Some("search_code"),
        ("graph_trace", "trace") => Some("trace_path"),
        ("graph_trace", "architecture") => Some("get_architecture"),
        ("graph_trace", "changes") => Some("detect_changes"),
        _ => None,
    }
}

pub fn is_valid_graph_action(graph_tool: &str, action: &str) -> bool {
    cbm_cli_tool_name(graph_tool, action).is_some()
}

fn escape_regex_literal(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        if matches!(ch, '.' | '*' | '+' | '?' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '[' | ']' | '\\') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

fn qualified_name_to_qn_pattern(qualified_name: &str, use_regex: bool) -> String {
    let trimmed = qualified_name.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if use_regex {
        return trimmed.to_string();
    }
    format!("^{}$", escape_regex_literal(trimmed))
}

fn map_search_qualified_name_to_qn_pattern(args: &mut Map<String, Value>) {
    let has_qn_pattern = args
        .get("qn_pattern")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.is_empty());
    if has_qn_pattern {
        args.remove("qualified_name");
        return;
    }

    let Some(qualified_name) = args
        .get("qualified_name")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    else {
        return;
    };

    let use_regex = args.get("regex").and_then(|v| v.as_bool()).unwrap_or(false);
    args.insert(
        "qn_pattern".to_string(),
        Value::String(qualified_name_to_qn_pattern(qualified_name, use_regex)),
    );
    args.remove("qualified_name");
}

fn glob_to_path_regex(glob: &str) -> Option<String> {
    let trimmed = glob.trim();
    if trimmed.is_empty() {
        return None;
    }
    let g = trimmed.replace('\\', "/");
    let mut out = String::from(".*");
    let mut chars = g.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '*' => {
                if chars.peek() == Some(&'*') {
                    chars.next();
                    out.push_str(".*");
                } else {
                    out.push_str("[^/]*");
                }
            }
            '?' => out.push_str("[^/]"),
            '.' | '+' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '[' | ']' | '\\' => {
                out.push('\\');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out.push_str(".*");
    Some(out)
}

fn prepare_search_code_args(args: &mut Map<String, Value>) {
    args.remove("query");
    args.remove("name_pattern");
    args.remove("qualified_name");
    args.remove("qn_pattern");
    args.remove("label");
    args.remove("_code_property_rewrite");

    if !args.contains_key("limit") {
        args.insert("limit".to_string(), Value::Number(20.into()));
    }

    let has_path_filter = args
        .get("path_filter")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.is_empty());
    if !has_path_filter {
        if let Some(fp) = args.get("file_pattern").and_then(|v| v.as_str()) {
            if let Some(regex) = glob_to_path_regex(fp) {
                args.insert("path_filter".to_string(), Value::String(regex));
            }
        }
    }
}

pub fn build_cli_args(
    graph_tool: &str,
    action: &str,
    payload: &serde_json::Value,
) -> Result<Option<String>, String> {
    if action == "list" && graph_tool == "graph_index" {
        return Ok(None);
    }

    let mut args: Map<String, Value> = match payload {
        Value::Object(map) => map.clone(),
        _ => Map::new(),
    };

    // Legacy / mistaken Agent field — resolution happens in cli.rs.
    args.remove("project_id");

    if graph_tool == "graph_trace" && action == "trace" {
        if !args.contains_key("direction") {
            args.insert(
                "direction".to_string(),
                serde_json::Value::String("both".to_string()),
            );
        }
        if !args.contains_key("depth") {
            args.insert("depth".to_string(), serde_json::Value::Number(3.into()));
        }
    }

    if graph_tool == "graph_trace" && action == "changes" {
        if !args.contains_key("depth") {
            args.insert("depth".to_string(), serde_json::Value::Number(3.into()));
        }
    }

    if graph_tool == "graph_query" && action == "search" {
        map_search_qualified_name_to_qn_pattern(&mut args);
        args.remove("regex");
        args.remove("action");
    }

    if graph_tool == "graph_query" && action == "code" {
        prepare_search_code_args(&mut args);
        args.remove("action");
    }

    if graph_tool == "graph_query" && action == "query" {
        args.remove("action");
        args.remove("file_pattern");
        args.remove("_code_property_rewrite");
    }

    if args.is_empty() {
        return Ok(None);
    }

    serde_json::to_string(&serde_json::Value::Object(args))
        .map(Some)
        .map_err(|e| format!("CBM 参数序列化失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_phase3_graph_actions() {
        assert_eq!(
            cbm_cli_tool_name("graph_query", "query"),
            Some("query_graph")
        );
        assert_eq!(
            cbm_cli_tool_name("graph_trace", "changes"),
            Some("detect_changes")
        );
    }

    #[test]
    fn maps_schema_and_code_actions() {
        assert_eq!(
            cbm_cli_tool_name("graph_query", "schema"),
            Some("get_graph_schema")
        );
        assert_eq!(
            cbm_cli_tool_name("graph_query", "code"),
            Some("search_code")
        );
    }

    #[test]
    fn rejects_invalid_graph_tool_action_pairs() {
        assert!(!is_valid_graph_action("graph_query", "index"));
        assert!(!is_valid_graph_action("graph_index", "search"));
        assert!(!is_valid_graph_action("graph_trace", "snippet"));
    }

    #[test]
    fn build_cli_args_strips_project_id() {
        let payload = serde_json::json!({
            "action": "search",
            "project_id": "D-project-foo",
            "name_pattern": ".*"
        });
        let json = build_cli_args("graph_query", "search", &payload)
            .unwrap()
            .expect("json");
        let value: Value = serde_json::from_str(&json).unwrap();
        assert!(value.get("project_id").is_none());
        assert_eq!(
            value.get("name_pattern").and_then(|v| v.as_str()),
            Some(".*")
        );
    }

    #[test]
    fn build_cli_args_maps_qualified_name_to_qn_pattern_for_search() {
        let payload = serde_json::json!({
            "action": "search",
            "qualified_name": ".src.stores.products.getProductById",
            "repo_path": "D:/proj"
        });
        let json = build_cli_args("graph_query", "search", &payload)
            .unwrap()
            .expect("json");
        let value: Value = serde_json::from_str(&json).unwrap();
        assert!(value.get("qualified_name").is_none());
        let qn = value
            .get("qn_pattern")
            .and_then(|v| v.as_str())
            .expect("qn_pattern");
        assert!(qn.contains("getProductById"));
        assert!(qn.starts_with('^'));
    }

    #[test]
    fn build_cli_args_prepares_search_code_and_strips_query() {
        let payload = serde_json::json!({
            "action": "code",
            "pattern": "import",
            "query": "MATCH (n) RETURN n",
            "file_pattern": "src/**/*.ts",
            "repo_path": "D:/proj"
        });
        let json = build_cli_args("graph_query", "code", &payload)
            .unwrap()
            .expect("json");
        let value: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value.get("pattern").and_then(|v| v.as_str()), Some("import"));
        assert!(value.get("query").is_none());
        assert!(value.get("action").is_none());
        assert!(value.get("path_filter").and_then(|v| v.as_str()).is_some());
        assert_eq!(value.get("limit").and_then(|v| v.as_i64()), Some(20));
    }
}
