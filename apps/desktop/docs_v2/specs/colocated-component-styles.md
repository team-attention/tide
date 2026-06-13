# Spec: Colocated Component Styles

## Scope

Move every component's CSS out of the central `styles/` area files into a
`.css` file sitting NEXT to the component module that owns those class names
(`workbench/code-editor.css` beside `workbench/code-editor.ts`). Keep one
ordered import index so the cascade is byte-for-byte order-preserving.

## Evidence

- `styles/index.css` is already an explicitly ORDERED import list ("the file
  order below preserves the original cascade") over 8 area files (5.3k lines).
- Class names are BEM-prefixed and map 1:1 onto component modules (verified by
  grep for every ambiguous prefix).
- Tests run under `node --test` (no CSS loader), and several import component
  modules directly — so component files must NOT `import "./x.css"` themselves.

## Decisions

- **No css-in-js.** It would add a runtime dependency (perf budget), force a
  5.3k-line rewrite, and fight the existing `--tide-*` token + light/dark
  theme system. The user asked for PROXIMITY, not a styling runtime.
- **Colocated plain `.css` per component**, imported from `styles/index.css`
  via relative paths. Proximity for humans; ordering and node-test safety for
  the build.
- Cross-component/shared styles keep shared homes: design tokens, theme, `tok-*`
  palette in `styles/base.css`; shared markdown body in `support/markdown.css`.
- Block-to-file assignment is by leading class prefix; `@keyframes`/`@media`
  blocks follow the preceding rule's target (the authoring-adjacency pattern).

## Out Of Scope

- Renaming classes, CSS Modules, scoping changes — selectors stay global.
- Visual changes of ANY kind.

## Invariants

- `styles/index.css` import order = original area order, targets ordered by
  first appearance; total rule text preserved (whitespace-normalized).
- Every colocated `.css` is imported exactly once by `styles/index.css`
  (enforced by test).
- Component `.ts` files do not import CSS.

## Tests

- Architecture check in the suite: every `.css` under the renderer tree
  (except `styles/`) is referenced exactly once from `styles/index.css`, and
  no `.ts` file under the renderer imports a `.css`.
- Full suite + build + `pw-smoke.cjs` + `pw-editor-intel-verify.cjs` against
  the real app (rendering unchanged).

## Implementation Notes

Split performed by a one-shot parser (top-level blocks incl. nested @media /
@keyframes, comments attach forward) with an explicit prefix→target map;
unmapped prefixes fall back to the area's home component file.
