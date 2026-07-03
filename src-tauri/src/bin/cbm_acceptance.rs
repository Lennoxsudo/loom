//! Manual acceptance runner for graph tool fixes (§7.3).
//!
//! `cargo run --bin cbm_acceptance` from `src-tauri/`
//! Requires `LOOM_CBM_PATH` or bundled sidecar under `binaries/`.

use serde_json::{json, Value};
use tauri::Manager;

use loom_lib::cbm::cli::{format_cbm_cli_error, run_cbm_cli};
use loom_lib::cbm::path::{cbm_sidecar_available, normalize_repo_path};
use loom_lib::cbm::CbmState;
use loom_lib::cbm::types::{build_cli_args, cbm_cli_tool_name};

const ASCII_REPO: &str = r"d:\project\Aiasprrato\Aiasprrato";
const CHINESE_REPO: &str = r"d:\project\酷态科";

struct Case {
    id: &'static str,
    pass: bool,
    detail: String,
}

fn main() {
    if std::env::var("LOOM_CBM_PATH").is_err() {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let bundled = manifest.join("binaries/codebase-memory-x86_64-pc-windows-msvc.exe");
        if bundled.is_file() {
            std::env::set_var("LOOM_CBM_PATH", &bundled);
        }
    }

    let app = tauri::Builder::default()
        .manage(CbmState::default())
        .build(tauri::generate_context!())
        .expect("failed to build tauri app for acceptance");

    let handle = app.handle().clone();
  if !cbm_sidecar_available(&handle) {
        eprintln!("FAIL: CBM sidecar unavailable");
        std::process::exit(2);
    }

    let mut results = Vec::new();
    results.push(run_t1(&handle));
    results.push(run_t2(&handle));
    results.push(run_t3(&handle));
    results.push(run_t4(&handle));
    results.push(run_t6(&handle));
    results.push(run_t7(&handle));

    println!("\n=== Manual acceptance summary ===");
    let mut failed = 0usize;
    for case in &results {
        let mark = if case.pass { "PASS" } else { "FAIL" };
        println!("[{mark}] {} - {}", case.id, case.detail);
        if !case.pass {
            failed += 1;
        }
    }

    if failed > 0 {
        eprintln!("\n{failed} case(s) failed.");
        std::process::exit(1);
    }
    println!("\nAll {} Rust acceptance cases passed.", results.len());
}

fn invoke_graph(
    app: &tauri::AppHandle,
    tool: &str,
    action: &str,
    payload: Value,
) -> Result<String, String> {
    let state = app.state::<CbmState>();
    state.check_circuit()?;

    let cli_tool = cbm_cli_tool_name(tool, action)
        .ok_or_else(|| format!("unsupported graph tool/action: {tool}/{action}"))?;
    let args_json = build_cli_args(tool, action, &payload)?;

    match run_cbm_cli(app, cli_tool, args_json.as_deref()) {
        Ok(output) => {
            state.record_success();
            Ok(output)
        }
        Err(e) => {
            state.record_failure_if_transient(&e);
            Err(format_cbm_cli_error(&e))
        }
    }
}

fn parse_json_output(raw: &str) -> Value {
    serde_json::from_str(raw.trim()).unwrap_or(Value::Null)
}

fn project_listed(raw: &str, normalized_repo: &str) -> bool {
    let value = parse_json_output(raw);
    let projects = value
        .get("projects")
        .and_then(|v| v.as_array())
        .or_else(|| value.as_array());
    let Some(items) = projects else {
        return false;
    };
    items.iter().any(|p| {
        p.get("root_path")
            .or_else(|| p.get("repo_path"))
            .and_then(|v| v.as_str())
            .is_some_and(|path| normalize_repo_path(path) == normalized_repo)
    })
}

fn status_has_graph_stats(raw: &str) -> bool {
    let value = parse_json_output(raw);
    value.get("node_count").is_some()
        || value.get("nodes").is_some()
        || value.get("edges").is_some()
        || value.get("edge_count").is_some()
        || value
            .get("indexed")
            .and_then(|v| v.as_bool())
            .is_some()
}

fn run_t1(app: &tauri::AppHandle) -> Case {
    let repo = ASCII_REPO;
    let normalized = normalize_repo_path(repo);
    let list = match invoke_graph(app, "graph_index", "list", json!({})) {
        Ok(v) => v,
        Err(e) => {
            return Case {
                id: "T1",
                pass: false,
                detail: format!("list failed: {e}"),
            };
        }
    };

    if !project_listed(&list, &normalized) {
        eprintln!("T1: indexing {repo} (may take several minutes)…");
        if let Err(e) = invoke_graph(app, "graph_index", "index", json!({ "repo_path": repo })) {
            return Case {
                id: "T1",
                pass: false,
                detail: format!("index failed: {e}"),
            };
        }
    }

    match invoke_graph(
        app,
        "graph_index",
        "status",
        json!({ "repo_path": repo }),
    ) {
        Ok(status) if status_has_graph_stats(&status) => Case {
            id: "T1",
            pass: true,
            detail: "status via repo_path returns graph stats".into(),
        },
        Ok(status) => Case {
            id: "T1",
            pass: false,
            detail: format!("unexpected status payload: {status}"),
        },
        Err(e) => Case {
            id: "T1",
            pass: false,
            detail: e,
        },
    }
}

fn run_t2(app: &tauri::AppHandle) -> Case {
    match invoke_graph(
        app,
        "graph_query",
        "search",
        json!({ "repo_path": ASCII_REPO, "name_pattern": ".*", "limit": 5 }),
    ) {
        Ok(raw) => {
            let count = parse_json_output(&raw)
                .get("results")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            if count > 0 {
                Case {
                    id: "T2",
                    pass: true,
                    detail: format!("search returned {count} symbols"),
                }
            } else {
                Case {
                    id: "T2",
                    pass: false,
                    detail: format!("empty search: {raw}"),
                }
            }
        }
        Err(e) => Case {
            id: "T2",
            pass: false,
            detail: e,
        },
    }
}

fn run_t3(app: &tauri::AppHandle) -> Case {
    if !std::path::Path::new(CHINESE_REPO).exists() {
        return Case {
            id: "T3",
            pass: true,
            detail: "SKIP — Chinese path not present on this machine".into(),
        };
    }

    let normalized = normalize_repo_path(CHINESE_REPO);
    let needs_index = match invoke_graph(app, "graph_index", "list", json!({})) {
        Ok(list) => !project_listed(&list, &normalized),
        Err(_) => true,
    };
    if needs_index {
        eprintln!("T3: indexing {CHINESE_REPO}…");
        if let Err(e) = invoke_graph(
            app,
            "graph_index",
            "index",
            json!({ "repo_path": CHINESE_REPO }),
        ) {
            return Case {
                id: "T3",
                pass: false,
                detail: format!("index failed: {e}"),
            };
        }
    }

    match invoke_graph(
        app,
        "graph_query",
        "search",
        json!({ "repo_path": CHINESE_REPO, "name_pattern": ".*", "limit": 3 }),
    ) {
        Ok(raw) if !raw.to_lowercase().contains("project not found") => Case {
            id: "T3",
            pass: true,
            detail: "Chinese repo_path search succeeded".into(),
        },
        Ok(raw) => Case {
            id: "T3",
            pass: false,
            detail: raw,
        },
        Err(e) => Case {
            id: "T3",
            pass: false,
            detail: e,
        },
    }
}

fn run_t4(app: &tauri::AppHandle) -> Case {
    let state = app.state::<CbmState>();
    for i in 0..6 {
        let err = match invoke_graph(
            app,
            "graph_query",
            "search",
            json!({
                "project": format!("definitely-not-a-real-project-{i}"),
                "name_pattern": ".*",
                "limit": 1
            }),
        ) {
            Ok(_) => {
                return Case {
                    id: "T4",
                    pass: false,
                    detail: "wrong project unexpectedly succeeded".into(),
                };
            }
            Err(e) => e,
        };
        if !err.to_lowercase().contains("project not found") {
            return Case {
                id: "T4",
                pass: false,
                detail: format!("expected project not found, got: {err}"),
            };
        }
    }

    if state.check_circuit().is_err() {
        return Case {
            id: "T4",
            pass: false,
            detail: "circuit breaker opened after business errors".into(),
        };
    }

    match invoke_graph(
        app,
        "graph_query",
        "search",
        json!({ "repo_path": ASCII_REPO, "name_pattern": ".*", "limit": 3 }),
    ) {
        Ok(_) => Case {
            id: "T4",
            pass: true,
            detail: "circuit stayed closed; valid search after bad project".into(),
        },
        Err(e) => Case {
            id: "T4",
            pass: false,
            detail: e,
        },
    }
}

fn snippet_has_code(raw: &str) -> bool {
    let value = parse_json_output(raw);
    for key in ["code", "snippet", "content", "source"] {
        if let Some(text) = value.get(key).and_then(|v| v.as_str()) {
            if !text.is_empty() && !text.contains("not available") {
                return true;
            }
        }
    }
    false
}

fn run_t6(app: &tauri::AppHandle) -> Case {
    let search = match invoke_graph(
        app,
        "graph_query",
        "search",
        json!({
            "repo_path": ASCII_REPO,
            "name_pattern": "invokeCbm|run_cbm_cli|graphHandlers|build_cli_args",
            "limit": 20
        }),
    ) {
        Ok(v) => v,
        Err(e) => {
            return Case {
                id: "T6",
                pass: false,
                detail: format!("search failed: {e}"),
            };
        }
    };

    let value = parse_json_output(&search);
    let Some(results) = value.get("results").and_then(|v| v.as_array()) else {
        return Case {
            id: "T6",
            pass: false,
            detail: "search returned no results array".into(),
        };
    };

    for item in results {
        let qn = item
            .get("qualified_name")
            .or_else(|| item.get("full_name"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());
        let Some(qn) = qn else { continue };
        if qn.contains("decorator") || qn.starts_with('<') {
            continue;
        }

        match invoke_graph(
            app,
            "graph_query",
            "snippet",
            json!({ "repo_path": ASCII_REPO, "qualified_name": qn }),
        ) {
            Ok(snippet) if snippet_has_code(&snippet) => {
                return Case {
                    id: "T6",
                    pass: true,
                    detail: format!("snippet returned code for {qn}"),
                };
            }
            Ok(_) => continue,
            Err(e) => {
                return Case {
                    id: "T6",
                    pass: false,
                    detail: format!("snippet failed for {qn}: {e}"),
                };
            }
        }
    }

    Case {
        id: "T6",
        pass: false,
        detail: "no search hit produced snippet with code".into(),
    }
}

fn run_t7(app: &tauri::AppHandle) -> Case {
    let base = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/cbm_acceptance_delete");
    let _ = std::fs::remove_dir_all(&base);
    if std::fs::create_dir_all(&base).is_err() {
        return Case {
            id: "T7",
            pass: false,
            detail: "failed to create temp repo".into(),
        };
    }
    let _ = std::fs::write(
        base.join("sample.rs"),
        "pub fn cbm_acceptance_sample() -> i32 { 42 }\n",
    );

    let repo = base.to_string_lossy().into_owned();
    let normalized = normalize_repo_path(&repo);

    if let Err(e) = invoke_graph(app, "graph_index", "index", json!({ "repo_path": repo })) {
        let _ = std::fs::remove_dir_all(&base);
        return Case {
            id: "T7",
            pass: false,
            detail: format!("index failed: {e}"),
        };
    }

    let listed = invoke_graph(app, "graph_index", "list", json!({}))
        .map(|raw| project_listed(&raw, &normalized))
        .unwrap_or(false);
    if !listed {
        let _ = std::fs::remove_dir_all(&base);
        return Case {
            id: "T7",
            pass: false,
            detail: "project missing from list after index".into(),
        };
    }

    if let Err(e) = invoke_graph(app, "graph_index", "delete", json!({ "repo_path": repo })) {
        let _ = std::fs::remove_dir_all(&base);
        return Case {
            id: "T7",
            pass: false,
            detail: format!("delete failed: {e}"),
        };
    }

    let gone = invoke_graph(app, "graph_index", "list", json!({}))
        .map(|raw| !project_listed(&raw, &normalized))
        .unwrap_or(false);
    let _ = std::fs::remove_dir_all(&base);

    if gone {
        Case {
            id: "T7",
            pass: true,
            detail: "index → list → delete cycle OK".into(),
        }
    } else {
        Case {
            id: "T7",
            pass: false,
            detail: "project still listed after delete".into(),
        }
    }
}
