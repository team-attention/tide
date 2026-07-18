# Provider Conversation Lifecycle Evidence

## Question

How do Codex CLI, Claude Code, and OpenCode actually persist, resume, accept,
run, interrupt, and finish chat turns, and what must Tide preserve to avoid a
provider session saying one thing while the Tide thread says another?

This report is based on the exact provider builds installed on 2026-07-18 and
the matching published source or distributable artifacts. It does not infer a
shared lifecycle from UI behavior.

## Conclusion

The provider-owned session is the conversation authority, but it is not enough
to store only its ID. Tide also needs a provider-observed lifecycle checkpoint
and a Tide-owned delivery ledger.

The current integration loses both:

- `start()` / `resume()` returns a runtime handle before the provider has
  accepted or loaded the session;
- Composer appends a local user block and marks the thread `running` before the
  provider acknowledges the message;
- adapters buffer messages after the application service has already accepted
  them, creating multiple queue owners;
- provider terminal states are collapsed to a status-free `turn_completed`;
- Codex resume/read responses include the state needed to reconcile a stale
  thread, but Tide discards it;
- Claude and ACP message-correlation fields exist, but Tide does not send them;
- protocol requests have no general deadline or indeterminate-delivery state.

The observed stuck session is a direct result of those gaps, not corrupted
provider history.

## Evidence boundary

| Surface | Pinned version / source | Evidence used |
| --- | --- | --- |
| Tide | current worktree, 2026-07-18 | runtime clients, application services, persistence, projector, tests |
| Codex CLI | `codex-cli 0.144.4` | generated protocol schema, local app-server probe, `openai/codex` tag `rust-v0.144.4` (`8c68d4c`) |
| Claude Code | `2.1.202` | native binary, official CLI/session docs, exact npm artifact, embedded executable JavaScript |
| OpenCode | `1.18.2` | native binary, `anomalyco/opencode` tag `v1.18.2` (`70b56a0`), CLI export behavior |
| ACP | `@agentclientprotocol/sdk 0.21.0` | exact schema shipped by OpenCode 1.18.2 |

Primary upstream references:

- Codex app-server lifecycle and protocol:
  <https://github.com/openai/codex/blob/rust-v0.144.4/codex-rs/app-server/README.md>
- Codex exact-version thread and turn types:
  <https://github.com/openai/codex/tree/rust-v0.144.4/codex-rs/app-server-protocol/src/protocol/v2>
- Claude CLI reference:
  <https://code.claude.com/docs/en/cli-reference>
- Claude session persistence and branching:
  <https://code.claude.com/docs/en/sessions>
- Claude structured/headless output:
  <https://code.claude.com/docs/en/headless>
- OpenCode exact-version ACP service:
  <https://github.com/anomalyco/opencode/blob/v1.18.2/packages/opencode/src/acp/service.ts>
- OpenCode exact-version session status:
  <https://github.com/anomalyco/opencode/blob/v1.18.2/packages/opencode/src/session/status.ts>
- OpenCode CLI export:
  <https://opencode.ai/docs/cli/#export>
- ACP prompt lifecycle:
  <https://agentclientprotocol.com/protocol/prompt-turn>

## Incident evidence: session `019f75a1-0128-7fd3-b759-68f17d3e2182`

Provider truth:

- rollout:
  `~/.codex/sessions/2026/07/18/rollout-2026-07-18T23-28-33-019f75a1-0128-7fd3-b759-68f17d3e2182.jsonl`;
- a read-only isolated `codex app-server` call to
  `thread/read { includeTurns: true }` returned three turns;
- turn 1 was `completed` with 18 items;
- turn 2 was `interrupted` with zero items;
- turn 3 was `interrupted` with zero items and no completion timestamp;
- the diagnostic app-server reported thread status `notLoaded`, so there was no
  live Codex turn to wait for.

Tide-derived state:

- `~/Library/Application Support/tide/threads/id-bb6ef7890ced/thread.json`
  still stored `lastKnownState: "running"`;
- Tide's cache contained the two optimistic local user bubbles;
- restarting Tide removed the process but did not compare the persisted Tide
  state with Codex's reconstructed turns.

Therefore the spinner was not evidence of work. It was a stale Tide projection.

## Provider-native lifecycle matrix

| Concern | Codex app-server | Claude stream-json | OpenCode ACP |
| --- | --- | --- | --- |
| Conversation identity | `thread.id`; rollout-backed | UUID `session_id`; project JSONL transcript | OpenCode `sessionId`; database-backed |
| Start | `thread/start` response | launch with `--session-id`; first stdin user frame starts work | `session/new` response |
| Resume | `thread/resume`; rejoins running thread or loads disk | new process with `--resume <id>` appends to same session | `session/resume` or `session/load`; OpenCode implements both |
| History read | `thread/read(includeTurns)` or paged turns/items | JSONL under `~/.claude/projects/...` | `opencode export`, HTTP messages, or ACP `session/load` replay |
| Current state | `Thread.status`: `notLoaded`, `idle`, `systemError`, or `active` with waiting flags | no separate status RPC; process stream plus transcript evidence | OpenCode server status is in-memory `idle`, `busy`, or `retry`; ACP prompt request remains open |
| Turn accepted | `turn/start` response returns `Turn{id,status:inProgress}` | input frame can carry UUID; `--replay-user-messages` echoes accepted/deduplicated user messages | `session/prompt` request; optional `messageId` is echoed as `userMessageId` in final response |
| Terminal result | `turn/completed` with `completed`, `interrupted`, or `failed` | `result` frame with subtype/error/terminal reason | prompt response `stopReason`: `end_turn`, `cancelled`, `max_tokens`, `refusal`, or request error |
| Interrupt | `turn/interrupt(threadId,turnId)`; validates active turn | control request `{subtype:"interrupt"}`; result ends turn | `session/cancel` notification; backing session aborts |
| Branch | `thread/fork`, optionally through `lastTurnId` | `--fork-session`, `/branch` | ACP unstable fork / OpenCode session fork |
| Client message correlation | `clientUserMessageId` persists as user item's `clientId` | input `uuid`; executable checks transcript/runtime duplicates | ACP UUID `messageId`; OpenCode echoes it as `userMessageId` |
| Correlation is idempotency? | not guaranteed by protocol; useful for history reconciliation | yes in observed 2.1.202 implementation: duplicates are skipped | no: OpenCode 1.18.2 does not forward ACP `messageId` into backing prompt storage; echo is completion acknowledgement |

## Codex 0.144.4

### Persistence and resume

`thread/resume` is not merely a command that makes a process available. Its
response contains the full `Thread`, including `status` and, by default,
reconstructed `turns`. The implementation gives a running thread precedence and
rejoins it; otherwise it loads history from the thread store/rollout.

`thread/read(includeTurns:true)` combines persisted metadata/history with live
state. Its `set_thread_status_and_interrupt_stale_turns` function rewrites any
persisted `inProgress` turn to `interrupted` when the thread is not actually
active. This is exactly the reconciliation needed for the incident.

### Delivery and completion

`turn/start` returns a provider turn ID immediately after the submission enters
Codex's input channel. A later `turn/completed` carries a distinct status:

- `completed`;
- `interrupted`;
- `failed` with `Turn.error`;
- `inProgress` is only a non-terminal status.

`clientUserMessageId` is copied into the persisted/emitted user item as
`clientId`. Source and tests prove correlation, not automatic deduplication.
Tide may use it to find whether an indeterminate submission reached history,
but must not blindly resend merely because no response was observed.

### Tide mismatch

`codex-app-server-client.ts` currently:

- takes only `thread.id` and `thread.path` in `adoptThread`;
- ignores `thread.status` and every resumed turn;
- does not call `thread/read` for recovery;
- omits `clientUserMessageId` on `turn/start` and `turn/steer`;
- converts all terminal statuses to a generic `turn_completed` (only failed gets
  notice text);
- stores JSON-RPC callbacks without deadlines;
- buffers pre-ready writes and pending steers inside the adapter.

## Claude Code 2.1.202

### Persistence and resume

Claude stores each session as JSONL under
`~/.claude/projects/<project>/<session-id>.jsonl`. Official documentation says
sessions are continuously saved and `--resume <session-id>` reopens the same ID
and appends to it. It also warns that resuming one session in two terminals
interleaves messages, supporting Tide's one-live-runtime-per-session rule.

There is no app-server-like read/status RPC in the chosen stream-json transport.
After a Tide-owned Claude process dies, there cannot be a still-live turn in
that process. Recovery must rebuild from the transcript, classify any
non-terminal local episode as interrupted/indeterminate, then launch one new
`--resume` process.

### Delivery and completion

The exact 2.1.202 executable accepts a UUID on a stream-json user input. Its
embedded implementation checks both persisted-session and runtime duplicate
sets; a duplicate UUID is skipped. With `--replay-user-messages`, accepted or
deduplicated user frames are emitted on stdout with the same UUID. The flag is
also documented by `claude --help`.

`result` is the turn boundary. Interrupt produces an error-during-execution
result with an aborted terminal reason while leaving the process reusable.

### Tide mismatch

The Claude launch plan does not enable `--replay-user-messages`, and
`sendUserText` does not attach a UUID. Tide therefore gives up both the provider's
deduplication and its input acknowledgement. It emits `turn_started` locally at
stdin write time and treats every `result` as status-free completion.

## OpenCode 1.18.2 over ACP 0.21.0

### Persistence and resume

OpenCode persists sessions and messages behind its SDK/server. `opencode export`
returns `{info,messages}` and is Tide's public history-read boundary.

The ACP service exposes both:

- `session/load`: validates the backing session, loads all messages, restores
  model/mode, and replays message parts as ACP `session/update` events;
- `session/resume`: validates the session and restores config from the latest 20
  messages without replaying history.

OpenCode's `SessionStatus` map is process memory. `idle` entries are removed from
the map; only `busy` and `retry` remain. It cannot be treated as durable state
after the ACP process exits.

### Delivery and completion

ACP 0.21 `PromptRequest.messageId` is an optional client UUID, and
`PromptResponse.userMessageId` acknowledges it. OpenCode 1.18.2 implements the
echo for successful, cancelled, max-token, and refusal responses.

However, OpenCode's ACP adapter does not pass that ID into
`sdk.session.prompt`; it only returns it with the final response. This is a
terminal acknowledgement, not an early durable-accept acknowledgement and not
an idempotency key.

The prompt response preserves `stopReason`; `session/cancel` aborts the backing
session and resolves the prompt as `cancelled`.

### Tide mismatch

`acp-client.ts` currently:

- uses `session/load` on runtime resume but ignores its lifecycle meaning;
- returns the Tide runtime handle before load/new completes;
- has its own `queuedPrompts` in addition to the application queue;
- omits `messageId` and ignores `userMessageId`;
- collapses all stop reasons into generic completion, except notices for
  max-token/refusal;
- has no request deadline;
- treats config writes as applied before inspecting their responses.

Tide's separate `opencode export` rebuilder is correct as the provider-history
read boundary. It should reconcile the UI before runtime launch; ACP
`session/resume` can then attach the runtime without replaying an already-built
history. `session/load` remains useful only when replay is intentionally the
history source and deduplicated by native message IDs.

## Tide lifecycle gaps

### 1. Synchronous-looking handle, asynchronous provider adoption

`AgentRuntimePort.start/resume` returns `AgentRuntimeHandle`, but
`spawnRuntime()` returns immediately after constructing the client. The actual
initialize + start/resume/load handshake continues in callbacks. The application
therefore cannot know whether it has:

- a process;
- a valid provider session;
- a replay-only session;
- an active turn;
- an idle session ready for a new message;
- a failed or timed-out bootstrap.

### 2. Optimistic conversation mutation precedes delivery evidence

`ComposerQueueService.sendComposerInput` appends a local user block and sets
`runtimeState/lastKnownState` to `running` before `writeInput` has provider-level
acceptance. A successful pipe write only proves bytes reached an OS buffer.

### 3. Multiple queue owners

The backend service owns `pendingInput` + `pendingInputQueue`, while:

- Codex owns `queuedWrites` and `pendingSteerText`;
- ACP owns `queuedPrompts`;
- Claude writes immediately but has no acceptance ledger.

Once the service hands off an input, it cannot tell whether that input is still
queued in an adapter, accepted by a provider, or lost with a child process.

### 4. Terminal evidence is erased

`StructuredProviderEvent.turn_completed` has no provider turn/session ID and no
terminal status. The native reducer and application projector can only infer
`completed` vs `failed-with-notice`; interruption and cancellation disappear.

### 5. Hydrate repairs UI state without reconciling provider state

On explicit hydrate, a thread with no active runtime and a remembered active
state is reset to idle. This prevents some permanent spinners, but it is not a
provider reconciliation:

- it cannot identify which turn ended;
- it cannot settle delivery records;
- it cannot distinguish accepted, rejected, and indeterminate messages;
- it ignores a provider session that is active in another owner;
- it cannot report why a turn ended.

### 6. No indeterminate state

Protocol requests can remain in callback maps forever. If a process or response
is lost between submission and acknowledgement, Tide has only `running` or
`failed`; it has no honest state for “delivery/result unknown; reconciliation
required.”

## Required semantic split

Tide must keep three artifacts separate:

1. **Provider conversation history (authority):** rollout, Claude transcript,
   OpenCode session/messages.
2. **Provider lifecycle checkpoint (observed, derived):** native session/turn
   IDs, native status, last terminal outcome, observation time/cursor, runtime
   ownership.
3. **Tide delivery ledger (coordination):** local delivery UUID, queue state,
   provider correlation ID, acknowledgement evidence, and whether retry is safe.

The checkpoint and ledger are not competing chat databases. Both can be
discarded and rebuilt or conservatively marked indeterminate; neither may
overwrite provider history.

## Design consequences

- Provider bootstrap must be an awaited handshake that returns an observed
  snapshot, not merely a process handle.
- A local user bubble is pending until the adapter returns provider evidence.
- Every input gets one stable UUID before it enters any queue.
- Exactly one Tide application queue owns not-yet-dispatched input.
- Native terminal outcomes and native IDs survive through the event spine.
- Resume always reconciles provider history/state before Composer becomes
  send-ready.
- Silence triggers observation/reconciliation, not invented completion.
- Automatic retry is allowed only when the provider supplies proven
  idempotency or history proves the original delivery absent. Otherwise Tide
  asks the user before a possible duplicate.
- Provider-specific extra capability remains capability-gated. Uniform UX must
  not erase Codex active status, Claude UUID deduplication, or OpenCode replay.
