//! Structured audit logging for sandbox decisions (P2)
//!
//! Every sandbox validation (read, write, command, network, dangerous command)
//! records a structured entry. Entries are kept in an in-memory ring buffer
//! capped at [`MAX_AUDIT_ENTRIES`] **and** appended to a JSONL file on disk
//! so they survive application restarts. The buffer can be queried via Tauri
//! commands for the frontend audit log panel.

use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use once_cell::sync::Lazy;

// ============================================================================
// AuditEntry
// ============================================================================

/// A single sandbox audit decision.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    /// ISO 8601 timestamp (UTC).
    pub timestamp: String,
    /// Who initiated the action: `"ai"` or `"user"`.
    pub source: String,
    /// What was attempted: `read`, `write`, `command`, `network`, `dangerous_command`.
    pub action: String,
    /// The target: file path, command string, or host.
    pub target: String,
    /// `"allowed"` or `"denied"`.
    pub decision: String,
    /// Error message when denied, or a short reason when allowed with caveats.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// The sandbox access mode at the time: `read_only`, `auto`, `full_access`.
    pub access_mode: String,
    /// Agent / chat session id when known (phase 2).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Per-execution id (agent turn / subagent) when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_id: Option<String>,
    /// Tool name when the decision was made inside a tool call.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
}

// ============================================================================
// In-memory ring buffer
// ============================================================================

/// Maximum number of entries retained in memory.
const MAX_AUDIT_ENTRIES: usize = 500;

static AUDIT_LOG: Lazy<Mutex<Vec<AuditEntry>>> =
    Lazy::new(|| Mutex::new(Vec::new()));

/// Optional on-disk log file path (JSONL). Set once during app startup via
/// [`set_log_file`]. When set, every recorded entry is appended to this file
/// in addition to the in-memory ring buffer, ensuring audit data survives
/// application restarts.
static AUDIT_FILE: Lazy<Mutex<Option<PathBuf>>> =
    Lazy::new(|| Mutex::new(None));

/// Set the on-disk audit log file path. Called once during app startup.
/// When set, [`record`] appends each entry as a JSON line to this file.
pub fn set_log_file(path: PathBuf) {
    if let Ok(mut f) = AUDIT_FILE.lock() {
        *f = Some(path);
    }
}

/// Record a single audit entry.
///
/// The entry is stored in the in-memory ring buffer **and** appended to the
/// on-disk JSONL file (if configured via [`set_log_file`]). Disk write
/// failures are silently ignored — the in-memory buffer remains the source
/// of truth for the current session, and the file is best-effort persistence.
pub fn record(entry: AuditEntry) {
    // Append to disk first (best-effort) so the entry survives even if the
    // in-memory push panics for some reason.
    if let Ok(file_guard) = AUDIT_FILE.lock() {
        if let Some(ref path) = *file_guard {
            if let Ok(json) = serde_json::to_string(&entry) {
                use std::io::Write;
                // Open in append mode; create if missing.
                if let Ok(mut f) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(path)
                {
                    let _ = writeln!(f, "{json}");
                }
            }
        }
    }

    if let Ok(mut log) = AUDIT_LOG.lock() {
        log.push(entry);
        if log.len() > MAX_AUDIT_ENTRIES {
            let excess = log.len() - MAX_AUDIT_ENTRIES;
            log.drain(0..excess);
        }
    }
}

/// Convenience helper — builds and records an entry in one call.
///
/// Session / execution / tool fields are taken from the thread-local
/// [`super::context::current_audit_meta`] stack when present.
#[allow(clippy::too_many_arguments)]
pub fn log_decision(
    source: &str,
    action: &str,
    target: &str,
    decision: &str,
    reason: Option<&str>,
    access_mode: &str,
) {
    let meta = super::context::current_audit_meta();
    log_decision_with_meta(
        source,
        action,
        target,
        decision,
        reason,
        access_mode,
        meta.session_id,
        meta.execution_id,
        meta.tool_name,
    );
}

/// Like [`log_decision`], but allows explicit correlation fields
/// (used when frontend path containment fails before any tool stack exists).
#[allow(clippy::too_many_arguments)]
pub fn log_decision_with_meta(
    source: &str,
    action: &str,
    target: &str,
    decision: &str,
    reason: Option<&str>,
    access_mode: &str,
    session_id: Option<String>,
    execution_id: Option<String>,
    tool_name: Option<String>,
) {
    let meta = super::context::current_audit_meta();
    record(AuditEntry {
        timestamp: chrono::Utc::now().to_rfc3339(),
        source: source.to_string(),
        action: action.to_string(),
        target: target.to_string(),
        decision: decision.to_string(),
        reason: reason.map(|s| s.to_string()),
        access_mode: access_mode.to_string(),
        session_id: session_id.or(meta.session_id),
        execution_id: execution_id.or(meta.execution_id),
        tool_name: tool_name.or(meta.tool_name),
    });
}

/// Record a path-containment / sandbox deny that happened before `validate_*`.
pub fn log_path_denied(target: &str, reason: &str, access_mode: &str) {
    log_decision(
        "ai",
        "read",
        target,
        "denied",
        Some(reason),
        access_mode,
    );
}

/// Return the most recent `limit` entries (newest first).
/// If `limit` is `None`, returns all entries.
pub fn get_entries(limit: Option<usize>) -> Vec<AuditEntry> {
    let log = AUDIT_LOG.lock().ok();
    let log = match log {
        Some(g) => g,
        None => return vec![],
    };
    let limit = limit.unwrap_or(log.len());
    log.iter()
        .rev()
        .take(limit)
        .cloned()
        .collect()
}

/// Clear all audit entries, both in-memory and on-disk.
pub fn clear() {
    if let Ok(mut log) = AUDIT_LOG.lock() {
        log.clear();
    }
    // Truncate the on-disk file as well.
    if let Ok(file_guard) = AUDIT_FILE.lock() {
        if let Some(ref path) = *file_guard {
            let _ = std::fs::File::create(path); // truncate
        }
    }
}

/// Current entry count (for diagnostics).
pub fn len() -> usize {
    AUDIT_LOG.lock().map(|l| l.len()).unwrap_or(0)
}

/// Whether the log is empty.
#[allow(dead_code)]
pub fn is_empty() -> bool {
    AUDIT_LOG.lock().map(|l| l.is_empty()).unwrap_or(true)
}

// ============================================================================
// Tauri commands
// ============================================================================

/// Fetch recent audit log entries (newest first).
#[tauri::command]
pub fn get_audit_logs(limit: Option<usize>) -> Result<Vec<AuditEntry>, String> {
    Ok(get_entries(limit))
}

/// Frontend path-containment denial (throws before Tauri file commands run).
/// Ensures the audit panel still shows a **denied** row for out-of-workspace paths.
#[tauri::command]
pub fn audit_path_denied(
    path: String,
    reason: Option<String>,
    access_mode: Option<String>,
    tool_name: Option<String>,
    session_id: Option<String>,
    execution_id: Option<String>,
    state: tauri::State<'_, crate::sandbox::SandboxState>,
) -> Result<(), String> {
    let mode = access_mode.unwrap_or_else(|| state.policy_snapshot().access_mode.clone());
    let reason_text = reason.unwrap_or_else(|| {
        format!("路径越界，不允许访问工作区外: {}", path)
    });
    log_decision_with_meta(
        "ai",
        "read",
        &path,
        "denied",
        Some(&reason_text),
        &mode,
        session_id,
        execution_id,
        tool_name,
    );
    Ok(())
}

/// Clear all audit log entries.
#[tauri::command]
pub fn clear_audit_logs() -> Result<(), String> {
    clear();
    Ok(())
}

/// Return the current audit log entry count.
#[tauri::command]
pub fn audit_log_count() -> Result<usize, String> {
    Ok(len())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Serialize tests that share the global AUDIT_LOG to prevent interference
    /// from sandbox tests that also write audit entries.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn lock_tests() -> std::sync::MutexGuard<'static, ()> {
        TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Get only entries whose target starts with `prefix`.
    fn entries_with_prefix(prefix: &str) -> Vec<AuditEntry> {
        get_entries(None)
            .into_iter()
            .filter(|e| e.target.starts_with(prefix))
            .collect()
    }

    #[test]
    fn record_and_retrieve() {
        let _guard = lock_tests();
        let p = "test://rr/";
        log_decision("ai", "read", &format!("{p}etc"), "denied", Some("outside roots"), "auto");
        log_decision("ai", "write", &format!("{p}project"), "allowed", None, "auto");
        log_decision("user", "read", &format!("{p}user_read"), "allowed", None, "read_only");

        let entries = entries_with_prefix(p);
        assert_eq!(entries.len(), 3);
        // Newest first
        assert_eq!(entries[0].source, "user");
        assert_eq!(entries[1].source, "ai");
        assert_eq!(entries[2].source, "ai");
        assert_eq!(entries[2].decision, "denied");
    }

    #[test]
    fn limit_returns_subset() {
        let _guard = lock_tests();
        let p = "test://lr/";
        for i in 0..10 {
            log_decision("ai", "read", &format!("{p}{i}"), "allowed", None, "auto");
        }
        let entries = entries_with_prefix(p);
        assert_eq!(entries.len(), 10);
        // Newest first → first three are the last three recorded
        assert_eq!(entries[0].target, format!("{p}9"));
        assert_eq!(entries[2].target, format!("{p}7"));
    }

    #[test]
    fn ring_buffer_evicts_oldest() {
        let _guard = lock_tests();
        let p = "test://rb/";
        // Fill beyond capacity to test ring buffer eviction.
        for i in 0..(MAX_AUDIT_ENTRIES + 50) {
            log_decision("ai", "read", &format!("{p}{i}"), "allowed", None, "auto");
        }
        let total = len();
        assert!(total <= MAX_AUDIT_ENTRIES, "ring buffer should cap at MAX_AUDIT_ENTRIES, got {total}");
        // Our newest entry should be at the top of the test entries
        let test_entries = entries_with_prefix(p);
        assert!(!test_entries.is_empty());
        assert_eq!(test_entries[0].target, format!("{p}{}", MAX_AUDIT_ENTRIES + 49));
    }

    #[test]
    fn clear_empties_log() {
        let _guard = lock_tests();
        let p = "test://ce/";
        log_decision("ai", "read", &format!("{p}entry"), "allowed", None, "auto");
        let before = entries_with_prefix(p);
        assert!(!before.is_empty());
        clear();
        // After clear, our test entries should be gone
        let after = entries_with_prefix(p);
        assert!(after.is_empty(), "clear should remove all test entries");
    }

    #[test]
    fn reason_is_serialized_as_optional() {
        let _guard = lock_tests();
        let p = "test://rs/";
        log_decision("ai", "read", &format!("{p}denied"), "denied", Some("forbidden"), "auto");
        log_decision("ai", "read", &format!("{p}allowed"), "allowed", None, "auto");
        let entries = entries_with_prefix(p);
        assert_eq!(entries.len(), 2);
        // Newest first: allowed entry was added last
        assert!(entries[0].reason.is_none(), "allowed entry should have no reason");
        assert!(entries[1].reason.is_some(), "denied entry should have a reason");
    }

    #[test]
    fn disk_persistence_writes_jsonl() {
        let _guard = lock_tests();
        let p = "test://dp/";

        // Use a unique temp file so concurrent tests don't interfere.
        let temp = std::env::temp_dir().join(format!(
            "loom_audit_test_{}.jsonl",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        set_log_file(temp.clone());
        log_decision("ai", "read", &format!("{p}entry1"), "denied", Some("outside roots"), "auto");
        log_decision("ai", "write", &format!("{p}entry2"), "allowed", None, "auto");

        // Read the file back — filter to our prefix so concurrent sandbox
        // tests that also hit the global AUDIT_FILE cannot pollute the count.
        let content = std::fs::read_to_string(&temp).expect("audit log file should exist");
        let lines: Vec<&str> = content
            .trim()
            .lines()
            .filter(|l| l.contains(p))
            .collect();
        assert_eq!(lines.len(), 2, "expected 2 JSONL entries for our prefix on disk");

        // Each line must be valid JSON with the expected fields.
        let e1: serde_json::Value =
            serde_json::from_str(lines[0]).expect("first line must be valid JSON");
        assert_eq!(e1["action"], "read");
        assert_eq!(e1["decision"], "denied");

        let e2: serde_json::Value =
            serde_json::from_str(lines[1]).expect("second line must be valid JSON");
        assert_eq!(e2["action"], "write");
        assert_eq!(e2["decision"], "allowed");

        // clear() should truncate the file.
        clear();
        let after = std::fs::read_to_string(&temp).unwrap_or_default();
        assert!(after.is_empty(), "clear() should truncate the on-disk file");

        // Cleanup: unset the log file so other tests don't write to it.
        if let Ok(mut f) = AUDIT_FILE.lock() {
            *f = None;
        }
        let _ = std::fs::remove_file(&temp);
    }

    #[test]
    fn log_decision_picks_up_audit_meta() {
        let _guard = lock_tests();
        let p = "test://meta/";
        crate::security::context::with_audit_meta(
            crate::security::context::AuditMeta {
                session_id: Some("sess-1".into()),
                execution_id: Some("exec-1".into()),
                tool_name: Some("read".into()),
            },
            || {
                log_decision("ai", "read", &format!("{p}file"), "allowed", None, "auto");
            },
        );
        let entries = entries_with_prefix(p);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].session_id.as_deref(), Some("sess-1"));
        assert_eq!(entries[0].execution_id.as_deref(), Some("exec-1"));
        assert_eq!(entries[0].tool_name.as_deref(), Some("read"));
    }

    #[test]
    fn log_path_denied_records_denied_read() {
        let _guard = lock_tests();
        let p = "test://pd/";
        let target = format!("{p}C:\\Windows\\System32\\drivers\\etc\\hosts");
        log_path_denied(&target, "路径越界，不允许访问工作区外", "auto");
        let entries = entries_with_prefix(p);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].decision, "denied");
        assert_eq!(entries[0].action, "read");
        assert_eq!(entries[0].source, "ai");
        assert!(entries[0].reason.as_deref().unwrap_or("").contains("越界"));
    }
}
