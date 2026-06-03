# Spec: Desktop Product Shell Visual Foundation

## Scope

This spec defines the first product-grade Tide v2 Desktop shell visual foundation.

It covers:

- Left UI as compact work history.
- Agent Chat as the primary center surface.
- Composer anchored inside Agent Chat.
- optional Workbench shell surface, with bounded Pane previews covered by
  `desktop-workbench-pane-content-rendering`.
- App Chrome as compact Thread-scoped operational chrome.
- Agent Icon treatment.
- Tide icon-derived key color palette for the Electron renderer.
- Product Shell interactions before real Thread persistence is wired.

It does not implement native Browser/WebView rendering, full editor or diff
interaction, full terminal emulation, final provider setup flows, or provider
output streaming.

## Evidence

- `docs_v2/README.md` says Tide v2 is a free, open-source Codex App alternative for local coding-agent work.
- `docs_v2/master-plan.md` sets the baseline UI as `Left UI | Agent Chat | Workbench`, with Composer anchored at the bottom of Agent Chat.
- `docs_v2/master-plan.md` says the Left UI starts with New thread, Search, and Sidebar options, and Thread Rows show one small Agent Icon.
- `docs_v2/master-plan.md` says Codex, Claude, and Antigravity need polished Agent Icons, not ad hoc text fallback.
- `docs_v2/implementation/concrete-design-backlog.md` selects Thread-first layout and minimal Thread-scoped App Chrome.
- `docs_v2/designs/README.md` records Figma node `1472:52` as the canonical design board and node `1268:2` as the canonical 8-color palette.
- `docs_v2/specs/desktop-workbench-pane-content-rendering.md` covers bounded
  Browser, Editor, Diff, and Terminal Pane previews from Shared Contracts.
- Figma node `1303:55` shows layout variants where Left UI, Agent Chat, Workbench, and FileTree each own a 52px top row; it does not use a separate global title bar.
- Figma node `1303:55` shows Left UI Thread Rows without visible leading Thread icons, Project Rows with folder icons, Project hover actions as more and new-thread icons, and archive confirmation as a transient inline row action.
- Figma node `1288:2` defines Left UI row states: Thread Row has no leading icon; Thread hover exposes pin/archive; archive click swaps the action slot into a single Confirm pill until pointer leave; Project open/closed state is expressed by folder icon; Project hover exposes more and new-thread actions; context menus keep the owning row highlighted.
- Figma node `1303:55` shows FileTree as a single independent right column that can appear with or without a Workbench Pane column.
- Figma node `1494:320` shows command suggestions, Agent questions, Provider Readiness, and permission prompts as one reusable Choice Surface pattern placed above the Composer with a visible gap.
- `crates/tide-app/src/theme.rs` shows the existing Tide palette uses warm charcoal document surfaces, warm neutral text, amber/green/blue status colors, and restrained borders.
- `assets/icon.png` is a 128x128 Tide icon with two dominant key colors: beige average `#afa89a` and dark average `#343038`; the deeper dark average is `#29252d`.
- `src/desktop/adapters/inbound/react-renderer/tide-product-shell.ts` previously rendered fixture Thread Rows and Composer without React state handlers for opening a Thread, starting a Thread, or submitting Composer input.
- `src/desktop/application/domains/product-shell/product-shell-state.ts` previously created `local-thread-*` preview Threads and rendered "Local preview" blocks instead of routing Product Shell Composer submit through BackendCommand drafts.
- `docs/glossary.md` defines V1 Terminal Context Surface as the right Dock region attached to one Stage Terminal, capable of showing Browser Pane, Diff, Editor, Launcher, secondary Terminal, or Render Pane.
- `docs/specs/dock-placeholder.md` says an open V1 Dock must not be empty: it creates a placeholder Launcher and replaces that slot when a Browser or Editor Pane opens.
- `docs/specs/open-terminal-codex-app.md` says the product gap is not missing agent internals; it is presenting Tide's existing open-terminal model as a Codex-app-like work surface.
- OpenAI describes Codex app as a command center for agents that manages multiple agents, Threads organized by projects, diffs, editor handoff, and worktrees.
- Palot describes a desktop GUI for OpenCode with multiple projects and sessions, a dedicated diff panel, real-time streaming, command palette, and OS-adaptive glass/accent treatment.
- Dia positions its app around surfacing what is next, ready, or missed, reading between tabs, and keeping work context visible without forcing users to hunt.

## Decisions

### D1. Keep Tide Thread-first

Tide follows the v2 product structure before adding Workbench weight:

```text
Left UI | Agent Chat | optional Workbench
```

Left UI Thread Rows are compact navigation rows, not boxed cards.

### D2. Use Tide icon key colors, not generic black

The first renderer palette is keyed to the Tide icon:

- beige key color: `#afa89a`
- dark key color: `#343038`
- deep dark support color: `#29252d`

Pure black is reserved for neither the app shell nor the Agent Chat surface, unrelated saturated accent colors do not dominate the first screen, and decorative glow/gradient fields do not carry the layout.

Surfaces should feel matte and application-native: compact lines, restrained selection, and depth only where the user needs focus.

### D3. Agent Icons are compact identity marks

Agent Icons are small identity marks with deterministic palettes derived from the Tide key colors:

- Codex: light beige on dark.
- Claude: beige on deep dark.
- Antigravity: muted shadow on beige-tinted dark.

They are not large logos and not text-only fallback.

### D4. Buttons use icon-first App Chrome

Common chrome buttons use icon components with labels or tooltips.

Text-only controls are reserved for clear commands such as Send.

### D4a. First screen does not show cue rows

The New Thread Start screen shows only the focused title and Start Composer.

It does not show fake cue rows, prompt queues, recent task rows, or suggested tasks below Composer.

### D5. Reference order guides mood, not copied UI

The design reference priority is:

1. Codex: command center for coding agents.
2. Palot: dense desktop multi-project/session tooling.
3. Dia: calm contextual work surface that suggests what is ready.

Tide must still keep its own palette and v2 terminology.

### D6. Right Workbench inherits V1 Dock behavior

The v2 right Workbench should read as the Agent-wrapper version of V1's right Dock / Terminal Context Surface:

- It is Thread-bound.
- It exposes visible Browser, Diff, Editor, or Terminal context panes.
- It is not the hidden Agent Runtime.
- Its visible Pane refs are driven by Backend Workbench state.

### D7. Top rows are column-owned

Each visible Product Shell column owns a 52px top row:

- Left UI owns window traffic controls and the Left UI collapse action while it is open.
- Agent Chat owns active Thread title and Thread actions.
- Workbench owns visible Pane tabs when Workbench is open.
- FileTree owns CWD FileTree controls when FileTree is open.

The right window actions live in the rightmost visible column's top row. They are not an absolutely positioned global overlay.

### D8. FileTree is one independent column

FileTree is not duplicated inside Workbench and outside Workbench.

It is a single right-side column attached to the active Thread's cwd. Workbench Pane columns and FileTree can be open together, but Workbench does not own a second FileTree.

### D9. Choice Surfaces are Composer-adjacent

Command suggestions, Provider Readiness, permission prompts, and Agent questions use the same Choice Surface pattern above the Composer.

The Composer remains below the Choice Surface with a visible gap. Choice Surface colors use the same canonical palette as Composer chips.

### D10. Left UI row menus are row-owned transient state

Thread Row and Project Row context menus belong to their owning Left UI row.

Opening a context menu keeps that row highlighted. Thread archive intent replaces the hover action slot with one `Confirm` pill; pointer leave clears that transient state.

### D11. Product Shell submit routes through BackendCommand drafts

Product Shell does not create fake local Thread previews on Composer submit.

When the user submits Start Composer, Product Shell emits the same `thread.start` command produced by the Agent Chat domain.

When the user submits Follow-up Composer, Product Shell emits `composer.sendInput`.

Product Shell updates Thread selection, blocks, runtime state, and Workbench visibility only from BackendEvent envelopes or explicit local navigation actions.

Thread-scoped BackendEvents that carry a `threadId` must not mutate the active Agent Chat or App Chrome when they belong to a different active Thread.

## Out Of Scope

- Real Project and Thread data loading.
- Native Browser/WebView rendering, full editor or diff interaction, full
  terminal emulation, and FileTree contents.
- Final brand assets.
- Settings, update, migration, and provider setup screens.
- Responsive mobile layout.

## Domain Model

### Product Shell

The Product Shell is a Desktop renderer composition:

- Left UI.
- Agent Chat.
- App Chrome.
- optional Workbench.

### Visual Palette

Palette tokens are defined as CSS custom properties so React components stay structural.

### Agent Icon

Agent Icon is rendered by Agent identity where identity is ambiguous, but canonical Left UI Thread Rows do not show a default leading Thread icon.

## Contracts

No Shared Contract changes are required for the Product Shell visual layer.

This slice consumes existing Desktop view models and fixture Left UI data. Composer submit must leave the renderer through BackendCommand drafts rather than creating fake Agent Session output.

## Flow

### UC-1: Developer opens Tide v2

1. Electron opens the Renderer.
2. Product Shell fills the window.
3. Left UI shows work history affordances.
4. Agent Chat shows the first-launch Composer.
5. App Chrome shows compact local operational state.

### UC-2: User scans work history

1. Left UI shows Pinned, Projects, and Scratch.
2. Thread Rows show Thread title and time without a default leading Thread icon.
3. Rows are compact and do not become status buckets.

### UC-3: User starts a Thread

1. Composer remains inside Agent Chat.
2. Start Composer shows Agent, Project or Scratch, Worktree, Branch, Permission, Model, and Send.
3. The design leaves less-common controls behind an icon button.

### UC-4: Workbench is available without dominating

1. When Workbench is not open, Agent Chat remains primary.
2. When Workbench is open, Workbench appears to the right.
3. Workbench content remains Thread-bound and does not replace Agent Chat.

### UC-5: User opens an existing Thread from Left UI

1. User clicks a Thread Row.
2. Product Shell emits `thread.hydrate` when a Backend command transport is available.
3. Product Shell marks that Thread Row active only after Backend returns `thread.hydrated`.
4. Agent Chat switches to Follow-up Composer mode for that Thread.
5. App Chrome reflects the active Thread's Agent Runtime state.

### UC-6: User starts a first Thread draft

1. User clicks `New thread`.
2. Product Shell clears the active Thread without deleting the Left UI history.
3. User types in Composer.
4. Product Shell keeps the Composer draft locally.
5. User sends the first meaningful Composer draft.
6. Product Shell emits a `thread.start` BackendCommand draft with the Start Composer Agent Binding, Execution Context, and Launch Options.
7. Product Shell switches to a real Thread only when Backend emits `thread.started` or `thread.hydrated`.

### UC-6b: User starts a Thread from a Project Row

1. User clicks the Project Row's `New thread in project` action.
2. Product Shell clears the active Thread (like UC-6) but pre-scopes the Start
   Composer Execution Context to that Project's `cwd`.
3. When the draft is sent, the `thread.start` Execution Context is that Project,
   so the resulting Thread is grouped under the same Project Row.

### UC-7: Active Thread exposes a right Workbench Dock surface

1. User opens a Thread that has visible Workbench context.
2. Product Shell opens the right Workbench surface.
3. App Chrome shows a Workbench Tab Strip for visible Workbench Panes.
4. The right Workbench renders the active Pane preview and preserves Agent Chat as the narrative surface.
5. User focus or close actions emit Backend Workbench commands.
6. Product Shell updates visible tabs from the resulting `workbench.changed` event.

### UC-8: User toggles shell columns

1. User closes the Left UI.
2. Agent Chat keeps the window controls in its own top row.
3. User opens or closes Workbench.
4. User opens or closes FileTree.
5. Right window actions remain in the rightmost visible column top row.

### UC-9: User responds to an Agent choice

1. Backend exposes Provider Readiness, Prompt State, or command suggestions.
2. Agent Chat renders a Choice Surface above Composer.
3. Composer remains the active input target below the choices.
4. User can either pick a choice or type into Composer.

## Invariants

1. Product Shell fills the viewport.
2. Composer is anchored inside Agent Chat.
3. Left UI is work history, not an IDE FileTree.
4. Workbench is optional.
5. Agent Runtime is not rendered as a default Terminal Pane.
6. App Chrome is compact and Thread-scoped.
7. Agent Icons are deterministic and color-coded.
8. Palette uses Tide icon beige `#afa89a` and dark `#343038`, with `#29252d` as deep support, not generic pure black.
9. Renderer composition does not import Backend internals.
10. Left UI actions and Composer controls that appear actionable update Product Shell state.
11. Right Workbench is Thread-bound support context, not a global static pane.
12. New Thread Start does not render fake cue rows, prompt queues, recent task rows, or suggested tasks below Start Composer.
13. Top rows are owned by visible columns; the Product Shell does not use a separate global title bar.
14. FileTree is a single independent column and can be open at the same time as Workbench.
15. Choice Surfaces use the canonical palette and sit above Composer with a visible gap.
16. Product Shell submit does not create `local-thread-*` previews or "Local preview" Agent Session Blocks.
17. Backend `thread.started` and `thread.hydrated` events preserve the selected Agent Binding and provider-native Launch Options in the active Agent Chat and Composer chrome.
18. A Thread started from a Project Row's `New thread in project` action is scoped to that Project's Execution Context, so it groups under the same Project Row.

## Tests

| Rule | Test expectation |
|------|------------------|
| Product Shell fills the viewport | `product_shell_renders_left_ui_agent_chat_composer_and_app_chrome` renders Product Shell landmarks. |
| Left UI uses work history | `left_ui_renders_project_grouped_thread_rows_without_thread_icons` renders Pinned, Projects, Scratch, Project folder rows, and iconless Thread Rows. |
| Thread Rows are natural list rows | `thread_rows_use_list_style_selection_not_card_blocks` scans CSS for flat active selection rather than boxed card treatment. |
| Composer stays in Agent Chat | `composer_is_anchored_inside_agent_chat` verifies Composer appears inside Agent Chat markup. |
| Empty Agent Chat feels like a product start surface | `agent_chat_empty_state_reads_like_a_product_start_surface` verifies the first screen has the New Thread Start title and Start Composer without fake cue rows. |
| Composer uses compact icon chrome | `composer_uses_icon_chrome_for_options_model_voice_and_send` verifies Composer options, permission, model, voice, and send are compact controls. |
| Palette uses Tide icon key colors | `visual_foundation_css_uses_tide_icon_key_colors_without_pure_black_shell` scans CSS tokens. |
| Surfaces stay flat and product-native | `visual_foundation_css_avoids_decorative_glow_and_heavy_cards` scans CSS for matte surfaces instead of glow fields and heavy card shadows. |
| Icons use deterministic palettes | `agent_icons_use_deterministic_identity_palette` renders Codex, Claude, and Antigravity Agent Icons. |
| Renderer mounts Product Shell | `renderer_entry_mounts_product_shell_not_bare_agent_chat` verifies the renderer entry imports and renders Product Shell. |
| Opening a Thread updates shell state | `opening_thread_from_left_ui_marks_it_active_and_hydrates_follow_up_composer` verifies fixture Product Shell state changes for a Thread Row. |
| Opening a Backend Thread hydrates through Backend | `product_shell_thread_selection_emits_thread_hydrate_when_backend_transport_exists` verifies a Thread Row click emits `thread.hydrate` instead of using local preview when command transport exists. |
| Sending the start Composer emits BackendCommand | `sending_start_composer_from_product_shell_emits_thread_start_without_local_preview` verifies `thread.start` is emitted and no local preview Thread is created. |
| New thread in project pre-scopes Composer | `new_thread_in_project_prescopes_start_composer_to_that_project` verifies the Start Composer Execution Context matches the selected Project's cwd and `thread.start` carries that scope. |
| Right Workbench follows the active Thread | `opening_thread_with_workbench_context_renders_right_workbench_tabs` verifies visible Workbench tabs and right Workbench state. |
| Right Workbench tab actions use Backend commands | `right_workbench_tab_actions_emit_backend_commands_and_apply_workbench_events` verifies focus and close emit `workbench.command` and visible tabs update from `workbench.changed`. |
| Background Thread events do not leak into active Thread | `product_shell_ignores_thread_scoped_events_for_inactive_threads` verifies runtime and Agent Session updates for another Thread do not mutate the active Agent Chat. |
| Top rows are column-owned | `product_shell_uses_column_owned_top_rows_without_global_window_chrome` verifies column top rows replace the global title bar. |
| FileTree is independent | `file_tree_opens_as_one_independent_column_next_to_workbench` verifies one FileTree column can coexist with Workbench. |
| Right actions stay in the rightmost column | `right_window_actions_move_to_the_rightmost_visible_column` verifies right actions move between Agent Chat, Workbench, and FileTree top rows. |
| Choice Surfaces stay Composer-adjacent | `prompt_choice_surface_renders_above_composer_with_canonical_spacing` verifies Prompt State choices render above Composer with a gap. |
| Thread archive confirm is transient | `thread_archive_intent_replaces_actions_with_one_confirm_pill` verifies a Thread Row renders one Confirm pill and no pin/archive actions while confirmation is pending. |
| Left UI context menus match Figma states | `left_ui_context_menus_match_figma_items_and_keep_rows_highlighted` verifies Thread and Project menus render the canonical items and keep their rows highlighted. |
| Backend thread events preserve selected Agent state | `product_shell_thread_started_preserves_antigravity_model_label` verifies an Antigravity `thread.start` followed by Backend `thread.started` stays on Antigravity and does not fall back to Codex/GPT Composer chrome. |

## Implementation Notes

- Keep this as a Desktop renderer slice.
- Keep CSS in `src/desktop/renderer/`.
- Use `lucide-react` for common command icons.
- Keep bespoke Agent Icons small and structural until final brand assets are created.
