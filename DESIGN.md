---
name: Tide Desktop Workbench
description: A calm, dense, desktop-native workspace for agent-assisted coding and review.
colors:
  app-bg: "#fdfdfc"
  surface: "#f4f3f0"
  selection: "#eeedea"
  line: "#e4e2de"
  line-strong: "#d9d6cf"
  text: "#242424"
  muted: "#8a8781"
  action: "#343038"
  accent: "#3970f0"
  danger: "#ba322f"
  success: "#1f9d54"
  warning: "#c0871c"
  dark-bg: "#1a1917"
  dark-surface: "#232220"
typography:
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 590
    lineHeight: 1.25
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 520
    lineHeight: 1.2
  mono:
    fontFamily: "Roboto Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
spacing:
  xxs: "4px"
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  command-surface:
    backgroundColor: "{colors.app-bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "8px"
  in-pane-find:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    height: "36px"
  result-row:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    height: "32px"
  result-row-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    height: "32px"
---

# Design System: Tide Desktop Workbench

## 1. Overview

**Creative North Star: "The Drafting Table"**

Tide is a workbench for users who are reading, editing, searching, comparing, and steering agents in the same session. The interface must feel like a precise desktop tool, not a browser page with panes attached. The core problem is not missing features. The current experience often fails because search, reference navigation, file editing, and chat-session lookup each use a different visual grammar and a different mental model.

The design direction is calm, dense, low-glare, and operational. A user should always understand: where am I, what scope am I operating in, what is selected, what will happen if I press Enter, and how do I get back. UI should make workflows feel continuous. Search should not interrupt reading. Reference navigation should not feel like a detached report. Chat-session search should not cover content like an emergency overlay.

Key characteristics:

- Contextual surfaces over global overlays. Prefer anchored, scoped tools inside the active column or pane.
- One search grammar across editor, transcript, file search, and command search.
- Navigation as a reversible path: show origin, destination, preview, and return path.
- Dense but legible rows. Every result row must carry type, name, location, preview, and state without looking like a card.
- Desktop-native restraint: 4px grid, square-ish radii, low shadow, muted state color.
- Feature surfaces must teach by structure, not by explanatory text blocks.

## 2. Colors

The palette is restrained, neutral, and low-glare. Accent color is reserved for current selection, focus, and active navigation state, never decoration.

### Primary

- **Ink Action** (`#343038`): Primary action surface, selected commands, high-confidence controls, and dark-on-light active chrome.
- **Precision Blue** (`#3970f0`): Focused navigation target, active match, editor selection, link-like code navigation, and keyboard focus where a neutral ring is not enough.

### Secondary

- **Workbench Surface** (`#f4f3f0`): Toolbars, in-pane find bars, gutters, compact controls, and quiet non-content panels.
- **Soft Selection** (`#eeedea`): Hover and selected row fill. It should read as local state, not a brand accent.

### Tertiary

- **Success Green** (`#1f9d54`): Git additions, successful saves, applied edits, completed checks.
- **Warning Amber** (`#c0871c`): conflicts, stale references, partial results, truncated search.
- **Danger Red** (`#ba322f`): destructive actions, failed saves, broken workspace state.

### Neutral

- **Paper Background** (`#fdfdfc`): Main app background and content surface in light mode.
- **Hairline Divider** (`#e4e2de`): Pane seams, toolbar separators, result group dividers.
- **Strong Divider** (`#d9d6cf`): Popover borders and active tool boundaries.
- **Primary Text** (`#242424`): File names, command labels, active row text.
- **Muted Text** (`#8a8781`): Paths, counters, metadata, disabled controls.
- **Dark Workbench** (`#1a1917`, `#232220`): Dark-mode base and surface. Dark mode must remain low-glare, not neon.

### Named Rules

**The Accent Scarcity Rule.** Blue appears only where the user has an active target: active match, current reference, keyboard focus, selected navigation destination, or code link affordance.

**The No Emergency Search Bar Rule.** Search bars must not become high-contrast full-width bands unless the entire surface is a search mode. Session search in particular must sit as a scoped tool, not as a viewport-wide interruption.

## 3. Typography

**Display Font:** None. Tide is a product workspace and does not use display typography inside working surfaces.
**Body Font:** Inter with system fallbacks.
**Label/Mono Font:** Roboto Mono for code, command literals, line previews, and paths when alignment matters.

**Character:** Typography should feel compact and assured. UI labels are metadata, not prose. Code and search previews need rhythm and alignment more than large text.

### Hierarchy

- **Title** (`590`, `14px`, `1.25`): Active file titles, selected tab title, search surface heading when needed.
- **Body** (`400`, `13px`, `1.45`): Transcript text, result labels, menu items, compact descriptions.
- **Label** (`520`, `12px`, `1.2`): Scope chips, counters, mode labels, keyboard hints.
- **Meta** (`400`, `11.5-12px`, `1.2`): Paths, line numbers, result counts, secondary state.
- **Code** (`400`, `12px`, `1.55`): Editor text, result line previews, terminal-like details.

### Named Rules

**The Metadata Stays Small Rule.** Paths, counts, shortcuts, and scope labels must not compete with file names or command labels.

**The Preview Is Code Rule.** Search result snippets, reference previews, diagnostics, and changed lines use the mono stack unless they are natural language transcript excerpts.

## 4. Elevation

Tide should be flat by default. Depth comes from seams, tonal layers, selected row fills, and local focus rings. Shadows are for transient floating surfaces only: command palette, dropdown menu, hover context, and modal. Pane content must not look like stacked cards.

### Shadow Vocabulary

- **Popover** (`0 8px 18px -10px rgb(52 48 56 / 12%)`): Small anchored menus and editor tooltips.
- **Sheet** (`0 24px 60px -12px rgba(36, 33, 38, 0.35)`): Command palette and project-wide search surfaces.
- **Composer** (`0 8px 11px rgba(52, 48, 56, 0.13)`): Bottom composer only, because it floats over the transcript.

### Named Rules

**The Surface Belongs To The Task Rule.** Editor, transcript, search results, file tree, and reference results are not cards. They are working surfaces with rows, seams, and toolbars.

## 5. Components

### Workbench Editor

The editor should read as the primary work surface, not a preview embedded in a pane.

- **Header:** File name first, path second, state third. Dirty, conflict, read-only, and truncated states must be visible in the tab/header, not only in a breadcrumb dot.
- **Body:** Gutters are quieter than content. Active line is visible but never a full-width warning band.
- **Selection:** Text selection and active match must be visually distinct. Selection is blue-tinted; hover and row selection stay neutral.
- **Actions:** Save, search, references, and add-to-chat can be keyboard-first, but they need discoverable chrome or command-palette entries.

### In-Pane Find

Find is a scoped instrument attached to the content being searched.

- **Shape:** 36px toolbar, 6px input radius, local surface background.
- **Placement:** Inside the active pane, below pane chrome or inside the transcript column header area. Never a full-window bar over unrelated content.
- **Controls:** Query input, match count, previous, next, close. Optional toggles for case, word, regex, and selection scope use icon buttons with clear selected state.
- **Behavior:** Opening find should preserve reading position and visually mark the active match. Empty query state should be quiet, not instructional.

### Project Search

Project search is a result browser, not a modal dialog pretending to be a form.

- **Shape:** Top-anchored sheet or docked side panel depending on scope. Use sheet for command-like one-off search, panel for sustained search/review.
- **Rows:** File group header, line number, preview, match highlight, path metadata. Rows are 28-34px high, no card boundaries.
- **Filters:** Include/exclude, regex, case, and word toggles sit in a secondary control row. Do not hide all power behind syntax.
- **State:** Loading, partial, no results, truncated, and stale index states must occupy the result region with the same row grammar.

### Chat Session Search

Transcript search is a reading aid, not a global mode.

- **Placement:** Anchored to the chat column, aligned with transcript width. It must not span the whole app or obscure unrelated panes.
- **Scope:** Search current thread by default. A scope selector can expand to all threads, current project, or archived threads.
- **Result model:** Match within transcript, message author, timestamp or turn label, and surrounding snippet. Jump keeps the find bar open and highlights the target message.
- **Visual rule:** The bar should feel like part of the transcript column. It should not look like a browser find overlay stretched across the viewport.

### Reference Navigation

Reference navigation should feel like a reversible route through code.

- **Entry:** Cmd/Ctrl-click, command palette, context menu, and keyboard shortcut all land in the same visual model.
- **Result surface:** Use a peek surface near the editor or a right-side reference panel, not a disconnected list at the bottom with no navigation memory.
- **Rows:** Symbol name, file, path, line:column, preview. Current file references group first.
- **Jump behavior:** Clicking a reference must move to exact line and column, show target highlight, and keep a back path to origin.
- **State:** No result, partial result, language server unavailable, and stale dirty-buffer states must be visible in the same reference surface.

### Command Palette And Quick Open

Command surfaces should share one grammar.

- **Field:** Icon, input, scope token, and optional count. No redundant title when placeholder and scope already describe the task.
- **Rows:** Leading icon, primary label, secondary path/description, trailing shortcut or state.
- **Selection:** Neutral selected fill plus strong text. Blue only when the row represents an active navigation target.
- **Keyboard:** Arrow keys, Enter, Escape, and type-to-filter are mandatory. Mouse hover must mirror keyboard selection.

### Tabs And Panes

Tabs are navigation for work surfaces, not decoration.

- **Active state:** Obvious through fill and text weight. Do not rely only on a small underline.
- **Dirty state:** Visible in tab title area. Dirty is a file state, not a breadcrumb afterthought.
- **Close affordance:** Hit target and visual target must match. Hide on rest only if focus and hover make it immediately available.
- **Split mode:** Pane headers and stacked tabs must use the same shape language, density, and active-state vocabulary.

### Inputs And Controls

- **Inputs:** 6-8px radius, 1px border, local surface background, clear focused state.
- **Icon buttons:** 24-28px hit target, 6-7px radius, neutral hover, visible selected state.
- **Chips:** Use chips only for scope, state, and compact metadata. Avoid large pills for primary actions.
- **Menus:** 30px rows, 4px inner padding, 6px item radius, popover shadow only.

## 6. Do's and Don'ts

### Do:

- **Do** design by workflow: edit, search, navigate, review, ask agent, return.
- **Do** give every search surface a scope, result count, keyboard path, and empty/partial/stale state.
- **Do** make search bars local to the surface they search unless the user explicitly opened a global search mode.
- **Do** use the same row anatomy for quick open, project search, references, diagnostics, and session search.
- **Do** keep chrome compact: 24-36px tool rows, 28-34px result rows, 4px spacing grid.
- **Do** make active pane, active row, active match, and active navigation target visually distinct.
- **Do** preserve route memory for navigation. Users need to see origin, destination, and how to get back.
- **Do** use low-contrast neutral fills before adding borders or saturated color.
- **Do** show file state in tabs and pane chrome, especially dirty, conflict, read-only, and truncated.
- **Do** keep power controls discoverable through icon buttons, tooltips, command palette entries, and keyboard hints.

### Don't:

- **Don't** treat feature parity as UX quality. A feature with weak placement, weak hierarchy, or no return path still feels broken.
- **Don't** stretch a session find bar across the whole app when it searches only the chat transcript.
- **Don't** make reference search feel like a static report. It is navigation and must behave like navigation.
- **Don't** use cards for every result group. Search, references, and diagnostics are row systems.
- **Don't** rely on right-click as the primary way to discover core editor actions.
- **Don't** encode important state with a tiny dot alone.
- **Don't** use full-saturation color for inactive states, hover states, or decoration.
- **Don't** make overlays block unrelated panes when a scoped inline or docked surface would work.
- **Don't** invent a different search component for every surface.
- **Don't** add explanatory UI copy to compensate for unclear structure.
