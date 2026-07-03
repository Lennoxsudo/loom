//! Port scanning and process management for localhost TCP listeners.

pub const PORT_KILL_PERMISSION_DENIED: &str = "PORT_KILL_PERMISSION_DENIED";

use std::collections::{HashMap, HashSet};
use std::process::Command;

use serde::Serialize;
use tauri::State;

use crate::cbm::CbmUiState;
use crate::live_server::LiveServerManager;
use crate::terminal::BackgroundTasks;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortHint {
    pub label_key: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PortOwnership {
    LoomManaged,
    KnownExternal,
    External,
    Protected,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningPortEntry {
    pub port: u16,
    pub address: String,
    pub protocol: String,
    pub pid: u32,
    pub process_name: String,
    pub command_line: Option<String>,
    pub hint: PortHint,
    pub ownership: PortOwnership,
    pub can_kill: bool,
}

#[derive(Debug, Clone)]
struct RawListeningPort {
    port: u16,
    address: String,
    pid: u32,
    process_name: Option<String>,
}

#[derive(Clone)]
pub(crate) struct LoomRuntimeContext {
    current_pid: u32,
    live_server_port: Option<u16>,
    cbm_tracked: Option<(u32, u16)>,
    background_pids: HashSet<u32>,
}

fn decode_command_output(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

struct HiddenCommandResult {
    success: bool,
    stdout: String,
    stderr: String,
}

fn run_hidden_command_detailed(program: &str, args: &[&str]) -> Option<HiddenCommandResult> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output().ok()?;
    Some(HiddenCommandResult {
        success: output.status.success(),
        stdout: decode_command_output(&output.stdout),
        stderr: decode_command_output(&output.stderr),
    })
}

fn run_hidden_command(program: &str, args: &[&str]) -> Option<String> {
    let result = run_hidden_command_detailed(program, args)?;
    if !result.success && result.stdout.is_empty() {
        return None;
    }
    Some(result.stdout)
}

fn parse_local_port(address: &str) -> Option<u16> {
    let address = address.trim();
    let host_port = if address.starts_with('[') {
        let end = address.find(']')?;
        address.get(end + 2..)?
    } else {
        address.rsplit(':').next()?
    };
    host_port.parse().ok()
}

fn is_localhost_address(address: &str) -> bool {
    let address = address.trim();
    address == "127.0.0.1"
        || address == "[::1]"
        || address == "::1"
        || address.starts_with("127.")
}

fn is_listening_state(line: &str) -> bool {
    line.contains("LISTENING") || line.contains("监听")
}

#[cfg(windows)]
fn windows_netstat_program() -> String {
    std::env::var("SystemRoot")
        .map(|root| format!("{root}\\System32\\netstat.exe"))
        .unwrap_or_else(|_| "netstat".to_string())
}

#[cfg(windows)]
fn windows_tasklist_program() -> String {
    std::env::var("SystemRoot")
        .map(|root| format!("{root}\\System32\\tasklist.exe"))
        .unwrap_or_else(|_| "tasklist".to_string())
}

#[cfg(windows)]
fn windows_taskkill_program() -> String {
    std::env::var("SystemRoot")
        .map(|root| format!("{root}\\System32\\taskkill.exe"))
        .unwrap_or_else(|_| "taskkill".to_string())
}

#[cfg(windows)]
fn windows_powershell_program() -> String {
    std::env::var("SystemRoot")
        .map(|root| format!("{root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"))
        .unwrap_or_else(|_| "powershell".to_string())
}

fn is_process_running(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }

    #[cfg(windows)]
    {
        match run_hidden_command(
            &windows_tasklist_program(),
            &["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"],
        ) {
            Some(text) => {
                let line = text.lines().next().unwrap_or("").trim();
                !line.is_empty() && !line.starts_with("INFO:")
            }
            None => false,
        }
    }
    #[cfg(not(windows))]
    {
        run_hidden_command("ps", &["-p", &pid.to_string(), "-o", "pid="])
            .map(|text| !text.trim().is_empty())
            .unwrap_or(false)
    }
}

#[cfg(windows)]
fn permission_denied_error(pid: u32) -> String {
    format!("{PORT_KILL_PERMISSION_DENIED}:{pid}")
}

#[cfg(windows)]
fn is_permission_denied_message(message: &str) -> bool {
    let msg = message.to_lowercase();
    msg.contains("拒绝访问")
        || msg.contains("access is denied")
        || msg.contains("access denied")
        || msg.contains("权限不足")
        || msg.contains("elevated")
        || msg.contains("administrator")
}

#[cfg(windows)]
fn format_kill_error(pid: u32, stderr: &str) -> String {
    let msg = stderr.trim();
    if msg.is_empty() {
        return format!("无法终止进程 PID {pid}");
    }
    if is_permission_denied_message(msg) {
        return permission_denied_error(pid);
    }
    if msg.contains("找不到")
        || msg.contains("not found")
        || msg.contains("NoProcessFoundForGivenId")
        || msg.contains("cannot find")
    {
        return format!("进程 PID {pid} 已不存在");
    }
    format!("无法终止进程 PID {pid}：{msg}")
}

#[cfg(windows)]
fn is_process_not_found_message(message: &str) -> bool {
    let msg = message.to_lowercase();
    msg.contains("not found")
        || msg.contains("找不到")
        || msg.contains("noprocessfoundforgivenid")
        || msg.contains("cannot find")
        || msg.contains("no tasks are running")
}

#[cfg(windows)]
fn try_windows_taskkill(pid: u32) -> Result<(), String> {
    let output = run_hidden_command_detailed(
        &windows_taskkill_program(),
        &["/PID", &pid.to_string(), "/F", "/T"],
    )
    .ok_or_else(|| format!("无法终止进程 PID {pid}：无法启动 taskkill"))?;

    if output.success || !is_process_running(pid) {
        return Ok(());
    }

    if is_process_not_found_message(&output.stderr) {
        return Ok(());
    }

    if !is_process_running(pid) {
        return Ok(());
    }

    Err(format_kill_error(pid, &output.stderr))
}

#[cfg(windows)]
fn try_windows_stop_process(pid: u32) -> Result<(), String> {
    let script = format!(
        "$p = Get-Process -Id {pid} -ErrorAction SilentlyContinue; \
         if ($null -eq $p) {{ exit 0 }}; \
         Stop-Process -Id {pid} -Force -ErrorAction SilentlyContinue; \
         if ($null -eq (Get-Process -Id {pid} -ErrorAction SilentlyContinue)) {{ exit 0 }} else {{ exit 1 }}"
    );
    let output = run_hidden_command_detailed(
        &windows_powershell_program(),
        &["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &script],
    )
    .ok_or_else(|| format!("无法终止进程 PID {pid}：无法启动 PowerShell"))?;

    if !is_process_running(pid) {
        return Ok(());
    }

    // exit 0 = process already gone or successfully stopped
    if output.success {
        return Ok(());
    }

    if is_process_not_found_message(&output.stderr) {
        return Ok(());
    }

    if !is_process_running(pid) {
        return Ok(());
    }

    Err(permission_denied_error(pid))
}

#[cfg(windows)]
fn pick_kill_error(pid: u32, primary: &Result<(), String>, fallback: &Result<(), String>) -> String {
    for message in [primary.as_ref().err(), fallback.as_ref().err()] {
        if let Some(text) = message {
            if text.starts_with(PORT_KILL_PERMISSION_DENIED) {
                return text.clone();
            }
        }
    }
    primary
        .as_ref()
        .err()
        .or(fallback.as_ref().err())
        .cloned()
        .unwrap_or_else(|| format!("无法终止进程 PID {pid}"))
}

#[cfg(not(windows))]
fn try_unix_signal_kill(pid: u32, signal: &str) -> Result<(), String> {
    let status = Command::new("kill")
        .args(["-", signal, &pid.to_string()])
        .status()
        .map_err(|e| format!("终止进程失败: {e}"))?;
    if status.success() || !is_process_running(pid) {
        Ok(())
    } else {
        Err(format!("无法向进程 PID {pid} 发送信号 {signal}"))
    }
}

#[cfg(windows)]
fn parse_netstat_output(output: &str) -> Vec<RawListeningPort> {
    let mut results = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if !line.starts_with("TCP") || !is_listening_state(line) {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 {
            continue;
        }
        let local_addr = parts[1];
        let pid: u32 = match parts.last().and_then(|p| p.parse().ok()) {
            Some(pid) if pid > 0 => pid,
            _ => continue,
        };
        let address = local_addr
            .rsplit_once(':')
            .map(|(host, _)| host)
            .unwrap_or(local_addr);
        if !is_localhost_address(address) {
            continue;
        }
        let Some(port) = parse_local_port(local_addr) else {
            continue;
        };
        results.push(RawListeningPort {
            port,
            address: normalize_address(address),
            pid,
            process_name: None,
        });
    }
    results
}

#[cfg(not(windows))]
fn parse_lsof_output(output: &str) -> Vec<RawListeningPort> {
    let mut results = Vec::new();
    for line in output.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() || !line.contains("(LISTEN)") {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }
        let pid: u32 = match parts[1].parse() {
            Ok(pid) if pid > 0 => pid,
            _ => continue,
        };
        let process_name = Some(parts[0].to_string());
        let name_part = parts.last().unwrap_or(&"");
        let addr_port = name_part
            .trim_start_matches("*:")
            .trim_start_matches("TCP ")
            .split_whitespace()
            .next()
            .unwrap_or("")
            .trim_end_matches("(LISTEN)");
        let address = addr_port
            .rsplit_once(':')
            .map(|(host, _)| host)
            .unwrap_or(addr_port);
        if !is_localhost_address(address) {
            continue;
        }
        let Some(port) = parse_local_port(addr_port) else {
            continue;
        };
        results.push(RawListeningPort {
            port,
            address: normalize_address(address),
            pid,
            process_name,
        });
    }
    results
}

fn normalize_address(address: &str) -> String {
    match address {
        "[::1]" | "::1" => "[::1]".to_string(),
        other => other.to_string(),
    }
}

fn is_port_listened_by_pid(port: u16, pid: u32) -> bool {
    collect_listening_ports()
        .map(|ports| {
            ports
                .iter()
                .any(|entry| entry.port == port && entry.pid == pid)
        })
        .unwrap_or(false)
}

fn wait_for_port_release(port: u16, pid: u32) -> bool {
    use std::time::Duration;
    for _ in 0..6 {
        if !is_port_listened_by_pid(port, pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    !is_port_listened_by_pid(port, pid)
}

fn collect_listening_ports() -> Result<Vec<RawListeningPort>, String> {
    #[cfg(windows)]
    {
        let output = run_hidden_command(&windows_netstat_program(), &["-ano", "-p", "tcp"])
            .ok_or_else(|| "无法执行 netstat".to_string())?;
        Ok(parse_netstat_output(&output))
    }
    #[cfg(not(windows))]
    {
        let output = run_hidden_command("lsof", &["-nP", "-iTCP", "-sTCP:LISTEN"])
            .ok_or_else(|| "无法执行 lsof".to_string())?;
        Ok(parse_lsof_output(&output))
    }
}

#[cfg(windows)]
fn parse_tasklist_output(
    output: Option<String>,
    pids: &HashSet<u32>,
) -> HashMap<u32, (String, Option<String>)> {
    let mut result = HashMap::with_capacity(pids.len());
    if pids.is_empty() {
        return result;
    }

    let Some(output) = output else {
        for &pid in pids {
            result.insert(pid, (format!("PID {pid}"), None));
        }
        return result;
    };

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("INFO:") {
            continue;
        }
        let fields = parse_csv_line(line);
        if fields.len() < 2 {
            continue;
        }
        let Ok(pid) = fields[1].trim_matches('"').parse::<u32>() else {
            continue;
        };
        if !pids.contains(&pid) {
            continue;
        }
        let name = fields[0].trim_matches('"').to_string();
        result.insert(pid, (name, None));
    }

    for &pid in pids {
        result
            .entry(pid)
            .or_insert_with(|| (format!("PID {pid}"), None));
    }

    result
}

#[cfg(not(windows))]
fn parse_ps_output(
    output: Option<String>,
    pids: &HashSet<u32>,
) -> HashMap<u32, (String, Option<String>)> {
    let mut result = HashMap::with_capacity(pids.len());
    if pids.is_empty() {
        return result;
    }

    let Some(output) = output else {
        for &pid in pids {
            result.insert(pid, (format!("PID {pid}"), None));
        }
        return result;
    };

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.splitn(3, char::is_whitespace);
        let Some(pid_str) = parts.next() else {
            continue;
        };
        let Ok(pid) = pid_str.parse::<u32>() else {
            continue;
        };
        if !pids.contains(&pid) {
            continue;
        }
        let name = parts.next().unwrap_or("").to_string();
        let args = parts.next().map(|s| s.to_string());
        if name.is_empty() {
            result.insert(pid, (format!("PID {pid}"), args));
        } else {
            result.insert(pid, (name, args));
        }
    }

    for &pid in pids {
        result
            .entry(pid)
            .or_insert_with(|| (format!("PID {pid}"), None));
    }

    result
}

#[cfg(windows)]
fn parse_csv_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for ch in line.chars() {
        match ch {
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => {
                fields.push(current.clone());
                current.clear();
            }
            other => current.push(other),
        }
    }
    fields.push(current);
    fields
}

fn known_port_label_key(port: u16) -> Option<&'static str> {
    match port {
        1420 => Some("viteDev"),
        9749 | 9750 | 9751 => Some("cbmGraph"),
        11434 => Some("ollama"),
        3000 | 5173 | 8080 => Some("commonDev"),
        _ => None,
    }
}

fn build_loom_context(
    live_server: &LiveServerManager,
    cbm_ui: &CbmUiState,
    bg_tasks: &BackgroundTasks,
) -> LoomRuntimeContext {
    let live_status = live_server.status();
    let live_server_port = if live_status.running {
        live_status.port
    } else {
        None
    };

    let cbm_tracked = cbm_ui.tracked_process();
    let background_pids = bg_tasks.active_pids();

    LoomRuntimeContext {
        current_pid: std::process::id(),
        live_server_port,
        cbm_tracked,
        background_pids,
    }
}

fn enrich_entry(
    raw: RawListeningPort,
    process_name: String,
    command_line: Option<String>,
    ctx: &LoomRuntimeContext,
) -> ListeningPortEntry {
    let mut label_key = known_port_label_key(raw.port).map(str::to_string);
    let mut description = command_line.clone();

    let ownership = if raw.pid == ctx.current_pid {
        PortOwnership::Protected
    } else if ctx
        .cbm_tracked
        .is_some_and(|(pid, port)| raw.pid == pid && raw.port == port)
    {
        label_key = Some("cbmGraph".to_string());
        PortOwnership::LoomManaged
    } else if ctx
        .live_server_port
        .is_some_and(|port| port == raw.port)
    {
        label_key = Some("liveServer".to_string());
        PortOwnership::LoomManaged
    } else if ctx.background_pids.contains(&raw.pid) {
        label_key = Some("loomBackgroundTask".to_string());
        PortOwnership::External
    } else if known_port_label_key(raw.port).is_some() {
        PortOwnership::KnownExternal
    } else {
        PortOwnership::External
    };

    if label_key.is_none() {
        description = Some(process_name.clone());
    }

    let can_kill = ownership != PortOwnership::Protected
        && ownership != PortOwnership::LoomManaged;

    ListeningPortEntry {
        port: raw.port,
        address: raw.address,
        protocol: "tcp".to_string(),
        pid: raw.pid,
        process_name,
        command_line,
        hint: PortHint {
            label_key,
            description,
        },
        ownership,
        can_kill,
    }
}

fn dedupe_ports(mut ports: Vec<RawListeningPort>) -> Vec<RawListeningPort> {
    let mut seen = HashSet::new();
    ports.retain(|entry| {
        seen.insert((entry.port, entry.address.clone(), entry.pid))
    });
    ports.sort_by(|a, b| a.port.cmp(&b.port).then(a.pid.cmp(&b.pid)));
    ports
}

pub(crate) fn scan_listening_ports_with_context(
    ctx: LoomRuntimeContext,
) -> Result<Vec<ListeningPortEntry>, String> {
    #[cfg(windows)]
    let (ports_join, process_output) = std::thread::scope(|scope| {
        let ports_handle = scope.spawn(|| collect_listening_ports());
        let processes_handle = scope.spawn(|| {
            run_hidden_command(&windows_tasklist_program(), &["/FO", "CSV", "/NH"])
        });
        (
            ports_handle.join(),
            processes_handle.join().ok().flatten(),
        )
    });

    #[cfg(not(windows))]
    let (ports_join, process_output) = std::thread::scope(|scope| {
        let ports_handle = scope.spawn(|| collect_listening_ports());
        let processes_handle =
            scope.spawn(|| run_hidden_command("ps", &["-axo", "pid=,comm=,args="]));
        (
            ports_handle.join(),
            processes_handle.join().ok().flatten(),
        )
    });

    let raw_ports = dedupe_ports(match ports_join {
        Ok(result) => result?,
        Err(_) => return Err("端口枚举线程异常退出".to_string()),
    });
    let unique_pids: HashSet<u32> = raw_ports.iter().map(|p| p.pid).collect();

    #[cfg(windows)]
    let pid_cache = parse_tasklist_output(process_output, &unique_pids);
    #[cfg(not(windows))]
    let pid_cache = parse_ps_output(process_output, &unique_pids);

    let mut entries = Vec::with_capacity(raw_ports.len());
    for raw in raw_ports {
        let (process_name, command_line) = if let Some(name) = raw.process_name.clone() {
            let args = pid_cache.get(&raw.pid).and_then(|(_, args)| args.clone());
            (name, args)
        } else {
            pid_cache
                .get(&raw.pid)
                .cloned()
                .unwrap_or_else(|| (format!("PID {}", raw.pid), None))
        };
        entries.push(enrich_entry(raw, process_name, command_line, &ctx));
    }

    Ok(entries)
}

fn resolve_kill_target(
    port: u16,
    pid: u32,
    ctx: &LoomRuntimeContext,
) -> Result<ListeningPortEntry, String> {
    let raw = collect_listening_ports()?
        .into_iter()
        .find(|entry| entry.port == port && entry.pid == pid)
        .ok_or_else(|| format!("未找到端口 {port} 上 PID {pid} 的监听进程"))?;

    let mut pids = HashSet::new();
    pids.insert(pid);

    #[cfg(windows)]
    let pid_cache = parse_tasklist_output(
        run_hidden_command(&windows_tasklist_program(), &["/FO", "CSV", "/NH"]),
        &pids,
    );
    #[cfg(not(windows))]
    let pid_cache = parse_ps_output(
        run_hidden_command("ps", &["-axo", "pid=,comm=,args="]),
        &pids,
    );

    let (process_name, command_line) = if let Some(name) = raw.process_name.clone() {
        let args = pid_cache.get(&pid).and_then(|(_, args)| args.clone());
        (name, args)
    } else {
        pid_cache
            .get(&pid)
            .cloned()
            .unwrap_or_else(|| (format!("PID {pid}"), None))
    };

    Ok(enrich_entry(raw, process_name, command_line, ctx))
}

#[allow(dead_code)]
pub(crate) fn scan_listening_ports(
    live_server: &LiveServerManager,
    cbm_ui: &CbmUiState,
    bg_tasks: &BackgroundTasks,
) -> Result<Vec<ListeningPortEntry>, String> {
    let ctx = build_loom_context(live_server, cbm_ui, bg_tasks);
    scan_listening_ports_with_context(ctx)
}

fn kill_port_pid(port: u16, pid: u32) -> Result<(), String> {
    if pid == 0 {
        return Err("无效的进程 PID".to_string());
    }

    if !is_port_listened_by_pid(port, pid) {
        return Ok(());
    }

    #[cfg(windows)]
    {
        let taskkill_err = try_windows_taskkill(pid);
        if wait_for_port_release(port, pid) || !is_process_running(pid) {
            return Ok(());
        }

        let stop_process_err = try_windows_stop_process(pid);
        if wait_for_port_release(port, pid) || !is_process_running(pid) {
            return Ok(());
        }

        if !is_port_listened_by_pid(port, pid) {
            return Ok(());
        }

        Err(pick_kill_error(pid, &taskkill_err, &stop_process_err))
    }
    #[cfg(not(windows))]
    {
        let _ = try_unix_signal_kill(pid, "TERM");
        if wait_for_port_release(port, pid) || !is_process_running(pid) {
            return Ok(());
        }

        let _ = try_unix_signal_kill(pid, "KILL");
        if wait_for_port_release(port, pid) || !is_process_running(pid) {
            return Ok(());
        }

        if !is_port_listened_by_pid(port, pid) {
            return Ok(());
        }

        Err(format!("无法终止进程 PID {pid}"))
    }
}

fn lookup_process_executable_path(pid: u32) -> Option<String> {
    #[cfg(windows)]
    {
        // Strategy:
        // 1. Get-Process (fast, but returns $null for system/protected processes)
        // 2. Get-CimInstance Win32_Process (WMI, works for most processes)
        // 3. Get-WmiObject Win32_Process (legacy WMI, works on older systems)
        // Errors are suppressed at each step; we move to the next on failure.
        let script = format!(
            "$ErrorActionPreference = 'SilentlyContinue'; \
             $path = (Get-Process -Id {pid}).Path; \
             if (-not $path) {{ \
               $path = (Get-CimInstance Win32_Process -Filter \"ProcessId = {pid}\").ExecutablePath; \
             }}; \
             if (-not $path) {{ \
               $path = (Get-WmiObject Win32_Process -Filter \"ProcessId = {pid}\").ExecutablePath; \
             }}; \
             if ($path) {{ $path }} else {{ '' }}"
        );
        let output = run_hidden_command("powershell", &["-NoProfile", "-Command", &script])?;
        let path = output.trim().to_string();
        if path.is_empty() {
            None
        } else {
            Some(path)
        }
    }
    #[cfg(target_os = "linux")]
    {
        let output = run_hidden_command("readlink", &["-f", &format!("/proc/{pid}/exe")])?;
        let path = output.trim().to_string();
        if path.is_empty() || path.contains("(deleted)") {
            None
        } else {
            Some(path)
        }
    }
    #[cfg(target_os = "macos")]
    {
        let output = run_hidden_command("lsof", &["-p", &pid.to_string(), "-a", "-d", "txt", "-Fn"])?;
        for line in output.lines() {
            if let Some(path) = line.strip_prefix('n') {
                let path = path.trim();
                if !path.is_empty() {
                    return Some(path.to_string());
                }
            }
        }
        None
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = pid;
        None
    }
}

#[tauri::command]
pub async fn get_process_executable_path(pid: u32) -> Result<Option<String>, String> {
    if pid == 0 {
        return Ok(None);
    }
    tokio::task::spawn_blocking(move || Ok(lookup_process_executable_path(pid)))
        .await
        .map_err(|e| format!("查询进程路径失败: {e}"))?
}

#[tauri::command]
pub async fn list_listening_ports(
    live_server: State<'_, LiveServerManager>,
    cbm_ui: State<'_, CbmUiState>,
    bg_tasks: State<'_, BackgroundTasks>,
) -> Result<Vec<ListeningPortEntry>, String> {
    let ctx = build_loom_context(&live_server, &cbm_ui, &bg_tasks);
    tokio::task::spawn_blocking(move || scan_listening_ports_with_context(ctx))
        .await
        .map_err(|e| format!("端口扫描任务失败: {e}"))?
}

#[tauri::command]
pub async fn kill_port_process(
    port: u16,
    pid: u32,
    live_server: State<'_, LiveServerManager>,
    cbm_ui: State<'_, CbmUiState>,
    bg_tasks: State<'_, BackgroundTasks>,
) -> Result<(), String> {
    if pid == std::process::id() {
        return Err("不能终止 Loom 自身进程".to_string());
    }

    let ctx = build_loom_context(&live_server, &cbm_ui, &bg_tasks);
    let target = tokio::task::spawn_blocking(move || resolve_kill_target(port, pid, &ctx))
        .await
        .map_err(|e| format!("验证端口进程失败: {e}"))??;

    match target.ownership {
        PortOwnership::Protected => return Err("该进程受保护，无法终止".to_string()),
        PortOwnership::LoomManaged => {
            return Err(
                "该端口由 Loom 内部服务占用，请通过对应功能（如 Live Server、代码图谱）停止"
                    .to_string(),
            );
        }
        PortOwnership::KnownExternal | PortOwnership::External => {
            if !target.can_kill {
                return Err("该进程不允许终止".to_string());
            }
        }
    }

    tokio::task::spawn_blocking(move || kill_port_pid(port, pid))
        .await
        .map_err(|e| format!("终止进程任务失败: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_windows_netstat_with_gbk_header() {
        let mut output = Vec::from(b"\r\n\xbb\xee\xb6\xaf\xc1\xac\xbd\xd3\r\n\r\n");
        output.extend_from_slice(
            b"  TCP    127.0.0.1:1420         0.0.0.0:0              LISTENING       12345\r\n",
        );
        let text = decode_command_output(&output);
        let ports = parse_netstat_output(&text);
        assert_eq!(ports.len(), 1);
        assert_eq!(ports[0].port, 1420);
        assert_eq!(ports[0].pid, 12345);
    }

    #[test]
    fn parse_windows_netstat_localhost_only() {
        let output = r#"
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4
  TCP    127.0.0.1:1420         0.0.0.0:0              LISTENING       12345
  TCP    127.0.0.1:5037         0.0.0.0:0              LISTENING       9999
  TCP    [::1]:5173             [::]:0                 LISTENING       67890
"#;
        let ports = parse_netstat_output(output);
        assert_eq!(ports.len(), 3);
        assert!(ports.iter().any(|p| p.port == 1420 && p.pid == 12345));
        assert!(ports.iter().any(|p| p.port == 5173 && p.pid == 67890));
        assert!(!ports.iter().any(|p| p.port == 445));
    }

    #[cfg(not(windows))]
    #[test]
    fn parse_unix_lsof_localhost_only() {
        let output = r#"COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node    12345 user   21u  IPv4 0x0      0t0  TCP 127.0.0.1:1420 (LISTEN)
python  23456 user   3u  IPv4 0x0      0t0  TCP *:8080 (LISTEN)
node    34567 user   22u  IPv6 0x0      0t0  TCP [::1]:3000 (LISTEN)
"#;
        let ports = parse_lsof_output(output);
        assert_eq!(ports.len(), 2);
        assert!(ports.iter().any(|p| p.port == 1420 && p.pid == 12345));
        assert!(ports.iter().any(|p| p.port == 3000 && p.pid == 34567));
        assert!(!ports.iter().any(|p| p.port == 8080));
    }

    #[test]
    fn known_port_labels() {
        assert_eq!(known_port_label_key(1420), Some("viteDev"));
        assert_eq!(known_port_label_key(9749), Some("cbmGraph"));
        assert_eq!(known_port_label_key(11434), Some("ollama"));
        assert_eq!(known_port_label_key(9999), None);
    }

    #[cfg(windows)]
    #[test]
    fn parse_csv_line_handles_quotes() {
        let line = r#""node.exe","12345","Console","1","45,678 K""#;
        let fields = parse_csv_line(line);
        assert_eq!(fields[0], "node.exe");
        assert_eq!(fields[1], "12345");
    }
}
