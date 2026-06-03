# Spec: Live Backend Persistence Bootstrap

## Scope

This spec connects the file-backed Persistence service to the live Backend process.

It covers:

- Desktop Main passing the Electron app data root to Backend.
- Backend creating file-backed storage from that root.
- Backend restoring persisted Thread metadata into the Thread Runtime before handling commands.
- Backend saving Thread metadata when a Thread is started or hydrated from a start path.
- Product Shell `thread.list` receiving persisted Threads after app restart.

It does not cover Agent Session Cache rebuild, provider session reference discovery, search, archive mutation, or project settings persistence.

## Evidence

- `docs_v2/specs/persistence.md` says Desktop Main resolves the Electron app data root and passes it to Backend at startup.
- `docs_v2/specs/persistence.md` says Tide-owned Thread metadata is the product navigation source of truth.
- `src/desktop/main/electron-main.ts` currently calls `utilityProcess.fork(resolveBackendEntrypointPath())` without an app data root option.
- `src/backend/infrastructure/node/live-backend.ts` currently creates `ThreadRuntimeService` without file-backed storage or initial persisted Threads.
- `src/backend/application/services/thread-persistence-service.ts` already writes `thread.json`, `threads/index.json`, and can rebuild the index from per-Thread metadata.
- `docs_v2/specs/backend-thread-list-product-shell-bootstrap.md` defines `thread.list` as the Backend-owned source for Product Shell startup.

## Decisions

### D1. App data root is an environment value owned by Desktop Main

Desktop Main passes `TIDE_APP_DATA_ROOT` to the Backend utility process from `app.getPath("userData")`.

### D2. Live Backend restores before first command handling

The live Backend wrapper restores persisted Thread metadata once before routing the first BackendCommand to the Contract Message Adapter.

### D3. Runtime restore uses ThreadSeed, not Shared Contracts

Persistence records convert into Backend `ThreadSeed` values inside Backend infrastructure. Shared Contracts remain only the Desktop/Backend wire language.

### D4. Saving Thread metadata is best-effort during this slice

The live Backend saves Thread metadata after command-scoped `thread.started` and `thread.hydrated` events produced by start flows. Persistence errors are warning-worthy, but they must not block live Agent Runtime command completion in this slice.

## Out Of Scope

- Provider session reference extraction and attachment.
- Persisting every runtime state change.
- Agent Session Cache write-through from live Agent Session Block events.
- Archive, pin, rename, or search commands.
- Migration beyond `storageVersion: 1`.

## Domain Model

- `ThreadStorageRecord` remains the file-backed metadata record.
- `ThreadSeed` is the restore shape for `ThreadRuntimeService`.
- `ThreadSummaryDto` is the process-boundary event shape used to save live command results.

## Flow

### UC-1: Restore persisted Thread list on app startup

1. Desktop Main starts Backend with `TIDE_APP_DATA_ROOT`.
2. Live Backend creates `ThreadPersistenceService`.
3. Before the first command, Backend reads persisted Thread metadata.
4. Backend restores those records into `ThreadRuntimeService`.
5. Product Shell sends `thread.list`.
6. Backend returns persisted Thread summaries.

### UC-2: Save Thread metadata after start

1. Product Shell sends `thread.start`.
2. Backend starts or preserves pending input for the Thread.
3. Contract adapter emits `thread.started` or `thread.hydrated`.
4. Live Backend stores Thread metadata from the emitted summary.
5. Later app startup can restore that Thread.

## Invariants

- Desktop does not import Backend application or adapter internals.
- Backend application services do not import Shared Contracts.
- Shared Contracts do not import Backend persistence types.
- `thread.list` remains backed by Backend-owned runtime state.
- Restore does not start or resume Agent Runtime.
- Storage records include `storageVersion: 1`.

## Tests

| Rule | Test expectation |
|------|------------------|
| Desktop Main passes app data root to Backend | `electron_main_passes_app_data_root_to_backend_process` checks `app.getPath("userData")`, `TIDE_APP_DATA_ROOT`, and `utilityProcess.fork` options. |
| Persistence lists full Thread metadata | `listing_thread_metadata_reads_thread_json_records` returns full Thread records, not index-only rows. |
| Runtime restores persisted Thread seeds without Agent Runtime side effects | `restoring_threads_allows_thread_list_without_runtime_start` restores a seed and lists it without runtime events. |
| Live Backend wires persistence bootstrap | `live_backend_wires_file_storage_restore_and_thread_event_persistence` checks live Backend uses file storage, persistence service, restore, and event persistence. |
| Thread summary maps to storage record | `thread_summary_storage_record_preserves_scope_and_agent_binding` maps a command event summary into `ThreadStorageRecord`. |

## Implementation Notes

- Keep the restore adapter in Backend infrastructure, not Desktop.
- Use `ThreadPersistenceService.listThreadMetadata()` instead of reading `threads/index.json`, because the Product Shell needs scope and Agent Binding details.
- Persist only Thread metadata in this slice; do not invent provider history references.
