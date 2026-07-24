//! Per-execution security context (Phase 2).
//!
//! Workspace policy still lives in [`super::sandbox::SandboxState`], but each
//! agent turn / subagent / automation can register an **execution-scoped**
//! snapshot so concurrent work does not share a single mutable context under
//! one long-held lock.
//!
//! Audit metadata (session / tool / execution id) is carried on a thread-local
//! stack so `validate_*` can enrich logs without changing every call site.

use std::cell::RefCell;
use std::sync::Arc;

use super::sandbox::SandboxContext;

// ============================================================================
// Execution record
// ============================================================================

/// One sandboxed execution (agent turn, subagent, automation run, …).
#[derive(Debug, Clone)]
pub struct ExecutionRecord {
    pub execution_id: String,
    pub session_id: Option<String>,
    pub label: Option<String>,
    /// Immutable policy snapshot for this execution.
    pub sandbox: Arc<SandboxContext>,
}

// ============================================================================
// Thread-local audit / execution metadata
// ============================================================================

/// Fields attached to audit log lines for the current stack frame.
#[derive(Debug, Clone, Default)]
pub struct AuditMeta {
    pub session_id: Option<String>,
    pub execution_id: Option<String>,
    pub tool_name: Option<String>,
}

thread_local! {
    static AUDIT_STACK: RefCell<Vec<AuditMeta>> = const { RefCell::new(Vec::new()) };
}

/// Push audit metadata for the duration of `f`.
pub fn with_audit_meta<F, R>(meta: AuditMeta, f: F) -> R
where
    F: FnOnce() -> R,
{
    AUDIT_STACK.with(|stack| {
        stack.borrow_mut().push(meta);
    });
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
    AUDIT_STACK.with(|stack| {
        let _ = stack.borrow_mut().pop();
    });
    match result {
        Ok(v) => v,
        Err(payload) => std::panic::resume_unwind(payload),
    }
}

/// Current (innermost) audit metadata, if any.
pub fn current_audit_meta() -> AuditMeta {
    AUDIT_STACK.with(|stack| {
        stack
            .borrow()
            .last()
            .cloned()
            .unwrap_or_default()
    })
}

// ============================================================================
// Path containment helpers (shared by sandbox + tool path resolution)
// ============================================================================

use std::path::{Component, Path, PathBuf};

/// Collapse `.` / `..` without requiring the path to exist on disk.
pub fn normalize_lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::Prefix(p) => out.push(p.as_os_str()),
            Component::RootDir => out.push(comp.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    // Preserve leading `..` when there is nothing to pop
                    // (absolute roots never get parent of drive).
                    if out.as_os_str().is_empty() {
                        out.push("..");
                    }
                }
            }
            Component::Normal(c) => out.push(c),
        }
    }
    out
}

/// Resolve `raw` against optional `root`, then ensure the result stays under
/// `root` when a root is provided.
///
/// - Relative paths are joined to `root`.
/// - Absolute paths under `root` are kept.
/// - Unix-style absolute paths outside `root` (e.g. `/proj/...`) are soft-remapped
///   into the workspace (common model habit); Windows drive/UNC escapes stay rejected.
/// - Empty `root` returns the path as-is (caller may still run sandbox roots).
pub fn resolve_under_root(raw: &str, root: Option<&str>) -> Result<PathBuf, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("路径不能为空".to_string());
    }

    let path = PathBuf::from(raw);
    let Some(root_str) = root.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(normalize_lexical(&path));
    };

    let root_path = PathBuf::from(root_str);
    let root_norm = normalize_lexical(&root_path);

    // On Windows, Path::join replaces the base when `path` is absolute (e.g. `/proj/...`
    // → `\proj\...`). Always evaluate the joined/normalized candidate first, then soft-remap.
    let candidate = if path.is_absolute() {
        normalize_lexical(&path)
    } else {
        normalize_lexical(&root_path.join(&path))
    };

    if path_is_under(&candidate, &root_norm) {
        return Ok(candidate);
    }

    let looks_pseudo_absolute = path.is_absolute()
        || raw.starts_with('/')
        || (raw.starts_with('\\') && !raw.starts_with("\\\\"));
    if looks_pseudo_absolute {
        if let Some(remapped) = remap_pseudo_absolute_under_workspace(&normalize_lexical(&path), &root_norm)
        {
            if path_is_under(&remapped, &root_norm) {
                return Ok(remapped);
            }
        }
    }

    Err(format!("路径越界，不允许访问工作区外: {}", raw))
}

/// Soft-remap `/name/...` into the workspace. Real drive/UNC absolutes return None.
fn remap_pseudo_absolute_under_workspace(absolute: &Path, root: &Path) -> Option<PathBuf> {
    let abs_str = absolute.to_string_lossy();
    // Keep Windows drive / UNC escapes strict.
    let bytes = abs_str.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return None;
    }
    if abs_str.starts_with("\\\\") || abs_str.starts_with("//") {
        return None;
    }

    let mut segs: Vec<String> = absolute
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();

    if segs.is_empty() {
        return None;
    }

    let root_name = root.file_name().map(|s| s.to_string_lossy().into_owned());
    if let (Some(first), Some(name)) = (segs.first(), root_name.as_ref()) {
        if first.eq_ignore_ascii_case(name) {
            segs.remove(0);
        }
    }

    let mut out = root.to_path_buf();
    for seg in segs {
        out.push(seg);
    }
    Some(normalize_lexical(&out))
}

/// Case-insensitive prefix check on Windows, case-sensitive elsewhere.
pub fn path_is_under(path: &Path, root: &Path) -> bool {
    #[cfg(windows)]
    {
        let p = path.to_string_lossy().to_lowercase();
        let r = root.to_string_lossy().to_lowercase();
        let r = r.trim_end_matches(['\\', '/']);
        let p = p.trim_end_matches(['\\', '/']);
        p == r || p.starts_with(&(r.to_string() + "\\")) || p.starts_with(&(r.to_string() + "/"))
    }
    #[cfg(not(windows))]
    {
        path == root || path.starts_with(root)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_collapses_parent_dirs() {
        let p = normalize_lexical(Path::new("a/b/../c"));
        assert_eq!(p, PathBuf::from("a/c").components().collect::<PathBuf>());
    }

    #[test]
    fn resolve_under_root_allows_relative_inside() {
        let root = if cfg!(windows) {
            "C:\\workspace\\proj"
        } else {
            "/workspace/proj"
        };
        let got = resolve_under_root("src/main.rs", Some(root)).expect("ok");
        assert!(path_is_under(&got, Path::new(root)));
    }

    #[test]
    fn resolve_under_root_blocks_relative_escape() {
        let root = if cfg!(windows) {
            "C:\\workspace\\proj"
        } else {
            "/workspace/proj"
        };
        let err = resolve_under_root("../../etc/passwd", Some(root)).unwrap_err();
        assert!(err.contains("越界") || err.contains("工作区"));
    }

    #[test]
    fn resolve_under_root_blocks_windows_drive_escape() {
        #[cfg(windows)]
        {
            let err = resolve_under_root(
                "C:\\Windows\\System32\\drivers\\etc\\hosts",
                Some("C:\\workspace\\proj"),
            )
            .unwrap_err();
            assert!(err.contains("越界") || err.contains("工作区"));
        }
    }

    #[test]
    fn resolve_under_root_soft_remaps_unix_style_absolute() {
        let root = if cfg!(windows) {
            "C:\\workspace\\proj"
        } else {
            "/workspace/proj"
        };
        let got = resolve_under_root("/proj/src/a.ts", Some(root)).expect("soft remap");
        assert!(path_is_under(&got, Path::new(root)));
        assert!(got.ends_with(Path::new("src").join("a.ts")));
    }

    #[test]
    fn resolve_under_root_allows_absolute_inside() {
        let root = if cfg!(windows) {
            "C:\\workspace\\proj"
        } else {
            "/workspace/proj"
        };
        let inside = if cfg!(windows) {
            "C:\\workspace\\proj\\src\\a.ts"
        } else {
            "/workspace/proj/src/a.ts"
        };
        let got = resolve_under_root(inside, Some(root)).expect("ok");
        assert!(path_is_under(&got, Path::new(root)));
    }

    #[test]
    fn audit_meta_stack_is_nested() {
        assert!(current_audit_meta().tool_name.is_none());
        with_audit_meta(
            AuditMeta {
                tool_name: Some("outer".into()),
                session_id: Some("s1".into()),
                execution_id: Some("e1".into()),
            },
            || {
                assert_eq!(current_audit_meta().tool_name.as_deref(), Some("outer"));
                with_audit_meta(
                    AuditMeta {
                        tool_name: Some("inner".into()),
                        session_id: Some("s1".into()),
                        execution_id: Some("e1".into()),
                    },
                    || {
                        assert_eq!(current_audit_meta().tool_name.as_deref(), Some("inner"));
                    },
                );
                assert_eq!(current_audit_meta().tool_name.as_deref(), Some("outer"));
            },
        );
        assert!(current_audit_meta().tool_name.is_none());
    }
}
