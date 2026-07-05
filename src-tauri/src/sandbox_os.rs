//! OS-level sandbox isolation (P1 + P2)
//!
//! Provides kernel-level process isolation across platforms:
//!
//! | Platform | Mechanism | Effect |
//! |----------|-----------|--------|
//! | Windows  | Job Object | Process lifecycle only — child processes killed when Loom exits |
//! | Linux    | Landlock   | Filesystem restricted to readable/writable roots (kernel-enforced) |
//! | macOS    | Seatbelt   | Filesystem + network restricted via `sandbox-exec` (kernel-enforced) |
//!
//! ## Windows Limitations (Important)
//!
//! The Windows Job Object provides **process lifecycle isolation only**:
//! it ensures all child processes are killed when Loom exits
//! (`KILL_ON_JOB_CLOSE`) and that unhandled exceptions crash the process
//! (`DIE_ON_UNHANDLED_EXCEPTION`).
//!
//! It does **NOT** provide filesystem or network isolation. On Windows,
//! all file/network access control is enforced solely at L1 (application
//! layer) via `validate_read`, `validate_write`, `validate_network`, and
//! `validate_command_file_access`. A compromised agent process that calls
//! Win32 APIs directly could bypass these application-layer checks.
//!
//! Full kernel-level filesystem isolation on Windows would require a
//! write-restricted token approach:
//! 1. `CreateRestrictedToken` with `WRITE_RESTRICTED` to create a token
//!    that can only write to objects granting access to a specific SID
//! 2. `AllocateAndInitializeSid` to create a synthetic `sandbox-write` SID
//! 3. `SetEntriesInAcl` + `SetNamedSecurityInfo` to add the SID to the
//!    project directory's DACL
//! 4. `CreateProcessAsUserW` to spawn the child with the restricted token
//!
//! This is a known gap and tracked as a future enhancement.
//!
//! On non-target platforms, all functions are no-ops.

// ============================================================================
// Windows implementation — Job Object (P1)
//
// IMPORTANT: The Job Object provides process lifecycle management ONLY.
// It does NOT restrict filesystem, network, or registry access.
// See the module-level documentation for details on Windows limitations
// and the roadmap for write-restricted token support.
// ============================================================================

#[cfg(windows)]
mod windows_impl {
    use std::sync::OnceLock;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    /// Wrapper around HANDLE that is Send + Sync.
    struct SafeHandle(HANDLE);

    unsafe impl Send for SafeHandle {}
    unsafe impl Sync for SafeHandle {}

    /// Global Job Object handle. When Loom exits, the handle is closed by
    /// the OS and all assigned processes are killed.
    ///
    /// NOTE: This does NOT prevent processes from escaping the Job Object
    /// via `CreateProcess` with `CREATE_BREAKAWAY_FROM_JOB`. We deliberately
    /// do NOT set `BREAKAWAY_OK` — instead, breakaway attempts will fail,
    /// keeping all descendants inside the Job Object.
    static JOB_HANDLE: OnceLock<SafeHandle> = OnceLock::new();

    fn ensure_job_object() -> Result<HANDLE, String> {
        if let Some(h) = JOB_HANDLE.get() {
            return Ok(h.0);
        }

        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err("CreateJobObjectW 失败".to_string());
        }

        // KILL_ON_JOB_CLOSE: When the Job Object handle is closed (including
        //   process exit/crash), all processes in the job are terminated.
        // DIE_ON_UNHANDLED_EXCEPTION: An unhandled exception in any process
        //   in the job terminates the entire job.
        //
        // We deliberately omit BREAKAWAY_OK: without it, child processes
        // cannot use CREATE_BREAKAWAY_FROM_JOB to escape, ensuring ALL
        // descendants remain in the Job Object and are killed on Loom exit.
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;

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
    use landlock::{AccessFs, CompatLevel, Compatible, PathBeneath, PathFd, Ruleset, ABI};

    /// Apply Landlock filesystem restrictions to the **current thread**.
    ///
    /// Must be called inside `pre_exec` (between fork and exec) so that only
    /// the child process is restricted. Once applied, the restriction is
    /// inherited by all descendants and cannot be removed.
    ///
    /// - `read_roots`: paths allowed for read-only access
    /// - `write_roots`: paths allowed for read+write access
    ///
    /// **BestEffort**: If the kernel doesn't support Landlock at all, this
    /// function logs a warning and returns `Ok(())` instead of failing.
    /// V1 access rights are required (`HardRequirement`); V2–V7 rights are
    /// opportunistically handled (`BestEffort`) and silently dropped on
    /// older kernels. This prevents command execution from breaking on
    /// systems without Landlock support. The application-layer checks (L1)
    /// remain as the fallback.
    ///
    /// **Network gap**: Landlock only restricts filesystem access, not network
    /// egress. Linux OS-level network isolation (equivalent to macOS Seatbelt's
    /// `(deny network*)`) is not available via Landlock and remains a gap.
    /// Network access control on Linux relies entirely on L1 (`validate_network`).
    pub fn apply_landlock(read_roots: &[String], write_roots: &[String]) -> Result<(), String> {
        // Use the crate's recommended two-tier ABI strategy:
        //
        // 1. HardRequirement + V1: guarantees the kernel supports at least the
        //    first Landlock ABI (Linux 5.13+). If not, `handle_access` returns
        //    an error and we fall back to application-layer checks.
        //
        // 2. BestEffort + V7: opportunistically handles access rights from
        //    newer ABIs (V2–V7). Unsupported rights are silently dropped by
        //    the crate — no error, no crash.
        //
        // Path rules use V7 access sets with BestEffort (inherited from the
        // ruleset) so that on newer kernels, operations like `rename` between
        // directories (AccessFs::Refer, V2+) are allowed within roots.
        let mut ruleset = match Ruleset::default()
            .set_compatibility(CompatLevel::HardRequirement)
            .handle_access(AccessFs::from_all(ABI::V1))
            .map_err(|e| format!("Landlock handle_access (V1) 失败: {e}"))?
            .set_compatibility(CompatLevel::BestEffort)
            .handle_access(AccessFs::from_all(ABI::V7))
            .map_err(|e| format!("Landlock handle_access (V7) 失败: {e}"))?
            .create()
        {
            Ok(rs) => rs,
            Err(e) => {
                // Landlock not available on this kernel — fail open but log.
                // Application-layer checks (validate_read/write/command) remain.
                eprintln!(
                    "Landlock: kernel does not support Landlock ({}), \
                     falling back to application-layer only",
                    e
                );
                return Ok(());
            }
        };

        // Allow read access to readable roots.
        // Uses V7 access set; BestEffort (inherited) drops unsupported rights.
        for root in read_roots {
            let fd = match PathFd::new(root) {
                Ok(fd) => fd,
                Err(e) => {
                    eprintln!("Landlock: 跳过无法打开的路径 {root}: {e}");
                    continue;
                }
            };
            ruleset = match ruleset.add_rule(PathBeneath::new(fd, AccessFs::from_read(ABI::V7))) {
                Ok(rs) => rs,
                Err(e) => {
                    eprintln!("Landlock: 跳过无法添加规则的路径 {root}: {e}");
                    continue;
                }
            };
        }

        // Allow read+write access to writable roots.
        for root in write_roots {
            let fd = match PathFd::new(root) {
                Ok(fd) => fd,
                Err(e) => {
                    eprintln!("Landlock: 跳过无法打开的路径 {root}: {e}");
                    continue;
                }
            };
            ruleset = match ruleset.add_rule(PathBeneath::new(fd, AccessFs::from_all(ABI::V7))) {
                Ok(rs) => rs,
                Err(e) => {
                    eprintln!("Landlock: 跳过无法添加规则的路径 {root}: {e}");
                    continue;
                }
            };
        }

        // BestEffort: if restrict_self fails (e.g. unprivileged user on old
        // kernel), don't crash the spawn — log and continue.
        if let Err(e) = ruleset.restrict_self() {
            eprintln!(
                "Landlock: restrict_self 失败 ({}), \
                 子进程将在无 Landlock 限制下运行（应用层校验仍然生效）",
                e
            );
        }

        Ok(())
    }

    /// On Linux, Landlock is applied via pre_exec before the child execs.
    /// This function stores the roots so that `pre_exec` can call `apply_landlock`.
    ///
    /// Returns a closure suitable for `Command::pre_exec()`.
    ///
    /// **BestEffort**: The closure never returns `Err` — if Landlock fails,
    /// the child runs without OS-level isolation but application-layer checks
    /// still apply. This prevents command execution from breaking on systems
    /// without Landlock support.
    pub fn make_pre_exec_hook(
        read_roots: Vec<String>,
        write_roots: Vec<String>,
    ) -> Box<dyn FnMut() -> std::io::Result<()> + Send + Sync> {
        Box::new(move || {
            // BestEffort: apply_landlock always returns Ok, so this never
            // fails the spawn. On unsupported kernels, it's a no-op.
            let _ = apply_landlock(&read_roots, &write_roots);
            Ok(())
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

        // System library/framework read whitelist (required for dyld to load
        // shared libraries and launch binaries). Without these, (deny default)
        // blocks dyld from reading the shared cache and system frameworks,
        // causing most commands to fail at launch.
        profile.push_str("(allow file-read* (subpath \"/usr/lib\"))\n");
        profile.push_str("(allow file-read* (subpath \"/usr/share\"))\n");
        profile.push_str("(allow file-read* (subpath \"/usr/bin\"))\n");
        profile.push_str("(allow file-read* (subpath \"/bin\"))\n");
        profile.push_str("(allow file-read* (subpath \"/sbin\"))\n");
        profile.push_str("(allow file-read* (subpath \"/System\"))\n");
        profile.push_str("(allow file-read* (subpath \"/Library\"))\n");
        profile.push_str("(allow file-read* (subpath \"/etc\"))\n");
        profile.push_str("(allow file-read* (subpath \"/private/etc\"))\n");
        // dyld shared cache
        profile.push_str("(allow file-read* (subpath \"/private/var/db/dyld\"))\n");
        // Device files
        profile.push_str("(allow file-read* (subpath \"/dev\"))\n");
        profile.push_str("(allow file-write* (subpath \"/dev/null\"))\n");
        profile.push_str("(allow file-write* (subpath \"/dev/urandom\"))\n");

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

    #[cfg(target_os = "macos")]
    #[test]
    fn seatbelt_profile_includes_system_library_paths() {
        let profile = generate_seatbelt_profile(
            &["/Users/test/project".to_string()],
            &["/Users/test/project".to_string()],
            false,
        );
        // dyld needs these to launch binaries
        assert!(profile.contains("\"/usr/lib\""), "must allow reading /usr/lib");
        assert!(profile.contains("\"/System\""), "must allow reading /System");
        assert!(profile.contains("\"/bin\""), "must allow reading /bin");
        assert!(profile.contains("\"/usr/bin\""), "must allow reading /usr/bin");
        assert!(
            profile.contains("\"/private/var/db/dyld\""),
            "must allow reading dyld shared cache"
        );
    }
}
