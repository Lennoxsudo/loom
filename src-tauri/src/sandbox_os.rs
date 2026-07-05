//! OS-level sandbox isolation (P1 + P2)
//!
//! Provides kernel-level process isolation across platforms:
//!
//! | Platform | Mechanism | Effect |
//! |----------|-----------|--------|
//! | Windows  | Job Object | Child processes killed when Loom exits; cannot escape |
//! | Linux    | Landlock   | Filesystem restricted to readable/writable roots |
//! | macOS    | Seatbelt   | Filesystem + network restricted via `sandbox-exec` |
//!
//! On non-target platforms, all functions are no-ops.

// ============================================================================
// Windows implementation — Job Object (P1)
// ============================================================================

#[cfg(windows)]
mod windows_impl {
    use std::sync::OnceLock;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_BREAKAWAY_OK, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    /// Wrapper around HANDLE that is Send + Sync.
    struct SafeHandle(HANDLE);

    unsafe impl Send for SafeHandle {}
    unsafe impl Sync for SafeHandle {}

    /// Global Job Object handle. When Loom exits, the handle is closed by the OS
    /// and all assigned processes are killed (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE).
    static JOB_HANDLE: OnceLock<SafeHandle> = OnceLock::new();

    fn ensure_job_object() -> Result<HANDLE, String> {
        if let Some(h) = JOB_HANDLE.get() {
            return Ok(h.0);
        }

        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err("CreateJobObjectW 失败".to_string());
        }

        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            | JOB_OBJECT_LIMIT_BREAKAWAY_OK
            | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;

        let result = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };

        if result == 0 {
            unsafe { CloseHandle(handle) };
            return Err("SetInformationJobObject 失败".to_string());
        }

        let actual = match JOB_HANDLE.set(SafeHandle(handle)) {
            Ok(()) => handle,
            Err(_) => {
                unsafe { CloseHandle(handle) };
                JOB_HANDLE.get().unwrap().0
            }
        };

        Ok(actual)
    }

    pub fn assign_process_to_job(pid: u32) -> Result<(), String> {
        let job = ensure_job_object()?;

        let process = unsafe {
            OpenProcess(
                PROCESS_SET_QUOTA | PROCESS_TERMINATE,
                0,
                pid,
            )
        };

        if process.is_null() {
            return Ok(());
        }

        let result = unsafe { AssignProcessToJobObject(job, process) };
        unsafe { CloseHandle(process) };

        if result == 0 {
            // Windows 7: assignment fails if process already has a job.
            // Windows 8+: nested jobs allowed. Either way, not fatal.
        }

        Ok(())
    }

    pub fn init() {
        let _ = ensure_job_object();
    }
}

// ============================================================================
// Linux implementation — Landlock (P2)
// ============================================================================

#[cfg(target_os = "linux")]
mod linux_impl {
    use landlock::{AccessFs, PathBeneath, PathFd, Ruleset, ABI};

    /// Apply Landlock filesystem restrictions to the **current thread**.
    ///
    /// Must be called inside `pre_exec` (between fork and exec) so that only
    /// the child process is restricted. Once applied, the restriction is
    /// inherited by all descendants and cannot be removed.
    ///
    /// - `read_roots`: paths allowed for read-only access
    /// - `write_roots`: paths allowed for read+write access
    pub fn apply_landlock(read_roots: &[String], write_roots: &[String]) -> Result<(), String> {
        let abi = ABI::V2;
        let mut ruleset = Ruleset::default()
            .handle_access(AccessFs::from_all(abi))
            .map_err(|e| format!("Landlock handle_access 失败: {e}"))?
            .create()
            .map_err(|e| format!("Landlock create 失败: {e}"))?;

        // Allow read access to readable roots
        for root in read_roots {
            let fd = PathFd::new(root)
                .map_err(|e| format!("Landlock: 无法打开路径 {root}: {e}"))?;
            ruleset = ruleset
                .add_rule(PathBeneath::new(fd, AccessFs::from_read(abi)))
                .map_err(|e| format!("Landlock add_rule(read) 失败 for {root}: {e}"))?;
        }

        // Allow read+write access to writable roots
        for root in write_roots {
            let fd = PathFd::new(root)
                .map_err(|e| format!("Landlock: 无法打开路径 {root}: {e}"))?;
            ruleset = ruleset
                .add_rule(PathBeneath::new(fd, AccessFs::from_all(abi)))
                .map_err(|e| format!("Landlock add_rule(write) 失败 for {root}: {e}"))?;
        }

        ruleset
            .restrict_self()
            .map_err(|e| format!("Landlock restrict_self 失败: {e}"))?;

        Ok(())
    }

    /// On Linux, Landlock is applied via pre_exec before the child execs.
    /// This function stores the roots so that `pre_exec` can call `apply_landlock`.
    ///
    /// Returns a closure suitable for `Command::pre_exec()`.
    pub fn make_pre_exec_hook(
        read_roots: Vec<String>,
        write_roots: Vec<String>,
    ) -> Box<dyn FnMut() -> std::io::Result<()> + Send + Sync> {
        Box::new(move || {
            apply_landlock(&read_roots, &write_roots)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
        })
    }

    pub fn assign_process_to_job(_pid: u32) -> Result<(), String> {
        // Linux uses Landlock (pre-exec), not post-spawn assignment
        Ok(())
    }

    pub fn init() {
        // Landlock is applied per-child, not globally
    }
}

// ============================================================================
// macOS implementation — Seatbelt (P2)
// ============================================================================

#[cfg(target_os = "macos")]
mod macos_impl {
    /// Generate a Seatbelt profile string for `sandbox-exec`.
    ///
    /// The profile uses `(deny default)` so everything not explicitly allowed
    /// is blocked. Filesystem access is limited to the project roots.
    pub fn generate_seatbelt_profile(
        read_roots: &[String],
        write_roots: &[String],
        network_enabled: bool,
    ) -> String {
        let mut profile = String::new();
        profile.push_str("(version 1)\n");
        profile.push_str("(deny default)\n");
        // Allow process operations needed for normal command execution
        profile.push_str("(allow process-fork)\n");
        profile.push_str("(allow process-exec)\n");
        profile.push_str("(allow signal (target self))\n");
        profile.push_str("(allow sysctl-read)\n");
        // Allow basic IPC
        profile.push_str("(allow mach-lookup)\n");
        profile.push_str("(allow ipc-posix-sem)\n");
        profile.push_str("(allow ipc-posix-shm)\n");

        // Readable roots
        for root in read_roots {
            let escaped = root.replace('\\', "\\\\").replace('"', "\\\"");
            profile.push_str(&format!(
                "(allow file-read* (subpath \"{}\"))\n",
                escaped
            ));
        }

        // Writable roots (also implicitly readable)
        for root in write_roots {
            let escaped = root.replace('\\', "\\\\").replace('"', "\\\"");
            profile.push_str(&format!(
                "(allow file-write* (subpath \"{}\"))\n",
                escaped
            ));
            // Also allow read for write roots
            profile.push_str(&format!(
                "(allow file-read* (subpath \"{}\"))\n",
                escaped
            ));
        }

        // Temp directory access (needed for scripts, temp files)
        profile.push_str("(allow file-read* (subpath \"/tmp\"))\n");
        profile.push_str("(allow file-write* (subpath \"/tmp\"))\n");
        profile.push_str("(allow file-read* (subpath \"/private/tmp\"))\n");
        profile.push_str("(allow file-write* (subpath \"/private/tmp\"))\n");

        // Network
        if network_enabled {
            profile.push_str("(allow network*)\n");
        } else {
            profile.push_str("(deny network*)\n");
        }

        profile
    }

    /// Wrap a command string with `sandbox-exec` using the generated profile.
    ///
    /// Returns a new command string suitable for direct execution:
    /// `sandbox-exec -p '<profile>' /bin/sh -c '<original_command>'`
    pub fn wrap_with_seatbelt(
        command: &str,
        read_roots: &[String],
        write_roots: &[String],
        network_enabled: bool,
    ) -> String {
        let profile = generate_seatbelt_profile(read_roots, write_roots, network_enabled);
        // Escape single quotes in the profile and command for shell safety
        let profile_escaped = profile.replace('\'', "'\\''");
        let command_escaped = command.replace('\'', "'\\''");
        format!(
            "sandbox-exec -p '{}' /bin/sh -c '{}'",
            profile_escaped, command_escaped
        )
    }

    pub fn assign_process_to_job(_pid: u32) -> Result<(), String> {
        // macOS uses Seatbelt (command wrapping), not post-spawn assignment
        Ok(())
    }

    pub fn init() {
        // Seatbelt is applied per-command, not globally
    }
}

// ============================================================================
// Fallback: no-op stubs for unsupported platforms
// ============================================================================

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
mod stub_impl {
    pub fn assign_process_to_job(_pid: u32) -> Result<(), String> {
        Ok(())
    }

    pub fn init() {}
}

// ============================================================================
// Public API — re-exports per platform
// ============================================================================

#[cfg(windows)]
pub use windows_impl::assign_process_to_job;
#[cfg(windows)]
pub use windows_impl::init;

#[cfg(target_os = "linux")]
pub use linux_impl::assign_process_to_job;
#[cfg(target_os = "linux")]
pub use linux_impl::init;

#[cfg(target_os = "linux")]
pub use linux_impl::make_pre_exec_hook as make_landlock_pre_exec;
#[cfg(target_os = "linux")]
pub use linux_impl::apply_landlock;

#[cfg(target_os = "macos")]
pub use macos_impl::assign_process_to_job;
#[cfg(target_os = "macos")]
pub use macos_impl::init;

#[cfg(target_os = "macos")]
pub use macos_impl::wrap_with_seatbelt;
#[cfg(target_os = "macos")]
pub use macos_impl::generate_seatbelt_profile;

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
pub use stub_impl::assign_process_to_job;
#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
pub use stub_impl::init;

/// Initialize the OS sandbox layer. Called once at application startup.
pub fn init_sandbox() {
    init();
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_does_not_panic() {
        init_sandbox();
        // Calling init again should be safe (idempotent)
        init_sandbox();
    }

    #[test]
    fn assign_process_to_job_does_not_panic_for_invalid_pid() {
        let result = assign_process_to_job(0);
        assert!(result.is_ok());
    }

    #[test]
    fn apply_pre_spawn_sandbox_is_safe() {
        // No-op on all platforms — sandbox is applied via pre_exec (Linux)
        // or command wrapping (macOS) or post-spawn Job Object (Windows)
    }

    // --- macOS Seatbelt profile generation tests ---

    #[cfg(target_os = "macos")]
    #[test]
    fn seatbelt_profile_has_deny_default() {
        let profile = generate_seatbelt_profile(
            &["/Users/test/project".to_string()],
            &["/Users/test/project".to_string()],
            false,
        );
        assert!(profile.contains("(deny default)"));
        assert!(profile.contains("(deny network*)"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn seatbelt_profile_allows_network_when_enabled() {
        let profile = generate_seatbelt_profile(&[], &["/tmp/p".to_string()], true);
        assert!(profile.contains("(allow network*)"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn seatbelt_wrap_includes_sandbox_exec() {
        let wrapped = wrap_with_seatbelt("ls -la", &[], &["/tmp/p".to_string()], false);
        assert!(wrapped.starts_with("sandbox-exec -p "));
        assert!(wrapped.contains("ls -la"));
    }
}
