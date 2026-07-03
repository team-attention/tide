# Spec: Semantic Styled Components Migration

## Status

Implemented. This spec is the renderer styling source of truth after the
migration from global BEM-like component CSS to semantic React components backed
by `styled-components`.

Component-owned `.css` files are no longer part of the renderer architecture.
`styles/index.css` remains only as the Electron renderer global style entry,
and `tests/colocated-styles.test.ts` now enforces the global CSS whitelist plus
semantic `.parts.tsx` naming.

## Goal

Make the UI read like the product structure instead of a tree of anonymous DOM
tags plus distant class rules.

The target JSX should look like this:

```tsx
<ThreadRowFrame $active={active} data-thread-row={threadId}>
  <ThreadMainButton aria-describedby={contextId}>
    <ThreadTitle>{title}</ThreadTitle>
    <ThreadTime>{timeLabel}</ThreadTime>
  </ThreadMainButton>
  <ThreadActions>{actions}</ThreadActions>
</ThreadRowFrame>
```

The target is not a mechanical rewrite from:

```tsx
<div className="thread-row">
```

to:

```tsx
const ThreadRow = styled.div`...`;
```

The migration must improve ownership, naming, state expression, and local
readability.

## Non Goals

- Do not adopt an external design system as a runtime dependency.
- Do not replace Tide's visual language with Meta Astryx, StyleX, Tailwind, or
  another product system.
- Do not move external/generated DOM styling into styled-components when React
  does not own the DOM nodes.
- Do not introduce visual redesigns as part of the migration. Visual changes
  need their own spec.
- Do not keep old BEM classes solely for styling after a component is migrated.
  Stable behavior/test selectors should use `data-*`, ARIA, roles, and labels.

## Design System Reference Policy

External design systems may be used as references for taxonomy only:

- token categories
- component anatomy
- variant naming
- slot boundaries
- global-vs-component style separation
- documentation structure

They must not become a source of Tide component behavior, visual defaults, or
runtime dependency unless a separate adoption spec is written.

Tide's source of truth remains `DESIGN.md`: dense desktop-native layout,
restrained palette, low-glare surfaces, compact rows, scoped tools, shared
search grammar, and `--tide-*` theme tokens.

## Current Inventory

Renderer UI lives under:

```txt
apps/desktop/src/desktop/adapters/inbound/react-renderer/
```

Current styling facts after migration:

- CSS files: 3 global files (`styles/index.css`, `styles/base.css`, `styles/highlight-api.css`)
- Component-owned styles: semantic styled-components in `.tsx` / `.parts.tsx`
- Style entry: `styles/index.css`
- Token/global base: `styles/base.css`
- Current architecture guard: `tests/colocated-styles.test.ts`
- `styled-components` is installed in `apps/desktop/package.json`

Remaining coupling to keep documented:

- `styles/index.css` is still the Electron renderer global style entry.
- `colocated-styles.test.ts` enforces the global CSS whitelist.
- External/generated DOM selectors are scoped under styled hosts where possible.

## Ownership Model

Every style must fall into exactly one ownership bucket.

### 1. React Owned

React renders the DOM node directly and owns its states. These styles should
migrate to styled-components.

Examples:

- left rail rows, sections, menus, skeletons
- thread rows and project rows
- file tree rows, toolbar, search field, notices
- composer shell, toolbar, chips, attachments, choice surfaces
- settings modal and worktree dialogs
- quick open and content search
- workbench tabs, pane chrome, launcher, image pane
- browser bar, markdown/html preview chrome
- git changes panel chrome and file list
- prompt card shell/options/actions
- transcript turn shells, tool log chrome, reasoning disclosure

### 2. External Or Generated DOM

React may mount the host, but another library or string renderer owns descendant
DOM. These styles are not automatically global.

Default strategy: style them through a React-owned styled host with nested
selectors. The host gives the generated DOM a product-level boundary, and the
nested selectors stay scoped to that boundary.

```tsx
const CodeEditorScope = styled.div`
  min-height: 0;

  & .cm-editor {
    height: 100%;
    background: var(--tide-bg);
  }

  & .cm-scroller {
    font-family: "Roboto Mono", ui-monospace, monospace;
  }

  & .cm-tide-occurrence {
    background: color-mix(in srgb, var(--tide-accent) 18%, transparent);
  }
`;
```

Use global CSS only when the selector cannot be reliably scoped under a
React-owned host, when it targets the document/browser platform itself, or when
the library renders outside the host through a portal that cannot be redirected.

Examples:

- CodeMirror DOM: `.cm-*`, `.cm-tide-*`, `.cm-tooltip-*`
- xterm DOM: `.xterm`, `.xterm-viewport`, `.xterm-screen`
- markdown-it generated HTML: `.markdown-body`, `.md-code`, `.md-fence`,
  task-list classes, generated heading anchors
- Lezer token classes: `.tok-*`
- Electron `webview` host styling and global webview zoom hooks
- CSS Highlight API: `::highlight(tide-find-match)`,
  `::highlight(tide-find-active)`

### 3. Platform Global

Styles that apply to the document, browser engine, theme variables, or global
accessibility behavior remain global.

Examples:

- `:root` and `[data-theme="dark"]`
- `html`, `body`, `#root`
- `box-sizing`
- global focus-visible rules
- scrollbar rules
- reduced-motion media guard
- app-wide keyframes that intentionally cross component boundaries
- `VisuallyHidden` React primitive for accessible hidden labels

## Global CSS Whitelist

Keep `styles/index.css` as the renderer's global CSS entry so the Electron
entrypoints do not churn. It now imports only documented global files.

At a later cleanup, it may be renamed to `styles/global.css`; until then,
`index.css` remains the compatibility entry.

The exact file names can change, but the allowed global content is:

```txt
styles/base.css
styles/highlight-api.css            optional split from in-pane-find CSS
styles/webview.css                  only if direct element/global webview styling is required
styles/portal-overrides.css         only for third-party DOM mounted outside React scopes
```

Whitelist rules:

- Global files may style external/generated selectors only when scoped
  styled-components cannot own the boundary.
- Global files may define design tokens and platform rules.
- Global files may not contain component-owned BEM selectors after the owning
  component has migrated.
- Global files may use stable wrapper classes only when needed to scope an
  external library that cannot be expressed through a styled host.
- New global selectors require an owner comment explaining why React cannot own
  that DOM.

## Styled Components Rules

### Naming

Names describe product anatomy, not HTML tags.

Good:

```tsx
const ThreadRowFrame = styled.li`...`;
const ThreadMainButton = styled.button`...`;
const ThreadContextPopover = styled.div`...`;
const ComposerToolbar = styled.div`...`;
const CommandResultRow = styled.button`...`;
```

Bad:

```tsx
const StyledDiv = styled.div`...`;
const Row = styled.div`...`;
const Wrapper = styled.div`...`;
const S = { Div: styled.div`...` };
```

Short generic names are allowed only inside a very small component where the
domain is already in the file name and the element has one obvious meaning.

### File Placement

Default: define styled components in the same `.tsx` module as the React
component that uses them. The preferred file order is:

1. imports
2. exported/public component or factory
3. small render helpers used by that component
4. styled component declarations at the bottom

Example:

```tsx
import { styled } from "styled-components";

export function ThreadRow(props: ThreadRowProps): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <ThreadRowFrame $active={props.active}>
      <ThreadMainButton>{props.title}</ThreadMainButton>
    </ThreadRowFrame>
  );
}

const ThreadRowFrame = styled.li<{ $active: boolean }>`
  background: ${({ $active }) => ($active ? "var(--tide-selection)" : "transparent")};
`;

const ThreadMainButton = styled.button`
  min-width: 0;
`;
```

This order keeps the human-reading path at the top: imports, behavior, returned
structure, then visual definitions. A styled constant declared below the
component is fine because the function body runs after module initialization.

Use an adjacent `*.parts.tsx` file only when one of these is true:

- keeping styled declarations in the same `.tsx` would make the owner file hard
  to scan even with styled declarations at the bottom
- the same styled primitive is shared by sibling modules in the same directory
- the module contains multiple semantic subcomponents and the split gives those
  pieces clearer names, such as prompt cards or settings sections

Do not create mechanical `*.styles.tsx` files full of anonymous styled tags.
When a parts file exists, it must export named product components:

```tsx
export const ThreadRowFrame = styled.li`...`;
export const ThreadMainButton = styled.button`...`;
export const ThreadTitle = styled.span`...`;
```

### State Props

Use transient props for visual state so state does not leak to the DOM.

```tsx
const ThreadRowFrame = styled.li<{
  $active: boolean;
  $running: boolean;
  $attention: boolean;
}>`
  background: ${({ $active }) => ($active ? "var(--tide-selection)" : "transparent")};
`;
```

Allowed transient prop patterns:

- `$active`
- `$selected`
- `$open`
- `$expanded`
- `$disabled`
- `$danger`
- `$running`
- `$attention`
- `$tone`
- `$kind`
- `$depth`
- `$status`
- `$width`
- `$x`, `$y`

Keep `data-*` when it is a behavior boundary, test selector, analytics/debug
surface, or external script contract. Do not keep `data-*` only to style a
component that React already owns.

### Tokens

Styled components must read Tide CSS variables directly:

```tsx
color: var(--tide-text);
background: var(--tide-bg);
border-color: var(--tide-line);
```

Do not duplicate the token table in TypeScript. A future theme object can be
added only if it solves a concrete problem that CSS variables cannot solve.

Initial migration should not require a `ThemeProvider`.

### Dynamic Geometry

Inline styles and CSS variables are still acceptable for measured geometry and
high-frequency runtime values.

Keep as inline style or CSS variable:

- popover `left`, `top`, `width`
- split pane flex ratios
- drag/drop preview rectangles
- file-tree depth indentation
- skeleton randomized widths
- usage/progress fill percent
- editor/terminal selection toolbar coordinates
- changes panel dynamic grid columns

Move to transient props when the value is a discrete UI state, not measured
layout.

### Stable Selectors

Migrated components should not rely on generated styled-components class names.

Use:

- roles
- aria-labels
- semantic `data-*`
- text
- existing public attributes when already present

Examples:

```tsx
<ThreadRowFrame data-thread-row={threadId} data-left-row-kind="thread">
<CommandResultRow data-command-result={result.id}>
<ComposerShell data-composer-mode={mode}>
```

Do not add `data-testid` unless there is no product-meaningful selector.

### Scoped External Selectors

When a third-party or generated DOM tree is mounted inside a React component,
prefer a styled host over global CSS.

Use this for:

- CodeMirror editor DOM under the editor surface
- xterm DOM under the terminal pane
- markdown-it output under transcript/workbench markdown hosts
- syntax token classes when they appear inside known code/markdown hosts
- generated diff/code rows inside React-owned panes

```tsx
const MarkdownContentScope = styled.div`
  & .markdown-body > :first-child {
    margin-top: 0;
  }

  & .md-code {
    border: 1px solid var(--tide-line);
    border-radius: 8px;
    overflow: hidden;
  }

  & .tok-keyword {
    color: #a626a4;
  }
`;
```

This keeps selector knowledge local without pretending React owns every
descendant node.

Remain global only for:

- document selectors: `:root`, `html`, `body`, `#root`
- browser pseudo-elements and pseudo-classes that are intentionally global
- `::highlight(...)`
- reduced-motion and scrollbar policy
- third-party portals rendered outside the styled host
- Electron/webview platform quirks that cannot be scoped to a React boundary

## Area Migration Matrix

### Shell And Chrome

Files:

- `product-shell/product-shell.css`
- `product-shell/chrome/chrome.css`
- `product-shell/chat-column/chat-column.tsx`
- `app-chrome/app-chrome.tsx`

Target components:

- `ProductShellRoot`
- `ProductShellBody`
- `ColumnStage`
- `ColumnTopRow`
- `ColumnTopRowLeading`
- `ColumnTopRowTrailing`
- `TopRowButton`
- `WindowToggleCluster`
- `TrafficControls`
- `WorkbenchControlsMenu`
- `ColumnResizeHandle`
- `CollapsibleRegion`

Keep global:

- none by default, except platform-level resize/drag workarounds that prove
  difficult to scope.

Notes:

- `column-top-row`, resize handles, and shared top-row buttons are currently
  shared across shell, chat, rail, file tree, and workbench. Extract them before
  migrating every caller.

### Left Rail

Files:

- `left-rail/left-rail.css`
- `left-rail/section-header.css`
- `left-rail/context-menu.css`
- `left-rail/project-section.css`
- `left-rail/thread-row.css`
- `left-rail/skeletons.css`
- `multitask/multitask.css`

Target components:

- `LeftRailColumn`
- `LeftRailTopRow`
- `LeftRailNav`
- `LeftRailSearch`
- `LeftRailSearchInput`
- `LeftRailSection`
- `LeftRailSectionHeader`
- `LeftRailSectionBody`
- `RailNavRow`
- `ProjectGroup`
- `ProjectRowFrame`
- `ProjectRowButton`
- `ProjectRowActions`
- `ThreadRowFrame`
- `ThreadMainButton`
- `ThreadTitle`
- `ThreadTime`
- `ThreadActions`
- `ThreadContextPopover`
- `LeftRailContextMenu`
- `LeftRailContextMenuItem`
- `RailSkeletonRow`
- `MultitaskHud`
- `RailDragItem`
- `RailPeekPanel`

Keep stable selectors:

- `data-thread-row`
- `data-project-row`
- `data-left-row-kind`
- `data-running`
- `data-attention`
- `data-expanded`
- menu kind attributes used by tests/scripts

Keep inline/variable:

- thread context popover geometry
- skeleton row width variation

Notes:

- This is the best pilot area. It has high cognitive value and low external DOM
  risk.
- Replace class-based drag title lookup in `rail-drag.tsx` with stable
  `data-rail-title` or a passed label before removing old title classes.

### File Tree

Files:

- `file-tree/file-tree.css`
- `file-tree/file-tree.tsx`
- `file-tree/file-tree-context-menu.tsx`

Target components:

- `FileTreeColumn`
- `FileTreeTopRow`
- `FileTreeToolbar`
- `FileTreeSearch`
- `FileTreeEntries`
- `FileTreeRow`
- `FileTreeRowButton`
- `FileTreeChevron`
- `FileNameCell`
- `FileTreeInlineInput`
- `FileTreeNotice`
- `FileTreeContextMenu`
- `FileTreeSkeletonRow`

Keep stable selectors:

- `data-file-kind`
- `data-depth`
- `data-expanded`
- `data-drag-over`
- `data-git-status`

Keep inline/variable:

- `--file-tree-depth` or `$depth`
- skeleton widths

Notes:

- This area is performance-sensitive because rows are memoized and can be many.
  Keep styled components defined outside render paths.
- Git status styling can move from attribute selectors to `$gitStatus`.

### Search And Command Surfaces

Files:

- `search/quick-open.css`
- `search/content-search.css`
- `support/in-pane-find.css`

Target components:

- `CommandBackdrop`
- `CommandSurface`
- `CommandField`
- `CommandInput`
- `CommandCount`
- `CommandResults`
- `CommandResultRow`
- `CommandResultIcon`
- `CommandResultPrimary`
- `CommandResultMeta`
- `ContentSearchGroup`
- `ContentSearchHit`
- `MatchHighlight`
- `InPaneFindBar`
- `InPaneFindInput`
- `FindIconButton`
- `FindMatchCount`

Keep global:

- `::highlight(tide-find-match)`
- `::highlight(tide-find-active)`

Keep stable selectors:

- selected result attributes
- any command/action attributes used by keyboard scrolling

Notes:

- Quick Open, Content Search, and In-Pane Find should share one command/search
  grammar. This is a design-system extraction point.

### Agent Chat Shell

Files:

- `agent-chat/agent-chat.css`
- `agent-chat/start-surface/start-surface.css`
- `agent-chat/thread-header/thread-header.tsx`

Target components:

- `AgentChatShell`
- `AgentChatTopRow`
- `AgentChatSessionRegion`
- `AgentChatFindRegion`
- `AgentChatComposerStack`
- `AgentChatThreadHeader`
- `AgentChatStateLabel`
- `StartSurface`
- `DescriptionPair`
- `ImageLightboxBackdrop`
- `ImageLightboxImage`
- `SelectionToolbar`

Keep stable selectors:

- `data-chat-state`
- `data-runtime-state`
- `data-thread-mode`

Keep inline:

- selected text toolbar coordinates
- hidden file input display rule can become a visually hidden primitive

Notes:

- The selection toolbar is shared with editor/terminal. Extract one
  `SelectionToolbar` primitive before migrating all callers.

### Composer

Files:

- `composer/composer.css`
- `composer/context-chips.css`
- `composer/choice-surface.css`
- `composer/usage-meter.css`
- `composer/steer-queue.css`
- `composer/opencode-connect-panel.css`

Target components:

- `ComposerShell`
- `ComposerBody`
- `ComposerInput`
- `ComposerToolbar`
- `ComposerToolbarLeft`
- `ComposerToolbarRight`
- `ComposerIconButton`
- `ComposerSendButton`
- `ComposerAttachment`
- `ComposerChipCard`
- `ComposerContextChip`
- `ChipPopover`
- `ChoiceSurface`
- `ChoiceSurfaceHeader`
- `ChoiceSurfaceRows`
- `ChoiceRow`
- `ChoiceRowIcon`
- `ChoiceRowLabel`
- `ChoiceRowMeta`
- `ChoiceInlineCreate`
- `UsageMeter`
- `UsageSegment`
- `SteerQueueStack`
- `SteerQueueItem`
- `OpenCodeConnectPanel`
- `OpenCodeMethodTile`

Keep stable selectors:

- `data-composer-mode`
- `data-context-kind`
- `data-agent-runtime-source`
- `data-choice-surface`
- `data-choice-source`
- `data-choice-tab-target`
- `data-selected`
- setup/onramp attributes such as `data-reconnect`

Keep inline/variable:

- usage bar fill percentage
- popover anchor geometry

Notes:

- Many Playwright scripts currently depend on `.composer-shell__context-chip`,
  `.composer-shell__send`, and `.choice-surface__row`. Convert those scripts to
  `data-*`/role selectors before removing classes.
- `choice-surface.tsx` uses DOM proximity with `.agent-chat-shell` and
  `.composer-shell`. Replace with refs or stable data selectors before full
  class removal.

### Prompt Cards

Files:

- `prompt-card/prompt-card.css`
- `prompt-card/prompt-card.tsx`

Target components:

- `PromptCardShell`
- `PromptCardHead`
- `PromptCardKind`
- `PromptCardBody`
- `PromptMessage`
- `PromptDetail`
- `PromptOptions`
- `PromptOptionButton`
- `PromptRadio`
- `PromptActions`
- `PromptSkipButton`
- `PromptSubmitButton`
- `PromptWizardHead`
- `PromptStepDot`
- `PromptNote`

Keep stable selectors:

- `data-kind`
- `data-format`
- `data-selected`
- `data-active`
- `data-answered`
- `data-multi`
- `data-line`

Notes:

- Prompt card should not be the first migration. The file is behavior-heavy.
  The migration may split anatomy first or split it while moving styles,
  whichever produces the smaller, safer patch. The final shape must expose
  named anatomy such as `PromptCardShell`, `PromptOptions`, and `PromptActions`
  rather than one large styled wrapper.
- Current scripts rely heavily on `.prompt-card`, `.prompt-card__option`,
  `.prompt-card__submit`, and message/detail classes. Replace those selectors
  before class removal.

### Transcript

Files:

- `transcript/transcript.css`
- `transcript/agent-turn.css`
- `transcript/tool-log.css`
- `transcript/reasoning.css`
- `transcript/working-indicator.css`
- `support/markdown.css`

Target components:

- `AgentSession`
- `AgentSessionTurn`
- `TurnLabel`
- `TurnBody`
- `UserTurnBubble`
- `AgentTurnActions`
- `AgentTurnActionButton`
- `ToolLogGroup`
- `ToolLogSummary`
- `ToolLogDetail`
- `ToolFileRow`
- `ReasoningDisclosure`
- `ReasoningSummary`
- `ReasoningBody`
- `WorkingIndicator`
- `SessionEmptyState`
- `SessionSkeleton`

Scoped external selectors:

- `.markdown-body`
- `.md-code`
- `.md-code__header`
- `.md-code__copy`
- `.md-code__quote`
- `.md-fence`
- `.tok-*`
- markdown task-list classes

Keep stable selectors:

- `data-block-id`
- `data-block-role`
- `data-block-kind`
- `data-block-status`
- `data-block-phase`
- `data-parent-block-id`
- `data-open-file`
- `data-open-browser-link`
- `data-edit-queued`

Notes:

- `transcript.tsx` delegates clicks with `.md-code__copy`,
  `.agent-turn-actions__btn--copy`, and related selectors. Generated markdown
  classes may still be styled inside a `MarkdownContentScope`; behavior
  selectors should move to stable `data-*` or refs before old classes are
  removed.
- React-owned turn chrome can migrate separately from markdown body styling.

### Workbench Column And Tabs

Files:

- `workbench/workbench.css`
- `workbench/split-view.css`
- `workbench/pane-content.css`
- `workbench/pane-chrome.css`
- `workbench/launcher-pane.css`

Target components:

- `WorkbenchColumn`
- `WorkbenchTopRow`
- `WorkbenchTabs`
- `WorkbenchTab`
- `WorkbenchTabLabel`
- `WorkbenchTabCloseButton`
- `WorkbenchPane`
- `WorkbenchEmptyState`
- `WorkbenchSplit`
- `SplitNode`
- `SplitSlot`
- `SplitDivider`
- `SplitPane`
- `SplitPaneHeader`
- `SplitDropPreview`
- `PaneContent`
- `PaneHeading`
- `EditorPicker`
- `LauncherPane`
- `LauncherAction`

Keep stable selectors:

- `data-column`
- `data-layout`
- `data-fullscreen`
- `data-pane-id`
- `data-pane-kind`
- `data-active`
- `data-kind`
- `data-corner`
- `data-launcher-action`

Keep inline:

- split ratios
- drop preview rectangle

Notes:

- `split-view.tsx` queries `.workbench-split__pane` during drag. Replace with a
  stable `data-split-pane` selector before removing the class.
- Split view overlays must continue to protect drag behavior over webview and
  terminal panes.

### Editor, Diff, Changes, Markdown, HTML, Browser, Image, Terminal

Files:

- `workbench/editor-pane.css`
- `workbench/code-editor.css`
- `workbench/diff-pane.css`
- `workbench/changes-panel.css`
- `workbench/markdown-view.css`
- `workbench/html-view.css`
- `workbench/browser-pane.css`
- `workbench/image-pane.css`
- `workbench/terminal-pane.css`

Target components:

- `EditorPaneContent`
- `EditorBreadcrumb`
- `BreadcrumbCrumb`
- `ReferencesPanel`
- `ReferenceResultRow`
- `CodeEditorSurface`
- `EditorCommandBar`
- `EditorCommandButton`
- `EditorContextMenu`
- `DiffPane`
- `DiffRow`
- `ChangesPane`
- `ChangesHeader`
- `ChangedFileRow`
- `ChangesDiffViewport`
- `MarkdownView`
- `MarkdownHeader`
- `MarkdownToggle`
- `MarkdownPreviewHost`
- `HtmlView`
- `HtmlHeader`
- `HtmlToggle`
- `HtmlPreviewStage`
- `BrowserPaneContent`
- `BrowserToolbar`
- `BrowserAddressInput`
- `BrowserNativeStage`
- `ImageStage`
- `TerminalPaneContent`
- `TerminalHost`

Scoped external selectors:

- `.cm-*`
- `.cm-tide-*`
- `.cm-tooltip-*`
- `.xterm*`
- `.markdown-body`
- markdown pick classes if classList remains the implementation

Keep global:

- `webview` host selectors if direct element styling is required

Keep stable selectors:

- `data-editor-readonly`
- `data-editor-language`
- `data-navigation-target`
- `data-md-mode`
- `data-md-picking`
- `data-html-mode`
- `data-native-runtime`
- `data-terminal-role`
- `data-terminal-status`
- `data-terminal-xterm`

Keep inline:

- editor context menu coordinates
- editor/terminal selection toolbar coordinates
- markdown selection toolbar coordinates
- changes panel grid template columns

Notes:

- CodeMirror and xterm are non-React DOM islands, but their styling should be
  scoped under `CodeEditorScope` and `TerminalHost` styled components where
  possible.
- Markdown preview is hybrid: header/toggle/chrome should migrate; generated
  `.markdown-body` content should sit under a `MarkdownContentScope`.
- Browser pane chrome should migrate; native webview behavior and host element
  quirks can remain global.

### Settings, Dialogs, Support

Files:

- `settings/settings.css`
- `dialogs/worktree-dialogs.css`
- `support/app-update-pill.css`
- `support/global-zoom.css`
- `support/error-boundary.tsx`
- `support/agent-identity.tsx`

Target components:

- `SettingsBackdrop`
- `SettingsModal`
- `SettingsHeader`
- `SettingsSection`
- `SettingsField`
- `SettingsInput`
- `SettingsThemeOption`
- `SettingsProviderRow`
- `UsageDetails`
- `DialogBackdrop`
- `DialogSurface`
- `DialogTitle`
- `DialogPreview`
- `DialogActions`
- `DialogCancelButton`
- `DialogConfirmButton`
- `AppUpdateButton`
- `ZoomIndicator`
- `PaneErrorFallback`
- `AppErrorFallback`
- `AgentIdentityIcon`
- `VisuallyHidden`

Keep stable selectors:

- `data-active`
- `data-installed`
- update status attributes if added during migration

Keep inline/variable:

- app update progress percent
- fatal error fallback may keep inline style until styled-components is
  available in error-boundary tests

Notes:

- Settings and dialogs are good for extracting modal/field/button primitives.
- `AgentIdentityIcon` may keep the `.agent-identity-icon` compatibility class
  during early phases because it crosses composer, transcript, menus, and
  settings. The final target is a shared styled `AgentIdentityIcon` component
  with no global styling class.

## Shared Primitives

Create primitives only when at least two areas need the same anatomy. Avoid a
large abstract UI kit upfront.

Initial primitives:

- `IconButton`
- `TopRowButton`
- `RowButton`
- `RowTitle`
- `MutedMeta`
- `SearchField`
- `CommandSurface`
- `CommandResultRow`
- `PopoverSurface`
- `DialogSurface`
- `ModalBackdrop`
- `SegmentedControl`
- `SelectionToolbar`
- `VisuallyHidden`

Primitive rules:

- Primitives are styled-components with semantic names.
- Primitives accept transient visual props.
- Primitives do not know product-specific behavior.
- Product-specific components wrap primitives with domain names when useful.

## Migration Phases

### Phase 0: Architecture Prep

1. Add this spec as the migration source of truth.
2. Add `styled-components` dependency to `apps/desktop/package.json`.
3. Decide whether to use a minimal `StyleSheetManager` at the renderer root.
4. Keep `ThemeProvider` out of the first pass.
5. Replace `colocated-styles.test.ts` with a new style ownership test.
6. Update `implementation/source-map.md` so it points readers to same-file
   styled components first, shared `.parts.tsx` second, and global CSS only for
   platform or scoped-external exceptions.

### Phase 1: Stable Selectors

Before removing major classes, convert test/script contracts from CSS classes
to stable selectors.

Start with:

- `.thread-row__main`
- `.composer-shell__context-chip`
- `.composer-shell__send`
- `.choice-surface__row`
- `.file-tree-row`
- `.prompt-card`
- `.prompt-card__option`
- `.workbench-tab`
- `.workbench-editor-cm`

Preferred replacements:

- existing `data-*`
- new product-meaningful `data-*`
- ARIA labels
- role selectors

Selector migration is split into two tracks:

- Active tests and active scripts are migration blockers. They must stop using
  visual styling classes before the related classes are removed.
- `scripts/archive/` is not a migration blocker. Archived scripts can keep old
  selectors until someone reactivates them; reactivation requires updating their
  selectors to the current stable `data-*`/ARIA contract.

### Phase 2: Left Rail Pilot

Migrate:

- `thread-row`
- `project-section`
- `left-rail`
- `context-menu`
- `section-header`
- `skeletons`

Validate:

- thread list render tests
- quick actions tests
- left-rail drag tests
- focused Playwright scripts that open/select threads
- visual smoke in light and dark themes

### Phase 3: Row And Command Grammar

Migrate:

- `file-tree`
- `quick-open`
- `content-search`
- `in-pane-find` except highlight globals

Extract:

- `SearchField`
- `CommandSurface`
- `CommandResultRow`
- `RowButton`
- `MutedMeta`

Validate:

- file operations scripts
- quick open/content search keyboard behavior
- find highlight behavior
- large file tree rendering

### Phase 4: Composer And Choice Surfaces

Migrate:

- composer shell
- context chips
- choice surface
- usage meter
- steer queue
- opencode connect panel

Validate:

- provider setup scripts
- permission/model/agent menu scripts
- composer focus tests
- new branch input tests
- live activity scripts

### Phase 5: Workbench Chrome

Migrate:

- workbench tabs
- split pane chrome
- pane content shell
- launcher
- browser toolbar
- image pane
- diff pane
- changes panel shell/file list

Scope external selectors through styled hosts:

- CodeMirror DOM under `CodeEditorScope`
- xterm DOM under `TerminalHost`
- markdown body under `MarkdownContentScope`

Keep global:

- webview quirks

Validate:

- workbench tab strip tests
- split/drag behavior
- browser pane scripts
- editor picker scripts
- git changes tests

### Phase 6: Settings, Dialogs, Support

Migrate:

- settings modal
- worktree/branch/delete dialogs
- update pill
- zoom indicator
- error boundaries
- agent identity icon

Validate:

- settings SSR tests
- branch/worktree deletion tests
- app update tests
- zoom scripts

### Phase 7: Transcript And Prompt Cards

Migrate React-owned parts only:

- turn shell
- agent/user bubble chrome
- tool log chrome
- reasoning disclosure
- working indicator
- prompt card shell/options/actions

Scope external selectors through styled hosts:

- generated markdown
- generated code-block controls until markdown rendering is React-owned
- syntax token classes

Validate:

- prompt pipeline scripts
- multi-step prompt tests
- transcript scroll tests
- markdown copy/quote/retry behavior
- live provider activity tests

## Test And Guard Updates

Replace `colocated-styles.test.ts` with tests that enforce the new ownership
model.

Required checks:

1. Global CSS whitelist
   - Only whitelisted `.css` files may remain under `react-renderer`.
   - Non-whitelisted `.css` files must fail the test once their area has
     migrated.

2. No component CSS imports
   - Component modules should not import `.css`.
   - Renderer entrypoints may import the global CSS entry.

3. No new BEM styling classes in migrated areas
   - Migrated files should not introduce new `className="foo__bar"` styling
     selectors.
   - Stable legacy classes may remain only during the phase that migrates tests.

4. Stable selector coverage
   - Test-facing components should expose product-meaningful `data-*` or ARIA
     selectors.

5. External selector ownership
   - `.cm-*`, `.xterm*`, `.markdown-body`, `.md-*`, and `.tok-*` are allowed
     inside documented styled host components.
   - The same selectors are allowed in global CSS only with an owner comment
     explaining why a styled host cannot scope them.
   - `webview` and `::highlight(...)` may remain global when they target
     platform behavior rather than component-owned descendants.

6. Styled component naming
   - Parts files may not export `Wrapper`, `Container`, `StyledDiv`, or generic
     `S` bags.

## Verification Matrix

Each migration phase should run:

```bash
npm run typecheck
npm run test:v2
npm run build
```

Focused checks by area:

- left rail: thread row quick actions, drag render, thread list snapshot
- file tree: file tree ops, start page tree, trust editor
- composer: composer focus, choice surface tab navigation, provider setup
- workbench: workbench code editor, terminal view, tab strip, browser runtime
- prompt/transcript: multi-step prompt, provider E2E, scroll/restart scripts
- scoped external islands: editor intel, html preview, zoom, markdown copy/quote

Every phase must be checked in both light and dark theme when the changed
styles touch color, border, focus, or shadows.

## Completion Criteria

The migration is complete when:

- all React-owned component CSS has moved to semantic styled-components
- `styles/index.css` has shrunk to global/platform styles
- component JSX uses semantic styled elements instead of anonymous `div` trees
  with style classes
- old styling classes are removed unless they are explicitly part of an
  external/generated DOM contract
- tests and scripts use stable product selectors instead of visual class names
- no component relies on styled-components generated class names for behavior
- `DESIGN.md` tokens are still consumed through `--tide-*` variables
- CodeMirror, xterm, markdown-generated DOM, and token highlighting are scoped
  under documented styled hosts wherever possible
- webview quirks and Highlight API rules are isolated in documented global files

## Settled Decisions

- Keep `styles/index.css` as the compatibility global entry. Rename to
  `styles/global.css` only in a separate cleanup if desired.
- Source-map documentation points readers to same-file styled components first,
  shared `.parts.tsx` second, and global CSS only for platform or
  scoped-external exceptions.
- Active tests and active Playwright scripts are migration blockers. Archived
  scripts under `scripts/archive/` are a separate cleanup track and are updated
  only when reactivated.
- Prompt-card anatomy is split into named semantic parts before the styled
  migration is considered complete.
- `AgentIdentityIcon` is a shared styled component with no global styling class.
