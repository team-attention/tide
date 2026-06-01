# Spec: App Chrome and Workbench Tab Strip

## Scope

This spec defines the first App Chrome and Workbench Tab Strip behavior.

It covers:

- top chrome responsibility.
- Status Bar responsibility.
- Workbench Tab Strip responsibility.
- Pane toolbar basics.
- Chrome Action rules.
- icon button and tooltip rules.
- disabled, loading, active, and attention states.
- hover-only versus always-visible actions.
- keyboard and screen-reader labels.
- Workbench Tab Strip focus, close, overflow, pin, and split decisions.

It does not define final visual theme, icon asset production, full split layout behavior, or complete Workbench Pane implementations.

## Evidence

- `docs_v2/glossary.md` defines App Chrome as compact non-content UI around Agent Chat and Workbench.
- `docs_v2/glossary.md` defines Status Bar as compact operational state, not a global Thread queue or settings panel.
- `docs_v2/glossary.md` defines Workbench Tab Strip as the App Chrome surface for visible Workbench Panes and says it does not include hidden Agent Runtime.
- `docs_v2/glossary.md` defines Chrome Action as a small command, usually icon button or compact menu item, with tooltip and state.
- `docs_v2/implementation/concrete-design-backlog.md` selects minimal Thread-scoped chrome and says App Chrome should be a compact command surface, not another navigation system.
- `docs_v2/implementation/concrete-design-backlog.md` says status candidates include Backend connection, selected Agent, Agent Runtime state, Provider Readiness issue, and active Project/Branch when Workbench is open.
- `docs_v2/implementation/concrete-design-backlog.md` says Workbench tabs should represent visible Workbench Panes only and not include the hidden Agent Runtime.
- `docs_v2/master-plan.md` says the Left UI remains work history, not a status dashboard.

## Decisions

### D1. App Chrome is Thread-scoped

App Chrome surfaces operational state for the active Thread and active Workbench.

It does not become a global dashboard or Thread queue.

### D2. Top chrome is identity and window-level command space

Top chrome can show:

- active Thread title.
- Project/Scratch context.
- selected Agent identity.
- narrow window-level commands.

It does not host full provider settings, global queues, or large setup forms.

### D3. Status Bar is compact operational state

Status Bar shows small state indicators:

- Backend connection.
- selected Agent.
- Agent Runtime State.
- Provider Readiness blocker when present.
- active Project/Branch when Workbench is open.

Status Bar is Thread-scoped with app connection state included.

### D4. Workbench Tab Strip shows visible Workbench Panes only

Workbench Tab Strip appears only when Workbench has visible Panes.

It does not include hidden Agent Runtime.

### D5. First Tab Strip supports focus, close, and overflow

The first Tab Strip supports:

- focus Pane.
- close Pane.
- overflow menu when tabs exceed available width.

It does not support pinning Workbench Panes in the first slice.

It does not expose split controls until Workbench layout split behavior is specified.

### D6. Chrome Actions are icon-first with labels in tooltips

Chrome Actions use recognizable icons when available.

Every icon-only action has:

- tooltip.
- accessible label.
- disabled state when unavailable.
- loading state when async.
- active state when toggled or selected.

### D7. Hover actions stay local

Hover-only actions are allowed for repeated rows or tabs when their absence does not block core workflow.

Essential actions such as send, active prompt answer, close modal, and primary setup retry are always visible.

### D8. Attention indicators are small and actionable

Attention dots or badges indicate a specific local state, such as Provider Readiness blocker or Prompt State.

They do not create global status buckets.

### D9. Workbench is reachable from top chrome, and new Panes from the Tab Strip

When a Thread is active, top chrome always exposes a Workbench open/close Chrome
Action (icon button with tooltip + accessible label). Opening the Workbench when
it has no visible Pane opens the Launcher Pane so the user can create the first
Pane (Browser, Terminal, Editor, Diff).

When the Workbench is open, the Tab Strip exposes a "New Pane" Chrome Action
(the "+" affordance) that opens the Launcher Pane. This is how a Browser Pane is
opened without first sending a message to the Agent.

## Out Of Scope

- Final icon asset set.
- Color system and typography.
- Full menu hierarchy.
- Full keyboard shortcut map.
- Workbench split layout implementation.
- Pinned Workbench Panes.
- Global activity center.
- Settings UI.

## Domain Model

### Chrome Surface

Chrome surfaces:

- top chrome.
- Status Bar.
- Workbench Tab Strip.
- Workbench Pane toolbar.
- Composer chrome.
- compact menus and popovers.

### Chrome Action

Chrome Action fields:

- id.
- surface.
- icon.
- accessible label.
- tooltip.
- state.
- command.
- disabled reason.

Action states:

- default.
- hover.
- active.
- disabled.
- loading.
- attention.

### Workbench Tab

Workbench Tab fields:

- WorkbenchPaneId.
- Pane kind.
- title.
- active flag.
- loading flag.
- dirty flag when relevant.
- attention flag when relevant.
- close availability.
- revision.

## Contracts

Chrome consumes BackendEvents:

| Event | Chrome effect |
|-------|---------------|
| `backend.connectionChanged` | Status Bar connection indicator. |
| `thread.hydrated` | Active Thread identity, Agent identity, and Workbench Pane refs after reconnect. |
| `thread.started` | Active Thread identity and Agent identity. |
| `agentRuntime.stateChanged` | Status Bar runtime indicator. |
| `providerReadiness.changed` | Status Bar readiness indicator and optional attention. |
| `prompt.changed` | Composer chrome attention and active prompt state. |
| `workbench.changed` | Workbench Tab Strip and Pane toolbar updates. |
| `contract.error` | Local error indicator on the relevant surface. |

Chrome emits BackendCommands:

| Action | BackendCommand |
|--------|----------------|
| close Workbench Pane | `workbench.command` |
| focus Workbench Pane | `workbench.command` |
| open overflow item | local UI action unless it changes Workbench state |
| stop Agent Runtime | `agentRuntime.stop` |
| retry Provider Readiness | provider readiness command when specified by provider bootstrap |

## Flow

### UC-1: Status Bar updates runtime state

1. Backend emits Agent Runtime State.
2. Status Bar updates compact indicator.
3. Agent Chat remains primary narrative surface.

### UC-2: Provider Readiness needs attention

1. Backend emits Provider Readiness blocker.
2. Status Bar shows small attention state.
3. Composer shows the actionable setup/trust state.
4. Left UI does not create a global queue.

### UC-3: Workbench opens Browser Pane

1. Workbench receives Browser Pane.
2. Workbench Tab Strip appears.
3. Browser tab is focusable and closable.
4. Hidden Agent Runtime is not represented as a tab.

### UC-6: Open Workbench and Launcher from chrome

1. A Thread is active and the Workbench is closed.
2. Top chrome shows an "Open Workbench" Chrome Action.
3. User clicks it; the Workbench opens.
4. Because the Workbench has no visible Pane, an `open_launcher` Workbench
   command is emitted and the Launcher Pane appears.
5. From the Launcher (or the Tab Strip "New Pane" action) the user opens a
   Browser/Terminal/Editor/Diff Pane.

### UC-4: Workbench tab overflow

1. Visible tab count exceeds available width.
2. Tab Strip keeps active tab visible when possible.
3. Extra tabs move into overflow menu.
4. Selecting overflow item focuses that Pane.

### UC-5: Chrome Action state

1. Async action starts.
2. Chrome Action enters loading state.
3. Action is disabled while conflicting operation is active.
4. Tooltip and accessible label remain available.

## Invariants

1. App Chrome is compact and Thread-scoped.
2. Status Bar is operational, not a dashboard.
3. Workbench Tab Strip contains visible Workbench Panes only.
4. Hidden Agent Runtime never appears as a Workbench tab.
5. First Tab Strip supports focus, close, and overflow.
6. Workbench Pane pinning is not supported in the first slice.
7. Workbench split controls are not exposed until split behavior is specified.
8. Every icon-only Chrome Action has tooltip and accessible label.
9. Disabled/loading/active states are explicit.
10. Attention indicators point to actionable local state.
11. While a Thread is active, the Workbench (and therefore the Launcher) is
    always reachable from top chrome, even before any message is sent.

## Tests

| Rule | Test expectation |
|------|------------------|
| Status Bar is Thread-scoped | `status_bar_updates_runtime_state_without_global_queue` updates active Thread runtime state and does not render a global queue. |
| Hidden runtime excluded | `workbench_tab_strip_excludes_hidden_agent_runtime` renders Workbench Pane tabs but no Agent Runtime tab. |
| Browser Pane tab appears | `workbench_changed_event_with_browser_pane_renders_tab_strip` renders one Browser Pane tab from `workbench.changed`. |
| Close emits command | `closing_workbench_tab_emits_workbench_command_with_pane_id` emits `workbench.command` with the Thread id and Pane id. |
| Focus emits command | `selecting_workbench_tab_emits_focus_workbench_command` emits focus `workbench.command` with the Thread id and Pane id. |
| Overflow keeps action | `overflow_menu_lists_hidden_tabs_and_focuses_selected_pane` keeps extra tabs in overflow and emits focus command for an overflow item. |
| Pin unavailable | `first_tab_strip_does_not_render_pin_or_split_actions` renders no pin action for Workbench Pane tabs. |
| Split unavailable | `first_tab_strip_does_not_render_pin_or_split_actions` renders no split action until Workbench split behavior is specified. |
| Icon buttons are labeled | `chrome_action_buttons_have_tooltips_and_accessible_labels` requires tooltip and accessible label for icon-only actions. |
| Loading disables conflicts | `loading_chrome_action_disables_conflicting_action` models loading state and disables the conflicting action. |
| Workbench reachable from chrome | `active_thread_with_closed_workbench_renders_open_workbench_action` renders an "Open Workbench" chrome action when a Thread is active and the Workbench is closed. |
| Opening empty Workbench opens Launcher | `opening_closed_workbench_for_active_thread_emits_open_launcher` emits `open_launcher` when toggling open a Workbench with no visible Pane. |
| Tab Strip exposes New Pane | `open_workbench_tab_strip_renders_new_pane_action` renders a "New Pane" chrome action that opens the Launcher. |

## Implementation Notes

- Keep Status Bar visually narrow.
- Prefer icon buttons with tooltips for compact repeated commands.
- Use text labels only where ambiguity would hurt repeated use.
- Keep setup/trust action body in Composer or a focused prompt surface, not Status Bar.
- Keep Workbench Tab Strip implementation independent from future split layout internals.
- Do not add a global activity dashboard as part of App Chrome.
