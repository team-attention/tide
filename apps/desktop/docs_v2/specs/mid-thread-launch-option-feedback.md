# Spec: Mid-Thread Launch Option Feedback

## Scope

Give the launch-option chips (Model / Permission / Reasoning) on an **active Thread**
a visible signal that a change registered and **when it takes effect**, distinguishing
**applied live now** from **applies on the next message** (transparent restart). Today
the chip patches optimistically with zero confirmation, so a correct change is
indistinguishable from a no-op — the user cannot tell it worked.

This **reopens** the original UX decision in
[`mid-thread-launch-option-changes.md`](./mid-thread-launch-option-changes.md)
("seamless, no extra UI states"). User decision (2026-06-16): the invisible-seamless
choice read as "I can't tell if it works"; add a minimal, contextual affordance.

## Evidence

- The mid-thread change path is implemented and LIVE-VERIFIED across all 4 providers
  (`scripts/v2-launch-change-flow.mjs` routing matrix + claude/gemini behavioral +
  `scripts/v2-claude-midturn-permission-probe.mjs` mid-turn). Backend is correct; only
  the feedback was missing.
- Backend already returns the routing signal: `updateThreadLaunchOptions` →
  `{ thread, applied: "live" | "next_turn" | "none" }`, surfaced on `command.completed`
  (`result.applied`) and alongside the `thread.launchOptionsChanged` event.
- `mergeAndApplyLaunchOptions` (composer-queue-service) computes `changedKeys`
  (⊆ {model, permission, reasoning}) but does not surface them. `sendComposerInput`
  calls the same helper and **ignores** its return — safe to widen the return shape.
- Renderer state consumes `thread.launchOptionsChanged` (agent-chat `events.ts`) to
  patch `thread.launchOptions`; it ignores `applied`. `command.completed` is used only
  for request/response correlation (`backend-bridge.ts`), never for state.
- Visible chips are Permission (`composer-shell__choice-chip`, `permissionLabel`) and
  Model (`--model`, `modelLabel`). Reasoning has no dedicated toolbar chip (it lives in
  the composer-options surface) — no badge target this slice.

## Decisions

1. **Affordance = inline on the chip** (user-picked). Live change → a brief "applied" ✓
   that fades (one-shot, ~2.5s). Restart-required → a persistent "next message" badge on
   the chip that clears when the next turn starts (the restart applies it).
2. **`none` with a real change = pending.** `applied: "none"` means either *no diff* OR
   *changed but no live runtime* (applies on next spawn/resume). The renderer keys
   feedback off `changedKeys`: empty ⇒ no feedback; non-empty ⇒ `live` → applied,
   otherwise (`next_turn` or `none`) → pending.
3. **Carry the signal on the event, statelessly.** Extend `thread.launchOptionsChanged`
   with `applied` + `changedKeys` so the renderer derives feedback purely from the event
   (no requestId↔keys correlation; also covers the multi-window / send-time-merge case the
   existing handler already guards).
4. **Renderer-only feedback state.** Feedback lives in `AgentChatShellState`, never on a
   backend thread summary (a later summary would clobber it). Thread-scoped; reset on
   thread switch.
5. **No optimistic feedback** this slice — the local round-trip is sub-frame; react to the
   event. (Optimism can be added later if it ever feels laggy.)

## Out Of Scope

- Reasoning chip badge (no toolbar chip exists; feedback plumbs by key but renders only
  on Model/Permission).
- Feedback on the Start Composer (no active runtime; changes are launch-time).
- Changing the per-provider live-vs-restart matrix (already specced + verified).
- Any new global toast/snackbar surface.

## Domain Model

- `AgentChatShellState.launchOptionFeedback: Record<string, LaunchOptionFeedback>` —
  keyed by option key (`model` | `permission` | `reasoning`). Renderer-only, transient.
- `LaunchOptionFeedback = { state: "applied" | "pending"; at: number }` — `at` is a
  monotonic token (event clock) so a repeat change re-triggers the flash animation.

## Contracts

- Event `thread.launchOptionsChanged` `{ thread, applied?: "live"|"next_turn"|"none",
  changedKeys?: string[] }`. Both optional (older backend ⇒ absent ⇒ renderer shows no
  feedback, patches options as before — backward compatible).
- `UpdateThreadLaunchOptionsResult` gains `changedKeys: string[]`.
- `mergeAndApplyLaunchOptions` returns `{ applied: "live"|"next_turn"|"none";
  changedKeys: string[] }` (was the bare applied string; only `updateThreadLaunchOptions`
  reads it).

## Flow

1. User picks a Model/Permission row on an active Thread → renderer optimistic chip patch
   + `thread.setLaunchOptions` (unchanged).
2. Backend merges/applies, emits `thread.launchOptionsChanged { thread, applied,
   changedKeys }` (+ persisted) and `command.completed { applied }` (unchanged).
3. Renderer `thread.launchOptionsChanged` handler (active thread only):
   - patch `thread.launchOptions` (existing);
   - for each `k ∈ changedKeys`: `launchOptionFeedback[k] = { state: applied==="live" ?
     "applied" : "pending", at: clock }`;
   - `changedKeys` empty ⇒ feedback untouched.
4. View-model derives `composer.permissionFeedback` / `composer.modelFeedback` from
   `launchOptionFeedback[key]`. Composer renders an inline badge per chip:
   - `applied` → ✓ "적용됨", keyed by `at`, one-shot CSS fade (ends invisible);
   - `pending` → persistent "다음 메시지부터".
5. Clears: on `agentRuntime.stateChanged` → `running` (a new turn started — deferred
   change applied), drop ALL feedback for the thread. On thread switch / `thread.started`
   / hydrate of a different threadId, reset to `{}`.

## Invariants

- Feedback never appears for a key that did not change (`changedKeys`-gated).
- `pending` persists until the next turn starts, then clears; `applied` fades visually and
  is cleared no later than the next turn start.
- Feedback is per-active-thread and never bleeds across threads.
- Absent `applied`/`changedKeys` (older backend) ⇒ options still patch, no feedback (no
  crash, no stale badge).
- Feedback state is renderer-only; no backend thread summary carries it.

## Tests

- backend service: `updateThreadLaunchOptions` result carries `changedKeys` (the keys
  that actually differed) alongside `applied`; no-diff ⇒ `changedKeys: []`,
  `applied: "none"`.
- contract event builder: `thread.launchOptionsChanged` payload includes `applied` +
  `changedKeys` from the result.
- renderer reducer: `thread.launchOptionsChanged { applied:"live", changedKeys:["model"] }`
  → `launchOptionFeedback.model.state === "applied"`; `applied:"next_turn"` → `"pending"`;
  `applied:"none", changedKeys:[]` → unchanged; wrong-thread event → ignored;
  `agentRuntime.stateChanged → running` clears feedback; thread switch resets.
- view-model: maps `launchOptionFeedback.permission` → `composer.permissionFeedback`,
  `.model` → `composer.modelFeedback`.

## Implementation Notes

- `at` uses the existing shell clock (or `event.emittedAt`); the chip badge element is
  React-keyed by `at` so the CSS flash replays only on a genuinely new applied event.
- Keep the badge copy short; the chip is narrow. "적용됨" / "다음 메시지부터".
- Clearing on `running` (not on send) is the precise moment a restart-deferred change is
  live; a normal send with no pending change simply has nothing to clear.
