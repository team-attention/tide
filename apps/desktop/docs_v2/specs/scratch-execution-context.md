# Spec: Scratch Execution Context

## Scope

A Scratch Thread must run in a real, Tide-owned per-thread directory, not a bare
placeholder string. Today `scope.scratchCwd` is the literal `"Scratch"`, which is
not a real path — the provider CLI runs in a non-existent/untrusted cwd and raises
`directory_trust_required`, so Scratch Threads cannot proceed.

In scope:
- On first start of a Scratch Thread, materialize its cwd to
  `<appDataRoot>/scratch/<threadId>` (Tide app-support dir), creating the directory.
- Persist the resolved real path back into `scope.scratchCwd` so every later cwd
  use (launch, readiness/trust, terminal, attachments) sees the same real dir.
- Auto-grant provider trust for that Tide-owned dir for the Thread's agent, so the
  agent proceeds without a trust prompt (Tide owns the dir; prompting is noise).

## Evidence

- `thread-runtime-service.ts threadRoot()` returns `scope.scratchCwd` for scratch.
- `agent-chat-shell-state.ts` defaults new-thread scope to `{ kind: "scratch",
  scratchCwd: "Scratch" }`.
- Readiness/trust is checked against this cwd; `directory_trust_required` fires when
  it is absent from the provider trust store (`provider-trust` spec).
- `live-backend.ts` has `appDataRoot` (Electron userData = Application Support/Tide).

## Decisions

- Scratch base = `<appDataRoot>/scratch`, per-thread subdir = the threadId.
- Resolution + dir creation + auto-trust happen once, before the readiness check on
  first start, then the real path is persisted and reused (idempotent on follow-ups).
- Auto-trust uses the existing `ProviderTrustPort` for the Thread's single agent.

## Domain Model / Contracts

- Service deps gain `ensureScratchDirectory?: (threadId) => string` — creates and
  returns the real scratch cwd. Injected (node mkdir) so the service stays pure/testable.

## Flow

1. `startThread` (and resume) → if `scope.kind === "scratch"` and `scratchCwd` is not
   already the materialized path, call `ensureScratchDirectory(threadId)`, set
   `scope.scratchCwd` to the result, auto-trust it.
2. Then the existing readiness check sees a real, trusted cwd → ready → launch there.

## Invariants

- A Scratch Thread's agent cwd is always an existing directory under
  `<appDataRoot>/scratch/<threadId>`.
- The materialized path is stable across turns (persisted in scope).
- No `directory_trust_required` blocker for a Scratch Thread (auto-trusted).

## Tests

- Scratch start materializes `scope.scratchCwd` to `<scratchRoot>/<threadId>`, creates
  the dir, and auto-trusts it for the agent.
- A project Thread is unchanged (no scratch materialization, no auto-trust).
- Second start of the same scratch thread is idempotent (same path, no re-trust churn).

## Out Of Scope

- Adoption default scoping (separate spec).
- Cleaning up old scratch dirs.
