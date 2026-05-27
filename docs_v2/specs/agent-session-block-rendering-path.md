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
- Agent Session Cache as derived state.
- reopen behavior without starting Agent Runtime.

It does not define React components, visual styling, full provider parser grammar, persistence storage layout, or Workbench tool operation contracts.

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

When the user sends Composer input, Backend may create a local user message block before provider output exists.

That block uses local provenance and is later linked to provider frames when the provider history exposes the submitted input.

### D9. Reopen does not start runtime

Opening an existing Thread renders cached or rebuilt Agent Session Blocks without starting Agent Runtime by default.

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
| `agentId` | Codex, Claude, or Antigravity. |
| `lane` | Evidence lane such as PTY Transcript, Provider Signal, provider history, structured batch, stdout, or stderr. |
| `sourceRef` | Provider session id, transcript path, rollout path, log path, PTY offset, or stream offset. |
| `sequence` | Monotonic order in one Thread observation stream. |
| `observedAt` | Tide observation time. |
| `payloadKind` | json, text, ansi text, stdout, stderr, provider record, or binary summary. |
| `payload` | Bounded raw payload. |
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

### UC-6: Link Workbench artifact

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
7. Readers interpret only supported provider evidence.
8. Agent Session Blocks are renderer-agnostic.
9. Provider-native labels stay provider-native in user-visible controls.
10. Opening a Thread does not start Agent Runtime by default.

## Tests

| Rule | Test expectation |
|------|------------------|
| Known structured messages render as conversation blocks | A fixture frame with known message type emits a user or agent message block. |
| Unknown structured events render as raw blocks | A fixture frame with unknown event type emits raw block with payload visible. |
| Reader output is stable | Same ordered frame list produces the same block ids and statuses. |
| PTY output preserves raw fallback | ANSI/text PTY fixture retains raw fallback when not safely parsed. |
| Partial output streams | Reader updates one streaming block by stable block id. |
| Approval uses provider-native labels | Approval block choices keep provider-native values. |
| Renderer cannot auto-approve | Reader/UI tests expose prompt state but no renderer-only approval mutation path. |
| Question state survives reopen | Cached prompt block and Prompt State can be reconstructed from cache/provider evidence. |
| Cache is derived | Rebuild test can discard cache and recover blocks from Raw Agent Session fixture. |
| Reopen does not start runtime | Reopen path does not call AgentRuntimePort.start or resume. |
| Follow-up user block precedes output | Local user message block sorts before frames caused by that input. |
| Workbench reference is scoped | Workbench reference points to Thread-owned state or renders unavailable. |

## Implementation Notes

- Implement synthetic fixture reader first.
- Add provider-specific readers only after fixtures cover block ordering, fallback, prompts, and cache replay.
- Prefer provider-readable history over PTY screen scraping when tied to the same hidden PTY session.
- Keep PTY Transcript as baseline evidence.
- Keep raw payloads bounded.
- Do not make Agent Session UI parse provider terminal output directly.
- Do not hide raw fallback for unsupported provider behavior.
