use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

/// Track and manage background CBM indexing threads.
///
/// Uses `Arc<AtomicBool>` for cancellation (no extra dependency on tokio-util).
/// Threads check `is_cancelled()` at strategic points and exit early.
pub struct CbmTaskRegistry {
    cancel_flag: Arc<AtomicBool>,
    handles: Mutex<Vec<JoinHandle<()>>>,
}

impl Default for CbmTaskRegistry {
    fn default() -> Self {
        Self {
            cancel_flag: Arc::new(AtomicBool::new(false)),
            handles: Mutex::new(Vec::new()),
        }
    }
}

/// Maximum number of JoinHandles to retain. When this limit is reached,
/// the oldest handle is detached (dropped) to make room for new ones.
/// Each JoinHandle holds a kernel thread descriptor even after the thread
/// exits, so bounding the Vec prevents unbounded resource usage in
/// long-running sessions with frequent workspace switches.
const MAX_HANDLES: usize = 32;

impl CbmTaskRegistry {
    /// Spawn a background thread for CBM indexing.
    /// The thread receives a clone of the cancel flag.
    pub fn spawn<F>(&self, f: F)
    where
        F: FnOnce(Arc<AtomicBool>) + Send + 'static,
    {
        let flag = self.cancel_flag.clone();
        let handle = std::thread::spawn(move || f(flag));
        if let Ok(mut handles) = self.handles.lock() {
            // Prune completed handles to avoid unbounded growth.
            handles.retain(|h| !h.is_finished());
            // Enforce upper bound: detach oldest handle if at capacity.
            while handles.len() >= MAX_HANDLES {
                let _ = handles.remove(0); // drop → detach
            }
            handles.push(handle);
        }
    }

    /// Signal all tasks to cancel and kill in-flight CBM CLI subprocesses.
    ///
    /// Killing subprocesses is necessary because background threads may be
    /// blocked inside `wait_child_with_timeout` → `rx.recv_timeout(1800s)`.
    /// The cancel flag alone cannot interrupt that blocking call — the
    /// subprocess must be killed so `child.wait_with_output()` returns,
    /// which unblocks `recv_timeout` and lets the thread finish promptly.
    pub fn cancel_all(&self) {
        self.cancel_flag.store(true, Ordering::Relaxed);
        super::cli::shutdown_running_cli_processes();
    }

    /// Wait for all spawned tasks to complete, up to `timeout`.
    /// Called on application exit for graceful shutdown.
    ///
    /// Uses `is_finished()` polling instead of `join()` to avoid blocking
    /// indefinitely on a single thread. If a thread doesn't finish within
    /// the deadline, its handle is detached (via `mem::forget`) and the OS
    /// reclaims the resource when the thread eventually exits.
    pub fn wait_all(&self, timeout: Duration) {
        let handles: Vec<_> = self
            .handles
            .lock()
            .map(|mut h| h.drain(..).collect::<Vec<_>>())
            .unwrap_or_default();

        let deadline = std::time::Instant::now() + timeout;
        let poll_interval = Duration::from_millis(50);

        for handle in handles {
            // Poll is_finished() until the thread exits or the deadline passes.
            // This avoids the indefinite blocking of join() when a thread is
            // stuck in an unkillable syscall (e.g. zombie process, permission
            // denied on taskkill).
            loop {
                if handle.is_finished() {
                    let _ = handle.join();
                    break;
                }
                if std::time::Instant::now() >= deadline {
                    // Detach: the OS will reclaim the thread when it exits.
                    // We must forget the handle to avoid the destructor
                    // panicking on an unjoined thread.
                    std::mem::forget(handle);
                    break;
                }
                std::thread::sleep(poll_interval);
            }
            if std::time::Instant::now() >= deadline {
                // Past the deadline: remaining handles in the Vec will be
                // dropped (detached) when it goes out of scope.
                break;
            }
        }
        // Remaining unjoined handles are dropped here — dropping a
        // JoinHandle detaches the thread (OS reclaims it on exit).
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_all_sets_flag() {
        let registry = CbmTaskRegistry::default();
        assert!(!registry.cancel_flag.load(Ordering::Relaxed));
        registry.cancel_all();
        assert!(registry.cancel_flag.load(Ordering::Relaxed));
    }

    #[test]
    fn spawn_receives_cancel_flag() {
        let registry = CbmTaskRegistry::default();
        let flag_holder = Arc::new(Mutex::new(None));
        let flag_clone = flag_holder.clone();
        registry.spawn(move |flag| {
            *flag_clone.lock().unwrap() = Some(flag);
        });
        std::thread::sleep(Duration::from_millis(50));
        let flag = flag_holder.lock().unwrap().take();
        assert!(flag.is_some());
        assert!(!flag.unwrap().load(Ordering::Relaxed));
    }

    #[test]
    fn spawn_sees_cancelled_flag_after_cancel_all() {
        let registry = CbmTaskRegistry::default();
        let seen_cancelled = Arc::new(AtomicBool::new(false));
        let seen_clone = seen_cancelled.clone();
        registry.spawn(move |flag| {
            // Simulate work, then check flag
            std::thread::sleep(Duration::from_millis(50));
            seen_clone.store(flag.load(Ordering::Relaxed), Ordering::Relaxed);
        });
        registry.cancel_all();
        std::thread::sleep(Duration::from_millis(100));
        assert!(seen_cancelled.load(Ordering::Relaxed));
    }

    #[test]
    fn wait_all_completes_after_threads_finish() {
        let registry = CbmTaskRegistry::default();
        let done = Arc::new(AtomicBool::new(false));
        let done_clone = done.clone();
        registry.spawn(move |_| {
            std::thread::sleep(Duration::from_millis(20));
            done_clone.store(true, Ordering::Relaxed);
        });
        registry.wait_all(Duration::from_secs(2));
        assert!(done.load(Ordering::Relaxed));
    }

    /// Verify that `cancel_all` + `wait_all` returns well within the timeout
    /// when a spawned thread cooperatively checks the cancel flag.
    ///
    /// This simulates the exit path: `shutdown_all` calls `cancel_all`
    /// (which kills CLI subprocesses and sets the flag) then `wait_all`.
    /// If the mechanism works, `wait_all` should not block for the full
    /// timeout duration.
    #[test]
    fn cancel_all_then_wait_all_returns_quickly() {
        let registry = CbmTaskRegistry::default();
        let finished = Arc::new(AtomicBool::new(false));
        let finished_clone = finished.clone();
        registry.spawn(move |flag| {
            // Simulate a long task that cooperatively checks the cancel flag.
            // Without cancellation, this would block for 30s.
            for _ in 0..3000 {
                if flag.load(Ordering::Relaxed) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            finished_clone.store(true, Ordering::Relaxed);
        });

        // Give the thread time to start.
        std::thread::sleep(Duration::from_millis(50));

        registry.cancel_all();

        let start = std::time::Instant::now();
        registry.wait_all(Duration::from_secs(5));
        let elapsed = start.elapsed();

        assert!(
            finished.load(Ordering::Relaxed),
            "thread should have finished after cancel_all"
        );
        assert!(
            elapsed < Duration::from_secs(2),
            "wait_all should return quickly after cancel_all, took {elapsed:?}"
        );
    }

    /// Verify that `wait_all` returns within the timeout even when a spawned
    /// thread is **uncancellable** — it never checks the cancel flag and is
    /// blocked in a long sleep that `cancel_all` cannot interrupt.
    ///
    /// This is the core regression test for P0-1: the old implementation used
    /// `handle.join()` which would block indefinitely on such a thread.
    /// The new implementation polls `is_finished()` and detaches the handle
    /// when the deadline passes.
    #[test]
    fn wait_all_returns_within_timeout_with_uncancellable_thread() {
        let registry = CbmTaskRegistry::default();
        let started = Arc::new(AtomicBool::new(false));
        let started_clone = started.clone();

        // Spawn a thread that ignores the cancel flag and sleeps for 10s.
        // cancel_all cannot interrupt this — it only kills CBM CLI processes
        // and sets the flag, but this thread checks neither.
        registry.spawn(move |_flag| {
            started_clone.store(true, Ordering::Relaxed);
            std::thread::sleep(Duration::from_secs(10));
        });

        // Wait for the thread to start.
        while !started.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(10));
        }

        registry.cancel_all();

        let timeout = Duration::from_millis(500);
        let start = std::time::Instant::now();
        registry.wait_all(timeout);
        let elapsed = start.elapsed();

        // wait_all must return within ~timeout, not 10s.
        // Allow generous slack for CI scheduling jitter.
        assert!(
            elapsed < Duration::from_secs(2),
            "wait_all should return within ~500ms timeout, took {elapsed:?}"
        );
    }

    /// Verify that the handles Vec is bounded at MAX_HANDLES.
    ///
    /// Spawn more threads than MAX_HANDLES. After all threads finish, the
    /// internal Vec should never exceed MAX_HANDLES entries.
    #[test]
    fn handles_bounded_at_max_limit() {
        let registry = CbmTaskRegistry::default();

        // Spawn MAX_HANDLES + 10 threads that finish quickly.
        for _ in 0..(MAX_HANDLES + 10) {
            registry.spawn(move |_| {
                std::thread::sleep(Duration::from_millis(5));
            });
        }

        // Wait for all threads to finish.
        std::thread::sleep(Duration::from_millis(200));

        // Check internal Vec length.
        let count = registry
            .handles
            .lock()
            .map(|h| h.len())
            .unwrap_or(0);

        assert!(
            count <= MAX_HANDLES,
            "handles Vec should be bounded at {MAX_HANDLES}, got {count}"
        );
    }
}
