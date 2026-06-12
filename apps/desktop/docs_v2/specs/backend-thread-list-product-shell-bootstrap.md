# Spec: Backend Thread List Product Shell Bootstrap

## Scope

This spec connects the Desktop Product Shell Left Rail to Backend-owned Thread state.

Included:

- A `thread.list` BackendCommand for requesting visible Threads.
- A `thread.listed` BackendEvent carrying Thread summaries.
- Backend service listing of current non-archived Threads, sorted by updated time descending.
- Product Shell startup that requests the Backend Thread list instead of using fixture Threads in the real renderer path.
- Product Shell state update from `thread.listed`.
- A `thread.archive` BackendCommand and `thread.archived` BackendEvent that toggle a Thread's archived state, persist it (event-driven), and update the Left Rail (the inline archive-confirm button drops the Thread from the visible list).
- A `thread.setPinned` BackendCommand and `thread.pinChanged` BackendEvent that toggle a Thread's pinned state, persist it (event-driven), and update the Left Rail (the hover pin button flips pin state and the Pinned shortcuts list). The Thread record carries a real `pinned` flag instead of a hardcoded `false`.
- A `thread.rename` BackendCommand and `thread.renamed` BackendEvent that set a manual Thread title (trimmed + whitespace-collapsed; empty rejected), persist it (event-driven), and update the Left Rail (double-click a Thread row to inline-rename).
- Left Rail search: a Product Shell `searchQuery` that filters the loaded Threads by title (case-insensitive substring) across Pinned, Projects, and Scratch, hiding empty Project groups while searching. This is a client-side filter over already-loaded Threads; searching archived Threads via Backend is a later slice.

Out of scope:

- Persistent storage loading from disk.
- Search, rename, project creation, worktree creation, or branch creation commands.
- Project list persistence independent from Threads.

## Evidence

- `docs_v2/master-plan.md` says Left Rail is work history and shows existing Threads grouped by Project and Scratch.
- `docs_v2/master-plan.md` says Thread is the primary product object and Project organizes Threads and provides Execution Context.
- `src/desktop/application/domains/product-shell/product-shell-state.ts` currently creates fixture `initialThreads` in `createProductShellState`.
- `src/shared/contracts/commands.ts` currently has `thread.hydrate` and `thread.start`, but no Thread list command.
- `src/shared/contracts/events.ts` currently has `thread.hydrated` and `thread.started`, but no Thread list event.
- `src/backend/application/services/thread-runtime-service.ts` owns in-memory Thread records and exposes hydrate/start/resume operations.

## Decisions

### D1. Thread list is a Backend-owned snapshot

Desktop asks Backend for the visible Thread list with `thread.list`.

Backend replies with `thread.listed`, not with fixture data in Desktop.

### D2. Default list excludes archived Threads

The default `thread.list` payload omits archived Threads because archived Threads are hidden from the default Left Rail.

An `includeArchived` boolean may be sent for future archived views.

### D3. Product Shell can still use fixtures in tests and design previews

`createProductShellState` can create fixture state for tests or design previews, but the real renderer-created Product Shell starts without fixture Threads and asks Backend for `thread.list`.

## Domain Model

### Thread List Snapshot

A bounded Backend snapshot containing `ThreadSummaryDto[]`.

It is not an Agent Session hydration event and does not start or resume an Agent Runtime.

## Contracts

```ts
BackendCommandPayloadByKind["thread.list"] = {
  includeArchived?: boolean;
}

BackendEventPayloadByKind["thread.listed"] = {
  threads: ThreadSummaryDto[];
}
```

## Flow

### UC-1: Product Shell starts

1. Desktop creates Product Shell state without fixture Threads.
2. Desktop sends `thread.list`.
3. Backend returns `command.accepted`, `thread.listed`, and `command.completed`.
4. Product Shell replaces its Thread list with the listed Threads.

### UC-2: Thread list command

1. Backend receives `thread.list`.
2. Backend reads current Thread records.
3. Backend filters archived Threads unless `includeArchived` is true.
4. Backend sorts by updated time descending.
5. Backend emits `thread.listed`.

## Invariants

- Listing Threads must not start, resume, or write to an Agent Runtime.
- Product Shell must not show fixture Threads in the real renderer default path.
- `thread.listed` uses `ThreadSummaryDto` so Desktop does not import Backend domain types.
- Backend domain and application services must not import Shared Contracts.

## Tests

| Behavior | Test |
|----------|------|
| Shared Contracts accept Thread list command and event | `thread_list_contracts_round_trip_thread_summaries` |
| Backend lists non-archived Threads sorted by updated time | `thread_list_returns_visible_threads_sorted_by_updated_time` |
| Contract adapter emits accepted, listed, and completed events | `thread_list_contract_events_return_backend_thread_summaries` |
| Product Shell applies Backend Thread list to Left Rail | `product_shell_applies_thread_listed_event_to_left_ui` |
| Real renderer starts Product Shell without fixture Threads and requests list | `product_shell_requests_backend_thread_list_on_mount_without_fixture_threads` |
| Backend archives a Thread and keeps it retrievable | `archiving_a_thread_excludes_it_from_the_default_list_but_keeps_it_retrievable` |
| Archiving a missing Thread is rejected | `archiving_a_missing_thread_returns_thread_not_found` |
| Product Shell archive confirm emits the command and drops the Thread | `confirming_thread_archive_emits_command_and_drops_it_from_the_list` |
| Product Shell applies the archived event | `thread_archived_event_removes_the_thread_from_the_list` |
| Backend pins a Thread (real pinned flag) | `pinning_a_thread_sets_pinned_on_its_summary_and_can_be_unset` |
| Pinning a missing Thread is rejected | `pinning_a_missing_thread_returns_thread_not_found` |
| Product Shell pin toggle emits the command optimistically | `toggling_thread_pin_emits_set_pinned_command_and_updates_optimistically` |
| Product Shell applies the pinChanged event | `thread_pin_changed_event_updates_thread_pinned_state` |
| Backend renames a Thread (trim/collapse, reject empty) | `renaming_a_thread_sets_a_trimmed_collapsed_title` |
| Product Shell rename submit emits the command optimistically | `submitting_thread_rename_emits_command_and_updates_title_optimistically` |
| Empty rename emits no command | `submitting_an_empty_thread_rename_emits_no_command` |
| Product Shell applies the renamed event | `thread_renamed_event_updates_thread_title` |
| Left Rail search filters Threads by title | `search_query_filters_threads_by_title_in_the_left_ui` |

## Implementation Notes

- Keep Thread summary conversion in the Backend contract adapter.
- Keep Product Shell fixture state opt-in for tests and design snapshots.
- Do not connect persistence in this slice; a later persistence bootstrap slice can seed Backend Thread records from `ThreadPersistenceService`.
