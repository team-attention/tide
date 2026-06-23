# Tide v2 Electron + Node Architecture Decisions

This document records the current best answer for the next Tide v2 implementation direction.

It is intentionally narrow. Tide v2 is a new Electron + Node application. The existing Rust/WGPU app remains archive and reference material. These decisions focus on the essential product problem: a reliable Agent Chat around provider-native coding agents, backed by a hidden PTY transport and provider-owned Raw Agent Session history.

## Current Base Decision

Tide v2 uses:

- Electron + React for the Desktop.
- A process-separated Node Backend for Agent Runtime ownership.
- Shared Contracts for messages crossing the Desktop and Backend boundary.
- Hidden PTY as Agent Runtime transport, not as a visible Terminal renderer.
- Existing Rust/WGPU Tide as archive/reference, not as the v2 code foundation.

Initial source shape:

```text
src/
  backend/
    application/
      domains/
      services/
      ports/
        inbound/
        outbound/
    adapters/
      inbound/
      outbound/
    infrastructure/

  desktop/
    application/
      domains/
      services/
      ports/
        inbound/
        outbound/
    adapters/
      inbound/
      outbound/
    infrastructure/

  shared/
    contracts/
```

## Source Architecture Mental Model

Tide v2 should mirror the useful part of Slice's source architecture: separate application boundaries that each use hexagonal architecture internally.

The top-level boundaries are:

```text
Desktop Application  <->  Shared Contracts  <->  Backend Application
```

This is the MSA-like mental model, but kept inside one Electron app and one source tree. `backend` and `desktop` are separate codebases in practice: each has its own application services, ports, adapters, infrastructure, tests, and ownership rules.

`shared/contracts` is the process-boundary language. It is not the Backend domain and not the Desktop application model.

### Why There Is No `src/core`

Tide should not add a generic `core/` folder above the real product boundaries.

The durable core for provider runtime work lives in `src/backend/application`. The durable core for user-facing UI behavior lives in `src/desktop/application`.

This avoids a vague shared "core" that slowly absorbs unrelated Backend and Desktop concepts. Shared code should exist only when it is a real process-boundary contract.

### Backend Boundary

Backend owns Agent Runtime, Provider Readiness, Provider Signals, PTY Transcript capture, provider-owned Raw Agent Session references, Tide MCP Tool Surface handling, and Agent Session Block production.

```text
src/backend/
  application/
    domains/
      thread/
      agent-runtime/
      agent-session/
      provider-readiness/
      provider-signal/
      workbench/
    services/
      thread-service.ts
      agent-runtime-service.ts
      provider-readiness-service.ts
      provider-signal-service.ts
      agent-session-service.ts
      tide-mcp-tool-service.ts
    ports/
      inbound/
        backend-command-port.ts
        provider-signal-port.ts
        tide-mcp-tool-port.ts
      outbound/
        agent-integration-port.ts
        pty-port.ts
        provider-history-port.ts
        thread-store-port.ts
        app-storage-port.ts
        clock-port.ts
  adapters/
    inbound/
      contract-message-adapter/
      provider-hook-bridge/
      tide-mcp-server/
    outbound/
      agent-integrations/
        codex/
        claude/
        opencode/
      pty/
      provider-history/
      thread-store/
      app-storage/
  infrastructure/
    node/
      backend-entrypoint.ts
      bootstrap/
      resources/
```

Backend direction of dependency:

```text
backend/adapters/inbound
  -> backend/application/ports/inbound
  -> backend/application/services
  -> backend/application/domains
  -> backend/application/ports/outbound
  -> backend/adapters/outbound
```

Provider-specific code belongs under `backend/adapters/outbound/agent-integrations/<agent>/` when Tide calls the provider, and under `backend/adapters/inbound/provider-hook-bridge/` or `backend/adapters/inbound/tide-mcp-server/` when the provider calls Tide.

### Desktop Boundary

Desktop owns Electron windows, menus, React Renderer, Agent Chat presentation, Composer UI, Workbench UI, App Chrome, and user interaction policy.

```text
src/desktop/
  application/
    domains/
      left-rail/
      composer/
      agent-chat/
      app-chrome/
      workbench-layout/
    services/
      left-rail-service.ts
      composer-service.ts
      agent-chat-view-service.ts
      app-chrome-service.ts
      workbench-layout-service.ts
      provider-setup-surface-service.ts
    ports/
      inbound/
        desktop-ui-port.ts
      outbound/
        backend-client-port.ts
        browser-pane-port.ts
        file-dialog-port.ts
        clipboard-port.ts
        shell-open-port.ts
  adapters/
    inbound/
      electron-main/
      electron-preload/
      react-renderer/
    outbound/
      backend-client/
      browser-pane/
      file-dialog/
      clipboard/
      shell-open/
  infrastructure/
    electron/
      main-entrypoint.ts
      preload-entrypoint.ts
      renderer-entrypoint.ts
      backend-process-supervisor.ts
      paths.ts
      permissions.ts
```

Desktop direction of dependency:

```text
desktop/adapters/inbound
  -> desktop/application/ports/inbound
  -> desktop/application/services
  -> desktop/application/domains
  -> desktop/application/ports/outbound
  -> desktop/adapters/outbound
```

React is an inbound adapter. It turns user gestures and render lifecycle events into Desktop application calls. Effects such as Backend IPC, Browser Pane control, clipboard, file dialogs, and shell opening sit behind outbound ports.

> **Reality note (2026-06-12).** The Desktop tree implements this boundary
> without a `ports/` or `services/` directory: the application layer
> (`application/domains/**/state/`) performs **no IO at all** — state
> transitions return command objects (`ProductShellBackendCommand`,
> `AgentChatBackendCommand`) and the inbound adapter forwards them to the
> outbound `backend-client` adapter (effects-as-data instead of injected port
> interfaces). The two port-shaped interfaces that do exist live with their
> adapters: `MessagePortBackendClient` (outbound backend-client) and
> `ProjectRegistryBridge` (renderer→main IPC surface, react-renderer types).
> Backend keeps real `application/ports/outbound/` because its services
> perform IO. If Desktop ever grows an application services layer that calls
> effects directly, introduce the ports listed above at that point — not
> before.

### Shared Contracts Boundary

Shared Contracts carry only serializable process-boundary DTOs:

```text
src/shared/contracts/
  envelope.ts
  commands/
  events/
  dtos/
  errors.ts
  version.ts
```

Backend inbound adapters translate `BackendCommand` DTOs into Backend application service calls. Backend outbound-to-Desktop adapters translate service results and stream updates into `BackendEvent` DTOs.

Desktop outbound Backend client adapters translate Desktop application intent into `BackendCommand` DTOs and translate `BackendEvent` DTOs back into Desktop application state updates.

Default import rule:

```text
shared/contracts may be imported by process-boundary adapters and contract tests.
backend/application should not import shared/contracts.
desktop/application should prefer Desktop view models over raw Backend DTOs.
```

If a shared type starts feeling like a Backend domain object, it belongs in `backend/application/domains`. If it starts feeling like UI state, it belongs in `desktop/application/domains`. Only the wire shape belongs in `shared/contracts`.

### Slice Reference For Desktop/Core Communication

Slice does not currently have `src/shared`. Its `src/desktop/README.md` says shared should be created only for stable contracts genuinely owned by neither `core` nor `desktop`.

The useful Slice communication pattern is:

```text
desktop/application/services
  -> desktop/application/ports/outbound/engine-client-port.ts
  -> desktop/adapters/outbound/runtime-worker or slice-engine-client
  -> core/application/ports/inbound/slice-runtime-api.ts
```

Evidence from Slice:

- `../slice/src/desktop/application/ports/outbound/engine-client-port.ts` defines an `EngineClientPort` with `run(command, input)` plus a narrow command union and envelope response.
- `../slice/src/desktop/adapters/outbound/slice-engine-client/runtime.ts` implements that port by importing `initializeStandaloneRuntime` from `core/application/ports/inbound/slice-runtime-api`.
- `../slice/src/desktop/adapters/outbound/runtime-worker/runtime-worker-client.ts` wraps runtime calls in worker messages shaped like `{ id, command, input }`.
- `../slice/src/desktop/infrastructure/electron/runtime-worker.ts` installs Core Node ports, creates the Desktop runtime service, and answers worker messages.
- `../slice/src/desktop/adapters/inbound/electron-main/ipc-handlers.ts` exposes `slice:runtime`, and `../slice/src/desktop/adapters/inbound/electron-preload/preload.ts` exposes `window.slice.runtime`.

Tide should borrow the port shape and process wiring idea, but not copy the direct Core import model.

Why Tide keeps `shared/contracts`:

- Tide Backend is a long-lived process boundary, not just a per-command worker helper.
- Tide streams Agent Runtime State, Prompt State, Provider Readiness, and Agent Session Block updates, so it needs stable `BackendCommand` and `BackendEvent` envelopes with `RequestId` and `Contract Version`.
- Desktop and Backend should be independently understandable. Desktop should depend on a `BackendClientPort`, not Backend application ports.
- Backend should receive Shared Contract messages through an inbound adapter, not expose Backend domain/services directly to Desktop.

The Tide version of the Slice pattern is:

```text
desktop/application/services
  -> desktop/application/ports/outbound/backend-client-port.ts
  -> desktop/adapters/outbound/backend-client/
  -> shared/contracts BackendCommand envelope
  -> backend/adapters/inbound/contract-message-adapter/
  -> backend/application/ports/inbound
```

This preserves the nice mental model from Slice while making the Desktop/Backend process contract explicit.

### Cross-Boundary Flow

The main runtime flow should read like this:

```text
React Renderer
  -> desktop/adapters/inbound/react-renderer
  -> desktop/application/services
  -> desktop/application/ports/outbound/backend-client-port
  -> desktop/adapters/outbound/backend-client
  -> shared/contracts BackendCommand
  -> backend/adapters/inbound/contract-message-adapter
  -> backend/application/services
  -> backend/application/ports/outbound/agent-integration-port
  -> backend/adapters/outbound/agent-integrations/codex|claude|opencode
  -> hidden PTY provider CLI
```

Provider callback flow:

```text
provider hook or Tide MCP tool call
  -> backend/adapters/inbound/provider-hook-bridge or tide-mcp-server
  -> backend/application/ports/inbound
  -> backend/application/services
  -> Agent Session Block / Prompt State / Workbench command
  -> shared/contracts BackendEvent
  -> desktop/application/services
  -> React Renderer
```

### Architecture Tests

Add an architecture-boundary test early, modeled after Slice's `tests/architecture-boundary.test.ts`.

The initial test should enforce:

- `backend/application` does not import Backend adapters, Backend infrastructure, Electron, React, or Node IO modules directly.
- `desktop/application` does not import Desktop adapters, Desktop infrastructure, Electron, React, Three, Node IO modules, or Backend internals.
- Backend and Desktop application layers do not import each other.
- `shared/contracts` does not import Backend or Desktop.
- Provider-specific Agent Integration code stays under Backend adapters, not Desktop or Shared Contracts.
- Electron process entrypoints stay under Desktop infrastructure.

Layer rule:

- Desktop talks to Backend through Shared Contracts.
- Backend domain, services, and ports keep their own internal model.
- Backend inbound adapters translate Shared Contract messages into service calls.
- Backend infrastructure wires Node, process entrypoints, ports, and concrete adapters.

## 1. Backend Runtime Model

### Current Best Answer

Keep an Agent Runtime alive while the app window is open and the Thread is actively being used.

Start with this simple lifecycle:

1. Opening the app does not eagerly start Agent Runtimes.
2. Opening an existing Thread hydrates its Agent Session from provider-owned history and Tide render cache without starting the Agent Runtime.
3. Sending a message starts or resumes the Thread's Agent Runtime.
4. The Agent Runtime stays alive until the app window closes, the user explicitly stops it, the provider process exits, or Tide restarts it for a visible recovery reason.
5. Active Agent Runtime limits are postponed until there is measured pressure.

### Explanation

The product should feel like a normal chat app: when the user is inside a Thread and sends follow-up messages, the selected Agent should remain ready. Killing the process aggressively would make the app feel unreliable unless hydration and resume are proven to be invisible.

The important distinction is PTY transport versus Terminal rendering. A hidden PTY that reads bytes and stores bounded transcript evidence is not the same cost profile as a visible terminal grid with glyph layout and repainting. The existing Tide renderer was built to solve visible dense terminal rendering. Tide v2 should avoid creating hidden terminal renderers for every Agent Runtime.

Idle policies can come later after measurement. If provider-owned history hydration is fast enough that reopening a Thread feels instant, Tide can add an active-runtime limit and keep only recently active Threads running. That is an optimization, not the initial product model.

PTY Transcript retention means how long Tide keeps raw terminal input/output evidence. The first model should keep:

- A bounded in-memory ring buffer for live debugging and parser recovery.
- A per-Thread file-backed PTY Transcript when a Thread has an active Agent Runtime.
- Provider-owned Raw Agent Session history as the source of truth.

The PTY Transcript is evidence and recovery material. It is not the primary conversation database.

## 2. Provider Integration Contract

### Current Best Answer

Treat this as research-gated, provider-by-provider work.

Each Agent Integration must prove:

- launch command.
- resume command.
- stop behavior.
- Tide MCP Tool Surface bootstrap.
- Provider Readiness checks.
- Directory Trust behavior.
- onboarding behavior.
- hook/bootstrap installation.
- question and permission prompt signatures.
- provider-owned history reference.

### Explanation

Codex, Claude Code, and opencode expose different CLIs/protocols, transcripts, and setup states. Tide should not invent one generic adapter contract and force providers into it before the provider facts are proven.

The stable product contract is:

```text
Agent Integration
  starts/resumes provider CLI in hidden PTY
  attaches Tide MCP Tool Surface when the provider supports MCP
  sends user input
  reads PTY Transcript
  reads Provider Signals
  surfaces Provider Readiness
  emits Agent Session Blocks
```

The unstable provider details stay inside the individual Agent Integration. The contract should be written from observed provider behavior, not from desired symmetry.

MCP attachment is required for Agent-operated app UI. Without it, the Agent can chat and produce text, but it cannot reliably observe or operate Tide-owned Workbench Panes, Browser Pane, Diff/File views, or Thread context. The Agent Integration should therefore bootstrap provider-native MCP config as part of launch.

This does not split one Agent into multiple runtimes. The provider CLI still runs in one hidden PTY. MCP tool calls are a provider-native tool surface attached to that same Agent Runtime, and Tide routes those tool calls back into Backend/Desktop capabilities.

## 3. Agent Session Model

### Current Best Answer

Keep Agent Session Block as the central renderable product unit.

The pipeline stays:

```text
Agent Runtime output
  -> Raw Agent Frame
  -> Agent-specific reader
  -> Agent Session Block
  -> Agent Session UI
```

Raw Agent Session remains provider-owned. Tide stores Thread metadata, provider session references, and an optional Agent Session Cache.

### Explanation

This keeps the UI independent from the provider transport and independent from the renderer. Electron/React can render Agent Session Blocks first. A later renderer can render the same product model if needed.

The Agent Session should preserve the meaningful sequence of the provider session: user messages, agent text, tool calls, command output, approvals, questions, file changes, errors, and raw fallback blocks.

Unknown output becomes a raw fallback block. That keeps the session visible without turning unknown provider behavior into a hard product failure.

## 4. Desktop UX Model

### Current Best Answer

Use a focused Thread-first layout:

- Left Rail: New thread, Search, Pinned, Projects/Scratch or Threads depending on grouping.
- Center: Agent Chat with Agent Session and Composer.
- Workbench: optional visible work area opened by user action or explicit Agent tool use.

The Composer is the active input surface. Agent Session is the narrative/history surface.

### Explanation

The product is no longer a terminal multiplexer first. The default user experience should be a focused Agent Chat. Workbench is available when work needs inspection, verification, editing, browser testing, or direct commands.

Provider questions, permission prompts, and choice prompts should appear at the Composer/active-input level when they require user action. The Agent Session can still record them as part of the narrative.

Start Composer controls Launch Options. Follow-up Composer inherits Thread-bound Agent, Project, Worktree, and Branch choices. The Agent Binding is locked after Thread start unless a later product decision introduces explicit migration.

## 5. Browser Pane / Workbench

### Current Best Answer

Browser Pane is a first-class Workbench Pane in Electron.

Workbench starts minimal:

- Browser Pane for web verification and local preview.
- Diff/File view for reviewing file changes.
- Terminal Pane only when a direct shell surface is needed.

The hidden Agent Runtime is not a Workbench Terminal Pane.

### Explanation

Browser work requires a real browser surface. Electron already provides Chromium-backed web contents, so Tide v2 can use Electron-native browser surfaces instead of rebuilding the current WKWebView path.

The Workbench should not recreate the old terminal-multiplexer product by default. It should exist to support the active Thread. Agent-visible Workbench control can come through Tide-owned tools that observe and operate specific Workbench Panes.

Terminal Pane should be explicit and visible. It is separate from the hidden PTY used to run the Agent Runtime. If a visible Terminal Pane is needed, it can use a terminal UI library such as xterm.js, but hidden Agent Runtimes should not attach visible terminal rendering by default.

Agent-operated Workbench behavior depends on Tide MCP Tool Surface. Browser Pane observe/action, Diff/File inspection, Workbench state observation, and future context-artifact actions should be exposed as Tide-owned MCP tools with bounded inputs and visible effects.

## 6. IPC / Data Flow

### Current Best Answer

Use process separation with a narrow control plane and a bounded data plane.

Initial model:

```text
Desktop Renderer
  -> Desktop Main
  -> Backend process
```

Preferred streaming model after the handshake:

```text
Desktop Main supervises Backend process
Desktop Renderer <-> Backend process through direct MessagePort
```

### Explanation

Electron Main should own app lifecycle, window lifecycle, and Backend process supervision. It should not become the Agent Runtime implementation.

Renderer should not own provider processes or PTYs. It is a UI surface that can reload, crash, or slow down. Backend owns Agent Runtime state.

Agent Session updates should be coalesced and bounded. The Backend should absorb PTY output, persist transcript evidence, read Provider Signals, and send Agent Session Block updates to the Renderer. It should not forward raw PTY firehose directly into React state.

The first implementation can route through Main for simplicity. Direct MessagePort can be introduced when the Agent Session stream needs a cleaner data plane.

## 7. Persistence

### Current Best Answer

Persist only Tide-owned state in Tide storage.

Tide-owned state:

- Thread id.
- title, pin/archive state, created/updated timestamps.
- Agent Binding.
- Project or Scratch scope.
- Execution Context metadata.
- provider-native session reference.
- Last Known State.
- optional Agent Session Cache metadata.
- app settings.

Provider-owned state:

- Raw Agent Session transcript/history.
- provider auth.
- provider onboarding.
- Directory Trust.
- provider-specific settings unless explicitly managed through a supported provider API.

### Explanation

The provider remains the source of truth for conversation history. Tide should not make a parallel conversation database that can diverge from Codex, Claude, or opencode.

Tide needs enough metadata to open, sort, search, and resume Threads. It can also cache rendered Agent Session Blocks for fast open. That cache is derived state and can be rebuilt from provider-owned history when provider signals are available.

Provider Readiness can be cached as last observed status, but the provider remains authoritative. Tide can show setup/trust state and guide the user, while avoiding silent mutation of provider-owned trust or consent state.

## 8. Build / Package

### Current Best Answer

Use a conventional Electron + TypeScript toolchain first:

- npm initially, unless package-manager needs force a change.
- Electron.
- React.
- Vite or electron-vite for renderer development.
- tsup for small Node/backend bundles if useful.
- electron-builder for macOS packaging.
- Node Backend process packaged with the Electron app.

### Explanation

The build system should serve the product architecture rather than become a separate project. Electron + React is already the chosen productivity path. The first build should optimize for understandable local development, tests, and packaged app creation.

The initial package target is macOS. Cross-platform support should stay structurally possible, but the first implementation should avoid abstracting platform packaging before the app shape is working.

Rust is not part of the initial build path. If Rust returns later, it should enter as a focused sidecar or helper binary with a clear product reason, such as a hardened Agent Runtime, hook helper, or heavy indexing path.

## Review Notes

The decisions above prefer direct product paths over generalized fallback systems.

Current intentional deferrals:

- active Agent Runtime limit policy.
- automatic idle shutdown.
- Rust sidecar.
- full provider readiness matrix.
- exact Browser Pane Electron primitive.
- visible Terminal Pane implementation.
- code signing and auto-update detail.

These deferrals need evidence before becoming architecture. The first implementation should prove the core loop:

```text
Thread
  -> Composer
  -> hidden PTY Agent Runtime
  -> Provider Signals
  -> Agent Session Blocks
  -> React Agent Chat
```
