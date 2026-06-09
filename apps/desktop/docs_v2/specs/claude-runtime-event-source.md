# Spec: Claude Runtime Event Source

Brings Claude Code onto the Agent Runtime Event Spine
(`agent-runtime-event-spine.md`). It is the spine's claude migration, **pulled
ahead of the codex slice** because of a live production incident: a normal
`gd` turn rendered "Ran 2 commands" with no answer — Claude's real final message
was on disk but Tide never surfaced it.

This spec covers the load-bearing kernel first: **provider-owned, transcript-based
turn-end detection** that decides turn completion from Claude's authoritative
on-disk turn-end record, not from a separately-timed hook poll that can outrun the
content poll. Wiring the full `AgentRuntimeEventSource` (frames + interrupt +
commands) is a follow-up slice that builds on this kernel.

## Scope

In scope:

- A pure function `detectClaudeTranscriptTurnEnd(transcriptTailText,
  expectedUserMessage)` that returns whether the current turn ended, by reading
  Claude's own transcript JSONL — mirroring `detectCodexRolloutTurnEnd`.
- The turn-end rule grounded in observed Claude transcript records.
- The "honored once" guard: a turn ends only after its own user message is located,
  so a prior turn's end record cannot settle the current turn early.

Out of scope (follow-up slices):

- The full `AgentRuntimeEventSource` implementation for claude (frame streaming via
  `output.delta`, `submit`, `interrupt`, `queryCommands`, `stop`).
- Flipping the Backend service to consume the claude spine and deleting the old
  `emitClaudeHistory` / `pollWhileRunning` claude path in `live-backend.ts`.
- Switching Claude to print-mode / `stream-json`. **Decided against** in
  `docs_v2/research/agent-hidden-pty-provider-signal-smoke.md`: runtime transport
  stays the hidden interactive PTY (preserves directory trust, the permission TUI,
  in-session commands, and same-session MCP attach). Hooks + transcript JSONL are
  Provider Signals.

## Evidence

Post-mortem of the `gd` turn (thread `id-7b64c1b083d0`, transcript
`…/-Users-eatnug-Workspace-life/113021f5-…jsonl`), observed 2026-06-09:

Transcript line structure (genuine end at the bottom):

| idx | record | meaning |
|-----|--------|---------|
| 4 | `user` "gd" | the turn's user message |
| 8 / 9 | `assistant` tool_use / `user` tool_result | `git diff --stat` |
| 13 / 14 | `assistant` tool_use / `user` tool_result | `git diff` |
| 17–19 | `last-prompt`, `mode`, `permission-mode` | **mid-turn session checkpoint — NOT turn end** |
| 20 | `assistant` thinking (empty) | model resumes |
| 21 | `assistant` text @ 09:43:20.006 | **the real answer** |
| 22 | `system` `subtype:"stop_hook_summary"` @ 09:43:20.195 | the `agent-idle` Stop hook ran (`hookCount:1`, `preventedContinuation:false`) — **authoritative turn end** |
| 23 | `system` `subtype:"turn_duration"` (`durationMs:14988`) | turn summary, real end only |

What Tide captured in `agent-session-cache.jsonl`: `user_message`, the two
`tool_call`/`tool_result` pairs — and **nothing after idx 14**. The idx 21 answer
was dropped.

Why the old path drops it: claude's live turn-end is the `agent-idle` hook spooled
to a file, polled on one loop (500ms); the answer text is tailed from the
transcript on a **separate** loop (1000ms) that stops 3 idle-grace cycles after the
runtime goes idle. The final answer was written ~7s after the last tool result —
past the idle-grace window — so the content poll that should have read idx 21 had
already wound down. Two independently-timed pollers reconstructing one turn is the
race. (A `system/stop_hook_summary` shows the hook fired exactly once, at the true
end; the early `last-prompt`/`mode`/`permission-mode` markers are not turn-end and
must be ignored.)

Comparison — a working same-shape turn (`id-9e2f74a36760`): final text came 2.3s
after the tool result (inside the 3s grace) and had no mid-turn markers. The bug is
timing-sensitive, which is exactly why it must become a structural, on-disk signal.

## Decisions

1. **Turn-end is a transcript record, not a hook-poll race.** The authoritative
   end of a Claude turn is the `system` record whose `subtype` is `turn_duration`
   (always written once per finished turn) or `stop_hook_summary` with
   `preventedContinuation !== true`. Detection reads these from the transcript the
   thread is bound to. The `agent-idle` hook remains a fast *nudge* to re-read, but
   the *decision* is the on-disk record that is guaranteed to sit after the final
   assistant content.

2. **Ignore mid-turn checkpoints.** `last-prompt`, `mode`, and `permission-mode`
   records are session state, never turn-end. Only `system` turn-summary records
   end a turn.

3. **Honored once, per current turn.** A turn ends only after its own user message
   is located in the transcript (same guard as `detectCodexRolloutTurnEnd`), so a
   prior turn's `turn_duration` cannot settle the new turn early.

4. **No fabricated settle.** If no turn-summary record exists yet, the turn has not
   ended. No free-text scraping, no inactivity guess. (Spine invariant #5.)

5. **Turn-end is uniformly provider-history owned; no cross-channel hook settle —
   for ALL providers.** Every agent settles from its own history-emit, in one read of
   one file, so the settle and the final-frame ingest never race across channels:
   - codex → rollout `task_complete` / `turn_aborted` in `emitCodexHistory`.
   - claude → transcript `turn_duration` / `stop_hook_summary` in `emitClaudeHistory`.
   - antigravity → terminal planner-response (`turnComplete` frame flag) in
     `emitAntigravityHistory`.
   The cross-channel hook-settle branch in `emitProviderSignals` was **removed
   entirely**, and `turnEndSignalEvents()` was **removed from the
   `AgentIntegrationPort`** and all three adapters — it is dead once no infra path
   settles on a hook. Provider hooks (`codex-stop`, `agent-idle`) still flow as
   Provider Signals for prompt detection and session-ref discovery; they no longer
   settle. codex's `codex-stop` was already unreliable ("never fires" → its rollout
   detection existed precisely to cover that), so removing its hook-settle is not a
   regression. This is the per-adapter, uniform shape the full `AgentRuntimeEventSource`
   slice will formalize (each adapter fusing its signals to one deduped `turn.ended`).

## Out Of Scope

See Scope. (No interim band-aid: the throwaway `flushProviderHistoryOnTurnEnd`
hook-flush guard was removed. Turn-end settle is now uniformly provider-history
owned — see Decision 5.)

## Domain Model

Pure function, no new types beyond a small result shape, living with the claude
adapter (provider lifecycle knowledge belongs in the integration, not infra):

```
src/backend/adapters/outbound/agent-integrations/claude/claude-transcript-turn-detection.ts
```

```ts
export type ClaudeTurnEndReason = "completed";

export interface ClaudeTurnEndDetection {
  ended: boolean;
  reason?: ClaudeTurnEndReason;
}

export function detectClaudeTranscriptTurnEnd(
  transcriptTailText: string,
  expectedUserMessage: string | undefined,
): ClaudeTurnEndDetection;
```

`reason` is `"completed"` for now; `aborted`/`interrupted` mapping is added when the
source wires `interrupt()` (follow-up slice). Claude's transcript writes the same
`turn_duration` for an interrupted turn, so distinguishing reasons needs the
interrupt signal, not just the transcript.

## Flow

```
agent-idle hook fires  ─┐
transcript file grows  ─┴─►  source re-reads bound transcript tail
                              detectClaudeTranscriptTurnEnd(tail, userMsg)
                                located current user message?           no ─► ended:false
                                system turn_duration / stop_hook_summary
                                  after it (preventedContinuation!=true)? yes ─► ended:true
                              on ended:true the source has, in the SAME read,
                              already seen idx 21 (it is above idx 22) ─► no drop
```

## Invariants

1. `detectClaudeTranscriptTurnEnd` returns `ended:false` until a `system`
   `turn_duration` (or non-prevented `stop_hook_summary`) appears after the current
   turn's user message.
2. Mid-turn `last-prompt` / `mode` / `permission-mode` records never end a turn.
3. A turn-summary record before the current user message does not end the turn.
4. With no located user message, no turn end is honored.

## Tests

`tests/claude-transcript-turn-detection.test.ts` (fake transcript text):

| Behavior | Test |
|---|---|
| `turn_duration` after user msg ends turn | `turn_duration_after_current_user_message_ends_turn` |
| `stop_hook_summary` (not prevented) ends turn | `non_prevented_stop_hook_summary_ends_turn` |
| `stop_hook_summary` with `preventedContinuation:true` does NOT end | `prevented_stop_hook_summary_does_not_end_turn` |
| mid-turn markers do not end turn | `mid_turn_markers_do_not_end_turn` |
| the `gd` shape: tools + late text + end record → ended | `gd_shape_with_late_answer_then_turn_end_record_ends_turn` |
| prior turn's end record does not settle new turn | `turn_end_before_current_user_message_does_not_end_turn` |
| no end record → not ended | `no_turn_end_record_does_not_end_turn` |
| no located user message → not honored | `turn_end_without_located_user_message_is_not_honored` |

## Implementation Notes

Mirror `detectCodexRolloutTurnEnd`: split lines, locate the latest `user` record
whose `message.content` equals/contains `expectedUserMessage`, then scan from the
end down to that index for a `system` turn-summary record. Reuse `parseJsonObject`,
`recordField`, `stringField`, `inputTextContentEquals` from
`live-backend-json.ts`. Keep it pure (text in, decision out) so it is the seed of
the claude `AgentRuntimeEventSource` exactly as the codex function seeds codex's.

## Open Questions

1. Reason fidelity (`completed` vs `interrupted`) — resolved when `interrupt()` is
   wired; the transcript alone cannot distinguish them.
2. Whether to drive the source off a file watch vs. the existing hook nudge —
   tracked in the spine spec (Open Question / push-not-poll); not blocking.
