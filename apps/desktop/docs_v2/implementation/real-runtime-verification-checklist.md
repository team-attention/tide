# Real-Runtime Verification Checklist

The headless work (specs, types, reducer, provider turn-end adapters, message-edit
full stack) is built and unit/integration-tested (547 tests, typecheck clean,
`npm run build` green). What unit tests cannot prove is the **seamless across 4
real agents in the running app** requirement. This checklist makes that
verification systematic instead of ad-hoc.

It must be run by a human with provider auth/setup (`codex login`, `claude` login,
opencode auth) in their environment — Claude Code cannot authenticate or drive
the painted Electron window headlessly.

## How to run

```bash
cd apps/desktop && npm run dev      # HMR dev, or `npm start` for a built launch
```

Run the full matrix for **each** agent: Codex CLI, Claude Code, opencode.
Pick a trusted project dir for the thread (directory-trust is verified in step 0).

## Per-agent matrix

Repeat every row for codex, claude, and opencode. Mark ✅/❌ and capture the app
log on any ❌.

| # | Feature | Steps | Pass criteria |
|---|---------|-------|---------------|
| 0 | Directory trust | Start a thread in a NOT-yet-trusted dir | Provider Setup Surface appears, input preserved, completing trust replays the message |
| 1 | Streaming | Send "explain this repo" | Agent text streams token-by-token into the Agent Session, not all-at-once at the end |
| 2 | Turn-end | Wait for the answer to finish | "Working" indicator stops promptly; thread goes idle (NOT stuck "Working") |
| 3 | Slash/command options | Type `/` in the composer | Provider In-Session Commands list appears |
| 4 | Question answering | Trigger a provider question/approval (e.g. an edit needing approval) | Prompt surfaces in chat; answering routes back; turn resumes |
| 5 | Queuing | While a turn runs, type + send a 2nd message | Shows as "대기 중" queued row; flushes as the next turn when the first ends |
| 6 | Message edit | On the queued row, click "수정" | Text returns to composer, queued row clears; re-send re-queues the corrected text |
| 7 | Interrupt/steering | While running, send a steering message (or Stop) | Current turn stops; the queued/steering message runs next |
| 8 | Workbench (agent) | Ask the agent to edit a file | File change shows; open Diff/Editor pane; change is correct |
| 8b| Workbench (user) | Manually edit + save a file in the Editor pane | Save works; no corruption; agent can still read it |
| 9 | Performance | Throughout a long streaming turn | No UI jank, no input lag, terminal/stream stays smooth (perf budget memory) |
| 10| Polish/layout | Resize columns, open/close Workbench, switch threads | Layout controls behave; no visual breakage; transitions smooth |

## Concurrency (the binding-bug regression check)

`v2-concurrency-hang-binding` was an OPEN deep bug. Verify it is gone:

1. Start 2–3 threads on different agents at the same time.
2. Each must stream into its OWN thread (no answer landing in the wrong thread).
3. Each must reach turn-end independently (no thread stuck "Working").
4. The rail running-dot must reflect each thread's real state.

## Turn-end focus (the #1 reported pain)

Specifically confirm the structural turn-end redesign holds live:

- Codex: a turn that produces NO visible output still settles to idle (rollout
  `task_complete`/`turn_aborted` or `codex-stop` hook).
- opencode: ACP/runtime events settle the turn.
- Claude: `agent-idle` hook settles the turn.

## Headless (auth-safe) verification — the UI half, already proven

Each feature has a **UI half** (does the surface render/behave) and a **runtime
half** (does it work driven by a real streaming agent). The UI half is verifiable
headlessly against the REAL built app via Playwright on a freshly-seeded data dir
that never spawns a provider or touches an auth token. These probes boot
`out/main/electron-main.js` with a temp `TIDE_APP_DATA_ROOT` (see
`scripts/seed-thread.cjs`):

- `scripts/pw-smoke.cjs` — thread open, FileTree, Workbench launcher, Browser /
  Terminal / Editor / Diff panes.
- `scripts/pw-slash-verify.cjs` — type `/`, assert the command popover renders the
  provider commands (verified: 8 codex builtins with descriptions + source pills).
- `scripts/pw-trust-editor-verify.cjs` — approval-mode / directory-trust chooser
  opens (read-only / workspace-write / danger-full-access + untrusted / on-request /
  never), Escape dismisses the popover, and opening a real source file renders a
  syntax-highlighted Editor pane with content.

Headless-verified so far (build green, real app, no auth):

| # | Feature (UI half) | Status |
|---|-------------------|--------|
| 0 | Directory-trust chooser renders all 6 codex permission modes | ✅ headless |
| 3 | Slash `/` command popover renders provider commands | ✅ headless |
| 8b| Editor pane opens a real file with content + syntax highlight | ✅ headless |
| 10| Thread view, Workbench panes (browser/terminal/editor/diff), FileTree | ✅ headless |
| — | Escape dismisses the chip/command popover (was missing) | ✅ FIXED + verified |

The **runtime half** of every row (streaming, turn-end, question round-trip,
queuing flush, interrupt, agent file edits) still needs a real authed agent and the
per-agent matrix above — those cannot be exercised headlessly.

## On any failure

Capture the app log and the thread's provider session ref. The turn-end and
streaming paths are now provider-owned in the Agent Integration adapters, so a
failure localizes to one `adapters/outbound/agent-integrations/<agent>/` file plus
the (still-polling) loop in `infrastructure/node/live/live-backend.ts`. The next
structural step (task #7) replaces those polling loops with per-runtime
`AgentRuntimeEventSource`s — do that migration against whichever agent fails here,
verifying with this checklist.
```
