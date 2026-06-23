# Spec: Live Turn Activity Visibility

## Scope

While a turn is running, the Agent Chat shows only a bare `Working… {N}s` indicator
(`working-indicator.tsx`). For tool-heavy turns — especially Claude deep-research
fan-outs that launch many nested `Task` subagents — the main chat goes silent for
minutes (the nested subagent activity is written to disk, never streamed), so the
user believes the turn is hung, presses **Stop**, and the interrupt force-rejects the
entire in-flight tool/subagent tree (recorded by the CLI as
`"The user doesn't want to proceed with this tool use…"`). See root-cause analysis
below.

This spec makes the running turn *legibly alive* across all four providers by
summarizing live activity in the working indicator, and — for providers that expose
deeper structure — surfacing nested/plan progress.

Delivered in three slices:

- **Slice A — all providers, renderer-only.** Summarize the in-flight top-level tool
  activity the renderer already receives into the working indicator
  (`Working… 6m · 3 agents running`, `Working… 30s · Searching the web`).
- **Slice B — Claude nested subagents.** Watch the Claude CLI `subagents/*.jsonl`
  side-channel for an in-flight `Task` fan-out and surface true nested counts
  (`3 agents · 187 tool calls`).
- **Slice B′ — codex / ACP plan.** Implement the deferred codex `plan` item and ACP
  `plan` / `current_mode_update` session updates so those providers also report
  multi-step progress.

## Evidence

Root cause (from the reported thread `9fa51f17-…`, Claude CLI 2.1.186):

- The three `"doesn't want to proceed"` results are **not** authored by Tide
  (`grep "doesn't want to proceed" src` = 0 hits) — the CLI writes them as the canned
  text for any denied tool use.
- Denials arrive in synchronized batches (`11:36:48.033/.036/.039`) immediately
  followed by `[Request interrupted by user for tool use]` and the user's next
  message — the signature of an **interrupt**, not compaction (0 `compact_boundary`
  markers) and not an approval timeout (subagents were calling tools right up to the
  kill instant; e.g. `agent-a50a90b…` made 15 tool calls `11:31:16 → 11:36:48`).
- ~32 subagents (11:36 batch) and ~40 (12:01 batch) all terminate at the exact
  interrupt millisecond. Claude `Task` subagents nest: the main session issued 3
  `Agent` tool_uses, each general-purpose agent spawned ~10 more.

Current pipeline:

- `working-indicator.tsx:30-47` renders `Working… {seconds}s`; gated in
  `transcript.tsx:34-35` by `chatState === "running" && !lastIsStreamingAgent`.
- Chat state derived in
  `domains/agent-chat/state/view-model.ts` (`createAgentChatShellViewModel`,
  `deriveChatState`); running when `runtimeState ∈ {starting, running}`.
- Renderer already receives every top-level tool call live as
  `agentSessionBlock.upserted` → `AgentSessionBlockDto`
  (`shared/contracts/agent-session-block.ts`): `kind ∈ {tool_call, tool_result,
  command_run, search, mcp_call, browser_action, file_*}`, `title` = tool name,
  `status`, `blockId`, `data`.
- All three structured clients normalize tool activity to a shared
  `content_record` event (`structured-runtime-events.ts`): Claude emits `tool_call`
  with `status:"complete"` inside the finalized assistant message and `tool_result`
  later (`claude-stream-json-client.ts:668-693`); codex emits pending→complete on
  `item/started`/`item/completed` (`codex-app-server-client.ts:471-478`,
  `emitToolCallItem`); ACP emits `tool_call` then `tool_call_update`
  (`acp-client.ts:544-589`).
- **Nested subagent activity is on no provider stream.** Claude writes it to
  `~/.claude/projects/<projectKey>/<sessionId>/subagents/agent-*.jsonl`; the parent
  stream shows only the `Task` tool_call and its eventual tool_result. codex and ACP
  have no subagent concept; both have an unimplemented `plan` notion
  (`codex-app-server-client.ts:673`, `acp-client.ts:18,605`).
- Backend→renderer event path for an enrichment that is not a block: mirror
  `agentRuntime.usageChanged` (`contract-message-adapter.ts`, contract
  `events.ts`, reducer `domains/agent-chat/state/events.ts`, view-model field).

## Decisions

- **D1.** Build all three slices (user decision, 2026-06-23). A first (ships alone),
  then B, then B′.
- **D2.** Slice A is **renderer-only**, derived from blocks already in
  `AgentChatShellState.blocks`. No backend or contract change. Keeps the cheapest path
  and is automatically all-provider.
- **D3.** Slice A in-flight detection is **block `status`** (`pending`/`streaming`),
  the only signal on the renderer `AgentChatBlock` (it carries no `data`/callId).
  codex and ACP stream tool items `pending → complete`, so status is accurate for them.
  Claude marks `tool_call` `complete` on arrival and streams nothing during a `Task`
  fan-out, so Claude top-level in-flight is intentionally **not** derived here — the
  running-agent count for Claude is owned by Slice B's `subagents/*.jsonl` watcher,
  which is the correct source. `latestToolLabel` (the last tool-activity block's title)
  is still computed for all providers as a "what's happening" hint.
- **D4.** `Task`/`Agent` tool calls are summarized as "agents", other tool kinds as
  "tools"; the indicator prefers the agent count when any agents are in-flight.
- **D5.** Slice B surfaces nested counts via a backend file-watcher keyed off the
  Claude session ref; it emits a new `agentRuntime.activityChanged` contract event
  (does **not** synthesize fake blocks — keeps the transcript provider-authoritative).
- **D6.** Slice A and Slice B feed the **same** view-model field
  (`liveActivity`); B/B′ only enrich it with deeper counts when available.

## Out Of Scope

- Changing interrupt semantics (Stop still cancels the turn). A separate concern;
  this spec only removes the *reason* the user reflexively stops.
- Re-labeling the CLI's `"doesn't want to proceed"` text (CLI-owned transcript text).
- Non-destructive mid-turn steering / queue redesign.
- Persisting live-activity history (it is transient turn state only).
- Reading subagent *content* (we count activity, we do not render subagent transcripts).

## Domain Model

`LiveTurnActivity` — transient, per active turn, never persisted:

```
LiveTurnActivity {
  inFlightTools: number       // tool-activity blocks not yet paired with a result
  inFlightAgents: number      // subset whose tool is Task/Agent
  latestToolLabel?: string    // human label of the most recent in-flight tool
  // Slice B / B′ enrichment (undefined until available):
  nestedAgents?: number       // distinct live subagents (Claude subagents/*.jsonl)
  nestedToolCalls?: number     // total tool calls across live subagents
  planTotal?: number          // plan steps (codex/ACP)
  planCompleted?: number
}
```

## Contracts

- **Slice A:** none. `liveActivity` is a computed field on
  `AgentChatShellViewModel`, derived in the selector from `state.blocks`.
- **Slice B / B′:** new backend event
  `agentRuntime.activityChanged { threadId, activity: LiveTurnActivityDto }` in
  `shared/contracts/events.ts` (`BackendEventPayloadByKind`), mirroring
  `agentRuntime.usageChanged`. `LiveTurnActivityDto` holds the enrichment fields
  (`nestedAgents`, `nestedToolCalls`, `planTotal`, `planCompleted`). The reducer folds
  it into `AgentChatShellState.liveActivityEnrichment`; the selector merges block-derived
  (A) + enrichment (B/B′) into the view-model `liveActivity`.

## Flow

1. Turn runs → blocks stream in (`agentSessionBlock.upserted`), already handled.
2. **A:** selector recomputes `liveActivity` from `state.blocks` whenever blocks
   change and `chatState === "running"`. Indicator renders
   `Working… {Ns}{ · detail}` where detail is, in priority order: nested counts (B) →
   plan progress (B′) → `{inFlightAgents} agents running` → `{latestToolLabel}` →
   `{inFlightTools} tools`.
3. **B:** on a Claude `Task` tool_call going in-flight, the backend watches the
   session's `subagents/` dir; on file change it recomputes `{nestedAgents,
   nestedToolCalls}` (live = subagent files whose last entry is not a terminal result)
   and emits `agentRuntime.activityChanged`. Cleared on turn end.
4. **B′:** codex `plan` items and ACP `plan`/`current_mode_update` updates parse into
   `{planTotal, planCompleted}` emitted via the same event.

## Invariants

- `liveActivity` is present only while `chatState === "running"`; it is `undefined`
  otherwise and MUST NOT survive turn end.
- Slice A never reads the filesystem or adds backend load.
- Counts are monotonic within a turn only by construction, never asserted — a result
  arriving lowers `inFlightTools`; this is expected.
- The transcript block list is unchanged by this feature (no synthetic blocks).
- The working indicator still suppresses itself when the last block is a streaming
  agent message (no double caret).

## Tests

- **A1** (view-model unit): 3 `tool_call` blocks titled `Task` with status `pending` →
  `liveActivity.inFlightAgents === 3`, `inFlightTools === 3`.
- **A2** (view-model unit): a `tool_call` block whose status is `complete` is NOT
  counted in-flight (codex/ACP completion path).
- **A3** (view-model unit): `liveActivity === undefined` when `chatState !== running`.
- **A4** (component): indicator with `inFlightAgents: 3` renders `… · 3 agents running`;
  with `latestToolLabel: "Searching the web"` (no in-flight) renders `… · Searching the web`.
- **A5** (view-model unit): a `pending` non-Task tool (`kind:"search"`) → counted in
  `inFlightTools`, not `inFlightAgents`; `latestToolLabel` set from its title.
- **B1** (backend unit, fake fs): two subagent files with non-terminal last entries →
  `activity.nestedAgents === 2`; nested tool_use lines summed into `nestedToolCalls`.
- **B2** (backend unit): turn end emits `activityChanged` clearing enrichment; watcher
  disposed.
- **B′1** (provider unit): codex `plan` item / ACP `plan` update → `{planTotal,
  planCompleted}` emitted.
- **Boundary:** renderer selector imports no node/fs; new event kind registered in the
  contract union.

## Implementation Notes

- callId source: Claude `tool_call` blockId is
  `structured:{runtimeId}:{messageId}:{callId}` and `tool_result` carries
  `callId`/`tool_use_id` in `payload`; confirm the agent-session reader maps callId
  onto `block.data` (field name) before relying on it — else pair on the blockId
  suffix scheme. Verify in `agent-session` reader.
- Task tool title: the main transcript shows `Agent`; the Claude SDK tool name is
  `Task`. Match a small set `{Task, Agent}` case-sensitively; verify the rendered
  `title` for each provider's "spawn agent" tool.
- Slice A is independently shippable and is the panic-stop fix; land + verify it before
  B/B′.
- Slice B watcher: derive the dir from the Claude `session_ref`
  (`kind:"claude_transcript"`) + project key from cwd; use `fs.watch` with debounce,
  owned by Backend agent-runtime infrastructure (not Electron main, not renderer).
- Open question: does Tide already know the absolute `subagents/` path from the session
  ref, or must it reconstruct the project-key hash? Resolve at start of Slice B.
