# Spec: Agent Session Block Rendering Path

## Scope

This spec defines the renderer-agnostic path from provider evidence to visible Agent Session Blocks.

It covers:

- Raw Agent Frame identity and ordering.
- Agent-specific reader contract.
- Agent Session Block schema.
- streaming block update behavior.
- raw fallback behavior.
- prompt block behavior.
- Workbench reference block behavior.
- Desktop rendering contract shape for block updates.
- Agent Session Cache as derived state.
- reopen behavior without starting Agent Runtime.

It does not define React components, visual styling, full provider parser grammar, persistence storage layout, PTY Transcript retention amount, provider launch, or Workbench tool operation contracts.

## Evidence

- `docs_v2/glossary.md` defines Agent Session as the visible app rendering of the Raw Agent Session inside Agent Chat.
- `docs_v2/glossary.md` defines Agent Session Block as one renderable unit inside Agent Session.
- `docs_v2/glossary.md` defines Raw Agent Frame as a small observed unit from Agent Runtime output before rendering.
- `docs_v2/master-plan.md` says Agent Runtime output flows to Raw Agent Frame, then Agent-specific reader, then Agent Session Block, then Agent Session UI.
- `docs_v2/implementation/electron-node-architecture-decisions.md` says Agent Session Block is the central renderable product unit and keeps UI independent from provider transport and renderer.
- `docs_v2/implementation/agent-session-rendering.md` defines Raw Agent Frame fields, Agent Session Block fields, block kinds, reader rules, use cases, invariants, and initial implementation slices.
- `docs_v2/research/agent-hidden-pty-provider-signal-smoke.md` says PTY Transcript is baseline evidence and provider transcripts/hooks are cleaner rendering sources when tied to the same PTY session.

## Decisions

### D1. Agent Session Block is the product render unit

Backend emits Agent Session Block updates to Desktop.

Desktop renders blocks. Desktop does not parse raw provider output as the normal path.

### D2. Raw Agent Frame is the evidence unit

Backend records Raw Agent Frames before interpretation.

Frames carry source, source reference, sequence, observed timestamp, payload kind, bounded payload, and truncation state.

### D3. Readers are provider-specific

Each Agent Integration can provide or select an Agent-specific reader.

Readers produce product-normalized Agent Session Blocks while preserving provider-native values that users see.

### D4. Unknown output remains visible

Unknown provider output becomes `raw_block`.

Unknown output is not dropped and is not guessed into structured tool, file, approval, or prompt blocks.

Exception: control **signals** are not "output". A consumed signal frame — a
`hook_payload` whose hook did not resolve into a renderable prompt, carried as
payload `type: "provider_signal"` — is runtime transport (like the hidden PTY).
It is consumed for Prompt State / session bookkeeping and MUST NOT render as a
visible `raw_block`. Only genuine provider *output* with an unrecognized type
(e.g. a future provider event from history) stays visible as `raw_block`.

### D5. Streaming uses stable block ids

A streaming provider message updates one Agent Session Block by stable block id until the reader marks it complete or failed.

Stream Update events use upsert semantics.

### D6. Prompt blocks and Prompt State are linked

When a reader has evidence for an approval, question, permission, choice, or command picker, it emits an interaction block and Backend creates Prompt State.

The block records narrative history. Prompt State drives the active input surface.

### D7. Agent Session Cache is derived

Agent Session Cache stores rendered blocks for fast reopen.

Raw Agent Session remains provider-owned source of truth.

Cache invalidation and storage layout are specified by the Persistence spec.

### D8. Local user input gets local provenance

When the user sends Composer input and the input is actually submitted to the selected Agent Runtime, Backend creates a local user message block before provider output exists.

That block uses local provenance and is later linked to provider frames when the provider history exposes the submitted input.

### D9. Reopen does not start runtime

Opening an existing Thread renders cached or rebuilt Agent Session Blocks without starting Agent Runtime by default.

### D10. Backend domain owns the product render model

Backend application domain owns Raw Agent Frame, Agent Session Block, reader input, reader result, and block update types.

Shared Contracts owns only the Desktop-facing Contract DTO shape for an Agent Session Block update.

### D11. This slice uses a fixture reader

The first implementation uses a provider-neutral fixture reader under Backend application services.

Provider-specific readers remain Agent Integration work after fixture behavior proves ordering, fallback, prompt, and DTO mapping rules.

### D12. Provider history readers extract tool calls

The codex and claude history paths (both the live history reader and the
rebuild-on-reopen path) extract provider-native tool activity into
`tool_call` and `tool_result` blocks, in file order, interleaved with message
blocks.

- **codex** rollout `response_item` payloads:
  - `function_call` / `custom_tool_call` → `tool_call` (title = provider tool
    name; body = the provider-native arguments/input, bounded).
  - `function_call_output` / `custom_tool_call_output` → `tool_result` (title =
    the matching call's tool name; body = the provider-native output, bounded).
  - calls and outputs are paired by `call_id` for stable block ids.
- **claude** transcript content items:
  - assistant `tool_use` → `tool_call` (title = tool name; body = bounded
    input).
  - user `tool_result` → `tool_result` (paired by `tool_use_id`; body = bounded
    output).
- Additional provider-native parsers must map tool calls/results into the same
  `tool_call` / `tool_result` block pair without adding provider-specific renderer
  surfaces.

Provider-native tool names and argument/output text are preserved (per D3). The
body is bounded; it is never guessed into a structured Tide tool block (those
come only from Tide MCP frames, per the Tide MCP specs).

### D13. Tool blocks render as a collapsed activity summary (Codex-style)

The Desktop renderer groups *consecutive* `role: "tool"` blocks into a single
muted, one-line **tool activity summary** row — matching the Codex app, e.g.
"Edited 1 file, ran 2 commands". The summary aggregates the group's `tool_call`
blocks by category derived from the provider-native tool name:

| Category | Tool name match (case-insensitive) | Phrase |
|----------|-----------------------------------|--------|
| edit | patch, edit, write, apply, create, str_replace | "edited N file(s)" |
| run | exec, run, bash, shell, command | "ran N command(s)" |
| search | grep, glob, search, find, ripgrep | "N search(es)" |
| read | view, read, list, cat, dir, ls | "read N file(s)" |
| other | (fallback) | "N tool call(s)" |

The summary row is expandable; expanded, it reveals the individual tool entries
(tool name + bounded monospace args/output), so detail is available on demand but
does not clutter the transcript. The row is visually separate from user and
agent message turns and is never rendered as a generic event or agent message.

### D14. Edited files surface as a "files changed" list

When a tool activity group contains edit-category `tool_call` blocks, the
renderer derives the distinct edited file paths from the call arguments and shows
a Codex-style "files changed" list under the summary (filename + muted parent
dir). Path extraction is best-effort from provider-native arguments:

- claude `Edit`/`Write`/`MultiEdit` → `file_path` from the JSON args.
- codex `apply_patch` → `*** Update/Add/Delete File: <path>` lines.
- ACP/provider-native edit tools → provider-specific path fields when available.

Paths are display-only (no diff stats are invented — those require git evidence
the transcript does not carry).

## Out Of Scope

- Full visual Agent Chat design.
- Markdown renderer choice.
- Syntax highlighting implementation.
- Provider-specific parser completeness.
- Permanent Raw Agent Frame storage policy.
- Full Agent Session Cache storage schema.
- Workbench Pane operation details.
- Provider runtime launch.

## Domain Model

### Raw Agent Frame

Raw Agent Frame fields:

| Field | Purpose |
|-------|---------|
| `frameId` | Tide id for the observed frame. |
| `threadId` | Owning Thread. |
| `agentId` | Provider CLI agent id. |
| `source` | Evidence source such as PTY Transcript, Provider Signal, provider history, structured batch, stdout, or stderr. |
| `sourceRef` | Provider session id, transcript path, rollout path, log path, PTY offset, or stream offset. |
| `sequence` | Monotonic order in one Thread observation stream. |
| `observedAt` | Tide observation time. |
| `payloadKind` | json, text, ansi text, stdout, stderr, provider record, or binary summary. |
| `payload` | Bounded raw payload. |
| `body` | Compatibility text payload for existing raw frame append paths. |
| `truncated` | Whether Tide bounded the payload. |

### Agent Session Block

Agent Session Block fields:

| Field | Purpose |
|-------|---------|
| `blockId` | Stable render/cache id. |
| `threadId` | Owning Thread. |
| `agentId` | Agent that produced or owns the block. |
| `kind` | Block kind. |
| `role` | user, agent, tool, system, or runtime. |
| `sourceFrameIds` | Raw Agent Frames used to produce the block. |
| `localProvenance` | Local source for user input blocks created before provider echo/history exists. |
| `status` | pending, streaming, complete, failed, or needs input. |
| `title` | Short label when useful. |
| `body` | Renderable text or markdown. |
| `data` | Structured JSON payload. |
| `rawFallback` | Raw text shown when Tide cannot safely interpret the frame. |
| `createdAt` | First observation time. |
| `updatedAt` | Last update time. |

### Block kinds

Initial block kinds:

- user message.
- agent message.
- markdown.
- code block.
- working status.
- progress status.
- waiting for input.
- waiting for approval.
- error.
- tool call.
- tool result.
- command run.
- file read.
- file edit.
- search.
- browser action.
- MCP call.
- file change.
- diff summary.
- generated file.
- link.
- attachment.
- Workbench reference.
- approval prompt.
- question prompt.
- choice prompt.
- command picker.
- model picker.
- raw block.

## Contracts

Suggested reader contract:

```ts
interface AgentSessionReader {
  read(input: AgentSessionReadInput): AgentSessionReadResult;
}

interface AgentSessionReadInput {
  thread: ThreadRuntimeSnapshot;
  agentBinding: AgentBinding;
  frames: RawAgentFrame[];
  existingBlocks: AgentSessionBlock[];
}

interface AgentSessionReadResult {
  blockUpdates: AgentSessionBlockUpdate[];
  promptState?: PromptState;
  lastKnownState?: LastKnownState;
  diagnostics: ReaderDiagnostic[];
}
```

Suggested block update shape:

```ts
type AgentSessionBlockUpdate =
  | { kind: "upsert"; block: AgentSessionBlock }
  | { kind: "complete"; blockId: string; status: "complete" | "failed"; updatedAt: string }
  | { kind: "reset"; reason: "cache_rebuild" | "reader_repair"; blocks: AgentSessionBlock[] };
```

Desktop rendering contract shape:

```ts
interface AgentSessionBlockDto {
  blockId: string;
  threadId: ThreadId;
  agentId?: AgentId;
  kind: string;
  role?: "user" | "agent" | "tool" | "system" | "runtime";
  sourceFrameIds?: string[];
  localProvenance?: JsonObject;
  status: "pending" | "streaming" | "complete" | "failed" | "needs_input";
  title?: string;
  body?: string;
  data?: JsonObject;
  rawFallback?: string;
  createdAt?: string;
  updatedAt: string;
}
```

Backend emits `agentSessionBlock.upserted` BackendEvents with this DTO. Backend emits `agentSessionBlock.completed` BackendEvents with the Shared Contracts completion payload: `blockId`, `threadId`, `status`, `completedAt`, and optional `error`. Desktop renders the DTO and does not parse provider raw output as the normal path.

## Flow

### UC-1: Render structured provider evidence

1. Backend records structured provider event as Raw Agent Frame.
2. Agent-specific reader maps known event types to blocks.
3. Unknown structured events become raw blocks.
4. Backend emits Agent Session Block updates.

### UC-2: Render interactive PTY output

1. Backend captures bounded PTY Transcript frames.
2. Reader detects conservative message, status, or prompt boundaries.
3. Unrecognized terminal output becomes raw block.
4. Partial output may update a streaming block.

### UC-3: Render approval prompt

1. Reader sees provider-supported approval evidence.
2. Reader emits approval prompt block.
3. Backend creates Prompt State.
4. Desktop presents the active approval at Composer or prompt controls.

### UC-4: Render question or choice prompt

1. Reader sees provider-supported question or choice evidence.
2. Reader emits question or choice prompt block.
3. Backend creates Prompt State.
4. User answer is sent through Backend lifecycle path.

### UC-5: Reopen Thread

1. Backend loads Thread metadata.
2. Backend returns Agent Session Cache when present and valid.
3. Backend rebuilds blocks from Raw Agent Session reference when cache is absent or stale and provider evidence is available.
4. Agent Runtime remains not started.

### UC-6: Send Follow-Up

1. Backend records the user message as an Agent Session Block.
2. Agent Integration resumes or attaches to the Raw Agent Session when possible.
3. New Raw Agent Frames stream into the reader.
4. Reader appends or updates Agent Session Blocks.

### UC-7: Link Workbench artifact

1. Reader sees evidence for file, diff, browser, command, generated artifact, or link.
2. Reader emits Workbench reference or related artifact block.
3. Missing target renders as unavailable reference, not broken UI.

## Invariants

1. Raw Agent Session remains the source of truth.
2. Agent Session Cache is derived state.
3. Raw Agent Frames are ordered and retain source references.
4. Every provider-derived Agent Session Block has Raw Agent Frame provenance.
5. Local user input blocks have local provenance until provider provenance can be linked.
6. Unknown provider output becomes raw block.
6b. Consumed control signals (hook payloads carried as `type: "provider_signal"`) are transport, not output, and never render as a visible block.
7. Readers interpret only supported provider evidence.
8. Agent Session Blocks are renderer-agnostic.
9. Provider-native labels stay provider-native in user-visible controls.
10. Opening a Thread does not start Agent Runtime by default.

## Tests

This slice adds the following executable expectations before implementation:

| Use Case | Business Rule | Test expectation |
|----------|---------------|------------------|
| UC-1 | BR-1 | A structured fixture message frame emits a user or agent message block. |
| UC-1 | BR-3 | A structured fixture frame with an unknown event type emits `raw_block` with the payload visible. |
| UC-1 | BR-3b | A `hook_payload` frame carrying a consumed `provider_signal` envelope emits no visible block. |
| UC-1 | BR-4 | The same ordered frame list produces the same block ids, statuses, and DTOs. |
| UC-2 | BR-1 | ANSI/text PTY fixture output keeps `rawFallback` when it is not safely parsed. |
| UC-2 | BR-2 | Partial output appends delta frames into one streaming block by stable block id. |
| UC-2 | BR-2 | Completed block updates map to `agentSessionBlock.completed` completion payloads. |
| UC-3 | BR-1 | Approval block choices keep provider-native values. |
| UC-3 | BR-2 | The Desktop rendering contract carries prompt data but has no renderer-side approval mutation. |
| UC-4 | BR-3 | A prompt block and Prompt State can be reconstructed from fixture frames. |
| UC-5 | BR-1 | Re-reading raw fixture frames rebuilds blocks without depending on cached DTOs. |
| UC-5 | BR-3 | Existing hydrate behavior does not call AgentRuntimePort start or resume. |
| UC-6 | BR-3 | A local user input block sorts before subsequent provider output. |
| UC-7 | BR-1 | A Workbench reference targeting the same Thread stays available. |
| UC-7 | BR-2 | A Workbench reference targeting another Thread renders as unavailable. |
| UC-5 | D12 | Rebuilding a codex rollout with `function_call`/`function_call_output` emits ordered `tool_call` + `tool_result` blocks with provider-native tool name and bounded body. |
| UC-5 | D12 | Rebuilding a claude transcript with `tool_use`/`tool_result` emits paired `tool_call` + `tool_result` blocks. |
| UC-1 | D13 | A `tool` role block renders as a tool log entry (tool name label + monospace body), not as a user/agent message turn. |

Future slices keep these documented but do not implement them here:

| Use Case | Business Rule | Deferred expectation |
|----------|---------------|----------------------|
| UC-6 | BR-1 | Real follow-up resume uses provider-native resume behavior. |
| UC-6 | BR-2 | Real resume failure appears as Agent Chat recovery UI. |

## Implementation Notes

- Implement synthetic fixture reader first.
- Add provider-specific readers only after fixtures cover block ordering, fallback, prompts, and cache replay.
- Prefer provider-readable history over PTY screen scraping when tied to the same hidden PTY session.
- Keep PTY Transcript as baseline evidence.
- Keep raw payloads bounded.
- Do not make Agent Session UI parse provider terminal output directly.
- Do not hide raw fallback for unsupported provider behavior.

This slice implementation locations:

- Backend product model: `src/backend/application/domains/agent-session/`.
- Fixture reader: `src/backend/application/services/`.
- Desktop rendering contract DTO: `src/shared/contracts/agent-session-block.ts`.
- Backend-to-Desktop contract adapter: `src/backend/adapters/outbound/desktop-contract/`.

## Open Questions

No user-blocking question remains for this slice.

Deferred to later specs:

1. Raw Agent Frame permanent storage policy belongs with Persistence.
2. PTY Transcript retention amount belongs with Persistence or PTY Transcript implementation.
3. The first real provider reader is selected after fixture behavior is stable and provider evidence is bounded.
