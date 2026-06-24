# Spec: Thread Goal & Live Checklist Panel

## Scope

A pinned, collapsible panel at the top of the Agent Chat column that shows two
things for the active thread:

1. **Goal** — a short user-set thread goal (one line / few lines). Persisted by
   Tide as thread metadata, editable inline in the panel.
2. **Checklist** — a live to-do/plan list produced by the coding agent
   (claude `TodoWrite`, codex `update_plan`, ACP `plan` for gemini/opencode).
   Items show their status (pending / in-progress / done) and a `done/total`
   progress count. Read-only from Tide's side — the agent owns the items and
   checks them off; Tide just reflects the latest plan state.

This is the v2 desktop app feature the user observed in codex/claude ("set a
goal, then watch the checklist get checked off"). Both halves ship together;
they may land as two sub-slices (1A checklist, 1B goal).

## Evidence

- `AgentSessionBlockKind` union — `src/backend/application/domains/agent-session/agent-session-block.ts:26-56`.
  Block shape carries `data?: Record<string, unknown>` (l.69) — checklist entries
  go here. No `plan`/`checklist` kind today.
- Reader switch — `src/backend/application/services/thread/fixture-agent-session-reader.ts:71-104`.
  Handles `message/notice/reasoning/tool_call/tool_result/*_prompt/workbench_reference/provider_signal`;
  no `plan` case. A single `case "plan":` is the insertion point.
- Provider adapters normalize raw frames into a uniform `content_record`
  (`{ kind:"content_record"; payload; body }`) —
  `src/backend/adapters/outbound/agent-runtime/structured/structured-runtime-events.ts:14-26`.
  - **claude** `TodoWrite` arrives as a `tool_use` with `name:"TodoWrite"`,
    `input:{ todos:[{content,status,activeForm?}] }` and is currently emitted as a
    generic `tool_call` record — `claude-stream-json-client.ts:668-681`. This is the
    **proven** path.
  - **codex** `update_plan` and `thread/goal/set` are NOT handled today —
    `codex-app-server-client.ts:599-673` (comment l.673 "plan ... render via their
    own flows later"). Needs protocol verification before wiring.
  - **ACP** `plan` updates are NOT handled — `acp-client.ts:605` ("plan /
    current_mode_update: later slices"). Payload shape:
    `session/update { update:{ sessionUpdate:"plan", entries:[{content,priority,status}] } }`.
- `ThreadSummaryDto` — `src/shared/contracts/thread.ts:5-28`. Carries optional
  `goal`.
  Built by `toThreadSummaryDto()` in
  `src/backend/adapters/inbound/contract-message-adapter/dto/thread-dtos.ts:7-29`,
  from `ThreadRecord`/`ThreadSnapshot` in
  `src/backend/application/domains/thread/thread.ts`. Tide-owned thread metadata
  store = `thread-store.ts`; mutations via `ThreadCrudService`.
- Composer `/goal <objective>` is Tide-owned UI grammar, not provider input.
  The command must set Thread metadata and steer the provider before the first
  turn starts; sending the literal `/goal ...` as `initialMessage` does not set
  the Codex goal and leaves the panel empty.
- Agent Chat shell mounts header + session-region + composer —
  `src/desktop/adapters/inbound/react-renderer/agent-chat/agent-chat.tsx:354-400`.
  Pinned panel mounts as a sibling between header and session-region.
- Transcript block dispatch — `agent-chat/transcript/transcript.tsx:220-228`
  (`renderSessionItem`). Plan blocks are consumed by the pinned panel, NOT
  rendered inline as turns (suppressed from the transcript flow).
- **codex native goal+plan API — VERIFIED** via `codex app-server generate-json-schema`
  (v2 schemas, 2026-06-23):
  - Goal: `thread/goal/set { threadId, objective?: string|null, status?: ThreadGoalStatus|null, tokenBudget?: int|null }`
    → `{ goal: ThreadGoal }`; plus `thread/goal/get`, `thread/goal/clear`, and a
    `thread/goal/updated { threadId, goal, turnId? }` notification.
  - `ThreadGoal = { threadId, objective, status, createdAt, updatedAt, timeUsedSeconds, tokensUsed, tokenBudget? }`.
  - `ThreadGoalStatus = active | paused | blocked | usageLimited | budgetLimited | complete`.
  - Plan: `turn/plan/updated { threadId, turnId, plan: TurnPlanStep[], explanation? }`
    notification; `TurnPlanStep = { step: string, status }`,
    status enum `pending | inProgress | completed`. (Also `item/plan/delta`.)
  → codex supports BOTH halves of this feature first-class. The earlier memory
  note ("thread/goal/set is edit-only") is stale; set/get/clear all exist.
- **claude**: `TodoWrite` checklist is the proven native path. `/goal` appears in
  claude's init `slash_commands` (prior live note) but its behavior/output is
  UNVERIFIED — re-probe during 1B; fall back to text injection if it is not a
  clean built-in.
- **gemini / opencode (ACP)**: native `plan` session update exists for checklist;
  NO native goal command. Goal needs a fallback (text injection) or is hidden for
  these providers — resolved in 1B.
- docs alignment: glossary `glossary.md:71` lists "plan-like modes, goal-like
  modes" as **Supported Agent Features**; master-plan `master-plan.md:1135` same.
  Feature is on-direction, no master-plan reopen needed.
- Test patterns: reader tests `tests/agent-session-block-rendering-path.test.ts`;
  tool body tests `tests/agent-chat-tool-body.test.ts`.

## Decisions

- **D1 — Checklist is read-only and agent-owned.** Tide reflects the agent's
  latest plan; the user does not edit checklist items in v1. (codex/claude behave
  this way — the agent maintains its own list.)
- **D2 — One plan block per thread, upserted.** Providers re-emit the *whole*
  list on each change (TodoWrite replaces the full `todos` array). The reader
  produces a single `kind:"plan"` block with a **stable** `blockId`
  (`plan:<runtimeId>`), so each update upserts the same block instead of
  appending N blocks.
- **D3 — Provider normalization lives in the adapter (Agent Integration).** Each
  provider client maps its native plan/todo signal into a uniform
  `content_record` with `payload.type:"plan"` + `entries:[{text,status}]`. The
  reader stays provider-agnostic. claude `TodoWrite` is normalized to a plan
  record and **suppressed as a tool_call** (no double render).
- **D4 — Status mapping.** Normalize provider statuses to Tide's three:
  `pending` | `in_progress` | `done`. claude: `pending→pending`,
  `in_progress→in_progress`, `completed→done`. ACP: `pending→pending`,
  `in_progress→in_progress`, `completed→done`. codex (`update_plan` step status):
  same mapping, verify field names against live schema.
- **D5 — Goal drives provider-native commands where they exist (CHOSEN: D5-c).**
  The user types the goal in the panel; Tide persists it as thread metadata AND
  pushes it to the provider's native goal mechanism so it actually steers the agent:
  - **codex:** `thread/goal/set { threadId, objective }` (verified). Consume
    `thread/goal/updated` to reflect status (`active`/`complete`/…) + token usage
    back into the panel. Clearing the goal → `thread/goal/clear`.
  - **claude:** send `/goal <objective>` as composer input (slash command). Verify
    behavior during 1B; if `/goal` is not a clean built-in, fall back to a context
    preamble injected on send.
  - **gemini / opencode (ACP):** no native goal command → **OPEN (1B): fall back to
    context-injection preamble, or hide the goal row for these providers.** Default
    recommendation: context-injection fallback so goal works everywhere; native
    used where available.
  Goal stays Tide-persisted regardless of provider so it survives restart and shows
  immediately.
- **D7 — `/goal <objective>` is a Tide local command.** The composer always offers
  `/goal` in the `/` command menu, including Codex when provider command discovery
  returns no slash commands for the cwd. Submitting `/goal <objective>` strips the
  slash command from the user message, stores `<objective>` as the thread goal,
  and passes it to the runtime start/write path. Empty `/goal` is ignored until an
  objective exists.
- **D6 — Slice order.** **1A = checklist** is built first: it is native for ALL four
  providers (codex `turn/plan/updated`, claude `TodoWrite`, ACP `plan`), so it is
  the strongest fully-verified ground and is independent of the goal fallback
  decision. **1B = goal** follows (codex native verified; claude verify-or-fallback;
  gemini/opencode fallback per D5 open point). Any per-provider deferral is logged,
  not silent.

## Out Of Scope

- User-editable checklist items (adding/checking Tide-side). Agent owns the list.
- Native provider goal commands (claude `/goal`, codex `thread/goal/set`) — D5-c,
  deferred.
- Persisting checklist state across runtime restarts beyond what the provider
  history already replays (plan is reconstructed from frames like other blocks).
- A separate workbench pane for goal/checklist (panel-in-chat was chosen).

## Domain Model

- New block kind `"plan"` on `AgentSessionBlockKind`.
- Plan block: `{ kind:"plan", role:"system", status:"complete", blockId:"plan:<runtimeId>",
  title?: <plan title>, data:{ entries: PlanEntry[] } }`.
- `PlanEntry = { text: string; status: "pending" | "in_progress" | "done" }`.
- Thread metadata gains `goal?: string` (ThreadRecord → Snapshot → Seed →
  ThreadSummaryDto).

## Contracts

- `ThreadSummaryDto.goal?: string` (`src/shared/contracts/thread.ts`).
- New inbound contract message `thread.setGoal { threadId: ThreadId; goal: string }`
  → updates thread metadata, echoes a thread-updated event. (Empty string clears
  the goal.)
- `thread.start` accepts optional `goal?: string`. When present, the backend
  persists it before readiness/runtime spawn and passes it as `initialGoal` so
  provider-native goal state is set before the initial prompt.
- Plan entries ride on the existing `AgentSessionBlockDto.data` (kind is already a
  free string in the DTO mirror — no DTO union change needed).
- (D5-a only) goal context injection happens backend-side at send time; no new
  wire field beyond `goal`.

## Flow

**Checklist (read path):**
1. Provider emits plan/todo signal → adapter normalizes to `content_record`
   `payload.type:"plan"` with `entries`. claude `TodoWrite` tool_use is converted
   here and not also emitted as `tool_call`.
2. Reader `case "plan":` → upserts the single stable `plan:<runtimeId>` block with
   `data.entries`.
3. Renderer: pinned panel selects the latest `kind:"plan"` block for the active
   thread, renders items + `done/total`. Transcript skips `kind:"plan"`.

**Goal (write path, D5-c):**
1. User edits goal in panel or submits `/goal <objective>` → `thread.setGoal` /
   `thread.start { goal }` → `ThreadCrudService` / `ThreadRuntimeService`
   persists to Tide metadata → thread-updated event → `ThreadSummaryDto.goal`
   updates → panel reflects it immediately.
2. Backend also pushes to the provider's native mechanism via a new runtime write
   `{ kind:"goal_set"; objective: string }` (empty ⇒ `goal_clear`):
   - codex client → `thread/goal/set` (or `thread/goal/clear`).
   - claude client → write `/goal <objective>` as input (or preamble fallback).
   - ACP clients → context-injection preamble fallback (no native goal).
3. codex `thread/goal/updated` notification → normalized signal that refreshes the
   panel's goal status/usage. (claude/ACP have no such echo; panel shows the
   Tide-persisted objective only.)

## Invariants

- At most one `kind:"plan"` block per runtime; updates upsert, never append.
- A plan block with zero entries renders nothing. The panel is not mounted when
  there is no non-empty goal and no non-empty checklist; there is no persistent
  "Set a goal for this thread" placeholder.
- When the panel is mounted, the Agent Chat shell gives it its own auto-height
  grid row. The transcript keeps the only flexible row; the panel never stretches
  into a large gray block or overlaps the first turn/Working indicator.
- Plan blocks never appear as transcript turns.
- Setting an empty goal clears it; `goal` absent on older payloads ⇒ treated as
  unset (no panel goal row).
- Provider-native status values are mapped exactly per D4; unknown statuses fall
  back to `pending` and are surfaced (not dropped).

## Tests

- Reader: claude `TodoWrite` frame → single `kind:"plan"` block, entries mapped,
  statuses normalized (D4); second TodoWrite frame upserts same blockId with new
  entries (D2). (`tests/agent-session-block-rendering-path.test.ts` style.)
- Reader: ACP `plan` frame and codex `update_plan` frame → equivalent plan block
  (once D6 wires them).
- Adapter: claude `TodoWrite` does NOT also emit a `tool_call` record (D3).
- Contract: `thread.setGoal` updates `ThreadSummaryDto.goal`; empty clears it.
- Contract: `thread.start { goal }` persists `ThreadSummaryDto.goal` and passes
  `initialGoal` to the runtime port.
- Composer: `/goal <objective>` emits `thread.setGoal` for an existing thread and
  `thread.start { goal:<objective> }` for a new thread; the literal slash command
  is never queued/sent as provider input.
- Command menu: `/goal` appears for Codex even when provider discovery returns no
  slash commands.
- Renderer: panel shows `done/total`, item statuses, editable goal; hidden when
  goal empty AND no plan entries; plan block absent from transcript.
- Renderer: when a goal/checklist is visible, the shell uses the goal-panel grid
  modifier so the panel is a compact metadata row above the transcript, not the
  transcript's flexible row.
- (D5-a) Send path injects goal preamble only when goal set.
- Architecture boundary tests unchanged (no new cross-layer imports).

## Implementation Notes

- Keep provider knowledge in each `*-client.ts` adapter; reader stays generic.
- Stable `blockId` `plan:<runtimeId>` is the upsert key — mirror how other
  whole-list-replace signals are keyed.
- Panel is a memoized component reading a single derived selector (latest plan
  block + thread.goal) to preserve render isolation
  (`desktop-product-shell-render-isolation`).
- Suggested sub-slices: **1A** = checklist (claude proven) end-to-end;
  **1B** = goal field + setGoal + panel goal row + (D5-a) injection.
- Open question logged: D5 behavior (a/b/c) — confirm before 1B.
