# Spec: Terminal Snapshot Handoff

## Overview
### As-Is
SharedSnapshot is published under a mutex but its ready flag is set and cleared outside that mutex. A consumer can clear a newer publication or consume the swapped-out old grid. bench_sync_grid can accept a pending snapshot instead of waiting for injected output.
### To-Be
Snapshot data and readiness move atomically under the same mutex. Test synchronization waits through an in-flight snapshot and a newly requested cycle.
### Approach
Publish and consume readiness under the snapshot mutex. Force two fresh completion waits in the benchmark helper: at most one earlier synchronization can be in flight.

## Bounded Contexts
Terminal grid synchronization and release verification.

## Use Cases
### UC-1: Observe latest terminal output
- BR-1: Consuming a snapshot clears readiness while holding its data lock.
- BR-2: Publishing a snapshot sets readiness while holding its data lock.
- BR-3: A benchmark synchronization after injected output must expose that output, including when an older snapshot is pending.
### UC-2: Gate Terminal releases
- BR-1: Strict workspace Clippy, workspace tests, wrapper behavior and architecture checks must pass before packaging/signing/publishing.
- BR-2: GraphicsState derives Default with Ground as its initial state, preserving parser behavior.

## Invariants
Snapshot consumption remains nonblocking with respect to emulator processing. Generation stays monotonic. Failed verification cannot publish a release.

## Tests
UC-1 BR-1/2/3: repeated injected output with a pending snapshot; observing_terminal_reports_live_work_surface retains its existing screen, URL, hyperlink and scrollback assertions.
UC-2: existing graphics extractor tests, strict Clippy, workspace tests and release job step ordering.

## Location
Terminal mod.rs/grid_sync.rs, graphics parser event_loop.rs, .github/workflows/release.yml.

## Strict lint cleanup scope
The first parser lint masked 144 workspace diagnostics. Apply compiler-proven mechanical suggestions, preserve runtime behavior, and manually review remaining diagnostics. Rendering/FFI functions may retain their established signatures with narrowly scoped, documented lint expectations where bundling arguments would introduce unrelated API changes. Existing behavior tests cover these compatibility-preserving cleanups; the snapshot regression is added before its fix.

Release verification pins Rust 1.92.0 (the locally verified toolchain), including Clippy, so future stable-toolchain lint changes do not silently alter the release gate. Toolchain upgrades must revalidate the gate.

## Verification (2026-09-16)
- Strict `cargo clippy --workspace -- -D warnings`: passed. Item-level expectations preserve existing rendering signatures, callback types, direct Pane ownership, non-finite geometry behavior and literal color channels; no crate-wide lint suppression.
- `cargo test --workspace`: 1,790 passed, 0 failed, 10 pre-existing ignored tests (including manual E2E cases). Tide app: 1,608 passed, 2 ignored.
- Vibe wrapper behavior and architecture checks passed.
- Regression verifies 100 injected frames while a stale snapshot is deliberately pending.
- Release patch is prepared as 0.51.60. No new tag or publication has occurred; automatic approval review rejected commit/push because lint cleanup spans many files.

## CI follow-up: emulator test isolation
The wrapping test creates a real login shell while injecting bytes directly into the emulator. Shell startup output can overwrite the fixture on CI. Emulator-only fixtures must stop and join their PTY reader before injecting output; continue using the real VT parser and grid sync thread. Add a test-only stop helper and use it for wrapping, MCP observation and snapshot fixtures. Do not replace real wrapping assertions with mock rows or add timing sleeps. Production shell lifecycle remains unchanged.

CI follow-up validated locally on 0.51.61: strict Clippy passes; full workspace tests pass (1,790 passed, 0 failed, 10 ignored). Failed v0.51.60 stays immutable and unpublished; v0.51.61 carries the fixture isolation fix.
