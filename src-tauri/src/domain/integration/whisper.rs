//! Local offline speech-to-text via bundled whisper.cpp sidecar + small-q5_1 model.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use tauri::{AppHandle, Manager};

const SIDECAR_NAME: &str = "whisper-cli";
const MODEL_FILE_NAME: &str = "ggml-small-q5_1.bin";
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);

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

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn sidecar_binary_name() -> String {
    format!("{SIDECAR_NAME}-{TARGET_TRIPLE}{}", std::env::consts::EXE_SUFFIX)
}

fn unique_temp_path(prefix: &str, extension: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut path = std::env::temp_dir();
    path.push(format!("loom_{prefix}_{nanos}.{extension}"));
    path
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

fn bundled_runtime_dir_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("resources").join("whisper").join("runtime"));
        candidates.push(resource_dir.join("whisper").join("runtime"));
        candidates.push(resource_dir.join("runtime"));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("resources").join("whisper").join("runtime"));
            candidates.push(parent.join("whisper").join("runtime"));
        }
    }

    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest.join("resources").join("whisper").join("runtime"));
    candidates
}

fn resolve_whisper_runtime_dir(app: &AppHandle) -> Option<PathBuf> {
    for candidate in bundled_runtime_dir_candidates(app) {
        let marker = candidate.join(format!("whisper-cli{}", std::env::consts::EXE_SUFFIX));
        let dll_marker = candidate.join("whisper.dll");
        if marker.is_file() || dll_marker.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn bundled_sidecar_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let triple_name = sidecar_binary_name();
    let plain_name = format!("{SIDECAR_NAME}{}", std::env::consts::EXE_SUFFIX);

    // Prefer the runtime copy on Windows so sibling DLLs resolve.
    for runtime in bundled_runtime_dir_candidates(app) {
        candidates.push(runtime.join(format!("whisper-cli{}", std::env::consts::EXE_SUFFIX)));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(&triple_name));
        candidates.push(resource_dir.join(&plain_name));
        candidates.push(resource_dir.join("binaries").join(&triple_name));
        candidates.push(resource_dir.join("binaries").join(&plain_name));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join(&triple_name));
            candidates.push(parent.join(&plain_name));
        }
    }

    let manifest_bin = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    candidates.push(manifest_bin.join(&triple_name));
    candidates.push(manifest_bin.join(&plain_name));
    candidates
}

fn bundled_model_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("resources").join("whisper").join(MODEL_FILE_NAME));
        candidates.push(resource_dir.join("whisper").join(MODEL_FILE_NAME));
        candidates.push(resource_dir.join(MODEL_FILE_NAME));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("resources").join("whisper").join(MODEL_FILE_NAME));
            candidates.push(parent.join("whisper").join(MODEL_FILE_NAME));
            candidates.push(parent.join(MODEL_FILE_NAME));
        }
    }

    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest.join("resources").join("whisper").join(MODEL_FILE_NAME));
    candidates.push(manifest.join("binaries").join(MODEL_FILE_NAME));
    candidates
}

pub fn resolve_whisper_executable(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(env_path) = std::env::var("LOOM_WHISPER_PATH") {
        let path = PathBuf::from(env_path);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!("LOOM_WHISPER_PATH 不存在: {}", path.display()));
    }

    for candidate in bundled_sidecar_candidates(app) {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    if let Some(path) = find_in_path(SIDECAR_NAME) {
        return Ok(path);
    }
    if let Some(path) = find_in_path("whisper-cli") {
        return Ok(path);
    }
    if let Some(path) = find_in_path("main") {
        // Older whisper.cpp builds named the CLI `main`.
        return Ok(path);
    }

    Err("未找到 whisper-cli sidecar（可设置 LOOM_WHISPER_PATH 或运行 npm run fetch:whisper）".into())
}

pub fn resolve_whisper_model(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(env_path) = std::env::var("LOOM_WHISPER_MODEL") {
        let path = PathBuf::from(env_path);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!("LOOM_WHISPER_MODEL 不存在: {}", path.display()));
    }

    for candidate in bundled_model_candidates(app) {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "未找到 Whisper 模型 {MODEL_FILE_NAME}（运行 npm run fetch:whisper）"
    ))
}

pub fn whisper_sidecar_available(app: &AppHandle) -> bool {
    resolve_whisper_executable(app).is_ok() && resolve_whisper_model(app).is_ok()
}

fn decode_audio_base64(audio_base64: &str) -> Result<Vec<u8>, String> {
    let trimmed = audio_base64.trim();
    let payload = if let Some((_, data)) = trimmed.split_once("base64,") {
        data
    } else {
        trimmed
    };
    base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("音频解码失败: {e}"))
}

fn extension_for_mime(mime_type: Option<&str>) -> &'static str {
    match mime_type.map(|s| s.to_ascii_lowercase()) {
        Some(ref m) if m.contains("wav") => "wav",
        Some(ref m) if m.contains("ogg") => "ogg",
        Some(ref m) if m.contains("mp4") || m.contains("m4a") => "m4a",
        Some(ref m) if m.contains("mpeg") || m.contains("mp3") => "mp3",
        _ => "wav",
    }
}

/// Extract the final plain transcript from whisper-cli stdout.
pub fn extract_transcript(stdout: &str) -> String {
    let mut lines: Vec<&str> = Vec::new();
    for raw in stdout.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        // Drop common progress / banner noise.
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("whisper_")
            || lower.starts_with("ggml_")
            || lower.starts_with("system_info:")
            || lower.starts_with("main:")
            || lower.contains("loading model")
            || lower.contains("processing")
            || lower.starts_with("error:")
            || lower.starts_with("warning:")
        {
            continue;
        }

        // Timestamped lines: [00:00:00.000 --> 00:00:01.000] text
        if let Some(rest) = line.strip_prefix('[') {
            if let Some((_, text)) = rest.split_once(']') {
                let text = text.trim();
                if !text.is_empty() {
                    lines.push(text);
                }
                continue;
            }
        }

        lines.push(line);
    }

    lines
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn wait_child_with_timeout(
    child: std::process::Child,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    let pid = child.id();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(e)) => Err(format!("等待 whisper-cli 退出失败: {e}")),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .creation_flags(CREATE_NO_WINDOW)
                    .status();
            }
            #[cfg(not(windows))]
            {
                let _ = Command::new("kill")
                    .args(["-TERM", &pid.to_string()])
                    .status();
            }
            Err(format!("whisper-cli 超时（{}s）", timeout.as_secs()))
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            Err("等待 whisper-cli 线程异常退出".into())
        }
    }
}

/// Map optional UI/locale hints to a whisper.cpp `-l` code.
/// Auto-detect often mislabels Chinese as English on smaller models.
pub fn resolve_whisper_language(language: Option<&str>) -> String {
    let Some(raw) = language.map(str::trim).filter(|s| !s.is_empty()) else {
        return "auto".into();
    };
    let lower = raw.to_ascii_lowercase();
    if lower == "auto" {
        return "auto".into();
    }
    if lower.starts_with("zh") {
        return "zh".into();
    }
    if lower.starts_with("en") {
        return "en".into();
    }
    // "ja", "pt-BR" → base tag whisper.cpp accepts
    lower
        .split_once(['-', '_'])
        .map(|(base, _)| base.to_string())
        .unwrap_or(lower)
}

/// Convert Traditional Chinese characters to Simplified (zh-CN).
pub fn to_simplified_chinese(text: &str) -> String {
    zhconv::zhconv(text, zhconv::Variant::ZhCN)
}

/// Remove common Whisper silence/noise hallucination artifacts (subtitle credits, repetitive loops, symbol noise).
pub fn sanitize_whisper_transcript(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let lower = trimmed.to_ascii_lowercase();

    // 1. Common hallucinated subtitle credits and silence noise tokens emitted by Whisper on quiet mic input
    let hallucination_keywords = [
        "字幕制作",
        "字幕組",
        "字幕组",
        "字幕提供",
        "字幕由",
        "未经作者授权",
        "未经授权",
        "禁止转载",
        "请订阅",
        "点赞关注",
        "subtitles by",
        "subtitled by",
        "thanks for watching",
        "thank you for watching",
    ];

    for keyword in &hallucination_keywords {
        if lower.contains(&keyword.to_ascii_lowercase()) {
            return String::new();
        }
    }

    // 2. Filter standalone parenthesized / bracketed silence markers: (贝尔), (鼓掌), [Silence], [Music]
    let is_bracketed = (trimmed.starts_with('(') && trimmed.ends_with(')'))
        || (trimmed.starts_with('（') && trimmed.ends_with('）'))
        || (trimmed.starts_with('[') && trimmed.ends_with(']'));

    if is_bracketed {
        return String::new();
    }

    // 3. Filter repetitive token loops (e.g. "@@@@@@@@@@@", ".......", "aaaaa", "啊啊啊啊")
    let chars: Vec<char> = trimmed.chars().filter(|c| !c.is_whitespace()).collect();
    if chars.len() >= 3 {
        // Single character repeated 3+ times
        let first = chars[0];
        if chars.iter().all(|&c| c == first) {
            return String::new();
        }
        // Dominant single character (> 60% of transcript)
        let mut counts = std::collections::HashMap::new();
        for &c in &chars {
            *counts.entry(c).or_insert(0) += 1;
        }
        if let Some(&max_count) = counts.values().max() {
            if max_count * 10 >= chars.len() * 6 && chars.len() >= 4 {
                return String::new();
            }
        }
    }

    // 4. Filter strings containing only non-alphanumeric symbols (e.g. "@@@", "...", "!?!")
    let has_meaningful_char = trimmed
        .chars()
        .any(|c| c.is_alphanumeric() || (c as u32 >= 0x4E00 && c as u32 <= 0x9FFF));
    if !has_meaningful_char {
        return String::new();
    }

    trimmed.to_string()
}

fn finalize_transcript(text: String, language: &str) -> String {
    let converted = if language == "zh" {
        to_simplified_chinese(&text)
    } else {
        text
    };
    sanitize_whisper_transcript(&converted)
}

fn run_whisper_cli(
    executable: &Path,
    model: &Path,
    audio_path: &Path,
    runtime_dir: Option<&Path>,
    language: &str,
    timeout: Duration,
) -> Result<String, String> {
    // Prefer modern whisper-cli flags; fall back paths are handled by packaging.
    let mut cmd = Command::new(executable);
    cmd.args([
        "-m",
        &model.to_string_lossy(),
        "-f",
        &audio_path.to_string_lossy(),
        "-nt",
        "-np",
        // Default 0.6 often drops short / quiet mic clips as "no speech".
        "-nth",
        "0.2",
        "-l",
        language,
    ]);
    // Bias Whisper toward Simplified Chinese (it often emits Traditional for `-l zh`).
    if language == "zh" {
        cmd.args(["--prompt", "简体中文"]);
    }
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    // Windows builds load ggml/whisper DLLs from the executable directory / cwd.
    if let Some(dir) = runtime_dir {
        cmd.current_dir(dir);
        if let Ok(path) = std::env::var("PATH") {
            #[cfg(windows)]
            {
                cmd.env("PATH", format!("{};{}", dir.display(), path));
            }
            #[cfg(not(windows))]
            {
                cmd.env("PATH", format!("{}:{}", dir.display(), path));
            }
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("启动 whisper-cli 失败: {e}"))?;
    let output = wait_child_with_timeout(child, timeout)?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            format!("whisper-cli 退出码 {}", output.status)
        };
        return Err(format!("语音识别失败: {detail}"));
    }

    let transcript = extract_transcript(&stdout);
    if transcript.is_empty() {
        // Some builds print the plain transcript only to stdout without timestamps;
        // if filtering removed everything, fall back to trimmed stdout.
        let fallback = stdout
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        let finalized = finalize_transcript(fallback, language);
        if !finalized.is_empty() {
            return Ok(finalized);
        }
        let detail = stderr.to_ascii_lowercase();
        if detail.contains("error") || detail.contains("failed") {
            return Err(format!("语音识别失败: {stderr}"));
        }
        return Err("未检测到语音".into());
    }

    let finalized = finalize_transcript(transcript, language);
    if finalized.is_empty() {
        return Err("未检测到语音".into());
    }
    Ok(finalized)
}

pub fn transcribe_audio_bytes(
    app: &AppHandle,
    audio_bytes: &[u8],
    mime_type: Option<&str>,
    language: Option<&str>,
) -> Result<String, String> {
    if audio_bytes.is_empty() {
        return Err("录音为空".into());
    }

    let executable = resolve_whisper_executable(app)?;
    let model = resolve_whisper_model(app)?;
    let runtime_dir = resolve_whisper_runtime_dir(app).or_else(|| {
        executable
            .parent()
            .map(|p| p.to_path_buf())
            .filter(|p| p.join("whisper.dll").is_file() || cfg!(not(windows)))
    });
    let ext = extension_for_mime(mime_type);
    let audio_path = unique_temp_path("voice", ext);
    let lang = resolve_whisper_language(language);

    fs::write(&audio_path, audio_bytes).map_err(|e| format!("写入临时录音失败: {e}"))?;

    let result = run_whisper_cli(
        &executable,
        &model,
        &audio_path,
        runtime_dir.as_deref(),
        &lang,
        DEFAULT_TIMEOUT,
    );
    let _ = fs::remove_file(&audio_path);
    result
}

#[tauri::command]
pub async fn transcribe_audio(
    app: AppHandle,
    audio_base64: String,
    mime_type: Option<String>,
    language: Option<String>,
) -> Result<String, String> {
    let bytes = decode_audio_base64(&audio_base64)?;
    let mime = mime_type.clone();
    let lang = language.clone();
    tauri::async_runtime::spawn_blocking(move || {
        transcribe_audio_bytes(&app, &bytes, mime.as_deref(), lang.as_deref())
    })
    .await
    .map_err(|e| format!("语音识别任务失败: {e}"))?
}

#[tauri::command]
pub fn whisper_available(app: AppHandle) -> bool {
    whisper_sidecar_available(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_transcript_from_timestamped_lines() {
        let stdout = r#"
system_info: AVX = 1
[00:00:00.000 --> 00:00:01.200]  Hello world
[00:00:01.200 --> 00:00:02.000]  from Loom
"#;
        assert_eq!(extract_transcript(stdout), "Hello world from Loom");
    }

    #[test]
    fn extract_transcript_from_plain_lines() {
        let stdout = "hello\nworld\n";
        assert_eq!(extract_transcript(stdout), "hello world");
    }

    #[test]
    fn extension_for_mime_defaults_to_wav() {
        assert_eq!(extension_for_mime(Some("audio/wav")), "wav");
        assert_eq!(extension_for_mime(Some("audio/webm")), "wav");
        assert_eq!(extension_for_mime(None), "wav");
    }

    #[test]
    fn sidecar_binary_name_contains_prefix() {
        let name = sidecar_binary_name();
        assert!(name.starts_with("whisper-cli-"));
    }

    #[test]
    fn resolve_whisper_language_maps_locale_tags() {
        assert_eq!(resolve_whisper_language(None), "auto");
        assert_eq!(resolve_whisper_language(Some("")), "auto");
        assert_eq!(resolve_whisper_language(Some("auto")), "auto");
        assert_eq!(resolve_whisper_language(Some("zh-CN")), "zh");
        assert_eq!(resolve_whisper_language(Some("zh")), "zh");
        assert_eq!(resolve_whisper_language(Some("en-US")), "en");
        assert_eq!(resolve_whisper_language(Some("ja")), "ja");
        assert_eq!(resolve_whisper_language(Some("pt-BR")), "pt");
    }

    #[test]
    fn to_simplified_chinese_converts_common_traditional() {
        assert_eq!(to_simplified_chinese("你是什麽模型"), "你是什么模型");
        assert_eq!(to_simplified_chinese("什麼"), "什么");
        assert_eq!(to_simplified_chinese("這個會話"), "这个会话");
    }

    #[test]
    fn sanitize_whisper_transcript_filters_hallucinated_credits() {
        assert_eq!(sanitize_whisper_transcript("(字幕制作:贝尔)"), "");
        assert_eq!(sanitize_whisper_transcript("（字幕製作：貝爾）"), "");
        assert_eq!(sanitize_whisper_transcript("字幕组"), "");
        assert_eq!(sanitize_whisper_transcript("(鼓掌)"), "");
        assert_eq!(sanitize_whisper_transcript("[Silence]"), "");
        assert_eq!(sanitize_whisper_transcript("Subtitles by Amara.org"), "");
        assert_eq!(sanitize_whisper_transcript("@@@@@@@@@@@"), "");
        assert_eq!(sanitize_whisper_transcript("..........."), "");
        assert_eq!(sanitize_whisper_transcript("aaaaaaaa"), "");
        assert_eq!(sanitize_whisper_transcript("啊啊啊啊啊啊"), "");
        assert_eq!(sanitize_whisper_transcript("你好，请帮我重构代码"), "你好，请帮我重构代码");
    }
}
