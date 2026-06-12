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

- `docs_v2/master-plan.md` says the baseline UX follows Codex App: Left Rail, one focused Agent Chat, Composer anchored at the bottom of Agent Chat, and Workbench only when needed.
- `docs_v2/master-plan.md` says Agent Chat owns the conversation narrative, its Composer, and the visible Agent Session.
- `docs_v2/master-plan.md` says continuing a Thread shows Thread messages and the agent work stream.
- `docs_v2/master-plan.md` says Agent Session preserves the meaningful content and conceptual sequence of the raw session, and may improve presentation with cards only where useful.
- `docs_v2/master-plan.md` says before first send, Tide keeps Composer draft state without creating a persistent Thread.
- `docs_v2/master-plan.md` says Start Composer applies selected Agent, Project or Scratch, Worktree, Branch, Permission, and Model values before hidden Agent Runtime starts.
- `docs_v2/master-plan.md` says Follow-up Composer inherits the active Thread's Agent, Project, Worktree, and Branch, and the Agent is locked after Thread start.
- `docs_v2/designs/README.md` says New Thread Start screens show only the Start Composer launch context and title, without fake cue, prompt queue, or recent task rows below the Composer.
- Figma node `1357:2` defines the Composer Canonical State Map: one Base Composer, source-aware Agent and Model menus, selected-Agent-specific Permission menus, Project/Worktree/Branch menus, and Prompt State or command suggestions as one transient surface above the Composer with a 16px gap.
- `docs_v2/implementation/electron-node-architecture-decisions.md` says the Composer is the active input surface and Agent Session is the narrative/history surface.
- `docs_v2/research/ui-rendering-surface.md` says React maps well to Agent Session Blocks and browser-native text input gives a stronger base for Korean IME than custom GPU input.
- `docs_v2/research/ui-rendering-surface.md` says CodeMirror is a candidate for code-aware Composer or prompt editor but is not necessary for the first Composer if native textarea is enough.
- `src/shared/contracts/agent-session-block.ts` defines `AgentSessionBlockDto` as the process-boundary render DTO with block id, Thread id, kind, role, status, body, data, raw fallback, and timestamps.
- `src/shared/contracts/commands.ts` defines `thread.start`, `composer.sendInput`, `prompt.answer`, `agentRuntime.stop`, and `workbench.command` command payloads.
- `src/shared/contracts/events.ts` defines `thread.hydrated`, `thread.started`, `agentRuntime.stateChanged`, `providerReadiness.changed`, `prompt.changed`, and Agent Session Block stream events.
- `src/shared/contracts/thread.ts` currently defines `ThreadSummaryDto` with Agent Binding and scope but no Worktree Option or Branch Option fields.
- `src/shared/contracts/agent.ts` defines source-aware Agent Binding DTOs for Provider CLI Agents and the `openai_api` Tide API Agent.
- `docs_v2/specs/composer-agent-runtime-source.md` defines the Agent Runtime Source split used by the Composer Agent chip and Model Chip.
- `src/desktop/application/domains/agent-chat/agent-chat.ts` keeps Follow-up Composer execution context tied to Thread data and does not fabricate Worktree or Branch fields when the Shared Contract omits them.
- `src/desktop/adapters/inbound/react-renderer/agent-chat/contract-adapter.ts` currently casts Composer shell commands to a type derived from all `BackendCommandKind` values, including commands the shell cannot emit.
- Existing v2 TypeScript tests under `tests/*.test.ts` use `node:test`, and `package.json` routes `npm run test:v2` through that suite.

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

### D10. Agent Session Blocks render as a transcript flow

Agent Session Block remains the renderer-agnostic data unit, but the Desktop UI must not render every block as a boxed card.

Default user and agent text render as natural transcript turns in the Thread stream. Cards are reserved for structured objects that need affordances, such as file changes, approvals, Workbench references, command summaries, or raw fallback details.

### D11. First shell keeps React adapter thin

The first implementation keeps Desktop Agent Chat state and submit routing in a pure Desktop application model.

The React renderer adapter imports Shared Contracts, maps BackendEvent DTOs into the Desktop model, renders `AgentSessionBlockDto` values through that model, and emits BackendCommand payloads.

This keeps the UI testable before the full electron-vite/Vitest scaffold lands.

### D12. No user decision is open for this slice

No current question changes product behavior, architecture boundary, data ownership, provider behavior, or UI hierarchy.

Missing npm/electron-vite/Vitest packaging remains part of the Build and Package slice, not a user-facing decision for this shell.

### D13. Follow-up context must not invent missing Thread metadata

Follow-up Composer may show Agent and Project/Scratch from the current `ThreadSummaryDto`.

It must not fabricate Worktree Option or Branch Option values when Shared Contracts do not provide those values.

When Shared Contracts later add explicit Thread execution metadata, the adapter may map those fields into read-only Follow-up context.

### D14. Composer shell command mapping is narrow

The first Composer shell can emit only `thread.start`, `composer.sendInput`, and `prompt.answer`.

The React contract adapter must expose exactly those command drafts and must not type-cast them as the full `BackendCommandKind` union.

### D15. Agent chip is visually singular but source-aware

The Composer shows one Agent chip.

Provider CLI Agents and Tide API Agents can appear in the same Agent menu, but the selected Agent Binding must carry Agent Runtime Source metadata as specified in [Composer Agent Runtime Source](composer-agent-runtime-source.md).

The first shell may continue to implement only the existing `codex | claude | antigravity` contract values until Shared Contracts add source-aware Agent Binding.

### D16. New Thread Start is Composer-first

When no Thread is selected, Agent Chat renders the New Thread Start surface as a focused title plus Start Composer.

It does not render fake prompt cues, recent task rows, or marketing explanation below the Composer.

### D17. Composer transient menus share one surface vocabulary

Composer Options, Agent, Model, Permission, Project, Worktree, Branch, command suggestions, Provider Readiness, and Prompt State choices render through the same transient surface pattern above the Composer.

They are not separate documentation cards or permanent UI blocks.

### D18. Prefix suggestions are input-triggered

Typing `/`, `$`, `@`, `!`, or another selected-Agent-supported prefix may reveal command suggestions above the Composer.

Those suggestions are transient choices for the active input, not a separate always-visible Command Suggestions UI.

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
- Agent Runtime Source metadata behind the selected Agent chip.
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
| `thread.hydrated` | Render Thread metadata, cached blocks, and Workbench open state when Workbench Pane refs are present. |
| `thread.started` | Switch from Start Composer to Follow-up Composer. |
| `agentRuntime.stateChanged` | Update Agent Chat state. |
| `providerReadiness.changed` | Show setup/trust blocker and preserve draft. |
| `prompt.changed` | Switch Composer into prompt answer mode or clear it. |
| `agentSessionBlock.upserted` | Upsert visible block. |
| `agentSessionBlock.completed` | Complete or fail visible block. |
| `contract.error` | Show recoverable error state. |

## Flow

### UC-1: First launch draft

1. Desktop shows Left Rail and empty Agent Chat.
2. Agent Chat shows the New Thread Start title and Start Composer.
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
4. Layout adapts to `Left Rail | Agent Chat | Workbench`.

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
10. Follow-up context displays only Thread metadata that came from Backend events or explicit Desktop state.
11. Composer shell command mapping does not claim unsupported BackendCommand kinds.
12. Default text blocks render as transcript turns, not boxed status cards.
13. Agent chip rendering stays visually singular even when its Agent Binding has different Agent Runtime Sources.
14. Model Chip menu data comes from the selected Agent Runtime Source, not from a generic cross-agent model list.
15. Empty Agent Chat does not show fake cue, prompt queue, recent task, or suggested task rows below Start Composer.

## Tests

| Rule | Test expectation |
|------|------------------|
| Draft does not create Thread | `typing_in_start_composer_keeps_a_local_draft_without_emitting_a_backend_command` changes local draft state but sends no BackendCommand. |
| First send creates Thread | `sending_a_non_empty_start_composer_draft_emits_thread_start_with_launch_options` emits `thread.start` with Launch Options. |
| Empty send is blocked | `sending_an_empty_start_composer_draft_emits_no_command` emits no command for empty or whitespace-only input. |
| Start screen is Composer-first | `new_thread_start_screen_renders_start_composer_without_fake_cues` shows the New Thread Start title and Start Composer launch context without prompt cue rows. |
| Follow-up sends input | `follow_up_composer_emits_composer_send_input_for_the_active_thread` emits `composer.sendInput` with active Thread id. |
| Hydrate restores Workbench presence | `hydrating_thread_with_workbench_panes_marks_workbench_open` marks the Workbench open when `thread.hydrated` carries Workbench Pane refs. |
| Prompt answer routes correctly | `active_prompt_state_routes_submit_to_prompt_answer` changes submit command from `composer.sendInput` to `prompt.answer`. |
| Provider readiness preserves draft | `provider_readiness_blocker_preserves_the_composer_draft_and_marks_shell_blocked` leaves draft text intact and shows blocked state. |
| Thread context is read-only after start | `follow_up_shell_displays_thread_context_without_inline_edit_controls` displays available Thread context as read-only text. |
| Agent Session block stream renders | `agent_session_block_upserts_render_one_visible_block_per_block_id` adds or updates one visible block from `agentSessionBlock.upserted`. |
| Agent Session text reads like a Thread | `agent_session_text_blocks_render_as_transcript_turns_not_status_cards` verifies user and agent text blocks render as transcript turns without visible per-block status card chrome. |
| Hidden runtime is not terminal UI | `running_agent_runtime_state_does_not_render_a_terminal_pane` shows runtime state without a visible Terminal Pane for Agent Runtime. |
| Composer shell displays Thread, Agent Runtime State, and Prompt State | `composer_shell_displays_thread_runtime_and_prompt_state` renders active Thread metadata, runtime state, and prompt state together. |
| Desktop application boundary holds | `desktop_application_shell_state_does_not_import_react_backend_or_shared_contracts` keeps React and Shared Contracts in the adapter/test layer. |
| Follow-up context does not fabricate missing fields | `follow_up_shell_does_not_fabricate_worktree_or_branch_when_thread_contract_omits_them` shows no placeholder Worktree or Branch values when `ThreadSummaryDto` omits those fields. |
| Command adapter stays narrow | `composer_shell_command_adapter_does_not_claim_unsupported_backend_command_kinds` ensures the adapter exposes only `thread.start`, `composer.sendInput`, and `prompt.answer` command drafts. |
| Agent chip stays singular | `agent_chip_renders_one_visible_value_for_provider_cli_and_tide_api_sources` verifies Provider CLI and Tide API selections share the same Agent chip surface. |
| Model source follows Agent Runtime Source | `model_chip_routes_menu_data_by_agent_runtime_source` verifies Codex CLI model choices come from Agent Integration metadata while OpenAI API model choices come from Provider Account model metadata. |
| Permission menu follows selected Agent | `permission_menu_renders_only_the_selected_agent_provider_values` verifies Codex, Claude, and Antigravity Permission menus do not mix provider-native values. |
| Composer menu is transient | `composer_options_and_command_prefix_render_as_transient_choice_surfaces` verifies the Composer menu and `/` suggestions render above Composer through Choice Surface, not as static documentation blocks. |
| API readiness names Provider Account | `openai_api_readiness_mentions_provider_account_not_hidden_pty` verifies OpenAI API setup copy does not mention hidden PTY, Directory Trust, or provider CLI hooks. |

## Implementation Notes

- Build this as a React shell under `src/desktop/adapters/inbound/react-renderer` plus pure Desktop application state under `src/desktop/application`.
- Keep UI state reducers separate from Shared Contract definitions.
- Use browser-native input behavior for IME, selection, copy, paste, and focus in the first Composer.
- Add component tests for command emission, state transitions, and `AgentSessionBlockDto` rendering before visual polish.
- Keep Composer Options shallow in the first shell; detailed provider command menus belong to later provider feature specs.
- Do not put global Thread queues or status dashboards inside Agent Chat.
- Use `React.createElement` without JSX until the Build and Package slice introduces the final TSX/Vitest/electron-vite setup.
