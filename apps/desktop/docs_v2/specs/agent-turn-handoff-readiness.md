# Spec: Agent Turn Handoff Readiness

## Scope

Unify how the FIRST user turn is delivered to a freshly spawned Agent Runtime,
behind one shared "turn handoff" path gated by a per-integration **readiness
gate**. Remove the two sources of fragmentation that exist today:

- the first prompt is delivered differently per provider CLI, and
- a blind `inputTiming.startupDelayMs` timer stands in for "the runtime is ready".

In scope:

- A `RuntimeReadinessGate` each Agent Integration declares.
- One delivery path: `spawn → await gate(runtimeId) → deliverFirstInput`.
- A real signal for the `tool_surface_ready` gate: the runtime's Tide MCP server
  handshake (`tools/list`) observed for that `runtimeId`, plus a small bounded
  settle to absorb a provider's post-discovery tool-registration lag.

Out of scope:

- The `AgentRuntimeEvent` turn-detection stream ([[agent-runtime-event-spine]]).
- Provider Readiness preflight / directory trust (separate specs).
- Resume flow prompt delivery (resume carries no initial prompt).

## Evidence

Observed 2026-06-07 with codex-cli 0.136.0 (gpt-5.5) driving Tide v2:

- Codex connects to the Tide MCP server, completes `initialize` + `tools/list`
  (confirmed at the bridge), the model emits a `tide_open_browser` function_call
  (rollout), but codex never sends `tools/call` to the bridge → the turn hangs
  "Working…" forever. Raw-stdin trace at the bridge proved the call is never sent.
- This matches codex#19425 / #20771: a regression (codex ≥0.124, worked at 0.91)
  where MCP tools are discovered via `tools/list` but not registered into the
  per-thread tool surface before the turn runs.
- v1 (Rust) drives the SAME codex and works, because it types the prompt into the
  TUI AFTER startup — codex finishes tool registration before the turn begins. v2
  passes the prompt as a launch argv `[PROMPT]`, so the turn starts before
  registration completes and loses the race.
- Current code: `codexLaunchPlan`/`claudeLaunchPlan` append `initialPrompt` to argv;
  `AgentIntegrationAgentRuntimePort.start` sets `deliverPromptViaLaunch =
  runtimeSource.kind === "provider_cli"` and skips `writeInput`; `writeInput` awaits
  `waitForStartupWindow` (`startupDelayMs` sleep).

## Decisions

- D1: The first prompt is NEVER embedded in launch argv. Every agent receives its
  first turn through the same `deliverFirstInput` path after its gate opens.
- D2: Gate kinds: `immediate` and `tool_surface_ready`. Each Agent Integration
  declares one uniformly. Current assignment:
  - codex → `tool_surface_ready` + gated post-launch `writeInput`. codex hits the
    codex#19425 registration race, so its first prompt MUST NOT be at launch.
  - claude → `immediate` + launch-time positional prompt. claude registers its MCP
    tools before the turn and reliably accepts the launch prompt; routing it through
    TUI-typing-after-gate was observed to drop the prompt (turn never answered), so
    claude keeps its proven launch delivery.
  - gemini → `immediate` through its structured runtime start path.
  - opencode → `immediate` through its structured runtime start path.
  The READINESS GATE is the uniform abstraction; the delivery transport differs only
  where a provider's launch behavior demands it (codex), recorded here rather than
  scattered as ad-hoc per-agent branching.
- D3: `tool_surface_ready` opens on the real signal — the runtime's Tide MCP
  `tools/list` observed for that `runtimeId` — then waits a small bounded settle
  (`toolSurfaceSettleMs`, default 400ms) to absorb provider tool-registration lag.
  The settle is a single tunable property of the gate, not a per-agent timer.
- D4: A bounded fallback timeout (`gateTimeoutMs`, default 8000ms) still delivers
  the prompt if the signal never arrives (e.g. an agent that does not list tools),
  so the gate can never hang a turn.
- D5: Per-runtime readiness is observable because the Tide MCP `tools/list`
  internal request now carries the caller `session` (it already does for
  `call_tool`); the Backend marks `runtimeId` ready on that request.

- D6: **Tide MCP tool authorization.** Tide injects its own first-party MCP server
  (`tide`: browser/file/terminal/observe tools), so its tools are pre-approved in each
  provider's bootstrap config — no runtime permission prompt (granted in config, like
  directory trust). Other (user/3rd-party) MCP servers and tools keep the agent's
  NATIVE approval flow, so behavior matches using the coding agent in a plain terminal.
  - codex: `-c mcp_servers.tide.default_tools_approval_mode="approve"`.
  - claude: settings.json `permissions.allow: ["mcp__tide"]`.
  - antigravity: OPEN — verify whether it prompts for MCP tools and find its config.
  Without this, codex's hidden-PTY per-tool approval prompt is invisible and the turn
  hangs "Working" forever (the agent waits for an answer before sending tools/call).

## Out Of Scope

- Changing turn-END detection, streaming, queuing, interrupt.
- Resume (`buildResumePlan`) prompt delivery — resume has no initial prompt.

## Domain Model

- `RuntimeReadinessGate = { kind: "immediate" } | { kind: "tool_surface_ready" }`.
  Declared by each Agent Integration via `AgentIntegrationPort.initialTurnReadiness()`.
- `RuntimeReadinessRegistry` (Backend application service): per-`runtimeId`
  tool-surface readiness. `markToolSurfaceReady(runtimeId)` resolves a waiter;
  `awaitToolSurface(runtimeId, { settleMs, timeoutMs })` resolves on signal+settle
  or on timeout; `forget(runtimeId)` on teardown.

## Contracts

- Internal Tide MCP socket request `tide_mcp/list_tools` params gain an optional
  `session` (mirrors `call_tool`). No change to the public MCP protocol surface.
- No Shared Contract (renderer↔backend) change.

## Flow

1. `start()` generates `runtimeId`, builds the launch plan (NO prompt argv),
   spawns the runtime.
2. The Backend records the initial prompt for the runtime and resolves the gate:
   - `immediate` → resolve now.
   - `tool_surface_ready` → `registry.awaitToolSurface(runtimeId, …)`.
3. When the spawned agent's Tide MCP server sends `tools/list` (carrying its
   `session.runtimeId`), the Backend calls `registry.markToolSurfaceReady`.
4. Gate opens (signal+settle, or timeout) → `deliverFirstInput(handle, prompt)` via
   the uniform `writeInput` path.

## Invariants

- No agent ever receives its first prompt as a launch argv.
- A turn's first input is delivered at most once, after the gate opens.
- The gate cannot hang a turn: it always resolves within `gateTimeoutMs`.
- `tools/list` for an unknown/absent `runtimeId` is a no-op for readiness.

## Tests

- `start` for a provider_cli agent does not put `initialPrompt` in `plan.args`.
- `start` delivers the first input via `writeInput` after the gate opens (fake
  registry: input not written before `markToolSurfaceReady`, written after).
- `immediate` gate delivers without any tool-surface signal.
- gate timeout delivers the prompt even if `markToolSurfaceReady` is never called.
- `RuntimeReadinessRegistry`: `awaitToolSurface` resolves after `mark…` + settle;
  resolves on timeout otherwise; `mark…` before `await…` still resolves (latched).
- bridge `listTools` includes `session`; Backend socket handler marks readiness
  from a `tide_mcp/list_tools` carrying a `runtimeId`.

## Implementation Notes

- Remove `promptArgs` from `codexLaunchPlan`/`claudeLaunchPlan`; drop
  `deliverPromptViaLaunch`; always `writeInput` the first prompt after the gate.
- Keep `waitForStartupWindow`/`preSubmitDelayMs` only as PTY submit pacing (typing
  cadence), not as the readiness mechanism.
- Wire `RuntimeReadinessRegistry` in `live-backend.ts` into both the runtime port
  and the Tide MCP socket request handler.
- `RuntimeReadinessRegistry` is a small application service (one responsibility:
  per-runtime tool-surface readiness latch). It is not provider-specific.
