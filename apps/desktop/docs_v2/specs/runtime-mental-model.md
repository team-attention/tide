# Spec: Tide v2 Runtime Mental Model (STRICT)

Grounded in the v1 Tide Terminal MCP runtime (`apps/terminal/docs/specs/tide-mcp-runtime.md`,
invariants 16–20) and v2's existing primitives. Every concurrency bug this session was a
violation of one rule below. New code must be checked against this model first.

## The one rule

**The unit of isolation is the Thread. Everything is keyed by `(threadId, runtimeId)`,
which v2 injects into the agent's environment at spawn (`TIDE_THREAD_ID`, `TIDE_RUNTIME_ID`).
Nothing is ever keyed by recency, prompt text, process scanning, or user focus.**

The agent's hooks and its Tide MCP session both already carry this env identity. So the id
is always available at every boundary — using anything else is the bug.

## A Thread is a self-contained runtime cell — four 1:1 bound resources

| # | Resource | Bound by | Rule |
|---|----------|----------|------|
| 1 | **Agent process** (one provider CLI in a hidden PTY) | env `TIDE_THREAD_ID`/`TIDE_RUNTIME_ID` at spawn | One process per thread. Reaped when the backend dies (PTY parent-death watchdog) + swept on startup. |
| 2 | **Provider session** (its own rollout/transcript in `~/.codex` `~/.claude` `~/.gemini`) | the agent's **hook**, which fires carrying `session_id`+`transcript_path`, tagged with this runtime's env id → recorded as the thread's `providerSessionRef` | Read **ONLY** the bound session's file. Never discover by "most recent file" or "file containing the prompt" — concurrent same-provider sessions then cross-bind. |
| 3 | **Workbench** (its own Browser / Editor / Diff / FileTree panes) | the env `TIDE_THREAD_ID` carried into the Tide MCP session | The agent's MCP tools (`tide_open_browser`, `tide_open_editor`, `tide_observe_workspace`…) observe/operate **only this thread's** workbench. Cross-thread pane access is rejected (v1 inv. 19/20). Panes run offscreen/in background when the thread isn't the one on screen (v1 inv. 16). |
| 4 | **Lifecycle + blocks** (running/idle, `runtimeStartedAt`, turn-end, agent session blocks) | `threadId` on every signal/frame | Attributed + applied by thread id. Turn-end = the provider's own end signal (codex `codex-stop`, claude `agent-idle` hook; antigravity has none → the terminal `PLANNER_RESPONSE` in its transcript). |

## User focus is ORTHOGONAL view state

`activeThreadId` = the one thread the user is currently looking at. It is set **only** by
user actions (click a thread / start a new thread). It is purely a render selection and
must NOT influence anything else:

- It does NOT decide which agents run — **all** threads' agents run concurrently in the
  background.
- It does NOT decide which workbench an agent operates — each operates its own (#3).
- It does NOT route sessions, signals, blocks, or lifecycle — those route by `threadId` (#1–4).
- Backend events update **every** thread's state by id; the rendered chat shows the active
  thread; the rail shows **all** threads' live status (running dot, elapsed).

A late answer, a background turn finishing, or another thread's event must never move focus
or bleed into the viewed thread.

## v1 → v2 mapping

| v1 Tide Terminal | v2 Tide |
|---|---|
| Caller Pane / Stage Terminal | **Thread** |
| `TIDE_TERMINAL_PANE` / `TIDE_WINDOW` | `TIDE_THREAD_ID` / `TIDE_RUNTIME_ID` |
| Terminal Context Surface (support panes) | **Workbench** |
| MCP scoped to Caller Pane; cross-terminal pane rejected | MCP scoped to thread; cross-thread pane rejected |
| Background offscreen WKWebView, human focus preserved | Background thread runtime; user focus orthogonal |
| Wrapped-agent rollout/transcript bound per Pane | Provider session bound per Thread (via hook) |

## This session's bugs, re-cast as model violations

- **2 same-provider threads' answers overlap** → resource #2 read the *most-recent* file
  instead of the thread-bound session. Fix: read only the hook-bound rollout/transcript.
- **focus dragged to a thread when its answer arrived** → an event moved `activeThreadId`.
  Fix: focus is user-action-only; events never set it.
- **stuck "Working" forever / 0 output** → reliability, not the model: poller gave up at 45s
  (fix: poll while running) and orphans starved spawns (fix: reap/sweep).
- **new thread demanded directory trust for a path never used** → scope used a placeholder
  cwd, not the thread's real project cwd.

## Checklist for any new runtime code

1. What identifies the thread here? It must be the env-injected `threadId`/`runtimeId`.
2. Am I reading/writing only THIS thread's resource (session file, workbench pane, blocks)?
3. Does user focus leak in? It must not.
4. Does another thread's data leak in (recency scan, shared file, shared daemon assumption)?
   It must not.
