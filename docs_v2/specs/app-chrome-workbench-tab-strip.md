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

## Tests

| Rule | Test expectation |
|------|------------------|
| Status Bar is Thread-scoped | Runtime state for active Thread updates Status Bar without adding global queue item. |
| Hidden runtime excluded | Workbench Tab Strip does not render Agent Runtime as a tab. |
| Browser Pane tab appears | Workbench changed event with Browser Pane renders one tab. |
| Close emits command | Close tab action emits `workbench.command` with pane id. |
| Focus emits command | Selecting tab emits focus Workbench command. |
| Overflow keeps action | Overflow menu lists hidden tabs and focusing one emits focus command. |
| Pin unavailable | No pin action appears for Workbench Pane tabs in first slice. |
| Split unavailable | No split action appears until Workbench split spec exists. |
| Icon buttons are labeled | Chrome Action tests require tooltip and accessible label. |
| Loading disables conflicts | Async Chrome Action enters loading and disables conflicting action. |

## Implementation Notes

- Keep Status Bar visually narrow.
- Prefer icon buttons with tooltips for compact repeated commands.
- Use text labels only where ambiguity would hurt repeated use.
- Keep setup/trust action body in Composer or a focused prompt surface, not Status Bar.
- Keep Workbench Tab Strip implementation independent from future split layout internals.
- Do not add a global activity dashboard as part of App Chrome.
