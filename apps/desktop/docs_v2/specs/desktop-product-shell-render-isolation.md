# Spec: Product Shell Render Isolation

## Scope

Make the Desktop Product Shell re-render only the components whose state actually
changed, instead of rebuilding the whole tree on every `setShellState`.

Introduce an external store for `ProductShellState` plus memoized per-area selectors,
and turn the column builder functions into `React.memo` components that subscribe to
only their slice. Stabilize the handler objects so they keep their identity across
renders. The event-sourced reducers, the contract DTOs, and the rendered output stay
exactly the same — only the *subscription boundary* and the *render layer* change.

This is a whole-shell change (all four columns + chrome + overlays + handlers), landed
behind the existing render-output tests.

## Evidence

Current architecture (all in `src/desktop/adapters/inbound/react-renderer/product-shell/`):

- `product-shell.ts:220` — one `useState(() => createProductShellState(...))` holds the
  entire `ProductShellState` at the root.
- `product-shell.ts:699` — `viewModel = useMemo(() => createProductShellViewModel(shellState), [shellState])`
  recomputes the **entire** view model on every state change (clones the file tree, maps
  every thread, etc. — `view-model.ts:80-138`).
- `product-shell.ts:725-730` — `handlerContext` and the merged `handlers` object are
  rebuilt fresh every render, so every handler has a new identity each render.
- `product-shell.ts:876-880` — the columns are **plain function calls**
  (`createLeftRail(layoutVm, handlers, …)`, `createAgentChatColumn(layoutVm, handlers)`,
  `createWorkbenchColumn(...)`, `createFileTreeColumn(...)`), not React components. There
  is **no `React.memo` anywhere** in the product-shell renderer, so there is no boundary
  at which React can bail out of re-rendering.

Consequence: every `setShellState` — including the rAF-batched streaming path
(`flushPending`, `product-shell.ts:611-651`) that fires continuously while an agent is
"Working" — re-runs the whole view model and every column builder. For plain DOM this is
tolerable (React diffs the vdom), but imperative widgets keyed on **prop identity** are
not diffed away:

- CodeMirror via `@uiw/react-codemirror` reconfigures on each new `extensions` array
  (`code-editor.ts:254-259`), which resets the Lezer parse — so syntax highlighting
  drops out while the shell re-renders rapidly. The code-intel extensions were memoized
  + given module-level state specifically to survive this (`code-editor.ts:93-105`); the
  grammar extension and `saveKeymap` were left un-memoized.
- Terminal output already bypasses React entirely for the same reason
  (`product-shell.ts:654-661`).

So the re-render storm is a known, hand-patched-per-widget problem; this spec removes the
storm at the source.

## Decisions

- **Mechanism (user):** external store + `useSyncExternalStore` selectors. React 19 ships
  `useSyncExternalStore` in core, so **no new dependency**. The with-selector variant is
  hand-rolled via memoized selectors (see Implementation Notes).
- **Scope (user):** whole shell in one spec.
- **Preserve the reducer:** the event-sourced state reducers (`applyProductShellBackendEvent`
  and the `state/*.ts` reducers) and their tests are unchanged. The store's `setState`
  takes the same `(state) => state` updaters that `setShellState` takes today.
- **Preserve output + view-model values:** area selectors return the *same shape and
  values* the current `createProductShellViewModel` produces for each area; only the
  composition/memoization changes. Existing `renderToStaticMarkup` tests pin parity.
- **Handlers built once** and read/write live state through the store, so their identity
  is stable across renders.

## Out Of Scope

- Backend, Shared Contracts, Electron Main — untouched.
- The reducer logic and the view-model *content* (slice shapes/values stay identical).
- Styling/CSS.
- Any third-party state library (Zustand/Jotai/Redux). Hand-rolled, zero new deps.
- The editor's own un-memoized grammar/`saveKeymap` (`code-editor.ts`) is a separate,
  smaller fix; this spec makes it unnecessary for the *cross-column* case (a chat token
  no longer re-renders the workbench), but the editor-local memoization can still land on
  its own.

## Domain Model

- **`ProductShellStore`** — holds the live `ProductShellState`.
  - `getState(): ProductShellState`
  - `setState(updater: (s) => s): void` — applies the updater; if the result is a new
    reference, stores it and notifies subscribers; a no-op updater (same ref) notifies
    nothing.
  - `subscribe(listener: () => void): () => void`
- **Area selectors** — memoized `(state) => areaViewModel` over the existing view-model
  slices:
  - `selectLayoutVm` (open/closed flags + the column-presence inputs)
  - `selectLeftRailVm`, `selectChatVm`, `selectWorkbenchVm`, `selectFileTreeVm`
  - overlay/global selectors: `selectQuickOpen`, `selectContentSearch`, `selectDialogs`,
    `selectEditorPicker`, `selectBackgroundBrowserPanes`.
- **Stable handlers** — the merged handlers object built once; each handler reads
  `store.getState()` / calls `store.setState(...)` instead of closing over a render-time
  `shellState`/`viewModel`.

## Contracts

No process-boundary contract changes. New *internal* module boundaries only:

- `state/store.ts` — `createProductShellStore`, `ProductShellStore` type.
- `state/selectors.ts` (or per-area files) — `createSelector` util + the area selectors.
- `react-renderer/product-shell/store-context.ts` — `StoreContext`, `useProductShellStore`,
  `useProductShellSlice(selector)`.

## Flow

1. A backend event or UI action calls `store.setState(reducer)` (same reducers as today).
2. The store swaps in the new state and notifies subscribers.
3. Each column component's `useProductShellSlice(selectXVm)` recomputes its selector.
4. The memoized selector returns the **same reference** when its inputs are unchanged, so
   `useSyncExternalStore` sees an unchanged snapshot and the `React.memo` column does not
   re-render. Only the column whose slice changed gets a new reference and re-renders.
5. Imperative widgets (CodeMirror, terminal, webview) therefore only receive new props
   when *their own* slice changes — a chat token no longer reconfigures the editor.

## Invariants

1. **Reference-stability (the testable core):** a state delta touching only area X must
   leave every *other* area selector's output reference unchanged
   (`selectWorkbenchVm(after) === selectWorkbenchVm(before)` when only chat changed).
2. **Output parity:** for a given `ProductShellState`, the rendered HTML is identical to
   the pre-refactor shell (existing static-render tests).
3. **Handler stability:** handler identities do not change across renders that do not
   change their dependencies.
4. **SSR safe:** `renderToStaticMarkup` still works — the hook provides a
   `getServerSnapshot`.
5. **No torn reads:** within one render pass every selector reads the same `getState()`.

## Tests

- `product-shell-store.test.ts` — subscribe/notify/unsubscribe; `setState` with a no-op
  updater notifies nothing; sequential updaters compose.
- `product-shell-selectors.test.ts` — `createSelector` recomputes only when an input ref
  changes (single-slot memo); **reference-stability matrix**: for each area, mutate a
  different area via a real reducer/event and assert this area's selector ref is
  unchanged (chat delta ⇒ workbench/filetree/leftRail refs stable; fileTree delta ⇒
  chat/workbench refs stable; etc.).
- `product-shell-render-isolation.test.ts` (jsdom + `react-dom/client` + `act`) — mount a
  store provider with two `React.memo` columns each incrementing a render counter;
  dispatch a chat-only `setState`; assert the workbench column's counter is unchanged and
  the chat column's incremented.
- Existing `desktop-product-shell-visual-foundation.test.ts` and the other
  `renderToStaticMarkup` suites stay green (output parity).

## Implementation Notes

- **`createSelector(inputs[], combiner)`** — tiny reselect-style single-slot memo: cache
  the last input tuple + output; recompute only when some input fails `Object.is`. Correct
  for a single live store (one state lineage).
- **`useProductShellSlice(selector)`** =
  `useSyncExternalStore(store.subscribe, snap, snap)` where `snap = () => selector(store.getState())`.
  Because the area selectors are memoized (reference-stable), `snap` returns a stable ref
  when nothing in the slice changed — no extra in-hook caching, no tearing/loops. Inline
  ad-hoc selectors that build fresh objects must NOT be passed to this hook; only the
  memoized area selectors (or `Object.is`-stable scalar reads).
- **Provider:** `StoreContext.Provider value={store}` at the `ProductShell` root. The store
  instance is created once (`useRef`/`useState` initializer) so the context value is stable
  and never itself triggers consumer re-renders.
- **Columns:** convert `createLeftRail` / `createAgentChatColumn` / `createWorkbenchColumn`
  / `createFileTreeColumn` into `React.memo` components that read their area selector via
  the hook and take stable handlers. Keep their existing internal element structure so the
  static-render output is unchanged.
- **Handlers:** build once (`useMemo([])`), reading live state through `store.getState()`
  and writing through `store.setState(...)`; replace the `handlerContext` fields
  `shellState`/`viewModel`/`setShellState` with store access. Renderer-local React state
  that drives layout (menuAnchor, columnWidths, isResizing, quickOpen/contentSearch
  visibility, worktree dialogs, themePref) either moves into the store or is exposed via
  stable setter refs so handler identity stays stable.
- **`createProductShellViewModel`** stays as the composition of the area selectors (so any
  whole-vm consumer/tests keep working); columns consume the area selectors directly.
- **Staging:** land store + selectors + tests first (additive, no behavior change), then
  convert columns one at a time behind the green static-render suite, then stabilize
  handlers. Typecheck + full suite at each step.
