//! Security layer: sandbox, OS isolation, audit log, per-execution context.
//!
//! Phase 2: workspace policy is an `Arc` snapshot; concurrent agent runs can
//! register execution-scoped contexts via `begin_sandbox_execution`.

pub mod audit_log;
pub mod context;
pub mod sandbox;
pub mod sandbox_os;
