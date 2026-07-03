/// CBM pinned version, injected at compile time by build.rs from cbm-version.json.
pub const CBM_PINNED_VERSION: &str = env!("CBM_PINNED_VERSION");

pub fn read_runtime_version(executable: &std::path::Path) -> Option<String> {
    let output = std::process::Command::new(executable)
        .arg("--version")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    // The --version output may be "codebase-memory 0.8.1" (or legacy "codebase-memory-mcp …") or just "0.8.1".
    // Extract the semantic version (x.y.z) from the output.
    extract_semver(text)
}

/// Extract a semantic version string (e.g. "0.8.1") from arbitrary text.
/// Matches the first occurrence of `\d+\.\d+\.\d+`.
fn extract_semver(text: &str) -> Option<String> {
    let text = text.trim();
    // Fast path: the entire output is already a semver.
    if !text.is_empty() && text.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return Some(text.to_string());
    }
    // Scan for the first \d+.\d+.\d+ pattern.
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            // Try to parse a semver starting here.
            let rest = &text[i..];
            if let Some(ver) = parse_semver_prefix(rest) {
                return Some(ver);
            }
        }
        i += 1;
    }
    None
}

/// Try to parse `major.minor.patch` from the start of `s`.
fn parse_semver_prefix(s: &str) -> Option<String> {
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() < 3 {
        return None;
    }
    let major = parts[0];
    let minor = parts[1];
    // patch may have trailing text (e.g. "1-beta"), take only digits.
    let patch = parts[2];
    let patch_digits: String = patch.chars().take_while(|c| c.is_ascii_digit()).collect();
    if patch_digits.is_empty() {
        return None;
    }
    if !major.chars().all(|c| c.is_ascii_digit()) || major.is_empty() {
        return None;
    }
    if !minor.chars().all(|c| c.is_ascii_digit()) || minor.is_empty() {
        return None;
    }
    Some(format!("{major}.{minor}.{patch_digits}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_semver_from_plain_version() {
        assert_eq!(extract_semver("0.8.1"), Some("0.8.1".into()));
    }

    #[test]
    fn extract_semver_from_binary_name_prefix() {
        assert_eq!(extract_semver("codebase-memory 0.8.1"), Some("0.8.1".into()));
        assert_eq!(extract_semver("codebase-memory-mcp 0.8.1"), Some("0.8.1".into()));
    }

    #[test]
    fn extract_semver_from_multiline_output() {
        assert_eq!(
            extract_semver("codebase-memory 1.2.3\nBuild: abc123"),
            Some("1.2.3".into())
        );
    }

    #[test]
    fn extract_semver_no_match() {
        assert_eq!(extract_semver("no version here"), None);
        assert_eq!(extract_semver(""), None);
    }

    #[test]
    fn extract_semver_with_prerelease_suffix() {
        assert_eq!(extract_semver("tool 0.8.1-beta"), Some("0.8.1".into()));
    }
}
