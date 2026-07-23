//! Unified Tauri command registration.
//!
//! Phase 1: all commands are registered here so `lib.rs` stays thin.
//! Command **names** are unchanged (function names), so the frontend `invoke` API is transparent.
//!
//! Module paths use crate-root re-exports (`crate::terminal::…`) for stability.

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use crate::live_server::{LiveServerManager, LiveServerStatus};

// ============================================================================
// Live Server commands (app-level glue)
// ============================================================================

#[tauri::command]
async fn start_live_server(
    state: tauri::State<'_, LiveServerManager>,
    root: String,
) -> Result<LiveServerStatus, String> {
    state.start(root).await
}

#[tauri::command]
fn stop_live_server(state: tauri::State<'_, LiveServerManager>) -> Result<(), String> {
    state.stop()
}

#[tauri::command]
fn get_live_server_status(state: tauri::State<'_, LiveServerManager>) -> LiveServerStatus {
    state.status()
}

// ============================================================================
// Agent Window - independent window management
// ============================================================================

#[tauri::command]
async fn open_agent_window(app: tauri::AppHandle, project_path: String) -> Result<(), String> {
    let label = "agent-window";

    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.show();
        let _ = existing.unminimize();
        existing
            .set_focus()
            .map_err(|e| format!("聚焦 Agent 窗口失败: {}", e))?;
        return Ok(());
    }

    let encoded_path = crate::editor_settings::percent_encode_path(&project_path);
    let webview_url = {
        #[cfg(debug_assertions)]
        {
            let url_str = format!(
                "http://localhost:1420/?window=agent&projectPath={}",
                encoded_path
            );
            WebviewUrl::External(
                url_str
                    .parse()
                    .map_err(|e| format!("无效的 Agent 窗口 URL: {}", e))?,
            )
        }
        #[cfg(not(debug_assertions))]
        {
            WebviewUrl::App(format!("/?window=agent&projectPath={}", encoded_path).into())
        }
    };

    let _webview_window = WebviewWindowBuilder::new(&app, label, webview_url)
        .title("Agent")
        .inner_size(1400.0, 900.0)
        .min_inner_size(600.0, 400.0)
        .center()
        .decorations(false)
        .visible(false)
        .build()
        .map_err(|e| format!("创建 Agent 窗口失败: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn show_agent_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("agent-window") {
        window
            .show()
            .map_err(|e| format!("显示 Agent 窗口失败: {}", e))?;
        window
            .set_focus()
            .map_err(|e| format!("聚焦 Agent 窗口失败: {}", e))?;
    }
    Ok(())
}

/// Attach the full command table to the Tauri builder.
///
/// Keeps command names identical to the pre-refactor registration so frontend
/// `invoke("…")` strings do not need to change.
pub fn attach_handlers(
    builder: tauri::Builder<tauri::Wry>,
) -> tauri::Builder<tauri::Wry> {
    builder.invoke_handler(tauri::generate_handler![
        // terminal
        crate::terminal::ensure_terminal,
        crate::terminal::create_terminal,
        crate::terminal::set_active_terminal,
        crate::terminal::write_to_terminal,
        crate::terminal::get_terminal_output,
        crate::terminal::set_terminal_size,
        crate::terminal::close_terminal,
        crate::terminal::execute_command,
        crate::terminal::execute_command_bg,
        crate::sandbox::set_sandbox_context,
        crate::sandbox::begin_sandbox_execution,
        crate::sandbox::end_sandbox_execution,
        crate::terminal::check_background_command,
        crate::terminal::kill_background_command,
        crate::terminal::list_background_commands,
        // file_ops
        crate::file_ops::read_file_content,
        crate::file_ops::read_file_content_tool,
        crate::file_ops::write_file_content,
        crate::file_ops::edit_file,
        crate::file_ops::open_folder,
        crate::file_ops::read_folder_children,
        crate::file_ops::create_file,
        crate::file_ops::create_folder,
        crate::file_ops::move_file_or_folder,
        crate::file_ops::copy_file_or_folder,
        crate::file_ops::delete_file_or_folder,
        crate::file_ops::file_ops_tool,
        crate::file_ops::search_in_folder,
        crate::file_ops::glob_search_files,
        crate::file_ops::get_file_tree,
        crate::file_ops::get_file_info,
        crate::file_ops::check_git_repo,
        crate::file_ops::find_windows_reserved_repo_files,
        // git
        crate::git_diff::get_git_diff,
        crate::git_diff::undo_changes,
        crate::git_workspace::git_workspace_snapshot,
        crate::git_workspace::git_workspace_stage,
        crate::git_workspace::git_workspace_unstage,
        crate::git_workspace::git_workspace_stage_all,
        crate::git_workspace::git_workspace_unstage_all,
        crate::git_workspace::git_workspace_discard_all,
        crate::git_workspace::git_workspace_commit,
        crate::git_workspace::git_workspace_checkout,
        crate::git_workspace::git_workspace_abort_merge,
        crate::git_workspace::git_workspace_merge_continue,
        crate::git_workspace::git_workspace_prepare_diff,
        crate::git_workspace::git_workspace_push,
        crate::git_workspace::git_workspace_sync_remote,
        crate::git_workspace::git_workspace_undo_last_commit,
        crate::git_workspace::git_workspace_log,
        crate::git_workspace::git_workspace_blame,
        crate::git_workspace::git_workspace_commit_detail,
        crate::git_workspace::git_workspace_create_branch,
        crate::git_workspace::git_workspace_delete_branch,
        crate::git_workspace::git_workspace_rename_branch,
        crate::git_workspace::git_workspace_stash_save,
        crate::git_workspace::git_workspace_stash_list,
        crate::git_workspace::git_workspace_stash_pop,
        crate::git_workspace::git_workspace_stash_apply,
        crate::git_workspace::git_workspace_stash_drop,
        crate::symbol_definition::get_symbol_definition,
        // live server + ports
        start_live_server,
        stop_live_server,
        get_live_server_status,
        crate::port_manager::list_listening_ports,
        crate::port_manager::kill_port_process,
        crate::port_manager::get_process_executable_path,
        // chat / AI
        crate::chat::save_ai_config,
        crate::chat::load_ai_config,
        crate::chat::test_ai_connection,
        crate::chat::list_ai_models,
        crate::chat::builtin_gateway_health,
        crate::chat::builtin_gateway_activate,
        crate::chat::builtin_gateway_list_models,
        crate::chat::builtin_gateway_get_quota,
        crate::image_gen::generate_image,
        crate::image_gen::test_image_generation,
        crate::chat::generate_conversation_title,
        crate::chat::generate_compact_summary,
        crate::chat::send_ai_chat_stream,
        crate::chat::cancel_ai_chat,
        // conversation
        crate::conversation::save_chat_image,
        crate::conversation::save_chat_image_from_path,
        crate::conversation::list_conversations,
        crate::conversation::load_conversation,
        crate::conversation::save_conversation,
        crate::conversation::create_conversation,
        crate::conversation::delete_conversation,
        crate::conversation::cleanup_old_conversations,
        crate::conversation::cleanup_orphan_chat_images,
        crate::conversation::cleanup_unreferenced_chat_images,
        crate::conversation::rename_conversation,
        // agent store
        crate::agent_store::get_agents,
        crate::agent_store::create_agent,
        crate::agent_store::update_agent,
        crate::agent_store::delete_agent,
        crate::agent_store::get_last_selected_agent_id,
        crate::agent_store::set_last_selected_agent_id,
        crate::agent_store::get_agent_storage_path,
        crate::agent_store::get_project_storage_key,
        crate::agent_store::get_agent,
        crate::agent_store::save_agent,
        crate::agent_store::get_project_state,
        crate::agent_store::save_project_state,
        crate::agent_store::get_projects_index,
        crate::agent_store::touch_project_index,
        crate::agent_store::delete_project_state,
        crate::agent_store::migrate_to_single_agent,
        crate::agent_store::get_agent_full_state,
        crate::agent_store::save_agent_full_state,
        crate::agent_store::load_agent_session_extras,
        crate::agent_store::save_agent_session_extras,
        crate::agent_store::save_todos,
        crate::agent_store::load_todos,
        crate::chat::fetch_web_content_v3,
        crate::chat::web_search,
        crate::conversation::get_conversations_path,
        // file watcher
        crate::file_watcher::watch_file,
        crate::file_watcher::unwatch_file,
        crate::file_watcher::start_watching,
        crate::file_watcher::stop_watching,
        // browser
        crate::browser::open_browser_window,
        crate::browser::navigate_browser,
        crate::browser::close_browser_window,
        crate::browser::get_browser_status,
        // CDP browser (system Chrome/Edge via DevTools Protocol)
        crate::cdp_browser::cdp_browser_status,
        crate::cdp_browser::cdp_browser_detect,
        crate::cdp_browser::cdp_browser_start,
        crate::cdp_browser::cdp_browser_stop,
        crate::cdp_browser::cdp_browser_navigate,
        crate::cdp_browser::cdp_browser_click,
        crate::cdp_browser::cdp_browser_type,
        crate::cdp_browser::cdp_browser_press_key,
        crate::cdp_browser::cdp_browser_content,
        crate::cdp_browser::cdp_browser_evaluate,
        crate::cdp_browser::cdp_browser_wait_for_selector,
        crate::cdp_browser::cdp_browser_screenshot,
        crate::cdp_browser::cdp_browser_refresh,
        // MCP
        crate::mcp::start_mcp_server,
        crate::mcp::start_mcp_servers_async,
        crate::mcp::stop_mcp_server,
        crate::mcp::start_single_mcp,
        crate::mcp::stop_single_mcp,
        crate::mcp::get_mcp_status,
        crate::mcp::list_mcp_tools,
        crate::mcp::get_mcp_tool_schemas,
        crate::mcp::call_mcp_tool,
        crate::mcp::list_mcp_resources,
        crate::mcp::read_mcp_resource,
        crate::mcp::list_mcp_prompts,
        crate::mcp::get_mcp_prompt,
        crate::mcp::save_mcp_config,
        crate::mcp::load_mcp_config,
        crate::mcp::get_mcp_config_path,
        crate::mcp::open_mcp_config_file,
        crate::mcp::get_claude_config_path,
        crate::mcp::open_claude_config_file,
        crate::mcp::save_claude_config,
        // editor / prompts
        crate::editor_settings::save_editor_settings,
        crate::editor_settings::load_editor_settings,
        crate::usage_tracking::save_usage,
        crate::usage_tracking::load_usage,
        crate::chat::save_prompts,
        crate::chat::load_prompts,
        crate::chat::get_prompts_config_path,
        crate::chat::get_app_data_path,
        // app windows
        open_agent_window,
        show_agent_window,
        crate::debug_log::debug_log,
        // worktree / automation
        crate::git_worktree::get_claude_user_agents_dir,
        crate::git_worktree::create_subagent_worktree,
        crate::git_worktree::cleanup_subagent_worktree,
        crate::git_worktree::run_subagent_hooks,
        crate::checkpoint::checkpoint_create,
        crate::checkpoint::checkpoint_list,
        crate::checkpoint::checkpoint_get,
        crate::checkpoint::checkpoint_restore,
        crate::checkpoint::checkpoint_clear_session,
        crate::automation::agent_automation_list,
        crate::automation::agent_automation_create,
        crate::automation::agent_automation_update,
        crate::automation::agent_automation_delete,
        crate::automation::agent_automation_set_enabled,
        crate::automation::agent_automation_run_now,
        crate::automation::agent_automation_record_run,
        // CBM
        crate::cbm::commands::cbm_graph,
        crate::cbm::commands::cbm_sidecar_available,
        crate::cbm::commands::cbm_schedule_workspace_index,
        crate::cbm::commands::cbm_delete_workspace_index,
        crate::cbm::commands::cbm_list_indexed_projects,
        crate::cbm::commands::cbm_storage_info,
        crate::cbm::commands::cbm_sync_config,
        crate::cbm::commands::cbm_ui_status,
        crate::cbm::commands::cbm_start_ui,
        crate::cbm::commands::cbm_stop_ui,
        // audit
        crate::audit_log::get_audit_logs,
        crate::audit_log::clear_audit_logs,
        crate::audit_log::audit_log_count,
        crate::audit_log::audit_path_denied,
    ])
}
