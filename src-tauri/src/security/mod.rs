//! Security layer: sandbox, OS isolation, audit log.
//! Phase 1 places modules here; deeper per-execution context is phase 2.

pub mod audit_log;
pub mod sandbox;
pub mod sandbox_os;
