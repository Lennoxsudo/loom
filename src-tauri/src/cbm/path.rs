use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::{AppHandle, Manager};

const SIDECAR_NAME: &str = "codebase-memory";

/// Strip Windows extended-length path prefixes so paths stay compatible with CBM CLI and UI matching.
#[cfg(windows)]
pub fn strip_extended_path_prefix(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = path.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    path.to_string()
}

#[cfg(not(windows))]
pub fn strip_extended_path_prefix(path: &str) -> String {
    path.to_string()
}

pub fn normalize_repo_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let mut normalized = trimmed.replace('/', std::path::MAIN_SEPARATOR_STR);
    if let Ok(canonical) = std::fs::canonicalize(&normalized) {
        normalized = canonical.to_string_lossy().into_owned();
    }

    normalized = strip_extended_path_prefix(&normalized);

    #[cfg(windows)]
    {
        normalized = normalized.to_lowercase();
    }

    normalized
}

pub fn cbm_cache_dir() -> Result<PathBuf, String> {
    let dir = crate::config_paths::resolve_app_data_subdir("Loom")?.join("cbm");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建 CBM 缓存目录失败: {e}"))?;
    Ok(dir)
}

fn find_in_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(windows)]
        {
            let with_exe = if candidate.extension().is_some() {
                candidate.clone()
            } else {
                candidate.with_extension("exe")
            };
            if with_exe.is_file() {
                return Some(with_exe);
            }
        }
    }
    None
}

/// Target triple for the current build target.
/// Used to construct the Tauri sidecar naming convention:
/// `codebase-memory-{triple}{exe-suffix}`
#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const TARGET_TRIPLE: &str = "x86_64-pc-windows-msvc";
#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
const TARGET_TRIPLE: &str = "aarch64-pc-windows-msvc";
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const TARGET_TRIPLE: &str = "x86_64-apple-darwin";
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const TARGET_TRIPLE: &str = "aarch64-apple-darwin";
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
const TARGET_TRIPLE: &str = "x86_64-unknown-linux-gnu";
#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
const TARGET_TRIPLE: &str = "aarch64-unknown-linux-gnu";

/// The expected sidecar binary name with target triple suffix.
fn sidecar_binary_name() -> String {
    format!("{SIDECAR_NAME}-{TARGET_TRIPLE}{}", std::env::consts::EXE_SUFFIX)
}

fn bundled_sidecar_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    // 1. Tauri resource_dir (release: bundled externalBin location)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let sidecar_name = sidecar_binary_name();
        candidates.push(resource_dir.join(&sidecar_name));
        // Also check without triple suffix (flat layout)
        candidates.push(resource_dir.join(format!("{SIDECAR_NAME}{}", std::env::consts::EXE_SUFFIX)));
    }

    // 2. Next to current exe (portable / some dev setups)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            if let Ok(entries) = std::fs::read_dir(parent) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with(SIDECAR_NAME) {
                        candidates.push(entry.path());
                    }
                }
            }
            candidates.push(parent.join(sidecar_binary_name()));
            candidates.push(parent.join(format!("{SIDECAR_NAME}{}", std::env::consts::EXE_SUFFIX)));
        }
    }

    // 3. CARGO_MANIFEST_DIR/binaries (dev: npm run fetch:cbm output)
    // Use env! macro (compile-time) — CARGO_MANIFEST_DIR is NOT set at runtime.
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let binaries = PathBuf::from(manifest_dir).join("binaries");
    if let Ok(entries) = std::fs::read_dir(&binaries) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(SIDECAR_NAME) {
                candidates.push(entry.path());
            }
        }
    }

    candidates
}

/// Sidecar candidates for the embedded 3D graph UI HTTP server.
/// Prefer the UI release asset from `npm run fetch:cbm` and release bundles only.
/// Do not scan next to `loom.exe` in dev — `target/debug/codebase-memory.exe` is
/// often a CLI-only copy and will shadow the UI binary in `src-tauri/binaries/`.
fn bundled_ui_sidecar_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let triple_name = sidecar_binary_name();

    let manifest_bin =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join(&triple_name);
    candidates.push(manifest_bin);

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(&triple_name));
        candidates.push(
            resource_dir.join(format!("{SIDECAR_NAME}{}", std::env::consts::EXE_SUFFIX)),
        );
    }

    candidates
}

pub fn resolve_cbm_executable(app: &AppHandle) -> Result<PathBuf, String> {
    // 1. LOOM_CBM_PATH env var (explicit override)
    if let Ok(env_path) = std::env::var("LOOM_CBM_PATH") {
        let path = PathBuf::from(env_path);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!("LOOM_CBM_PATH 不存在: {}", path.display()));
    }

    // 2. Bundled sidecar (resource_dir / next-to-exe / CARGO_MANIFEST_DIR)
    for candidate in bundled_sidecar_candidates(app) {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    // 3. PATH lookup (system-installed CBM)
    if let Some(path) = find_in_path(SIDECAR_NAME) {
        return Ok(path);
    }

    Err("未找到 codebase-memory sidecar（可设置 LOOM_CBM_PATH 或运行 npm run fetch:cbm）".into())
}

/// Resolve the sidecar used for the embedded 3D graph UI HTTP server.
/// Unlike [`resolve_cbm_executable`], this never falls back to PATH or dev `target/debug`
/// copies so a CLI-only install cannot shadow the bundled UI release asset.
pub fn resolve_cbm_ui_executable(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(env_path) = std::env::var("LOOM_CBM_PATH") {
        let path = PathBuf::from(env_path);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!("LOOM_CBM_PATH 不存在: {}", path.display()));
    }

    for candidate in bundled_ui_sidecar_candidates(app) {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err("未找到带 UI 的 codebase-memory sidecar（运行 npm run fetch:cbm）".into())
}

pub fn cbm_sidecar_available(app: &AppHandle) -> bool {
    resolve_cbm_executable(app).is_ok()
}

pub fn path_status(repo_path: &str) -> crate::cbm::types::CbmPathStatus {
    let trimmed = repo_path.trim();
    if trimmed.is_empty() {
        return crate::cbm::types::CbmPathStatus::Missing;
    }
    let path = Path::new(trimmed);
    if !path.exists() {
        return crate::cbm::types::CbmPathStatus::Missing;
    }
    if !path.is_dir() {
        return crate::cbm::types::CbmPathStatus::NotDirectory;
    }
    crate::cbm::types::CbmPathStatus::Ok
}

pub fn display_name_for_path(repo_path: &str) -> String {
    Path::new(repo_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(repo_path)
        .to_string()
}

/// True when the path string contains any non-ASCII character.
pub fn contains_non_ascii(path: &str) -> bool {
    path.chars().any(|c| !c.is_ascii())
}

#[cfg(windows)]
fn remove_directory_junction(path: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let path_str = path.to_string_lossy();
    let output = Command::new("cmd")
        .args(["/C", "rmdir", &path_str])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("删除目录联接失败: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("删除目录联接失败: {path_str}")
    } else {
        stderr
    })
}

/// ASCII-only directory junction under CBM cache when 8.3 short paths are unavailable.
#[cfg(windows)]
fn windows_junction_link(target: &str) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let trimmed = target.trim();
    let normalized = normalize_repo_path(trimmed);
    if normalized.is_empty() {
        return Err("repo_path 为空".into());
    }

    let target_path = Path::new(trimmed);
    if !target_path.exists() {
        return Err(format!("项目路径不存在: {trimmed}"));
    }

    let canonical_target = target_path
        .canonicalize()
        .map_err(|e| format!("无法解析项目路径: {trimmed} ({e})"))?;
    let canonical_key = normalize_repo_path(&canonical_target.to_string_lossy());

    let mut hasher = Sha256::new();
    hasher.update(canonical_key.as_bytes());
    let hash = format!("{:x}", hasher.finalize());

    let links_dir = cbm_cache_dir()?.join("invoke-links");
    std::fs::create_dir_all(&links_dir)
        .map_err(|e| format!("创建 CBM invoke-links 目录失败: {e}"))?;
    let link_path = links_dir.join(&hash[..16]);

    if link_path.exists() {
        if target_path.exists() {
            let existing = normalize_repo_path(&link_path.to_string_lossy());
            if existing == canonical_key {
                return Ok(link_path.to_string_lossy().into_owned());
            }
        }
        remove_directory_junction(&link_path)?;
    }

    let link_str = link_path.to_string_lossy().into_owned();
    let target_str = canonical_target.to_string_lossy().into_owned();
    let output = Command::new("cmd")
        .args(["/C", "mklink", "/J", &link_str, &target_str])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("创建目录联接失败: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("exit code {}", output.status)
        };
        return Err(format!(
            "无法为含非 ASCII 字符的路径创建 CBM 目录联接: {trimmed} ({detail})"
        ));
    }

    Ok(link_str)
}

#[cfg(windows)]
fn windows_short_path(path: &str) -> Option<String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetShortPathNameW(lpsz_long_path: *const u16, lpsz_short_path: *mut u16, cch_buffer: u32) -> u32;
    }

    fn to_wide(value: &str) -> Vec<u16> {
        OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let wide = to_wide(path);
    let mut buffer = vec![0u16; 512];
    let written = unsafe { GetShortPathNameW(wide.as_ptr(), buffer.as_mut_ptr(), buffer.len() as u32) };
    if written == 0 || written as usize >= buffer.len() {
        return None;
    }
    Some(String::from_utf16_lossy(&buffer[..written as usize]))
}

/// Path string passed to CBM CLI JSON args.
///
/// On Windows non-ASCII paths: try 8.3 short path first (ASCII-only, transparent
/// to CBM CLI), then directory junction (ASCII-only, persistent), and finally
/// fall back to the canonical Unicode path (CBM 0.8.1+ hex project slugs).
pub fn cbm_invoke_repo_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }

    #[cfg(windows)]
    {
        if contains_non_ascii(trimmed) {
            // Prefer ASCII-only paths: CBM CLI binary may reject non-ASCII
            // repo_path values with "repo_path is required".
            if let Some(short) = windows_short_path(trimmed) {
                if !contains_non_ascii(&short) {
                    return Ok(short);
                }
            }
            if let Ok(junction) = windows_junction_link(trimmed) {
                return Ok(junction);
            }
            // Last resort: canonical Unicode path (CBM 0.8.1+ hex slugs).
            if let Some(canonical) = canonical_unicode_repo_path(trimmed) {
                return Ok(canonical);
            }
            return Err(format!(
                "无法为含非 ASCII 字符的路径创建可用的 CBM 调用路径: {trimmed}"
            ));
        }
    }

    Ok(trimmed.to_string())
}

#[cfg(windows)]
fn canonical_unicode_repo_path(path: &str) -> Option<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path_obj = std::path::Path::new(trimmed);
    if !path_obj.exists() {
        return None;
    }
    let canonical = path_obj
        .canonicalize()
        .ok()
        .map(|p| strip_extended_path_prefix(&p.to_string_lossy()))
        .unwrap_or_else(|| strip_extended_path_prefix(trimmed));
    if canonical.is_empty() {
        return None;
    }
    Some(canonical)
}

const CBM_CLI_PATH_KEYS: &[&str] = &["repo_path", "path"];

/// Rewrite `repo_path` / `path` in CBM CLI JSON for Windows Unicode compatibility.
pub fn adapt_cbm_cli_json(args_json: &str) -> Result<String, String> {
    let trimmed = args_json.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }

    let mut value: Value = serde_json::from_str(trimmed)
        .map_err(|e| format!("CBM CLI 参数 JSON 解析失败: {e}"))?;
    let Some(map) = value.as_object_mut() else {
        return Ok(trimmed.to_string());
    };

    let mut changed = false;
    for key in CBM_CLI_PATH_KEYS {
        let Some(current) = map.get(*key).and_then(|v| v.as_str()) else {
            continue;
        };
        let adapted = cbm_invoke_repo_path(current)?;
        if adapted != current {
            let _ = super::project_path::record_invoke_path_alias(current, &adapted);
            map.insert((*key).to_string(), Value::String(adapted));
            changed = true;
        }
    }

    if !changed {
        return Ok(trimmed.to_string());
    }

    serde_json::to_string(&value).map_err(|e| format!("CBM CLI 参数序列化失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_empty_path() {
        assert!(normalize_repo_path("").is_empty());
        assert!(normalize_repo_path("   ").is_empty());
    }

    #[test]
    fn display_name_uses_tail_segment() {
        assert_eq!(display_name_for_path("D:/project/foo"), "foo");
    }

    #[cfg(windows)]
    #[test]
    fn normalize_lowercases_on_windows() {
        let normalized = normalize_repo_path("D:\\Project\\Foo");
        assert_eq!(normalized, normalized.to_lowercase());
    }

    #[cfg(windows)]
    #[test]
    fn normalize_canonicalize_strips_extended_prefix() {
        let path = normalize_repo_path("D:\\project\\Aiasprrato\\Aiasprrato");
        assert!(
            !path.starts_with(r"\\?\"),
            "normalized path should not use extended-length prefix: {path}"
        );
        assert!(path.contains("aiasprrato"));
    }

    #[test]
    fn sidecar_binary_name_contains_target_triple() {
        let name = sidecar_binary_name();
        assert!(name.starts_with(SIDECAR_NAME));
        assert!(name.contains(TARGET_TRIPLE));
    }

    #[cfg(windows)]
    #[test]
    fn sidecar_binary_name_has_exe_suffix_on_windows() {
        let name = sidecar_binary_name();
        assert!(name.ends_with(".exe"));
    }

    #[cfg(not(windows))]
    #[test]
    fn sidecar_binary_name_has_no_exe_suffix_on_unix() {
        let name = sidecar_binary_name();
        assert!(!name.ends_with(".exe"));
    }

    #[test]
    fn target_triple_contains_arch_and_os() {
        assert!(TARGET_TRIPLE.contains(std::env::consts::ARCH));
        assert!(TARGET_TRIPLE.contains(std::env::consts::OS));
    }

    #[test]
    fn contains_non_ascii_detects_unicode() {
        assert!(!contains_non_ascii("D:/project/foo"));
        assert!(!contains_non_ascii(""));
        assert!(contains_non_ascii("D:/project/酷态科"));
    }

    #[test]
    fn adapt_cbm_cli_json_passes_through_ascii_paths() {
        let input = r#"{"repo_path":"D:/project/foo","action":"search"}"#;
        let output = adapt_cbm_cli_json(input).expect("adapt");
        assert_eq!(output, input);
    }

    #[test]
    fn adapt_cbm_cli_json_rejects_invalid_json() {
        assert!(adapt_cbm_cli_json("not-json").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn cbm_invoke_repo_path_returns_ascii_for_non_ascii_path() {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("cbm_test_invoke_酷态科");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).expect("create temp dir");

        let long = base.to_string_lossy().into_owned();
        let invoke = cbm_invoke_repo_path(&long).expect("invoke path");
        assert!(
            !contains_non_ascii(&invoke),
            "expected ASCII-only path for non-ASCII input, got: {invoke}"
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(windows)]
    #[test]
    fn cbm_invoke_repo_path_falls_back_to_junction_when_path_missing() {
        let missing = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("cbm_test_missing_unicode_不存在");
        let _ = std::fs::remove_dir_all(&missing);

        let invoke = cbm_invoke_repo_path(&missing.to_string_lossy()).expect_err("missing path");
        assert!(
            invoke.contains("不存在") || invoke.contains("not found") || invoke.contains("路径"),
            "expected path error for missing dir, got: {invoke}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn normalize_short_and_long_paths_match_for_same_target() {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("cbm_test_norm_酷态科");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).expect("create temp dir");

        let long = normalize_repo_path(&base.to_string_lossy());
        let invoke = cbm_invoke_repo_path(&base.to_string_lossy()).expect("invoke path");
        let from_invoke = normalize_repo_path(&invoke);
        assert_eq!(
            from_invoke, long,
            "invoke={invoke} long={long} from_invoke={from_invoke}"
        );

        let input = serde_json::json!({ "repo_path": long }).to_string();
        let adapted = adapt_cbm_cli_json(&input).expect("adapt json");
        let parsed: Value = serde_json::from_str(&adapted).expect("parse adapted json");
        let adapted_path = parsed
            .get("repo_path")
            .and_then(|v| v.as_str())
            .expect("repo_path");
        assert!(
            !contains_non_ascii(adapted_path),
            "adapted path should be ASCII-only for CBM CLI, got: {adapted_path}"
        );
        // The adapted (ASCII-only) path must normalize back to the same canonical key.
        let from_adapted = normalize_repo_path(adapted_path);
        assert_eq!(
            from_adapted, long,
            "adapted path should resolve to same canonical key: adapted={adapted_path} long={long} from_adapted={from_adapted}"
        );

        let _ = std::fs::remove_dir_all(&base);
    }
}
