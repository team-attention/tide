# Spec: Desktop Agent Chat and Composer Shell

## Scope

This spec defines the first Desktop UI shell for Agent Chat and Composer.

It covers:

- Thread-first center layout.
- Agent Chat states.
- Agent Session Block rendering surface.
- Start Composer state.
- Follow-up Composer state.
- Prompt State presentation at the active input surface.
- Composer command emission through Shared Contracts.
- keyboard focus order for the first shell.
- basic Workbench opening behavior as layout pressure, not full Workbench tools.

It does not define final visual polish, App Chrome details, Workbench Tab Strip details, Browser Pane implementation, or provider-specific command menus.

## Evidence

- `docs_v2/master-plan.md` says the baseline UX follows Codex App: Left UI, one focused Agent Chat, Composer anchored at the bottom of Agent Chat, and Workbench only when needed.
- `docs_v2/master-plan.md` says Agent Chat owns the conversation narrative, its Composer, and the visible Agent Session.
- `docs_v2/master-plan.md` says before first send, Tide keeps Composer draft state without creating a persistent Thread.
- `docs_v2/master-plan.md` says Start Composer applies selected Agent, Project or Scratch, Worktree, Branch, Permission, and Model values before hidden Agent Runtime starts.
- `docs_v2/master-plan.md` says Follow-up Composer inherits the active Thread's Agent, Project, Worktree, and Branch, and the Agent is locked after Thread start.
- `docs_v2/implementation/electron-node-architecture-decisions.md` says the Composer is the active input surface and Agent Session is the narrative/history surface.
- `docs_v2/research/ui-rendering-surface.md` says React maps well to Agent Session Blocks and browser-native text input gives a stronger base for Korean IME than custom GPU input.
- `docs_v2/research/ui-rendering-surface.md` says CodeMirror is a candidate for code-aware Composer or prompt editor but is not necessary for the first Composer if native textarea is enough.

## Decisions

### D1. Agent Chat is the center surface

Desktop renders Agent Chat as the primary center surface for a selected Thread or first-screen draft.

Workbench opens beside it only when user action or explicit Agent tool use requires it.

### D2. Composer belongs to Agent Chat

Composer is anchored inside Agent Chat, not the whole window.

It remains visible in Start Composer and Follow-up Composer states.

### D3. Agent Session is narrative, Composer is action

Agent Session shows history and runtime narrative.

Composer handles new user input, prompt answers, approvals, and command/menu activation.

### D4. Native textarea is first Composer editor

The first Composer uses browser-native text input, likely a textarea or equivalent React-controlled input.

CodeMirror is deferred until Composer needs code-aware editing, large prompt editing, or structured command editing.

### D5. Start Composer creates Thread on send

Before first send, Desktop may hold draft state but does not create persistent Thread metadata.

On first meaningful send, Desktop sends `thread.start` through Shared Contracts.

### D6. Follow-up Composer sends into existing Thread

Follow-up Composer sends `composer.sendInput` for the active Thread.

Agent, Project, Worktree, and Branch are read-only Thread context after Thread start.

### D7. Prompt State replaces normal send action

When Backend reports active Prompt State, Composer presents the prompt interaction as the active input state.

Submitting the prompt emits `prompt.answer`, not `composer.sendInput`.

### D8. Provider Readiness preserves draft

When Backend reports Provider Readiness blockers, Composer preserves the user's draft and shows the setup/trust state without writing the draft into runtime.

### D9. Hidden Agent Runtime is not rendered

Agent Chat renders Agent Session Blocks and operational states.

It does not render the hidden Agent Runtime as a terminal by default.

## Out Of Scope

- Final typography, color, icon set, and animation.
- Status Bar and top chrome.
- Workbench Tab Strip and Pane toolbars.
- Provider-specific slash command discovery.
- Rich text Composer.
- CodeMirror integration.
- Browser Pane internals.
- Accessibility implementation details beyond focus and labeling requirements.

## Domain Model

### Agent Chat state

Initial states:

| State | Meaning |
|-------|---------|
| `empty` | No Thread is selected; Start Composer may hold draft state. |
| `hydrating` | Existing Thread is opening and Backend is loading metadata or cache. |
| `ready` | Thread is open and idle. |
| `running` | Agent Runtime has active work. |
| `waiting_for_input` | Prompt State needs a question, choice, or command picker answer. |
| `waiting_for_approval` | Prompt State needs approval or permission. |
| `provider_not_ready` | Provider Readiness blocks runtime input. |
| `failed` | Backend reported recoverable Thread or runtime failure. |

### Start Composer

Start Composer controls:

- text input.
- selected Agent chip.
- Project or Scratch control.
- Worktree Option.
- Branch Option.
- Permission Chip.
- Model Chip.
- Composer Options menu.
- send action.

### Follow-up Composer

Follow-up Composer controls:

- text input.
- attach/context control.
- Composer Options menu.
- read-only Thread context access.
- send action.
- prompt answer action when Prompt State is active.

### Composer Options

Composer Options is a searchable menu.

Before Thread start, it can expose less-common Launch Options.

After Thread start, it can expose attach/context controls and supported provider-native In-Session Commands.

## Contracts

Desktop sends Shared Contract commands:

| UI action | BackendCommand |
|-----------|----------------|
| First meaningful send | `thread.start` |
| Open existing Thread | `thread.hydrate` |
| Follow-up send | `composer.sendInput` |
| Prompt answer | `prompt.answer` |
| Stop active runtime | `agentRuntime.stop` |
| Open Workbench surface | `workbench.command` |

Desktop consumes BackendEvents:

| Event | UI effect |
|-------|-----------|
| `thread.hydrated` | Render Thread metadata and cached blocks. |
| `thread.started` | Switch from Start Composer to Follow-up Composer. |
| `agentRuntime.stateChanged` | Update Agent Chat state. |
| `providerReadiness.changed` | Show setup/trust blocker and preserve draft. |
| `prompt.changed` | Switch Composer into prompt answer mode or clear it. |
| `agentSessionBlock.upserted` | Upsert visible block. |
| `agentSessionBlock.completed` | Complete or fail visible block. |
| `contract.error` | Show recoverable error state. |

## Flow

### UC-1: First launch draft

1. Desktop shows Left UI and empty Agent Chat.
2. Start Composer is visible.
3. User types a draft.
4. No persistent Thread is created before send.

### UC-2: Start Thread

1. User sends first meaningful input.
2. Desktop builds `thread.start` with draft and Launch Options.
3. Backend accepts or returns Provider Readiness blockers.
4. If accepted, Desktop switches to running/hydrating state and then Follow-up Composer.
5. Agent Session Blocks stream into Agent Chat.

### UC-3: Continue Thread

1. User opens existing Thread.
2. Desktop sends `thread.hydrate`.
3. Agent Chat renders cached or rebuilt Agent Session Blocks.
4. Follow-up Composer appears with inherited Thread context.
5. Sending input emits `composer.sendInput`.

### UC-4: Answer provider prompt

1. Backend emits Prompt State.
2. Composer switches to prompt answer mode.
3. User answers through prompt controls or Composer text input.
4. Desktop emits `prompt.answer`.
5. Composer returns to normal Follow-up mode after prompt clears.

### UC-5: Workbench opens beside Agent Chat

1. User or explicit Agent tool use opens a Workbench surface.
2. Agent Chat remains the narrative area.
3. Composer stays anchored in Agent Chat.
4. Layout adapts to `Left UI | Agent Chat | Workbench`.

## Invariants

1. Composer is always scoped to the current Agent Chat.
2. Start Composer does not create persistent Thread metadata before first meaningful send.
3. Follow-up Composer uses the Thread's locked Agent Binding.
4. Prompt State changes the submit target to `prompt.answer`.
5. Provider Readiness blockers preserve unsent user draft.
6. Desktop does not spawn Agent Runtime processes or PTYs.
7. Agent Chat renders Agent Session Blocks, not the hidden PTY terminal.
8. Workbench does not replace Agent Chat as the narrative area.
9. CodeMirror is not part of the first Composer unless a later spec reopens the editor requirement.

## Tests

| Rule | Test expectation |
|------|------------------|
| Draft does not create Thread | Typing in Start Composer changes local draft state but sends no BackendCommand. |
| First send creates Thread | Sending non-empty draft emits `thread.start` with Launch Options. |
| Empty send is blocked | Empty or whitespace-only Start Composer send emits no command. |
| Follow-up sends input | Follow-up Composer emits `composer.sendInput` with active Thread id. |
| Prompt answer routes correctly | Active Prompt State changes submit command from `composer.sendInput` to `prompt.answer`. |
| Provider readiness preserves draft | Readiness blocker leaves draft text intact and shows blocked state. |
| Thread context is read-only after start | Follow-up Composer does not expose editable Agent, Project, Worktree, or Branch controls inline. |
| Agent Session block stream renders | `agentSessionBlock.upserted` adds or updates one visible block. |
| Hidden runtime is not terminal UI | Running state does not mount a visible Terminal Pane for Agent Runtime. |

## Implementation Notes

- Build this as a React shell under `src/desktop/renderer`.
- Keep UI state reducers separate from Shared Contract definitions.
- Use browser-native input behavior for IME, selection, copy, paste, and focus in the first Composer.
- Add component tests for command emission and state transitions before visual polish.
- Keep Composer Options shallow in the first shell; detailed provider command menus belong to later provider feature specs.
- Do not put global Thread queues or status dashboards inside Agent Chat.
