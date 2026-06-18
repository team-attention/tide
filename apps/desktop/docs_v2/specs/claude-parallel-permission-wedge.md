# Spec: Claude Parallel-Permission Wedge (deny path)

## Scope

Fix the "Working forever after rejecting a tool" wedge on the claude (stream-json)
provider: a thread that shows a live "running" spinner with no card and no way out
after the user denies/skips a tool permission.

## Evidence (live repro, claude 2.1.179)

A standalone harness drove the REAL `claude` CLI with Tide's exact stream-json flags
(`--print --input-format stream-json --output-format stream-json --verbose
--include-partial-messages --permission-prompt-tool stdio`) and answered permissions
exactly as `claude-stream-json-client.ts` does:

| Scenario | claude behavior |
|----------|-----------------|
| Single `can_use_tool` denied (`behavior:"deny", interrupt:false`) | emits `result` → turn ends cleanly |
| A 3-way **parallel** batch, ALL denied | emits `result` → turn ends cleanly |
| Same 3-way batch, **only one** answered, two left pending | **NO `result` ever** (blocked 30s+) |

Conclusion: **claude fires multiple `can_use_tool` requests in parallel within one
turn, and blocks the whole turn until EVERY one is answered.** Leave one unanswered and
claude never ends the turn → Tide stays "running" forever.

## Root cause (Tide side)

Tide funnels N parallel permissions through ONE visible card plus a `promptQueue`
(`thread-runtime-service.ts` `recordProviderPromptState`). The funnel has a latent drop:

1. `answerPrompt` sets `promptAnsweredPendingSettle = true` (so a following turn-end may
   settle the answered card), then **promotes** the next queued prompt into the visible
   slot — but does NOT reset the flag. The freshly-promoted card is still UNANSWERED yet
   carries `promptAnsweredPendingSettle = true`.
2. `recordProviderPromptState` resets the flag to `false` for any card it makes visible
   (a fresh waiting episode) — the promote path skips that reset.
3. A stray/inferred turn-end (claude's history reader can infer one mid-turn) then hits
   `recordTurnComplete`, whose "don't drop a live unanswered card" guard is BYPASSED when
   `promptAnsweredPendingSettle` is true → it drops `promptState` AND the whole
   `promptQueue`. The siblings claude is still blocked on never get answered → wedge.

Two compounding correctness bugs on the same path:

- **Skip = silent Allow.** The Skip button answers a permission card with value `""`.
  In the claude client `write()` the only explicit branch is the deny token; everything
  else (including `""`) falls through to **allow**, so "Skip" actually RUNS the command.
- The wedge also makes Stop feel dead: a thread that `recordTurnComplete` settled to idle
  shows no Stop affordance even though claude is still blocked; and one stuck "running"
  has a Stop, but the user reached the wedge because the card vanished.

## Decisions

- A queued prompt promoted into the visible slot is a FRESH unanswered episode and must
  reset `promptAnsweredPendingSettle = false` — identical to a card surfaced directly.
- An empty / unrecognized answer to a claude permission card defaults to **deny**, never
  allow. Explicit allow requires the allow token. (Skip on a permission = deny.)
- AskUserQuestion answering is unchanged (handled before the allow/deny branch).
- Stop stays the universal escape hatch: `interrupt()` already denies every pending
  permission, so once a card is reachable again the thread is always recoverable.

## Out Of Scope

- codex / ACP providers (user reproduced only on claude; their answer encodings differ).
- Changing the one-card-at-a-time UX into a multi-card batch view.

## Flow (after fix)

3 parallel permissions p1 (visible), p2, p3 (queued):
1. Deny p1 → write deny for p1, promote p2, **reset flag false**.
2. A stray turn-end now → guard holds (flag false, prompt live) → p2 survives.
3. Deny p2 → promote p3 (flag false). Deny p3 → queue empty → `running`.
4. claude has all three answers → emits `result` → `recordTurnComplete` settles to idle.

## Invariants

- After promoting a queued prompt, `promptAnsweredPendingSettle === false`.
- A claude permission answered with anything other than the allow token is denied.
- No claude turn is left with an unanswered `can_use_tool` once its card was shown.

## Tests

- Backend: p1 visible + p2 queued; answer p1; a bare `recordTurnComplete` must KEEP p2
  (promoted) as the visible `waiting_for_approval` card, not settle to idle. (Fails before
  the flag reset.)
- claude client: answering a permission with `""` (Skip) writes a `behavior:"deny"`
  control_response, NOT an allow. Answering with the allow token still allows; the deny
  token still denies.

## Implementation Notes

- `src/backend/application/services/thread/thread-runtime-service.ts` — in `answerPrompt`,
  the promote branch sets `thread.promptAnsweredPendingSettle = false`.
- `src/backend/adapters/outbound/agent-runtime/structured/claude-stream-json-client.ts` —
  `write()` denies unless the value is exactly `STRUCTURED_ALLOW_TOKEN`.
