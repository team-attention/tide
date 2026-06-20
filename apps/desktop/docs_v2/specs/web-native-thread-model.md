# Spec: Web-Native Thread Model (chat/thread re-grounding)

## Why

The v2 chat layer drifted from the plain web pattern, so things that are trivial
on the web (switch threads, don't duplicate messages, sort the list, open a new
thread instantly) each became a separate bug + patch. Re-ground the behavior on
the standard web model so these are correct by construction, not by patches.

## The model (target)

Backend (provider files + thread store) is the single source of truth. The client
is a thin view over it.

1. **Focus is pure local UI state.** `activeThreadId` is set ONLY by user actions
   (click a thread, start a new thread, archive the active one). NO backend event
   ever changes focus. (Already enforced: command vs broadcast source-gating.)
2. **The active thread's data is fetched by id.** Opening/switching dispatches
   `thread.hydrate(threadId)`; the response renders. Only events whose threadId ==
   activeThreadId touch the active chat surface. (Mostly done.)
3. **The rail is a projection of all threads.** Broadcast events update each
   thread's row (status, updatedAt) by id, regardless of focus. Sort strictly by
   `updatedAt`, newest first; a thread with activity "now" is always on top.
4. **New thread is optimistic + instant.** On submit the client generates the
   threadId, sets it active immediately, shows the thread (running), and passes the
   id to `thread.start`. The backend already honors a client `threadId`
   (`startThread: input.threadId ?? generate`). No waiting on the backend to "open"
   the thread, so a slow backend can't cause re-click → duplicate threads.
5. **Send clears the composer draft.** A submitted draft is cleared on send (every
   path), so re-clicking can't resend the same message.
6. **No guessed bindings.** A run binds to the exact session its own process owns
   (codex rollout, claude transcript, gemini/opencode structured session refs).

## Concrete deltas

| # | Change | Files |
|---|--------|-------|
| 1 | Clear composer draft on send (all paths) | agent-chat-shell-state `submitComposer` |
| 2 | `thread.start` command payload accepts `threadId` | shared/contracts/commands |
| 3 | Optimistic new thread: client id, set active + thread summary + running, pass id | agent-chat `submitComposer`, product-shell submit |
| 4 | Sort/list: new + active threads carry a current `updatedAt`; sort by it | product-shell-state (toProductShellThreadFromSummary / event handlers) |
| 5 | Working timer from turn start: backend `runtimeStartedAt` → hydrate → indicator | thread domain, service, contract, agent-chat reducer, AgentWorkingIndicator |
| 6 | claude deterministic binding (pid→transcript) like codex | live-backend, codex-rollout-for-pid generalization |

## Invariants

- No code path outside user-action handlers writes `activeThreadId`.
- Every agent-chat-mutating event is dropped unless its threadId == activeThreadId
  (or it is the active thread's own command response).
- A thread's `updatedAt` reflects its latest activity; the rail sorts by it.
- A run's providerSessionRef is derived from the process the run owns, never matched
  by prompt text.

## Sequence

1, 2, 3 first (kills the duplicate-thread + slow-open + double-message bugs and is
the core of the web feel). Then 4 (sort). Then 5 (timer) and 6 (claude binding).
Each step keeps tests green; one rebuild at a coherent stopping point.

## Tests

- submit clears draft; re-submit with empty draft is a no-op.
- new-thread submit sets activeThreadId to the client id and emits `thread.start`
  carrying that id.
- a background broadcast never changes activeThreadId (existing).
- list sorts a "now" thread above older ones.
