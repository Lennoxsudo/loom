//! Structured audit logging for sandbox decisions (P2)
//!
//! Every sandbox validation (read, write, command, network, dangerous command)
//! records a structured entry. Entries are kept in an in-memory ring buffer
//! capped at [`MAX_AUDIT_ENTRIES`]. The buffer can be queried via Tauri
//! commands for the frontend audit log panel.

use serde::Serialize;
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
}

// ============================================================================
// In-memory ring buffer
// ============================================================================

/// Maximum number of entries retained in memory.
const MAX_AUDIT_ENTRIES: usize = 500;

static AUDIT_LOG: Lazy<Mutex<Vec<AuditEntry>>> =
    Lazy::new(|| Mutex::new(Vec::new()));

/// Record a single audit entry.
pub fn record(entry: AuditEntry) {
    if let Ok(mut log) = AUDIT_LOG.lock() {
        log.push(entry);
        if log.len() > MAX_AUDIT_ENTRIES {
            let excess = log.len() - MAX_AUDIT_ENTRIES;
            log.drain(0..excess);
        }
    }
}

/// Convenience helper — builds and records an entry in one call.
#[allow(clippy::too_many_arguments)]
pub fn log_decision(
    source: &str,
    action: &str,
    target: &str,
    decision: &str,
    reason: Option<&str>,
    access_mode: &str,
) {
    record(AuditEntry {
        timestamp: chrono::Utc::now().to_rfc3339(),
        source: source.to_string(),
        action: action.to_string(),
        target: target.to_string(),
        decision: decision.to_string(),
        reason: reason.map(|s| s.to_string()),
        access_mode: access_mode.to_string(),
    });
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

/// Clear all audit entries.
pub fn clear() {
    if let Ok(mut log) = AUDIT_LOG.lock() {
        log.clear();
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

    /// Get only entries whose target starts with `prefix`.
    fn entries_with_prefix(prefix: &str) -> Vec<AuditEntry> {
        get_entries(None)
            .into_iter()
            .filter(|e| e.target.starts_with(prefix))
            .collect()
    }

    #[test]
    fn record_and_retrieve() {
        let _guard = TEST_LOCK.lock().unwrap();
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
        let _guard = TEST_LOCK.lock().unwrap();
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
        let _guard = TEST_LOCK.lock().unwrap();
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
        let _guard = TEST_LOCK.lock().unwrap();
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
        let _guard = TEST_LOCK.lock().unwrap();
        let p = "test://rs/";
        log_decision("ai", "read", &format!("{p}denied"), "denied", Some("forbidden"), "auto");
        log_decision("ai", "read", &format!("{p}allowed"), "allowed", None, "auto");
        let entries = entries_with_prefix(p);
        assert_eq!(entries.len(), 2);
        // Newest first: allowed entry was added last
        assert!(entries[0].reason.is_none(), "allowed entry should have no reason");
        assert!(entries[1].reason.is_some(), "denied entry should have a reason");
    }
}
