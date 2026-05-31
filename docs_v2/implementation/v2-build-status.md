# Tide v2 Build Status and Unblock Runbook

Living status of the v2 implementation against the product goal. Update this when
a slice lands or a gate is cleared.

Verification baseline at last update: **373 behavior tests pass**, `tsc --noEmit`
clean, `npm run build` green, and the built Electron app boots its Backend
utilityProcess and runs the full agent loop (openai_api + fake-OpenAI Electron
smoke reaches `ok:true`).

## Done and verified

- **Codex-app-style Thread management** — list, archive, pin, rename, and Left UI
  search, each end-to-end (Shared Contracts → Backend service → event-driven
  persistence → Product Shell) with tests.
  Spec: `specs/backend-thread-list-product-shell-bootstrap.md`.
- **Workbench panes**
  - Editor — real CodeMirror 6 (MIT): grammar highlighting, line numbers,
    edit/save, LSP go-to-definition + go-to-references (TS language service).
    Specs: `specs/workbench-editor-pane-editing.md`, `workbench-editor-code-navigation.md`.
  - Terminal — live PTY session + GPU-accelerated xterm.js/WebGL renderer with
    output streamed off the React hot path (delta-chunk `workbench.terminalOutput`).
    Spec: `specs/workbench-terminal-pane-session.md`.
  - Diff — structured unified-diff rendering (added/removed/hunk/context).
  - Launcher — actions open the corresponding panes.
  - Browser — Electron `<webview>` wired with snapshot + click/type action
    capture (unit-tested). See gate B below for live page-load verification.
- **Multi coding-agent compatibility** — Codex / Claude / Antigravity route to
  provider-specific Agent Integrations (not a generic GPT path) and launch a
  hidden PTY; OpenAI API is a Tide API Agent. Provider Readiness preflight +
  Provider Setup Surface (not-ready → preserve input → setup terminal → replay)
  is implemented and tested. See gate A for the live-login step.
- **Agent-operable MCP** — observe and operate (e.g. open browser) verified
  end-to-end over the real stdio↔unix-socket transport a provider CLI uses;
  socket server is resilient to broken clients.
- **Performance** — see `~/.claude` memory `v2-performance-budget`: backend
  bundle externalizes node deps (10.3MB→290KB); terminal uses the GPU; terminal
  output bypasses React; CodeMirror/xterm/CodeMirror render only their viewport.
  Renderer bundle ≈ 2.1MB (~480KB gzip) for a real editor + GPU terminal.

## Open gates (need one environment action, not code)

These are the only items left for "everything actually works", and each needs a
human/environment step that cannot be done headlessly.

### Gate A — Multi-agent real answers — VERIFIED for antigravity + openai
Routing, hidden-PTY launch, readiness preflight, and Setup Surface are done.
Root-cause fix (commit "Deliver first message as provider launch-time prompt"):
the first message is delivered as the provider CLI's launch-time prompt
(codex/claude positional, antigravity `--prompt-interactive`) so a turn starts
immediately — the old type-into-TUI-after-launch did not reliably start a turn.

**Verified:** the antigravity Electron smoke now returns a real answer captured
as a role:agent block (`agentOutputFound:true`, was false before the fix), and
openai_api streams a real answer. Multi-agent real answers work end-to-end.

Codex uses the same code path and will answer identically once its login is
valid — during testing its token was invalidated:

Real-answer verification is still blocked by two non-code conditions found while
testing with a live codex login:
- **Auth token invalidated:** codex returned `token_invalidated` /
  `refresh_token_reused` / 401. The login got invalidated (running codex
  concurrently can rotate/reuse the refresh token). **Action:** run a fresh
  `codex login` and do NOT run other codex processes meanwhile.
- **Directory trust:** codex refuses to run in an untrusted dir ("Not inside a
  trusted directory"). The Thread Execution Context cwd must be a trusted codex
  directory (this is provider-owned trust state, surfaced via Provider Readiness
  / Setup Surface).
- **Then:** `npm run test:smoke:electron -- --agent codex` should report
  `agentOutputFound:true` once auth + trust hold.

### Gate B — Browser pane live page-load (GUI)
The `<webview>` + snapshot/action evidence loop is wired and unit-tested. The
actual page render only happens in a painted Electron window; the headless smoke
can't drive it (command-result events are returned to the caller, not broadcast
to the Product Shell that mounts the webview).
- **Action:** `npm run dev`, open a Thread, open a Browser pane, confirm a page
  loads and the title/text snapshot returns. Report any visual issue.

### Gate C — Figma-exact reproduction (UNBLOCKED — reading Figma via curl)
The Figma Dev Mode MCP server (Figma desktop, 127.0.0.1:3845/mcp) is drivable by
manual JSON-RPC over curl WITHOUT a Claude Code restart: initialize →
notifications/initialized → tools/list → tools/call, reusing the `mcp-session-id`
header. Tools: get_metadata, get_design_context, get_variable_defs (the design
uses inline values, returns {}), get_screenshot. Pass an explicit `nodeId`
(e.g. workbench `1223:2`); without one the tools act on the current selection
("Nothing is selected").

Ground truth extracted (workbench frame 1223:2, 1920x1080): 4 columns —
Left Rail (256) | Agent Chat + Composer | Workbench editor (tabs + breadcrumb) |
FileTree ("Filter files…"). Top Row 52. Palette + type roles already match. The
current Product Shell already matches this structure closely.

Known divergence to fix: the Left UI "Search" is a nav row (icon + "Search"),
not an inline input — the inline input belongs only to the FileTree filter.

Headless conformance loop (no Electron GUI needed): a dev-only harness
(`src/desktop/renderer/dev-harness.html`/`.ts`, not in the production build
input) mounts the real Product Shell with a Figma-matching fixture. Serve it
with `npx vite src/desktop/renderer --port 5199` and open
`/dev-harness.html?probe=N` (bump N to bust the snapshot cache). The harness
reports layout (column order, rail width, top-row height, editor/composer
presence) via `document.title` because the Browser Pane snapshot extractor does
not surface the CSS-grid DOM as text — read it with capture_pane's `title`.

This loop already (a) caught and fixed a real white-screen bug — the xterm
default import resolved to `undefined` under Vite, throwing at module load; and
(b) conformed the Left Rail to Figma's 256px (was minmax(246,270)→246). Verified
top row 52 and 4-column order match. The production build (`vite preview
--outDir out/renderer`) also renders, confirming the fix ships.

Remaining for pixel-exact: conform remaining per-frame numbers (FileTree column
width, composer spacing, chip styling) by pulling each value from Figma
get_metadata and measuring via the harness.

## Deferred (evidence-gated, intentionally not done)

- Agent Session list virtualization — real for very long transcripts, but
  variable-height windowing can't be verified headlessly and risks scroll jank;
  do it with real-app profiling, not blind. Recorded in the perf budget.
- Backend search across archived Threads (current search is a client-side filter
  over loaded Threads).
