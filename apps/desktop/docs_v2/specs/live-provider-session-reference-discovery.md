# Spec: Live Provider Session Reference Discovery

## Scope

This spec defines how live Backend runtime evidence attaches a provider-owned Raw Agent Session reference to a Tide Thread after the provider CLI starts.

It covers:

- recording a discovered provider session reference on the in-memory Thread.
- persisting the same provider session reference into `thread.json`.
- using Codex rollout evidence to derive `codex_rollout` references.
- using Claude transcript evidence to derive `claude_transcript` references.
- using Antigravity transcript evidence to derive `antigravity_conversation` references.
- keeping follow-up resume available without starting a new Raw Agent Session.

## Evidence

- `docs_v2/master-plan.md` says Tide stores a reference to the Raw Agent Session instead of copying provider history as the primary source of truth.
- `docs_v2/specs/persistence.md` defines `ProviderSessionRefRecord` in `thread.json`.
- `docs_v2/specs/backend-agent-runtime-port-wiring.md` defines follow-up resume through `AgentRuntimePort.resume` using a provider session reference.
- `docs_v2/research/agent-hidden-pty-provider-signal-smoke.md` records that Codex rollout files under `~/.codex/sessions/...` contain a provider session id, and that `codex resume --no-alt-screen <session-id>` resumes the same Raw Agent Session.
- `docs_v2/research/agent-hidden-pty-provider-signal-smoke.md` records that Claude transcript files under `~/.claude/projects/.../<session-id>.jsonl` contain the provider session id, and that `claude --resume <session-id>` resumes the same Raw Agent Session.
- `docs_v2/research/agent-hidden-pty-provider-signal-smoke.md` records that Antigravity hook and transcript evidence includes `conversationId` and `transcriptPath`, and that `agy --conversation <conversation-id>` resumes the same Raw Agent Session.
- `src/backend/application/services/thread-runtime-service.ts` resumes a Thread only when `thread.agentBinding.providerSessionRef` exists.
- `src/backend/application/services/thread-persistence-service.ts` can attach `providerSessionRef` to persisted Thread metadata.
- `src/backend/infrastructure/node/live/live-backend.ts` currently projects Antigravity transcript frames into Agent Session Blocks and attaches Antigravity references, but it does not attach Codex rollout or Claude transcript references.

## Decisions

### D1. Runtime discovery updates the Thread Agent Binding

When live Backend observes a provider session reference for the active runtime, it records the reference on `Thread.agentBinding.providerSessionRef`.

The Thread Agent Binding stays locked to its original Agent. A discovered Antigravity reference cannot attach to a Codex, Claude, or Tide API Thread.

### D2. Runtime discovery persists immediately

When live Backend records a provider session reference, it also writes the same reference to Thread persistence with `observedAt`.

This makes app restart and Thread reopen able to resume from the provider-native Raw Agent Session.

### D3. Provider-local history paths are enough to attach

Provider-local history polling must only attach a history path that is correlated to the Tide Thread's user input. A recent file from the same cwd is not enough because another Raw Agent Session can update provider history concurrently.

For Codex, the rollout filename identifies the Codex session id, but the rollout is only accepted when its structured user-message record matches a user message already recorded on the Tide Thread. The live Backend projector derives:

```ts
{
  agentId: "codex",
  kind: "codex_rollout",
  value: sessionId,
  transcriptPath: rolloutPath,
  observedAt
}
```

For Claude, the transcript filename identifies the Claude session id, but the transcript is only accepted when its structured user record matches a user message already recorded on the Tide Thread. The live Backend projector derives:

```ts
{
  agentId: "claude",
  kind: "claude_transcript",
  value: sessionId,
  transcriptPath,
  observedAt
}
```

For Antigravity, the transcript path under provider-owned history contains the conversation id.

The live Backend projector derives:

```ts
{
  agentId: "antigravity",
  kind: "antigravity_conversation",
  value: conversationId,
  transcriptPath,
  observedAt
}
```

### D4. Hook payload identity may attach before history polling

If a provider hook payload includes the provider-native session id and transcript path, live Backend can attach the provider session reference directly from that Provider Signal.

This is only an identity shortcut. The hidden PTY remains the runtime transport, and provider-owned history remains the Raw Agent Session source of truth.

### D5. Attachment is idempotent

If the Thread already has the same provider session reference, recording it again is a no-op except for normal updated timestamps.

If the Thread has a different provider session reference, Backend keeps the existing reference until a separate conflict policy is specified.

### D6. Codex rollout history can also project Agent messages

When a correlated Codex rollout contains an `agent_message` event, live Backend projects it into an Agent Session Block input for the active Thread.

This does not make Tide the owner of the Raw Agent Session. The rollout path remains the provider-owned source reference, and the projection is a visible Agent Session cache/update derived from that evidence.

### D7. Claude transcript history can also project Agent messages

When a correlated Claude transcript contains an assistant message record, live Backend projects its text content into an Agent Session Block input for the active Thread.

This follows the same ownership rule as Codex: the Claude transcript remains provider-owned Raw Agent Session history, and Tide only emits a visible Agent Session update derived from that transcript evidence.

### D8. History projection updates the Thread cache used by hydrate

When live Backend projects a provider-owned history record into an Agent Session Block update, it also upserts that block into the active Thread's cached block references.

This keeps the live event stream and same-process `thread.hydrate` result aligned. It does not copy the provider transcript into a Tide-owned Raw Agent Session; it only stores the visible derived block reference already emitted to Desktop.

## Flow

### UC-1: Attach provider Raw Agent Session reference

1. User starts a Provider CLI Agent Thread.
2. Backend starts the selected provider CLI through hidden PTY.
3. Live Backend observes a provider hook payload or provider-local history path for the runtime.
4. Backend derives the provider-native resume value from the provider evidence.
5. Backend records the provider session reference on the Thread Agent Binding.
6. Backend persists the provider session reference to `thread.json`.
7. Follow-up Composer can resume the same Raw Agent Session with the selected Agent Integration's provider-native resume plan when no active runtime handle exists.

## Invariants

1. Provider session reference attachment must validate Thread id and Agent id.
2. Attachment must not change the selected Agent, Agent Runtime Source, scope, or Launch Options.
3. Attachment must not copy the provider transcript as Tide-owned conversation history.
4. Persistence must store the same reference value and transcript path used by the in-memory Thread.
5. Follow-up resume must use the recorded provider session reference before writing Composer input.
6. Provider-local history polling must not attach a Codex or Claude history file solely because it is recent or has the same cwd.
7. Provider history projection must update the same Thread cached block references that `thread.hydrate` returns.

## Tests

| Rule | Test expectation |
|------|------------------|
| Service records provider ref | `recording_provider_session_ref_attaches_it_to_thread_agent_binding` proves the Thread snapshot includes the discovered reference. |
| Service rejects wrong Agent | `recording_provider_session_ref_rejects_mismatched_agent_binding` proves a provider ref cannot attach to a Thread owned by another Agent. |
| Codex path becomes ref | `codex_provider_history_reader_derives_provider_session_ref_from_rollout_path` proves the rollout path maps to `codex_rollout`. |
| Claude path becomes ref | `claude_provider_history_reader_derives_provider_session_ref_from_transcript_path` proves the transcript path maps to `claude_transcript`. |
| Provider signal identity becomes ref | `provider_signal_payload_derives_provider_session_refs_for_codex_and_claude` proves hook payload identity can attach before history polling. |
| History polling requires Thread prompt correlation | `provider_history_readers_ignore_recent_codex_and_claude_files_without_thread_prompt` proves concurrent provider sessions are not attached only because they are recent. |
| Codex rollout history becomes visible output | `codex_provider_history_reader_projects_agent_message_frame` proves a correlated Codex rollout can produce an agent message frame. |
| Claude transcript history becomes visible output | `claude_provider_history_reader_projects_agent_message_frame` proves a correlated Claude transcript can produce an agent message frame. |
| Projected block updates Thread cache | `recording_agent_session_block_upserts_cached_block_for_hydrate` proves a projected Agent Session Block is returned by later `thread.hydrate`. |
| Antigravity path becomes ref | `antigravity_provider_history_reader_derives_provider_session_ref_from_transcript_path` proves the transcript path maps to `antigravity_conversation`. |
| Live projector persists ref | `live_backend_projector_persists_antigravity_provider_session_ref` proves live Antigravity history projection attaches the ref to service and `thread.json`. |

## Implementation Notes

- Add a Backend service method dedicated to recording provider session references.
- Keep the persistence DTO shape in `thread-persistence-service.ts`.
- Keep provider-specific derivation in live Backend infrastructure, near the Provider Signal and provider history readers.
- Bound provider-local discovery to recent rollout/transcript files by mtime and a small result cap.
