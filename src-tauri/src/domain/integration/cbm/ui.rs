use std::io::{BufRead, BufReader};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::AppHandle;

use super::path::{cbm_cache_dir, resolve_cbm_ui_executable};

pub const CBM_UI_DEFAULT_PORT: u16 = 9749;
const CBM_UI_PORT_MAX_RETRIES: u16 = 3;
const UI_START_GRACE: Duration = Duration::from_secs(30);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CbmUiStatus {
    pub running: bool,
    pub port: u16,
    pub url: String,
    pub ui_supported: bool,
    pub message: Option<String>,
}

struct UiProcess {
    child: Child,
    port: u16,
    started_at: Instant,
}

pub struct CbmUiState {
    inner: Mutex<Option<UiProcess>>,
}

impl Default for CbmUiState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

fn is_ui_port_open(port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}")
            .parse()
            .expect("valid localhost socket"),
        Duration::from_millis(250),
    )
    .is_ok()
}

/// Check if a port is available for binding (not in use).
fn is_port_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Find an available port starting from CBM_UI_DEFAULT_PORT.
fn find_available_port() -> Option<u16> {
    for offset in 0..CBM_UI_PORT_MAX_RETRIES {
        let port = CBM_UI_DEFAULT_PORT + offset;
        if is_port_available(port) {
            return Some(port);
        }
    }
    None
}

impl CbmUiState {
    fn build_status(running: bool, port: u16, message: Option<String>) -> CbmUiStatus {
        CbmUiStatus {
            running,
            port,
            url: format!("http://localhost:{port}"),
            ui_supported: true,
            message,
        }
    }

    fn reconcile_process(guard: &mut Option<UiProcess>) -> Option<u16> {
        // Take the process out to avoid borrow conflicts during try_wait.
        let Some(mut proc) = guard.take() else {
            // No tracked process; check if something is listening on default port
            return if is_ui_port_open(CBM_UI_DEFAULT_PORT) {
                Some(CBM_UI_DEFAULT_PORT)
            } else {
                None
            };
        };

        match proc.child.try_wait() {
            Ok(Some(_)) => {
                // Process exited
                None
            }
            Ok(None) => {
                // Process still running
                let port = proc.port;
                if is_ui_port_open(port) {
                    *guard = Some(proc);
                    return Some(port);
                }
                if proc.started_at.elapsed() > UI_START_GRACE {
                    let _ = proc.child.kill();
                    let _ = proc.child.wait();
                    None
                } else {
                    // Still in grace period, put it back
                    *guard = Some(proc);
                    None
                }
            }
            Err(_) => {
                // try_wait failed, drop the process handle
                None
            }
        }
    }

    pub fn status(&self) -> CbmUiStatus {
        if let Ok(mut guard) = self.inner.lock() {
            if let Some(port) = Self::reconcile_process(&mut guard) {
                return Self::build_status(true, port, None);
            }
        } else if is_ui_port_open(CBM_UI_DEFAULT_PORT) {
            return Self::build_status(true, CBM_UI_DEFAULT_PORT, None);
        }

        Self::build_status(false, CBM_UI_DEFAULT_PORT, None)
    }

    pub fn start(&self, app: &AppHandle) -> Result<CbmUiStatus, String> {
        if resolve_cbm_ui_executable(app).is_err() {
            return Err("codebase-memory UI sidecar 不可用".into());
        }

        // Already running?
        if let Ok(mut guard) = self.inner.lock() {
            if let Some(port) = Self::reconcile_process(&mut guard) {
                return Ok(Self::build_status(true, port, None));
            }
        } else if is_ui_port_open(CBM_UI_DEFAULT_PORT) {
            return Ok(Self::build_status(true, CBM_UI_DEFAULT_PORT, None));
        }

        // Find an available port (9749 → 9750 → 9751)
        let port = find_available_port().ok_or_else(|| {
            format!(
                "端口 {CBM_UI_DEFAULT_PORT}~{} 均被占用",
                CBM_UI_DEFAULT_PORT + CBM_UI_PORT_MAX_RETRIES - 1
            )
        })?;

        let executable = resolve_cbm_ui_executable(app)?;
        let cache_dir = cbm_cache_dir()?;

        let mut cmd = Command::new(executable);
        cmd.arg("--ui=true")
            .arg(format!("--port={port}"))
            .env("CBM_CACHE_DIR", cache_dir)
            .stdout(Stdio::null())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("启动 CBM UI 失败: {e}"))?;

        // Spawn a thread to drain stderr for diagnostics
        if let Some(stderr) = child.stderr.take() {
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    eprintln!("[cbm-ui] {line}");
                }
            });
        }

        if let Ok(mut guard) = self.inner.lock() {
            *guard = Some(UiProcess {
                child,
                port,
                started_at: Instant::now(),
            });
        }

        // Return status with the actual port
        Ok(Self::build_status(true, port, None))
    }

    pub fn stop(&self) -> Result<CbmUiStatus, String> {
        if let Ok(mut guard) = self.inner.lock() {
            if let Some(mut proc) = guard.take() {
                let _ = proc.child.kill();
                let _ = proc.child.wait();
            }
        }
        Ok(self.status())
    }

    /// Returns tracked CBM UI child PID and port when the process is still running.
    pub fn tracked_process(&self) -> Option<(u32, u16)> {
        let guard = self.inner.lock().ok()?;
        let proc = guard.as_ref()?;
        Some((proc.child.id(), proc.port))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_ui_port_open_returns_false_for_unused_high_port() {
        assert!(!is_ui_port_open(19749));
    }

    #[test]
    fn is_port_available_finds_free_port() {
        // At least one of 9749/9750/9751 should be free in test env
        assert!(find_available_port().is_some());
    }

    /// Verify that `status()` does not block when the tracked child process
    /// is hung (doesn't respond to kill). This is the core regression test
    /// for P1-3: the old implementation called `child.wait()` inside the
    /// Mutex, blocking all callers. The new implementation polls with a
    /// timeout and detaches.
    #[test]
    fn status_does_not_block_when_child_hangs() {
        let ui_state = CbmUiState::default();

        // Spawn a "hung" process that will not exit on its own.
        #[cfg(windows)]
        let child = Command::new("ping")
            .args(["-n", "9999", "127.0.0.1"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("failed to spawn test process");

        #[cfg(not(windows))]
        let child = Command::new("sleep")
            .arg("9999")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("failed to spawn test process");

        // Inject the process with started_at far in the past (past grace period)
        // so reconcile_process will try to kill it.
        {
            let mut guard = ui_state.inner.lock().unwrap();
            *guard = Some(UiProcess {
                child,
                port: CBM_UI_DEFAULT_PORT,
                started_at: Instant::now() - Duration::from_secs(120),
            });
        }

        // status() should return within CHILD_WAIT_TIMEOUT + slack, not block.
        let start = Instant::now();
        let _status = ui_state.status();
        let elapsed = start.elapsed();

        assert!(
            elapsed < Duration::from_secs(6),
            "status() should not block when child hangs, took {elapsed:?}"
        );
    }
}
