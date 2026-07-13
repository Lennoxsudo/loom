//! Loom Tauri backend library.
//!
//! # Module layout (phase 1 architecture)
//!
//! - [`core`] — config paths, debug log
//! - [`domain`] — business modules (agent / system / integration / ai)
//! - [`security`] — sandbox, OS isolation, audit
//! - [`app`] — command registration + setup glue
//!
//! Crate-root re-exports keep existing `crate::file_ops` / `crate::chat` paths
//! working so internal call sites need not change in phase 1.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::Manager;

// ============================================================================
// Layer modules
// ============================================================================

mod app;
mod core;
mod domain;
mod security;

// ============================================================================
// Compatibility re-exports (stable crate:: paths for phase 1)
// ============================================================================

pub use core::{config_paths, debug_log};

pub use domain::agent::{agent_store, automation, conversation};
pub use domain::ai::{chat, image_gen};
pub use domain::integration::{
    browser, git_diff, git_workspace, git_worktree, mcp,
};
/// Public for `bin/cbm_acceptance` and external tooling.
pub use domain::integration::cbm;
pub use domain::system::{
    editor_settings, file_ops, file_watcher, live_server, port_manager, symbol_definition,
    terminal, tool_executor,
};

pub use security::{audit_log, sandbox, sandbox_os};

// ============================================================================
// Re-exports used by this crate's run() / tests
// ============================================================================

pub use chat::extension_from_image_format;
pub use chat::normalize_path_string;

use automation::AutomationStoreState;
use browser::BrowserWindowState;
use chat::ChatTaskMap;
use file_watcher::WatcherState;
use live_server::LiveServerManager;
use mcp::McpServerState;
use terminal::BackgroundTasks;
use terminal::TerminalState;

/// Application entry used by `main.rs`.
pub fn run() {
    let builder = tauri::Builder::default()
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    if let Some(agent_window) = window.get_webview_window("agent-window") {
                        let _ = agent_window.close();
                    }
                }
            }
        })
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                let label = webview.label();
                if label == "main" || label.starts_with("agent-") {
                    if let Some(window) = webview.get_webview_window(label) {
                        let _ = window.show();
                    }
                }
            }
        })
        .manage(LiveServerManager::default())
        .manage(ChatTaskMap(Arc::new(Mutex::new(HashMap::new()))))
        .manage(TerminalState::new(2_000_000))
        .manage(BackgroundTasks::default())
        .manage(WatcherState::default())
        .manage(BrowserWindowState {
            window_label: Arc::new(Mutex::new(None)),
        })
        .manage(McpServerState::default())
        .manage(agent_store::AgentStoreState::default())
        .manage(AutomationStoreState::default())
        .manage(sandbox::SandboxState::default())
        .manage(cbm::CbmState::default())
        .manage(cbm::CbmUiState::default())
        .manage(cbm::CbmTaskRegistry::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init());

    app::commands::attach_handlers(builder)
        .setup(|app| app::setup::run(app))
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                cbm::shutdown_all(app_handle);
            }
        });
}

#[cfg(test)]
mod tests {
    use crate::file_ops::{
        self as file_ops, apply_search_replace, apply_search_replace_all, format_file_size,
        resolve_path_with_root, ReadFileToolRequest, ReadFileToolResult, ReplaceBlock,
    };
    use crate::git_diff::{parse_hunk_header, GitDiffOptions};
    use crate::symbol_definition::{get_symbol_definition, SymbolDefinitionOptions};
    use crate::terminal::{
        resolve_terminal_id, rewrite_powershell_command_chain, select_active_after_close,
        TerminalBuffer,
    };
    use std::fs;
    use std::io::Read;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_path(file_name: &str) -> String {
        let mut path = std::env::temp_dir();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        path.push(format!("{file_name}_{nanos}.txt"));
        path.to_string_lossy().to_string()
    }

    fn unique_temp_dir(file_name: &str) -> String {
        let mut path = std::env::temp_dir();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        path.push(format!("{file_name}_{nanos}"));
        path.to_string_lossy().to_string()
    }

    #[test]
    fn read_file_content_returns_file_contents() {
        let path = unique_temp_path("read_file_content_ok");
        fs::write(&path, "hello from test").expect("write temp file");

        let result = file_ops::read_file_content_impl(&path);

        assert_eq!(result.expect("read file content"), "hello from test");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn read_file_content_returns_error_on_missing_file() {
        let path = unique_temp_path("read_file_content_missing");

        let result = file_ops::read_file_content_impl(&path);

        let err = result.expect_err("expected error for missing file");
        assert!(err.starts_with("\u{8bfb}\u{53d6}\u{5931}\u{8d25}:"));
    }

    #[test]
    fn read_file_content_tool_reads_with_limits() {
        let path = unique_temp_path("read_file_tool_limits");
        fs::write(&path, "l1\nl2\nl3\n").expect("write temp file");

let result = file_ops::read_file_content_tool_impl(ReadFileToolRequest {
file_path: path.clone(),
max_bytes: None,
max_lines: Some(1),
            start_line: Some(2),
            encoding: None,
            search: None,
            around_line: None,
        })
        .expect("read tool file");

        assert!(result.truncated);
        assert_eq!(result.content, "l2\n");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn read_file_content_tool_detects_binary() {
        let path = unique_temp_path("read_file_tool_binary");
        fs::write(&path, vec![0u8, 159u8, 0u8]).expect("write binary file");

let result = file_ops::read_file_content_tool_impl(ReadFileToolRequest {
file_path: path.clone(),
max_bytes: None,
max_lines: None,
            start_line: None,
            encoding: None,
            search: None,
            around_line: None,
        })
        .expect("read tool file");

        assert!(result.is_binary);
        assert_eq!(result.content, "");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn apply_search_replace_replaces_single_occurrence() {
        let content = "line1\nold\nline3\n";
        let blocks = vec![ReplaceBlock {
            search: "old".to_string(),
            replace: "new".to_string(),
        }];

        let result = apply_search_replace(content, &blocks).expect("apply search replace");

        assert_eq!(result, "line1\nnew\nline3\n");
    }

    #[test]
    fn apply_search_replace_all_replaces_all_occurrences() {
        let content = "foo\nfoo\nbar\n";

        let result =
            apply_search_replace_all(content, "foo", "baz").expect("apply search replace all");

        assert_eq!(result, "baz\nbaz\nbar\n");
    }

    #[test]
    fn apply_search_replace_errors_when_search_not_found() {
        let content = "content\n";
        let blocks = vec![ReplaceBlock {
            search: "missing".to_string(),
            replace: "new".to_string(),
        }];

        let result = apply_search_replace(content, &blocks);

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("not found"));
    }

    #[test]
    fn apply_search_replace_handles_crlf_and_bom() {
        let content = "\u{feff}line1\r\nold\r\nline3\r\n";
        let blocks = vec![ReplaceBlock {
            search: "old".to_string(),
            replace: "new".to_string(),
        }];

        let result = apply_search_replace(content, &blocks).expect("apply search replace");

        assert_eq!(result, "\u{feff}line1\r\nnew\r\nline3\r\n");
    }

    #[test]
    fn apply_search_replace_errors_when_search_empty() {
        let content = "content\n";
        let blocks = vec![ReplaceBlock {
            search: "".to_string(),
            replace: "new".to_string(),
        }];

        let result = apply_search_replace(content, &blocks);

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("cannot be empty"));
    }

    #[test]
    fn get_git_diff_returns_error_for_non_git_directory() {
        let temp_dir = unique_temp_dir("git_diff_non_git");
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let result = crate::git_diff::get_git_diff(GitDiffOptions {
            repo_path: temp_dir.clone(),
            file_path: None,
            cached: None,
            max_lines: None,
        });

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Not a git repository"));
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn parse_hunk_header_parses_correctly() {
        let header = "@@ -10,5 +20,8 @@ function test()";
        let result = parse_hunk_header(header);

        assert!(result.is_some());
        let (old_start, old_lines, new_start, new_lines) = result.unwrap();
        assert_eq!(old_start, 10);
        assert_eq!(old_lines, 5);
        assert_eq!(new_start, 20);
        assert_eq!(new_lines, 8);
    }

    #[test]
    fn parse_hunk_header_handles_single_line() {
        let header = "@@ -10 +20 @@ context";
        let result = parse_hunk_header(header);

        assert!(result.is_some());
        let (old_start, old_lines, new_start, new_lines) = result.unwrap();
        assert_eq!(old_start, 10);
        assert_eq!(old_lines, 1);
        assert_eq!(new_start, 20);
        assert_eq!(new_lines, 1);
    }

    #[test]
    fn write_file_content_writes_file_contents() {
        let path = unique_temp_path("write_file_content_ok");

        let result = fs::write(&path, "hello write");

        assert!(result.is_ok());
        let stored = fs::read_to_string(&path).expect("read written file");
        assert_eq!(stored, "hello write");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn write_file_content_returns_error_on_directory_path() {
        let path = unique_temp_dir("write_file_content_dir");
        fs::create_dir(&path).expect("create temp dir");

        let result = fs::write(&path, "data");

        assert!(result.is_err());
        let _ = fs::remove_dir(path);
    }

    #[test]
    fn search_in_folder_finds_matches_and_ignores_node_modules() {
        let root = unique_temp_dir("search_root");
        fs::create_dir_all(&root).expect("create temp root");

        let f1 = format!("{root}{}a.txt", std::path::MAIN_SEPARATOR);
        fs::write(&f1, "hello world\nHello again\n").expect("write a.txt");

        let nm = format!("{root}{}node_modules", std::path::MAIN_SEPARATOR);
        fs::create_dir_all(&nm).expect("create node_modules");
        let nm_f = format!("{nm}{}x.txt", std::path::MAIN_SEPARATOR);
        fs::write(&nm_f, "hello from node_modules\n").expect("write ignored file");

        let results =
            file_ops::search_in_folder_impl(root.clone(), "hello".to_string(), false, 100, 5_000_000, None, None, None, None)
                .expect("search ok");

        assert!(results.iter().any(|r| r.path == f1));
        assert!(!results.iter().any(|r| r.path == nm_f));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn glob_search_files_returns_sorted_slash_paths_and_ignores_dist() {
        let root = unique_temp_dir("glob_search_root");
        fs::create_dir_all(&root).expect("create temp root");

        let src_dir = format!("{root}{}src", std::path::MAIN_SEPARATOR);
        let deep_dir = format!("{src_dir}{}deep", std::path::MAIN_SEPARATOR);
        fs::create_dir_all(&deep_dir).expect("create dirs");

        let root_short = format!("{root}{}a.ts", std::path::MAIN_SEPARATOR);
        let root_long = format!("{root}{}longer-name.ts", std::path::MAIN_SEPARATOR);
        let src_file = format!("{src_dir}{}App.ts", std::path::MAIN_SEPARATOR);
        let deep_file = format!("{deep_dir}{}DeepFile.ts", std::path::MAIN_SEPARATOR);
        fs::write(&root_short, "a").expect("write root short");
        fs::write(&root_long, "a").expect("write root long");
        fs::write(&src_file, "a").expect("write src file");
        fs::write(&deep_file, "a").expect("write deep file");

        let dist_dir = format!("{root}{}dist", std::path::MAIN_SEPARATOR);
        fs::create_dir_all(&dist_dir).expect("create dist dir");
        let dist_file = format!("{dist_dir}{}ignore.ts", std::path::MAIN_SEPARATOR);
        fs::write(&dist_file, "ignore").expect("write dist file");

        let results = file_ops::glob_search_files_impl(root.clone(), "**/*.ts".to_string(), Some(50), None, None)
            .expect("glob ok");

        let root_slash = root.replace('\\', "/");
        let expected = vec![
            format!("{root_slash}/a.ts"),
            format!("{root_slash}/longer-name.ts"),
            format!("{root_slash}/src/App.ts"),
            format!("{root_slash}/src/deep/DeepFile.ts"),
        ];

        assert_eq!(results, expected);
        assert!(!results.iter().any(|p| p.contains("dist/ignore.ts")));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn move_file_or_folder_respects_overwrite() {
        let root = unique_temp_dir("move_file_overwrite_root");
        fs::create_dir_all(&root).expect("create temp root");

        let src = format!("{root}{}src.txt", std::path::MAIN_SEPARATOR);
        let dest = format!("{root}{}dest.txt", std::path::MAIN_SEPARATOR);
        fs::write(&src, "src").expect("write src file");
        fs::write(&dest, "dest").expect("write dest file");

        let resolved_src = file_ops::resolve_path_with_root(&Some(root.clone()), &src).unwrap();
        let resolved_dest = file_ops::resolve_path_with_root(&Some(root.clone()), &dest).unwrap();
        assert!(resolved_src.exists());
        assert!(resolved_dest.exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn move_file_or_folder_rejects_outside_root() {
        let root = unique_temp_dir("move_file_root_guard");
        fs::create_dir_all(&root).expect("create temp root");

        let src = format!("{root}{}src.txt", std::path::MAIN_SEPARATOR);
        fs::write(&src, "src").expect("write src file");

        let resolved = file_ops::resolve_path_with_root(&Some(root.clone()), "src.txt").unwrap();
        assert!(resolved.starts_with(&root));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn delete_file_or_folder_permanent_removes_file() {
        let root = unique_temp_dir("delete_file_root");
        fs::create_dir_all(&root).expect("create temp root");

        let target = format!("{root}{}delete.txt", std::path::MAIN_SEPARATOR);
        fs::write(&target, "data").expect("write target file");

        fs::remove_file(&target).expect("delete ok");

        assert!(!std::path::Path::new(&target).exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn terminal_buffer_returns_full_output() {
        let mut buffer = TerminalBuffer::new(8);
        buffer.push_bytes(b"hello");

        let chunk = buffer.read_since(0, 16);

        assert_eq!(chunk.data, b"hello");
        assert_eq!(chunk.next_seq, 5);
        assert!(!chunk.truncated);
    }

    #[test]
    fn terminal_buffer_truncates_old_data() {
        let mut buffer = TerminalBuffer::new(5);
        buffer.push_bytes(b"hello");
        buffer.push_bytes(b"world");

        let chunk = buffer.read_since(0, 16);

        assert!(chunk.truncated);
        assert_eq!(chunk.data, b"world");
        assert_eq!(chunk.next_seq, 10);
    }

    #[test]
    fn terminal_buffer_respects_max_bytes() {
        let mut buffer = TerminalBuffer::new(10);
        buffer.push_bytes(b"abcdef");

        let chunk = buffer.read_since(0, 3);

        assert_eq!(chunk.data, b"abc");
        assert_eq!(chunk.next_seq, 3);
        assert!(!chunk.truncated);
    }

    #[test]
    fn terminal_buffer_benchmark_large_batch() {
        use std::time::Instant;

        let buffer_size = 1024 * 1024;
        let data_size = 2 * 1024 * 1024;
        let chunk_size = 4096;

        let mut buffer = TerminalBuffer::new(buffer_size);
        let chunk_data = vec![b'x'; chunk_size];

        let start = Instant::now();
        let mut pushed = 0;
        while pushed < data_size {
            buffer.push_bytes(&chunk_data);
            pushed += chunk_size;
        }
        let push_duration = start.elapsed();

        assert!(buffer.ring.len() <= buffer_size);

        let start = Instant::now();
        let result = buffer.read_since(0, buffer_size);
        let read_duration = start.elapsed();

        println!(
            "TerminalBuffer benchmark ({}MB data, {}KB chunks):",
            data_size / 1024 / 1024,
            chunk_size / 1024
        );
        println!("  Push time: {:?}", push_duration);
        println!("  Read time: {:?}", read_duration);
        println!("  Data in buffer: {} bytes", result.data.len());

        assert!(
            push_duration.as_millis() < 500,
            "Push took too long: {:?}",
            push_duration
        );
        assert!(
            read_duration.as_millis() < 100,
            "Read took too long: {:?}",
            read_duration
        );
    }

    #[test]
    fn terminal_buffer_benchmark_small_pushes() {
        use std::time::Instant;

        let buffer_size = 64 * 1024;
        let total_bytes = 256 * 1024;

        let mut buffer = TerminalBuffer::new(buffer_size);

        let start = Instant::now();
        for _ in 0..total_bytes {
            buffer.push_bytes(b"a");
        }
        let duration = start.elapsed();

        println!(
            "TerminalBuffer small push benchmark ({}KB in 1-byte chunks):",
            total_bytes / 1024
        );
        println!("  Total time: {:?}", duration);
        println!("  Per-byte: {:?}", duration / total_bytes as u32);

        assert!(
            duration.as_millis() < 500,
            "Small pushes took too long: {:?}",
            duration
        );
    }

    #[test]
    fn terminal_buffer_benchmark_mixed_workload() {
        use std::time::Instant;

        let buffer_size = 128 * 1024;
        let mut buffer = TerminalBuffer::new(buffer_size);

        let mut last_seq = 0u64;
        let iterations = 1000;
        let chunk_size = 1024;
        let chunk_data = vec![b'y'; chunk_size];

        let start = Instant::now();
        for i in 0..iterations {
            buffer.push_bytes(&chunk_data);

            if i % 10 == 0 {
                let chunk = buffer.read_since(last_seq, 8192);
                last_seq = chunk.next_seq;
            }
        }
        let duration = start.elapsed();

        let final_chunk = buffer.read_since(last_seq, buffer_size);

        println!(
            "TerminalBuffer mixed workload benchmark ({} iterations, {}KB each):",
            iterations,
            chunk_size / 1024
        );
        println!("  Total time: {:?}", duration);
        println!("  Final buffer size: {} bytes", final_chunk.data.len());

        assert!(
            duration.as_millis() < 500,
            "Mixed workload took too long: {:?}",
            duration
        );
    }

    #[test]
    fn terminal_buffer_benchmark_memory_efficiency() {
        let buffer_size = 100;
        let mut buffer = TerminalBuffer::new(buffer_size);

        assert!(
            buffer.ring.capacity() >= buffer_size,
            "Buffer should be pre-allocated"
        );

        for _ in 0..10 {
            buffer.push_bytes(&vec![b'z'; 50]);
        }

        assert!(
            buffer.ring.capacity() <= buffer_size * 2,
            "Capacity grew too much: {} (expected ~{})",
            buffer.ring.capacity(),
            buffer_size
        );
    }

    #[test]
    fn resolve_terminal_id_prefers_explicit() {
        let resolved = resolve_terminal_id(Some("term-1".to_string()), Some("term-2".to_string()));
        assert_eq!(resolved.expect("resolve"), "term-1");
    }

    #[test]
    fn resolve_terminal_id_falls_back_to_active() {
        let resolved = resolve_terminal_id(None, Some("term-2".to_string()));
        assert_eq!(resolved.expect("resolve"), "term-2");
    }

    #[test]
    fn resolve_terminal_id_errors_without_active() {
        let resolved = resolve_terminal_id(None, None);
        assert!(resolved.is_err());
    }

    #[test]
    fn select_active_after_close_keeps_active_when_not_closed() {
        let remaining = vec!["term-1".to_string(), "term-2".to_string()];
        let next = select_active_after_close(Some("term-1".to_string()), "term-2", &remaining);
        assert_eq!(next.as_deref(), Some("term-1"));
    }

    #[test]
    fn select_active_after_close_uses_first_remaining() {
        let remaining = vec!["term-3".to_string(), "term-4".to_string()];
        let next = select_active_after_close(Some("term-2".to_string()), "term-2", &remaining);
        assert_eq!(next.as_deref(), Some("term-3"));
    }

    #[test]
    fn select_active_after_close_none_when_empty() {
        let remaining: Vec<String> = Vec::new();
        let next = select_active_after_close(Some("term-2".to_string()), "term-2", &remaining);
        assert!(next.is_none());
    }

    #[test]
    fn rewrite_powershell_command_chain_converts_and_chain() {
        let rewritten = rewrite_powershell_command_chain("npm install && npm test\r");
        assert_eq!(
            rewritten,
            "npm install; $__loom_last_status = $?; if ($__loom_last_status) { npm test; $__loom_last_status = $? }\r"
        );
    }

    #[test]
    fn rewrite_powershell_command_chain_converts_mixed_chain() {
        let rewritten = rewrite_powershell_command_chain("foo || bar && baz");
        assert_eq!(
            rewritten,
            "foo; $__loom_last_status = $?; if (-not $__loom_last_status) { bar; $__loom_last_status = $? }; if ($__loom_last_status) { baz; $__loom_last_status = $? }"
        );
    }

    #[test]
    fn rewrite_powershell_command_chain_keeps_quoted_operators() {
        let rewritten = rewrite_powershell_command_chain("echo \"a && b\" && Write-Host done");
        assert_eq!(
            rewritten,
            "echo \"a && b\"; $__loom_last_status = $?; if ($__loom_last_status) { Write-Host done; $__loom_last_status = $? }"
        );
    }

    #[test]
    fn rewrite_powershell_command_chain_skips_explicit_cmd_shell() {
        let original = "cmd /c \"npm install && npm test\"";
        let rewritten = rewrite_powershell_command_chain(original);
        assert_eq!(rewritten, original);
    }

    #[test]
    fn get_file_tree_generates_tree_structure() {
        let root = unique_temp_dir("file_tree_root");
        fs::create_dir_all(&root).expect("create temp root");

        let src_dir = format!("{root}{}src", std::path::MAIN_SEPARATOR);
        fs::create_dir_all(&src_dir).expect("create src dir");
        let file1 = format!("{src_dir}{}main.rs", std::path::MAIN_SEPARATOR);
        fs::write(&file1, "fn main() {}").expect("write main.rs");

        let result =
            file_ops::get_file_tree_impl(Some(root.clone()), Some(3), Some(false)).expect("get tree ok");

        assert_eq!(result.root_path, root);
        assert!(result.tree.contains("src/"));
        assert!(result.tree.contains("main.rs"));
        assert!(result.total_dirs >= 1);
        assert!(result.total_files >= 1);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_file_tree_respects_max_depth() {
        let root = unique_temp_dir("file_tree_depth");
        fs::create_dir_all(&root).expect("create temp root");

        let level1 = format!("{root}{}level1", std::path::MAIN_SEPARATOR);
        fs::create_dir_all(&level1).expect("create level1");
        let level2 = format!("{level1}{}level2", std::path::MAIN_SEPARATOR);
        fs::create_dir_all(&level2).expect("create level2");
        let level3 = format!("{level2}{}level3", std::path::MAIN_SEPARATOR);
        fs::create_dir_all(&level3).expect("create level3");
        let deep_file = format!("{level3}{}deep.txt", std::path::MAIN_SEPARATOR);
        fs::write(&deep_file, "deep").expect("write deep file");

        let result1 =
            file_ops::get_file_tree_impl(Some(root.clone()), Some(1), Some(false)).expect("get tree ok");
        assert!(result1.tree.contains("level1/"));
        assert!(!result1.tree.contains("level2/"));

        let result2 =
            file_ops::get_file_tree_impl(Some(root.clone()), Some(2), Some(false)).expect("get tree ok");
        assert!(result2.tree.contains("level1/"));
        assert!(result2.tree.contains("level2/"));
        assert!(!result2.tree.contains("level3/"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_file_tree_filters_ignored_directories() {
        let root = unique_temp_dir("file_tree_filter");
        fs::create_dir_all(&root).expect("create temp root");

        let src_dir = format!("{root}{}src", std::path::MAIN_SEPARATOR);
        fs::create_dir_all(&src_dir).expect("create src dir");
        let src_file = format!("{src_dir}{}app.ts", std::path::MAIN_SEPARATOR);
        fs::write(&src_file, "code").expect("write app.ts");

        let node_modules = format!("{root}{}node_modules", std::path::MAIN_SEPARATOR);
        fs::create_dir_all(&node_modules).expect("create node_modules");
        let nm_file = format!("{node_modules}{}package.json", std::path::MAIN_SEPARATOR);
        fs::write(&nm_file, "{}").expect("write package.json");

        let git_dir = format!("{root}{}.git", std::path::MAIN_SEPARATOR);
        fs::create_dir_all(&git_dir).expect("create .git");

        let result =
            file_ops::get_file_tree_impl(Some(root.clone()), Some(3), Some(false)).expect("get tree ok");

        assert!(result.tree.contains("src/"));
        assert!(result.tree.contains("app.ts"));
        assert!(!result.tree.contains("node_modules"));
        assert!(!result.tree.contains(".git"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_file_tree_dirs_only_mode() {
        let root = unique_temp_dir("file_tree_dirs_only");
        fs::create_dir_all(&root).expect("create temp root");

        let src_dir = format!("{root}{}src", std::path::MAIN_SEPARATOR);
        fs::create_dir_all(&src_dir).expect("create src dir");
        let file1 = format!("{src_dir}{}main.rs", std::path::MAIN_SEPARATOR);
        fs::write(&file1, "code").expect("write main.rs");
        let file2 = format!("{root}{}README.md", std::path::MAIN_SEPARATOR);
        fs::write(&file2, "readme").expect("write README.md");

        let result =
            file_ops::get_file_tree_impl(Some(root.clone()), Some(3), Some(true)).expect("get tree ok");

        assert!(result.tree.contains("src/"));
        assert!(!result.tree.contains("main.rs"));
        assert!(!result.tree.contains("README.md"));
        assert_eq!(result.total_files, 0);
        assert!(result.total_dirs >= 1);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_file_tree_returns_error_for_nonexistent_path() {
        let nonexistent = unique_temp_path("nonexistent_dir");
        let result = file_ops::get_file_tree_impl(Some(nonexistent), Some(3), Some(false));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("路径不存在"));
    }

    #[test]
    fn get_file_tree_returns_error_for_file_path() {
        let file_path = unique_temp_path("not_a_dir");
        fs::write(&file_path, "content").expect("write file");

        let result = file_ops::get_file_tree_impl(Some(file_path.clone()), Some(3), Some(false));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("不是目录"));

        let _ = fs::remove_file(file_path);
    }

    #[test]
    fn get_file_info_returns_metadata_for_existing_file() {
        let path = unique_temp_path("file_info_test");
        fs::write(&path, "hello world").expect("write file");

        let result = file_ops::get_file_info_impl(path.clone()).expect("get file info ok");

        assert!(result.exists);
        assert_eq!(result.file_type, "file");
        assert_eq!(result.size_bytes, 11);
        assert!(result.size_human.contains("11"));
        assert!(result.modified.is_some());
        assert!(!result.is_readonly);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn get_file_info_returns_exists_false_for_nonexistent_file() {
        let nonexistent = unique_temp_path("nonexistent");
        let result = file_ops::get_file_info_impl(nonexistent).expect("get file info ok");

        assert!(!result.exists);
        assert_eq!(result.file_type, "unknown");
        assert_eq!(result.size_bytes, 0);
    }

    #[test]
    fn get_file_info_detects_directory() {
        let dir = unique_temp_dir("file_info_dir");
        fs::create_dir_all(&dir).expect("create dir");

        let result = file_ops::get_file_info_impl(dir.clone()).expect("get file info ok");

        assert!(result.exists);
        assert_eq!(result.file_type, "directory");

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn format_file_size_formats_correctly() {
        assert_eq!(format_file_size(0), "0 B");
        assert_eq!(format_file_size(1023), "1023 B");
        assert_eq!(format_file_size(1024), "1.0 KB");
        assert_eq!(format_file_size(1536), "1.5 KB");
        assert_eq!(format_file_size(1048576), "1.0 MB");
        assert_eq!(format_file_size(52428800), "50.0 MB");
        assert_eq!(format_file_size(1073741824), "1.0 GB");
    }

    #[test]
    fn get_file_info_includes_timestamps() {
        let path = unique_temp_path("file_info_timestamps");
        fs::write(&path, "test").expect("write file");

        let result = file_ops::get_file_info_impl(path.clone()).expect("get file info ok");

        assert!(result.created.is_some() || result.modified.is_some());
        assert!(result.modified.is_some());

        let _ = fs::remove_file(path);
    }

    // ==================== Symbol Definition Tests ====================

    #[test]
    fn get_symbol_definition_finds_named_import_interface() {
        let root = unique_temp_dir("symbol_def_named_import");
        fs::create_dir_all(&root).expect("create temp root");

        let types_file = format!("{root}{}types.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &types_file,
            r#"export interface User {
  id: number;
  name: string;
  email: string;
}"#,
        )
        .expect("write types.ts");

        let main_file = format!("{root}{}main.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &main_file,
            r#"import { User } from './types';

const user: User = {
  id: 1,
  name: 'John',
  email: 'john@example.com'
};
"#,
        )
        .expect("write main.ts");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: main_file.clone(),
            symbol_name: "User".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");

        assert_eq!(result.symbol_name, "User");
        assert_eq!(result.definition_type, "interface");
        assert_eq!(result.definition_line, 1);
        assert!(result.definition_code.contains("interface User"));
        assert!(result.definition_code.contains("id: number"));
        assert_eq!(result.import_source, "./types");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_finds_class_definition() {
        let root = unique_temp_dir("symbol_def_class");
        fs::create_dir_all(&root).expect("create temp root");

        let models_file = format!("{root}{}models.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &models_file,
            r#"export class ApiClient {
  constructor(private baseUrl: string) {}
  
  async fetch(path: string) {
    return fetch(`${this.baseUrl}${path}`);
  }
}"#,
        )
        .expect("write models.ts");

        let app_file = format!("{root}{}app.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &app_file,
            r#"import { ApiClient } from './models';

const client = new ApiClient('https://api.example.com');
"#,
        )
        .expect("write app.ts");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: app_file.clone(),
            symbol_name: "ApiClient".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");

        assert_eq!(result.symbol_name, "ApiClient");
        assert_eq!(result.definition_type, "class");
        assert!(result.definition_code.contains("class ApiClient"));
        assert!(result.definition_code.contains("constructor"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_finds_type_alias() {
        let root = unique_temp_dir("symbol_def_type");
        fs::create_dir_all(&root).expect("create temp root");

        let types_file = format!("{root}{}types.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &types_file,
            r#"export type Status = 'pending' | 'active' | 'completed';
export type UserId = string;
"#,
        )
        .expect("write types.ts");

        let main_file = format!("{root}{}main.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &main_file,
            r#"import { Status } from './types';

const status: Status = 'active';
"#,
        )
        .expect("write main.ts");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: main_file.clone(),
            symbol_name: "Status".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");

        assert_eq!(result.symbol_name, "Status");
        assert_eq!(result.definition_type, "type");
        assert!(result.definition_code.contains("type Status"));
        assert!(result.definition_code.contains("pending"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_finds_const_export() {
        let root = unique_temp_dir("symbol_def_const");
        fs::create_dir_all(&root).expect("create temp root");

        let constants_file = format!("{root}{}constants.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &constants_file,
            r#"export const API_URL = 'https://api.example.com';
export const MAX_RETRIES = 3;
"#,
        )
        .expect("write constants.ts");

        let main_file = format!("{root}{}main.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &main_file,
            r#"import { API_URL } from './constants';

console.log(API_URL);
"#,
        )
        .expect("write main.ts");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: main_file.clone(),
            symbol_name: "API_URL".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");

        assert_eq!(result.symbol_name, "API_URL");
        assert_eq!(result.definition_type, "const");
        assert!(result.definition_code.contains("const API_URL"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_resolves_tsx_extension() {
        let root = unique_temp_dir("symbol_def_tsx");
        fs::create_dir_all(&root).expect("create temp root");

        let button_file = format!("{root}{}Button.tsx", std::path::MAIN_SEPARATOR);
        fs::write(
            &button_file,
            r#"export interface ButtonProps {
  label: string;
  onClick: () => void;
}
"#,
        )
        .expect("write Button.tsx");

        let app_file = format!("{root}{}App.tsx", std::path::MAIN_SEPARATOR);
        fs::write(
            &app_file,
            r#"import { ButtonProps } from './Button';

const props: ButtonProps = { label: 'Click', onClick: () => {} };
"#,
        )
        .expect("write App.tsx");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: app_file.clone(),
            symbol_name: "ButtonProps".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");

        assert_eq!(result.symbol_name, "ButtonProps");
        assert_eq!(result.definition_type, "interface");
        assert!(result.resolved_path.ends_with("Button.tsx"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_resolves_index_file() {
        let root = unique_temp_dir("symbol_def_index");
        fs::create_dir_all(&root).expect("create temp root");

        let types_dir = format!("{root}{}types", std::path::MAIN_SEPARATOR);
        fs::create_dir_all(&types_dir).expect("create types dir");
        let index_file = format!("{types_dir}{}index.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &index_file,
            r#"export interface User {
  id: number;
  name: string;
}
"#,
        )
        .expect("write index.ts");

        let main_file = format!("{root}{}main.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &main_file,
            r#"import { User } from './types';

const user: User = { id: 1, name: 'John' };
"#,
        )
        .expect("write main.ts");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: main_file.clone(),
            symbol_name: "User".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");

        assert_eq!(result.symbol_name, "User");
        assert_eq!(result.definition_type, "interface");
        assert!(result.resolved_path.contains("index.ts"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_handles_multiple_imports() {
        let root = unique_temp_dir("symbol_def_multiple");
        fs::create_dir_all(&root).expect("create temp root");

        let types_file = format!("{root}{}types.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &types_file,
            r#"export interface User {
  id: number;
  name: string;
}

export interface Post {
  id: number;
  title: string;
  authorId: number;
}
"#,
        )
        .expect("write types.ts");

        let main_file = format!("{root}{}main.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &main_file,
            r#"import { User, Post } from './types';

const user: User = { id: 1, name: 'John' };
const post: Post = { id: 1, title: 'Hello', authorId: 1 };
"#,
        )
        .expect("write main.ts");

        let result1 = get_symbol_definition(SymbolDefinitionOptions {
            file_path: main_file.clone(),
            symbol_name: "User".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");
        assert_eq!(result1.symbol_name, "User");
        assert!(result1.definition_code.contains("interface User"));

        let result2 = get_symbol_definition(SymbolDefinitionOptions {
            file_path: main_file.clone(),
            symbol_name: "Post".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");
        assert_eq!(result2.symbol_name, "Post");
        assert!(result2.definition_code.contains("interface Post"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_supports_named_import_aliases() {
        let root = unique_temp_dir("symbol_def_named_alias");
        fs::create_dir_all(&root).expect("create temp root");

        let types_file = format!("{root}{}types.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &types_file,
            r#"export interface User {
  id: number;
}
"#,
        )
        .expect("write types.ts");

        let main_file = format!("{root}{}main.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &main_file,
            r#"import { User as AccountUser } from './types';

const user: AccountUser = { id: 1 };
"#,
        )
        .expect("write main.ts");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: main_file.clone(),
            symbol_name: "AccountUser".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");

        assert_eq!(result.symbol_name, "AccountUser");
        assert_eq!(result.definition_type, "interface");
        assert!(result.definition_code.contains("interface User"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_returns_error_for_missing_symbol() {
        let root = unique_temp_dir("symbol_def_missing");
        fs::create_dir_all(&root).expect("create temp root");

        let main_file = format!("{root}{}main.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &main_file,
            r#"import { User } from './types';

const user: User = { id: 1, name: 'John' };
"#,
        )
        .expect("write main.ts");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: main_file.clone(),
            symbol_name: "NonExistent".to_string(),
            line_number: None,
        });

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Symbol not found"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_returns_error_for_missing_file() {
        let root = unique_temp_dir("symbol_def_missing_file");
        fs::create_dir_all(&root).expect("create temp root");

        let main_file = format!("{root}{}main.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &main_file,
            r#"import { User } from './types';

const user: User = { id: 1, name: 'John' };
"#,
        )
        .expect("write main.ts");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: main_file.clone(),
            symbol_name: "User".to_string(),
            line_number: None,
        });

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Import source file not found"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_handles_parent_directory_imports() {
        let root = unique_temp_dir("symbol_def_parent");
        fs::create_dir_all(&root).expect("create temp root");

        let types_file = format!("{root}{}types.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &types_file,
            r#"export interface Config {
  apiUrl: string;
  timeout: number;
}
"#,
        )
        .expect("write types.ts");

        let src_dir = format!("{root}{}src", std::path::MAIN_SEPARATOR);
        fs::create_dir_all(&src_dir).expect("create src dir");

        let main_file = format!("{src_dir}{}main.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &main_file,
            r#"import { Config } from '../types';

const config: Config = { apiUrl: 'https://api.example.com', timeout: 5000 };
"#,
        )
        .expect("write main.ts");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: main_file.clone(),
            symbol_name: "Config".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");

        assert_eq!(result.symbol_name, "Config");
        assert_eq!(result.definition_type, "interface");
        assert!(result.definition_code.contains("interface Config"));
        assert_eq!(result.import_source, "../types");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_handles_multiline_imports() {
        let root = unique_temp_dir("symbol_def_multiline");
        fs::create_dir_all(&root).expect("create temp root");

        let types_file = format!("{root}{}types.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &types_file,
            r#"export interface User {
  id: number;
  name: string;
}

export interface Post {
  id: number;
  title: string;
}

export interface Comment {
  id: number;
  text: string;
}
"#,
        )
        .expect("write types.ts");

        let main_file = format!("{root}{}main.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &main_file,
            r#"import {
  User,
  Post,
  Comment
} from './types';

const user: User = { id: 1, name: 'John' };
const post: Post = { id: 1, title: 'Hello' };
"#,
        )
        .expect("write main.ts");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: main_file.clone(),
            symbol_name: "User".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");

        assert_eq!(result.symbol_name, "User");
        assert_eq!(result.definition_type, "interface");
        assert!(result.definition_code.contains("interface User"));

        let result2 = get_symbol_definition(SymbolDefinitionOptions {
            file_path: main_file.clone(),
            symbol_name: "Post".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");

        assert_eq!(result2.symbol_name, "Post");
        assert_eq!(result2.definition_type, "interface");
        assert!(result2.definition_code.contains("interface Post"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_finds_current_file_definitions() {
        let root = unique_temp_dir("symbol_def_current_file");
        fs::create_dir_all(&root).expect("create temp root");

        let main_file = format!("{root}{}main.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &main_file,
            r#"import { ExternalUser } from './types';

// Local helper function
function helperFunction(x: number): number {
  return x * 2;
}

// Local interface
interface LocalConfig {
  apiUrl: string;
  timeout: number;
}

const config: LocalConfig = {
  apiUrl: 'https://api.example.com',
  timeout: 5000
};

// Using the helper
const result = helperFunction(10);
"#,
        )
        .expect("write main.ts");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: main_file.clone(),
            symbol_name: "helperFunction".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");

        assert_eq!(result.symbol_name, "helperFunction");
        assert_eq!(result.definition_type, "function");
        assert!(result.definition_code.contains("function helperFunction"));
        assert_eq!(result.import_source, "(current file)");

        let result2 = get_symbol_definition(SymbolDefinitionOptions {
            file_path: main_file.clone(),
            symbol_name: "LocalConfig".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");

        assert_eq!(result2.symbol_name, "LocalConfig");
        assert_eq!(result2.definition_type, "interface");
        assert!(result2.definition_code.contains("interface LocalConfig"));
        assert_eq!(result2.import_source, "(current file)");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_handles_path_aliases() {
        let root = unique_temp_dir("symbol_def_path_alias");
        fs::create_dir_all(&root).expect("create temp root");

        let package_json = format!("{root}{}package.json", std::path::MAIN_SEPARATOR);
        fs::write(&package_json, r#"{"name": "test-project"}"#).expect("write package.json");

        let src_dir = format!("{root}{}src", std::path::MAIN_SEPARATOR);
        let types_dir = format!("{src_dir}{}types", std::path::MAIN_SEPARATOR);
        fs::create_dir_all(&types_dir).expect("create types dir");
        let user_file = format!("{types_dir}{}user.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &user_file,
            r#"export interface User {
  id: number;
  name: string;
  email: string;
}
"#,
        )
        .expect("write user.ts");

        let components_dir = format!("{src_dir}{}components", std::path::MAIN_SEPARATOR);
        fs::create_dir_all(&components_dir).expect("create components dir");
        let userlist_file = format!("{components_dir}{}UserList.tsx", std::path::MAIN_SEPARATOR);
        fs::write(
            &userlist_file,
            r#"import { User } from '@/types/user';

const users: User[] = [];
"#,
        )
        .expect("write UserList.tsx");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: userlist_file.clone(),
            symbol_name: "User".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");

        assert_eq!(result.symbol_name, "User");
        assert_eq!(result.definition_type, "interface");
        assert!(result.definition_code.contains("interface User"));
        assert_eq!(result.import_source, "@/types/user");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_extracts_complete_class_with_braces() {
        let root = unique_temp_dir("symbol_def_complete_class");
        fs::create_dir_all(&root).expect("create temp root");

        let api_file = format!("{root}{}api.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &api_file,
            r#"export class ApiClient {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl: string, timeout: number = 5000) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  async get(path: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`);
    return response.json();
  }

  async post(path: string, data: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return response.json();
  }

  async delete(path: string): Promise<void> {
    await fetch(`${this.baseUrl}${path}`, { method: 'DELETE' });
  }
}

export const defaultClient = new ApiClient('https://api.example.com');
"#,
        )
        .expect("write api.ts");

        let main_file = format!("{root}{}main.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &main_file,
            r#"import { ApiClient } from './api';

const client = new ApiClient('https://api.example.com');
"#,
        )
        .expect("write main.ts");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: main_file.clone(),
            symbol_name: "ApiClient".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");

        assert_eq!(result.symbol_name, "ApiClient");
        assert_eq!(result.definition_type, "class");

        assert!(result.definition_code.contains("class ApiClient"));
        assert!(result.definition_code.contains("constructor"));
        assert!(result.definition_code.contains("async get"));
        assert!(result.definition_code.contains("async post"));
        assert!(result.definition_code.contains("async delete"));

        assert!(result.definition_code.trim().ends_with("}"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_handles_large_interface_with_truncation() {
        let root = unique_temp_dir("symbol_def_large_interface");
        fs::create_dir_all(&root).expect("create temp root");

        let mut interface_lines = vec!["export interface LargeConfig {".to_string()];
        for i in 1..=60 {
            interface_lines.push(format!("  field{}: string;", i));
        }
        interface_lines.push("}".to_string());

        let types_file = format!("{root}{}types.ts", std::path::MAIN_SEPARATOR);
        fs::write(&types_file, interface_lines.join("\n")).expect("write types.ts");

        let main_file = format!("{root}{}main.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &main_file,
            r#"import { LargeConfig } from './types';

const config: LargeConfig = {} as any;
"#,
        )
        .expect("write main.ts");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: main_file.clone(),
            symbol_name: "LargeConfig".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");

        assert_eq!(result.symbol_name, "LargeConfig");
        assert_eq!(result.definition_type, "interface");

        assert!(result.definition_code.contains("interface LargeConfig"));
        assert!(result
            .definition_code
            .contains("(definition truncated, exceeds 50 lines)"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_handles_import_without_semicolon() {
        let root = unique_temp_dir("symbol_def_no_semicolon");
        fs::create_dir_all(&root).expect("create temp root");

        let types_file = format!("{root}{}types.ts", std::path::MAIN_SEPARATOR);
        fs::write(&types_file, r#"export interface User { id: number; }"#).expect("write types.ts");

        let main_file = format!("{root}{}main.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &main_file,
            r#"import { User } from './types'

const user: User = { id: 1 };
"#,
        )
        .expect("write main.ts");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: main_file.clone(),
            symbol_name: "User".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");

        assert_eq!(result.symbol_name, "User");
        assert_eq!(result.definition_type, "interface");
        assert!(result.definition_code.contains("interface User"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_matches_multiline_import_line_hint() {
        let root = unique_temp_dir("symbol_def_multiline_line_hint");
        fs::create_dir_all(&root).expect("create temp root");

        let types_file = format!("{root}{}types.ts", std::path::MAIN_SEPARATOR);
        fs::write(&types_file, r#"export interface User { id: number; }"#).expect("write types.ts");

        let main_file = format!("{root}{}main.ts", std::path::MAIN_SEPARATOR);
        fs::write(
            &main_file,
            r#"import {
  User,
} from './types';

const u: User = { id: 1 };
"#,
        )
        .expect("write main.ts");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: main_file.clone(),
            symbol_name: "User".to_string(),
            line_number: Some(2),
        })
        .expect("get symbol definition ok");

        assert_eq!(result.symbol_name, "User");
        assert_eq!(result.definition_type, "interface");
        assert!(result.definition_code.contains("interface User"));
        assert_eq!(result.import_source, "./types");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_resolves_vue_default_component() {
        let root = unique_temp_dir("symbol_def_vue_default_component");
        fs::create_dir_all(&root).expect("create temp root");

        let component_file = format!("{root}{}AppHeader.vue", std::path::MAIN_SEPARATOR);
        fs::write(
            &component_file,
            r#"<template>
  <header class="app-header">Header</header>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'AppHeader',
  props: {
    title: {
      type: String,
      required: true,
    },
  },
});
</script>
"#,
        )
        .expect("write AppHeader.vue");

        let main_file = format!("{root}{}App.vue", std::path::MAIN_SEPARATOR);
        fs::write(
            &main_file,
            r#"import AppHeader from './AppHeader.vue';

const header = AppHeader;
"#,
        )
        .expect("write App.vue");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: main_file.clone(),
            symbol_name: "AppHeader".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");

        assert_eq!(result.symbol_name, "AppHeader");
        assert_eq!(result.definition_type, "component");
        assert!(result.resolved_path.ends_with("AppHeader.vue"));
        assert!(result
            .definition_code
            .contains("export default defineComponent"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_resolves_vue_script_setup_component() {
        let root = unique_temp_dir("symbol_def_vue_script_setup_component");
        fs::create_dir_all(&root).expect("create temp root");

        let component_file = format!("{root}{}AppFooter.vue", std::path::MAIN_SEPARATOR);
        fs::write(
            &component_file,
            r#"<template>
  <footer class="app-footer">{{ label }}</footer>
</template>

<script setup lang="ts">
defineProps<{
  label: string;
}>();
</script>
"#,
        )
        .expect("write AppFooter.vue");

        let main_file = format!("{root}{}App.vue", std::path::MAIN_SEPARATOR);
        fs::write(
            &main_file,
            r#"import AppFooter from './AppFooter.vue';

const footer = AppFooter;
"#,
        )
        .expect("write App.vue");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: main_file.clone(),
            symbol_name: "AppFooter".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");

        assert_eq!(result.symbol_name, "AppFooter");
        assert_eq!(result.definition_type, "component");
        assert!(result.resolved_path.ends_with("AppFooter.vue"));
        assert!(result
            .definition_code
            .contains("<script setup lang=\"ts\">"));
        assert!(result.definition_code.contains("defineProps"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_finds_vue_component_by_convention_without_import() {
        let root = unique_temp_dir("symbol_def_vue_convention");
        let src_dir = format!("{root}{}src", std::path::MAIN_SEPARATOR);
        let components_dir = format!("{src_dir}{}components", std::path::MAIN_SEPARATOR);
        let pages_dir = format!("{src_dir}{}pages", std::path::MAIN_SEPARATOR);
        fs::create_dir_all(&components_dir).expect("create components dir");
        fs::create_dir_all(&pages_dir).expect("create pages dir");
        fs::write(
            format!("{root}{}package.json", std::path::MAIN_SEPARATOR),
            r#"{"name":"vue-symbol-test"}"#,
        )
        .expect("write package.json");

        let component_file = format!("{components_dir}{}AppHeader.vue", std::path::MAIN_SEPARATOR);
        fs::write(
            &component_file,
            r#"<template>
  <header>{{ title }}</header>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
}>();
</script>
"#,
        )
        .expect("write AppHeader.vue");

        let page_file = format!("{pages_dir}{}HomePage.vue", std::path::MAIN_SEPARATOR);
        fs::write(
            &page_file,
            r#"<template>
  <AppHeader title="Hello" />
</template>
"#,
        )
        .expect("write HomePage.vue");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: page_file.clone(),
            symbol_name: "AppHeader".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");

        assert_eq!(result.definition_type, "component");
        assert_eq!(result.import_source, "(vue component convention)");
        assert!(result.resolved_path.ends_with("AppHeader.vue"));
        assert!(result.definition_code.contains("defineProps"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_symbol_definition_matches_kebab_case_vue_component_tags() {
        let root = unique_temp_dir("symbol_def_vue_kebab_case");
        let src_dir = format!("{root}{}src", std::path::MAIN_SEPARATOR);
        let components_dir = format!("{src_dir}{}components", std::path::MAIN_SEPARATOR);
        let pages_dir = format!("{src_dir}{}pages", std::path::MAIN_SEPARATOR);
        fs::create_dir_all(&components_dir).expect("create components dir");
        fs::create_dir_all(&pages_dir).expect("create pages dir");
        fs::write(
            format!("{root}{}package.json", std::path::MAIN_SEPARATOR),
            r#"{"name":"vue-symbol-test"}"#,
        )
        .expect("write package.json");

        let component_dir = format!("{components_dir}{}AppFooter", std::path::MAIN_SEPARATOR);
        fs::create_dir_all(&component_dir).expect("create AppFooter dir");
        let component_file = format!("{component_dir}{}index.vue", std::path::MAIN_SEPARATOR);
        fs::write(
            &component_file,
            r#"<template>
  <footer>{{ label }}</footer>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'AppFooter',
  props: {
    label: {
      type: String,
      required: true,
    },
  },
});
</script>
"#,
        )
        .expect("write AppFooter/index.vue");

        let page_file = format!("{pages_dir}{}HomePage.vue", std::path::MAIN_SEPARATOR);
        fs::write(
            &page_file,
            r#"<template>
  <app-footer label="Bye" />
</template>
"#,
        )
        .expect("write HomePage.vue");

        let result = get_symbol_definition(SymbolDefinitionOptions {
            file_path: page_file.clone(),
            symbol_name: "app-footer".to_string(),
            line_number: None,
        })
        .expect("get symbol definition ok");

        assert_eq!(result.definition_type, "component");
        assert_eq!(result.import_source, "(vue component convention)");
        assert!(
            result.resolved_path.ends_with("AppFooter\\index.vue")
                || result.resolved_path.ends_with("AppFooter/index.vue")
        );
        assert!(result.definition_code.contains("defineComponent"));

        let _ = fs::remove_dir_all(root);
    }
}
