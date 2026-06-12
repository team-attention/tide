# Spec: Workbench Editor Language Intelligence

## Scope

Bring the Editor Pane to VS Code/Warp-level language intelligence:

- **Autocomplete** while typing (LSP-quality, not word-list).
- **Hover** type/doc tooltips.
- **Diagnostics** (squiggles + gutter) for the open file.
- **Occurrence highlighting** — all uses of the symbol under the cursor light up.
- **Signature help** when typing call arguments.
- **Cmd+hover underline** affordance for the existing Cmd+Click go-to-definition.
- **Richer syntax highlighting** — the editor adopts the same One Dark `tok-*`
  token CSS the chat transcript already uses, plus more bundled grammars
  (Python, Go, HTML, YAML, SQL, XML, C++, Java, shell/TOML via legacy modes).
- **Context menu** grows Cut/Copy/Paste and keeps Go to Definition /
  Find References / Add selection to chat / Save.
- **Real LSP**: definition/references/hover/completions for non-TS languages via
  language servers found on PATH (rust-analyzer, gopls), behind the same port.

## Evidence

- `src/backend/adapters/outbound/code-intelligence/typescript-code-intelligence-port.ts`
  builds and disposes a full `ts.createLanguageService` **per query** and reads
  files only from disk — correct but slow on large roots and blind to unsaved
  editor drafts.
- `src/desktop/adapters/inbound/react-renderer/product-shell/workbench/code-editor.ts`
  already has Cmd+Click → go_to_definition and a context menu; no completion/
  hover/lint extensions are registered.
- `window.tide.sendBackendCommand(envelope)` returns that command's event
  envelopes as a Promise (`renderer-entry.ts`), so query-style round-trips
  (completion/hover) need no new transport — mirror `workspace.searchContent`.
- Chat code blocks are highlighted with `@lezer/highlight`'s `classHighlighter`
  and themed `tok-*` rules in `styles/base.css` (light + dark). The editor uses
  CodeMirror's default highlight style instead — visibly poorer.
- `rust-analyzer` and `gopls` exist on PATH on the primary dev machine;
  `typescript-language-server` does not, but the `typescript` package (tsserver's
  engine) is already a dependency.

## Decisions

- **D1 — Two engines, one port.** TS/JS intelligence stays in-process on a
  persistent `ts.LanguageService` (tsserver's own engine; zero install). Other
  languages go through a generic LSP stdio client when a known server binary is
  on PATH (`rust-analyzer` for `.rs`, `gopls` for `.go`). A router adapter picks
  by file extension. (User direction: "아마 실제로 LSP 써야할듯" — real LSP, but
  TS must not regress when no server is installed.)
- **D2 — Dirty buffers are first-class.** Every query carries the live editor
  content; the TS host overlays it as a versioned script snapshot, the LSP
  client syncs it via `didOpen`/`didChange` (full-text sync). Intelligence must
  reflect what the user sees, not what's on disk.
- **D3 — Query transport mirrors content search.** New command
  `workspace.codeIntel` → new event `workspace.codeIntelResult`, correlated by
  `requestId`; results never enter shell state (no re-render per keystroke).
- **D4 — Diagnostics are pull-from-cache for LSP.** LSP servers push
  `publishDiagnostics`; the client caches the latest per file and the
  diagnostics query returns the cache. TS computes syntactic+semantic
  diagnostics on demand. The editor lints the open file only.
- **D5 — Editor token theme = chat token theme.** The editor registers
  `syntaxHighlighting(classHighlighter)` so the existing `tok-*` CSS variables
  style it in both themes; no second palette.

## Out Of Scope

- Rename refactoring, code actions, workspace symbol search, semantic tokens.
- Installing/downloading language servers (PATH detection only).
- Cross-root (multi-project) navigation; the Thread root stays the boundary.
- Diff pane upgrades; markdown preview changes.

## Domain Model

- `WorkspaceCodeIntelligencePort` (backend outbound port) grows:
  `getCompletions`, `getHover`, `getDocumentHighlights`, `getSignatureHelp`,
  `getDiagnostics` — all `{root, path, content?, line, character}` (0-based,
  `content` optional dirty buffer), plus existing `findDefinition`/
  `findReferences` which also accept `content?`.
- `LspClient` (backend adapter infra): one spawned server per (root, serverId),
  JSON-RPC over stdio with Content-Length framing, lifecycle
  initialize→initialized→didOpen→didChange→requests, latest-diagnostics cache,
  idle process reuse, dispose on backend shutdown.

## Contracts

- `workspace.codeIntel` command payload:
  `{ cwd, path, content?, kind: "completion"|"hover"|"highlights"|"signature"|"diagnostics", line?, character? }`.
- `workspace.codeIntelResult` event payload (union by `kind`):
  - `completions`: `[{ label, kind?, detail?, insertText?, sortText? }]` (≤80)
  - `hover`: `{ contents, line?, character?, length? } | null`
  - `highlights`: `[{ line, character, length, kind? }]`
  - `signature`: `{ signatures: [{ label, parameters: [{ label }] }], activeSignature, activeParameter } | null`
  - `diagnostics`: `[{ line, character, length, message, severity }]`

## Flow

1. CodeMirror extension (autocomplete source / hover / lint / cursor-idle
   occurrence plugin / signature trigger) fires in the Editor Pane.
2. Renderer `code-intel` gateway posts `workspace.codeIntel` through
   `onBackendCommand` and awaits the returned envelopes; picks
   `workspace.codeIntelResult`.
3. Contract adapter routes to `ThreadRuntimeService.queryWorkspaceCodeIntel`
   (delegating to `WorkbenchCommandHandler`, which owns the port).
4. Router adapter: `.ts/.tsx/.js/...` → persistent TS service; `.rs` →
   rust-analyzer LSP; `.go` → gopls LSP; otherwise
   `workspace_code_intelligence_unavailable`.
5. Existing `go_to_definition` / `go_to_references` workbench commands keep
   their pane-snapshot flow but now hit the persistent engines (and accept the
   dirty buffer via command data `content`).

## Invariants

- Queries never mutate Workbench state; only `go_to_definition`/`references`
  do (unchanged).
- All positions cross the contract 0-based (line and character); the TS adapter
  and LSP client convert internally.
- A missing language server degrades to a clean `unavailable` error — the
  editor simply shows no intelligence for that file; no spawn retry storms
  (failed spawn is remembered per server for the backend lifetime).
- Paths outside the Thread root are rejected (existing `resolveInsideRoot`).
- LSP child processes are reaped on backend shutdown and runtime teardown
  (no orphans — see v2-agy-process-leak).

## Tests

- `tests/workspace-code-intelligence.test.ts` (new): persistent TS adapter —
  completions include local symbol; hover returns type text; document
  highlights cover all occurrences; signature help reports parameters;
  diagnostics flag a type error; dirty-buffer overlay changes results without
  touching disk; definition/references still pass; service instance is reused
  across queries (no per-query rebuild).
- `tests/lsp-client.test.ts` (new): generic client against a scripted fake LSP
  server (node stdio): framing, initialize handshake, didOpen/didChange sync,
  definition/hover/completion mapping, publishDiagnostics cache, graceful
  shutdown; router picks TS vs LSP vs unavailable by extension.
- `tests/shared-contracts.test.ts`: round-trip the new command/event kinds.
- `tests/desktop-product-shell-visual-foundation.test.ts` or
  `tests/workbench-code-editor.test.ts`: context menu lists the new clipboard
  items; editor registers completion/hover/lint extensions (presence-level).
- Gated live smoke (`TIDE_LSP_LIVE=1`, not in default suite): rust-analyzer
  definition on a tiny cargo fixture.

## Implementation Notes

- TS adapter keeps a `Map<root, ProjectService>` with
  `{service, fileVersions, overlays, lastScan}`; rescan the file list when a
  queried path is unknown or the scan is >30s old; `getScriptVersion` from the
  per-file counter so overlay updates invalidate correctly.
- LSP positions are UTF-16 line/character — same convention as the contract;
  pass through, no offset math in the client.
- `@uiw/react-codemirror`'s `basicSetup.autocompletion` is disabled; the
  explicit `autocompletion({override})` extension queries the gateway
  (CodeMirror debounces via `activateOnTypingDelay`).
- Occurrence plugin: selection-idle (~120ms) → highlights query → `Decoration.mark`
  ranges; cleared on doc change.
- New deps: `@codemirror/autocomplete`, `@codemirror/lint`,
  `@codemirror/language`, `@lezer/highlight` (promote from transitive), plus
  language packs `@codemirror/lang-python|go|html|yaml|sql|xml|cpp|java` and
  `@codemirror/legacy-modes` (shell, TOML).
