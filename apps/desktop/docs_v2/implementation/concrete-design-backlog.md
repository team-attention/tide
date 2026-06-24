# Tide v2 Concrete Design Backlog

This document lists the design areas that must be made concrete before implementation plans are written.

It builds on:

- [Master Plan](../master-plan.md)
- [Electron + Node Architecture Decisions](electron-node-architecture-decisions.md)
- [Agent Session Rendering](agent-session-rendering.md)

The goal is to keep design work focused on the product core:

```text
Thread
  -> Composer
  -> hidden PTY Agent Runtime
  -> Provider Signals
  -> Tide MCP Tool Surface
  -> Agent Session Blocks
  -> Agent Chat and Workbench UI
```

This is not an implementation task list. Each section explains the design area, compares realistic options, records the best option, and lists what still needs exact specification.

## 1. Shared Contracts

### What This Is

Shared Contracts are the serializable command and event shapes exchanged between Desktop and Backend.

Initial contract families:

- BackendCommand.
- BackendEvent.
- AgentSessionBlock DTO.
- ProviderReadiness DTO.
- Prompt and permission DTO.
- Thread metadata DTO.
- Workbench tool command/result DTO.

### Options

| Option | Description |
|--------|-------------|
| A. Shared contract module | Put process-boundary DTOs under `src/shared/contracts/` and import them from Desktop and Backend inbound adapters. |
| B. Duplicate frontend/backend types | Define similar message shapes separately in Desktop and Backend, relying on tests to keep them aligned. |
| C. Backend domain as contract | Let Desktop import Backend domain/service types directly. |

### Comparison

| Option | Strength | Cost |
|--------|----------|------|
| A. Shared contract module | One explicit wire language; easy to test; keeps process boundary visible. | Requires mapping between Backend domain and contract DTOs. |
| B. Duplicate frontend/backend types | Keeps each side independent. | Drift risk is high; every change requires manual sync. |
| C. Backend domain as contract | Fast at first. | Couples Desktop to Backend internals and weakens the hexagonal boundary. |

### Best Option

Use Option A: `src/shared/contracts/`.

Shared Contracts should represent what crosses the Desktop/Backend boundary. Backend domain, services, and ports should not import them. Backend inbound adapters translate contract messages into service calls, then map service results back into contract events.

### Must Specify

- Command envelope shape.
- Event envelope shape.
- Request/response correlation id.
- Error shape.
- Streaming update shape.
- Version field or compatibility policy.
- Which DTOs are stable product contracts versus temporary implementation DTOs.

## 2. Backend Domain And Services

### What This Is

Backend owns the product runtime model behind Agent Chat.

Core domain concepts:

- Thread.
- Agent Binding.
- Agent Runtime.
- Agent Integration.
- Provider Readiness.
- Raw Agent Frame.
- Agent Session Block.
- PTY Transcript.
- Tide MCP Tool Surface.
- Workbench reference.

Core services:

- start Thread.
- hydrate Thread.
- start or resume Agent Runtime.
- send Composer input.
- answer prompt.
- stop Agent Runtime.
- read Provider Signals.
- build Agent Session Blocks.
- expose Tide MCP tools.

### Options

| Option | Description |
|--------|-------------|
| A. Backend hexagonal core | Keep Backend domain/services/ports/adapters/infrastructure separate. |
| B. Electron main owns backend logic | Put Thread, Agent Runtime, PTY, and Provider logic directly in Electron Main. |
| C. Renderer owns agent state | Let React own Thread state and call process/PTY APIs through IPC. |

### Comparison

| Option | Strength | Cost |
|--------|----------|------|
| A. Backend hexagonal core | Preserves clear product model; testable without UI; isolates provider complexity. | More initial structure than a single main-process file. |
| B. Electron main owns backend logic | Quick for a prototype. | Main becomes a mixed app lifecycle and domain layer; hard to test and evolve. |
| C. Renderer owns agent state | Easy UI iteration. | Renderer reloads or slow rendering can disrupt runtime ownership; weak security boundary. |

### Best Option

Use Option A: a Backend hexagonal core.

Desktop renders and sends user intent. Backend owns provider processes, PTY input/output, provider-local session references, readiness, and Agent Session Block production. The domain should stay small and should not model UI layout or visual details.

### Must Specify

- Thread lifecycle states.
- Agent Runtime lifecycle states.
- Prompt states: question, approval, permission, choice, command picker.
- Raw Agent Frame identity and ordering.
- Agent Session Block identity and update behavior.
- How Tide MCP tool calls become Backend service calls.
- Which state belongs to Backend domain versus Desktop UI.

## 3. Agent Integration Detail

### What This Is

Agent Integration is the provider-specific layer for Codex CLI, Claude Code, and opencode.

Each Agent Integration owns:

- launch command.
- resume command.
- stop behavior.
- Provider Readiness detection.
- Directory Trust detection.
- onboarding handling.
- hook/bootstrap setup.
- Tide MCP Tool Surface bootstrap.
- Provider Signal readers.
- prompt and permission signature readers.
- provider-owned session reference extraction.

### Options

| Option | Description |
|--------|-------------|
| A. Provider-specific integrations behind one capability contract | Build Codex, Claude, and opencode integrations separately, then expose confirmed capabilities through a shared Tide contract. |
| B. One generic CLI adapter | Treat all providers as the same interactive CLI shape and normalize details immediately. |
| C. Shell-only integration | Do not attach hooks or MCP; interact through PTY text only. |

### Comparison

| Option | Strength | Cost |
|--------|----------|------|
| A. Provider-specific integrations | Matches real provider differences; supports hooks, MCP, readiness, and history accurately. | Requires research and smoke per provider. |
| B. One generic CLI adapter | Looks simpler on paper. | Hides provider differences until they break prompt handling, resume, or readiness. |
| C. Shell-only integration | Minimal launch path. | Cannot reliably operate Workbench UI or capture structured Provider Signals. |

### Best Option

Use Option A.

Provider behavior is not symmetrical. The shared contract should describe what Tide needs, while each Agent Integration owns how its provider exposes those capabilities.

The existing Tide wrappers prove the basic pattern: launch the provider CLI through a Tide-owned wrapper, attach hooks, attach MCP, and route provider signals back to Tide. In v2 this moves from visible Terminal Pane integration to Thread-scoped hidden Agent Runtime integration.

### Must Specify

- Codex launch/resume/MCP/hook/readiness path.
- Claude launch/resume/MCP/hook/readiness path.
- opencode launch/resume/MCP/vendor/readiness path.
- Provider Readiness preflight command or observation method.
- Provider-owned history reference format per provider.
- Prompt and permission payload examples per provider.
- How hook response paths are handled when supported.

## 4. Backend Process Lifecycle

### What This Is

Backend process lifecycle defines who starts Backend, who owns Agent Runtime processes, and how Desktop reconnects.

Initial ownership:

- Desktop Main starts and supervises Backend.
- Backend owns Agent Runtime processes.
- Desktop Renderer does not spawn provider processes or PTYs.
- Desktop Renderer may receive a direct MessagePort to Backend after Main creates the connection.

### Options

| Option | Description |
|--------|-------------|
| A. Electron utilityProcess Backend | Desktop Main starts a Node-capable Electron utilityProcess and connects it to Renderer with MessagePort. Backend owns PTYs and providers. |
| B. Child process Backend | Desktop Main starts a Node child process and communicates over stdio, IPC, or a local socket. |
| C. Backend in Electron Main | No separate process; Main owns PTYs and providers directly. |
| D. Backend in Renderer | Renderer owns all app and runtime state. |

### Comparison

| Option | Strength | Cost |
|--------|----------|------|
| A. Electron utilityProcess Backend | Fits Electron's process model; supports MessagePort data plane; isolates Agent Runtime from React rendering and reloads. | Requires validating native dependency packaging for PTY support. |
| B. Child process Backend | Simple Node process semantics and familiar debugging. | MessagePort-style direct Renderer connection is less natural. |
| C. Backend in Electron Main | Fewer moving pieces at first. | Main process becomes mixed app lifecycle and domain/runtime layer. |
| D. Backend in Renderer | Simplest data access for UI. | Runtime becomes coupled to the most volatile process. |

### Best Option

Use Option A: Electron utilityProcess Backend.

React rendering, reloads, and UI errors should not interrupt PTY reading or provider process ownership. Backend must continue to absorb output, persist evidence, and maintain runtime state even if Desktop Renderer is slow or reconnecting.

Desktop Main is a supervisor and handshake layer, not an Agent Runtime implementation.

### Must Specify

- Backend process entry.
- Main to Backend spawn protocol.
- Renderer to Backend connection protocol.
- reconnect behavior after Renderer reload.
- Backend crash behavior.
- app close behavior.
- active Agent Runtime shutdown behavior.
- event buffering during reconnect.

## 5. Persistence

### What This Is

Persistence defines what Tide stores, what the provider stores, and how a Thread reopens.

Tide-owned storage:

- Thread id.
- Thread title.
- pin/archive state.
- created/updated timestamps.
- Agent Binding.
- Project or Scratch scope.
- Execution Context metadata.
- provider-native session reference.
- Last Known State.
- Agent Session Cache metadata.
- app settings.

Provider-owned storage:

- Raw Agent Session transcript/history.
- provider auth.
- provider onboarding.
- Directory Trust.
- provider-specific settings unless explicitly managed through a supported provider API.

### Options

| Option | Description |
|--------|-------------|
| A. Provider-owned history plus Tide metadata | Store Thread metadata and provider session refs in Tide; use provider history as source of truth. |
| B. Tide-owned full transcript database | Copy or reconstruct all conversation history into Tide-owned storage. |
| C. No Tide persistence | Depend entirely on provider history and reconstruct Thread list dynamically. |

### Comparison

| Option | Strength | Cost |
|--------|----------|------|
| A. Provider-owned history plus Tide metadata | Preserves provider truth; lets Tide own product navigation and resume refs. | Requires careful hydration and cache invalidation. |
| B. Tide-owned full transcript database | Fast local UI queries. | Risk of divergence from provider history; more migration and storage work. |
| C. No Tide persistence | Minimal storage. | Cannot provide reliable Thread list, pins, archive, titles, or Project grouping. |

### Best Option

Use Option A.

Provider-local history remains the conversation source of truth. Tide stores enough metadata to reopen, sort, resume, and render Threads quickly. Any Agent Session Cache is derived state.

### Must Specify

- app data root.
- Thread metadata file or database shape.
- provider session reference shape.
- Agent Session Cache format.
- PTY Transcript ring buffer and file policy.
- cache invalidation rules.
- migration policy for early versions.

## 6. Desktop UX Layout

### What This Is

Desktop UX layout defines the main visible product structure.

Target layout:

```text
Left Rail | Agent Chat | Workbench
```

Default surfaces:

- Left Rail for work history.
- Agent Chat for Agent Session and Composer.
- Workbench only when needed.

### Options

| Option | Description |
|--------|-------------|
| A. Thread-first layout | Left Rail, focused Agent Chat, optional Workbench. |
| B. IDE-first layout | Project/FileTree/Workbench dominate the first screen. |
| C. Terminal-first layout | Terminal or Workbench is the primary starting surface. |

### Comparison

| Option | Strength | Cost |
|--------|----------|------|
| A. Thread-first layout | Matches Codex App alternative goal; keeps Composer and Agent Session central. | Workbench must be discoverable without dominating. |
| B. IDE-first layout | Familiar to code editors. | Pulls product toward project-first IDE behavior. |
| C. Terminal-first layout | Reuses old Tide mental model. | Reintroduces the terminal multiplexer thesis v2 is moving away from. |

### Best Option

Use Option A.

The product is a focused coding-agent chat app, not a terminal multiplexer and not a project-first IDE. Workbench exists to support the active Thread when visible inspection, editing, verification, or direct commands are needed.

### Must Specify

- first launch center state.
- Thread list row density.
- Project/Scratch grouping behavior.
- Agent Chat empty, loading, running, waiting, failed, and completed states.
- Composer placement and resize behavior.
- responsive behavior when Workbench opens.
- keyboard focus order across Left Rail, Agent Chat, Composer, and Workbench.

## 7. App Chrome And Micro-Interactions

### What This Is

App Chrome is the compact non-content UI around Agent Chat and Workbench.

Chrome surfaces to design:

- top title/chrome area.
- status bar.
- Workbench Tab Strip.
- Workbench Pane toolbars.
- Composer chrome.
- compact icon buttons.
- attention dots and activity indicators.
- small menus and popovers.

### Options

| Option | Description |
|--------|-------------|
| A. Minimal Thread-scoped chrome | Keep chrome compact; show only operational state and local commands. |
| B. Rich dashboard chrome | Put global queues, provider settings, activity, and controls in persistent bars. |
| C. Mostly hidden chrome | Hide most small controls behind menus and hover states. |

### Comparison

| Option | Strength | Cost |
|--------|----------|------|
| A. Minimal Thread-scoped chrome | Keeps Agent Chat primary while preserving precise controls. | Requires careful decisions about what earns visibility. |
| B. Rich dashboard chrome | Exposes many controls. | Competes with Agent Chat and risks visual noise. |
| C. Mostly hidden chrome | Looks clean. | Hurts discoverability and repeated Workbench workflows. |

### Best Option

Use Option A.

Design App Chrome as a compact command surface, not as another navigation system. Status, tabs, and small buttons should reveal state and commands without competing with the Composer or Thread narrative.

### Must Specify

- What belongs in top chrome versus status bar.
- Whether the status bar is global, Thread-scoped, or Workbench-scoped.
- Which Agent Runtime states appear in chrome.
- Which Provider Readiness states appear in chrome.
- Workbench Tab Strip layout, overflow, close, pin, split, and focus behavior.
- Icon button set and tooltip rules.
- Disabled/loading/active states.
- Hover-only versus always-visible actions.
- Keyboard and screen-reader labels.
- Visual density rules for compact controls.

### Initial Guidance

Keep the status bar narrow. It should show operational state, not become a dashboard.

Good status candidates:

- Backend connected/disconnected.
- selected Agent.
- Agent Runtime running/idle/waiting.
- Provider Readiness issue.
- active Project/Branch when Workbench is open.

Bad status candidates:

- full provider settings.
- global Thread queues.
- every possible Agent feature.
- permanent logs.

Workbench tabs should represent visible Workbench Panes only. They should not include the hidden Agent Runtime.

## 8. Workbench And Tide MCP Tools

### What This Is

Workbench is the visible support area inside a Thread. Tide MCP Tool Surface lets the Agent observe and operate it.

Initial tool groups:

- observe Thread/Workbench state.
- open Browser Pane.
- observe Browser Pane.
- act on Browser Pane.
- open Diff/File view.
- read Diff/File state.
- open Terminal Pane when explicitly needed.
- create/read/send context artifacts.

### Options

| Option | Description |
|--------|-------------|
| A. Tide-owned MCP tools | Expose Workbench operations through provider-attached Tide MCP tools. |
| B. External browser/shell delegation | Let agents use shell commands, external browser automation, or provider tools without Tide-specific Workbench tools. |
| C. Human-only Workbench | Workbench is visible to humans, but agents cannot operate it directly. |

### Comparison

| Option | Strength | Cost |
|--------|----------|------|
| A. Tide-owned MCP tools | Preserves Thread, Workbench, Browser Pane, and visible UI context. | Requires bounded tool contracts and authorization rules. |
| B. External browser/shell delegation | Uses existing provider capabilities. | Loses Tide UI identity and can create second runtimes. |
| C. Human-only Workbench | Simplest Workbench implementation. | Prevents the core agent-operated UI workflow. |

### Best Option

Use Option A.

If Agents are expected to use the app UI, they need tools that operate Tide-owned surfaces. Shell commands or external browser automation do not preserve Thread, Workbench, and visible UI context.

MCP tools are attached to the same provider CLI session. They do not create a second Agent Runtime.

### Must Specify

- tool names.
- tool input/output DTOs.
- authorization rules.
- visible side effects.
- observe-before-action discipline.
- Browser Pane page map strategy.
- Workbench Pane identity and stale reference handling.
- human/agent shared control rules.

## 9. Build And Test Scaffold

### What This Is

Build and test scaffold defines how the new Electron + Node app is developed, checked, and packaged.

Initial tooling:

- npm.
- Electron.
- React.
- electron-vite.
- electron-builder for macOS package.
- Vitest.

### Options

| Option | Description |
|--------|-------------|
| A. Simple Electron + TypeScript scaffold | One app source tree with electron-vite, React, Vitest, electron-builder, and boundary tests. |
| B. Custom Vite + tsup scaffold | Wire Electron main, preload, renderer, and Backend bundles manually. |
| C. Monorepo packages from day one | Split Desktop, Backend, and Shared Contracts into workspace packages immediately. |
| D. Existing Rust workspace integration | Keep the current Rust workspace as the primary scaffold and add Electron around it. |

### Comparison

| Option | Strength | Cost |
|--------|----------|------|
| A. Simple Electron + TypeScript scaffold | Direct support for Electron main/preload/renderer; easy to understand and iterate; enough for first product loop. | May need package split later. |
| B. Custom Vite + tsup scaffold | Maximum control over bundle outputs. | More build plumbing before the product loop exists. |
| C. Monorepo packages from day one | Clear package boundaries. | More tooling and dependency overhead before the product loop exists. |
| D. Existing Rust workspace integration | Preserves old repo shape. | Keeps v2 constrained by the archived implementation. |

### Best Option

Use Option A: simple Electron + TypeScript scaffold with electron-vite, React, Vitest, and electron-builder.

The build should make the architecture easy to run, test, and package. It should not introduce extra workspace complexity before the first product loop works.

### Must Specify

- package scripts.
- dev run command.
- packaged run command.
- test command.
- typecheck command.
- architecture boundary test rules.
- fake provider test harness.
- fake PTY test harness.
- minimal CI gates.

## First Concrete Spec Sequence

The first implementation specs should be written in this order:

1. Shared Contracts.
2. Backend Thread and Agent Runtime lifecycle.
3. Provider Integration bootstrap for one provider.
4. Agent Session Block rendering path.
5. Desktop Agent Chat and Composer shell.
6. Backend/Desktop process connection.
7. Tide MCP Tool Surface for Workbench observe/open-browser.
8. App Chrome and Workbench Tab Strip.
9. Persistence.
10. Build and package.

This order keeps the first slice focused on one real loop before expanding UI chrome and Workbench depth.
