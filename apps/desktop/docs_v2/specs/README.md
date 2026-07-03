# Tide v2 Specs

This folder contains focused implementation specs derived from `docs_v2/master-plan.md` and `docs_v2/implementation/concrete-design-backlog.md`.

Each spec must be narrow enough to test and implement as one slice.

## Sequence

| Order | Spec | Status |
|-------|------|--------|
| 1 | [Shared Contracts](shared-contracts.md) | Drafted |
| 2 | [Backend Thread and Agent Runtime Lifecycle](backend-thread-agent-runtime-lifecycle.md) | Drafted |
| 3 | [Provider Integration Bootstrap](provider-integration-bootstrap.md) | Archived |
| 4 | [Agent Session Block Rendering Path](agent-session-block-rendering-path.md) | Drafted |
| 5 | [Desktop Agent Chat and Composer Shell](desktop-agent-chat-composer-shell.md) | Drafted |
| 6 | [Backend/Desktop Process Connection](backend-desktop-process-connection.md) | Drafted |
| 7 | [Tide MCP Tool Surface for Workbench Observe/Open Browser](tide-mcp-workbench-observe-open-browser.md) | Drafted |
| 8 | [App Chrome and Workbench Tab Strip](app-chrome-workbench-tab-strip.md) | Drafted |
| 9 | [Persistence](persistence.md) | Drafted |
| 10 | [Build and Package](build-and-package.md) | Drafted |

## Support Specs

| Spec | Status | Purpose |
|------|--------|---------|
| [Navigable Source Structure](navigable-source-structure.md) | Implemented | Whole-app decomposition: feature/concern directories, ordered CSS area files, size ratchet; navigation guide in implementation/source-map.md. |
| [Provider Evidence Harness](provider-evidence-harness.md) | Drafted | Repeatably collect provider PTY, readiness, prompt, and history-reference evidence before implementing real Agent Integrations. |
| [Composer Agent Runtime Source](composer-agent-runtime-source.md) | Implemented | Keep one visible Composer Agent chip over the supported Provider CLI Agents and source-specific Model Chip behavior. |
| [Thread Workbench Agent Model Cleanup](thread-workbench-agent-model-cleanup.md) | Drafted | Collapse provider readiness handoffs onto normal `open_terminal` Workbench Terminal Panes with readiness metadata. |
| [Provider Setup Surface Workbench Command](provider-setup-surface-workbench-command.md) | Superseded | Historical setup-surface command slice. New work should use `open_terminal` with provider-readiness terminal metadata. |
| [Provider Setup Surface Terminal Lifecycle](provider-setup-surface-terminal-lifecycle.md) | Superseded | Historical setup-surface lifecycle slice. New work should use normal Workbench Terminal Pane lifecycle plus retry-preflight metadata. |
| [Provider Setup Surface Input And Retry](provider-setup-surface-input-and-retry.md) | Superseded | Historical setup-surface input/retry slice. New work should route bytes to the Terminal Pane handle and retry readiness from terminal completion metadata. |
| [Provider Signal Prompt Ingress](provider-signal-prompt-ingress.md) | Drafted | Record provider-observed Prompt State in Backend and emit Desktop prompt events. |
| [Provider Bootstrap Artifacts](provider-bootstrap-artifacts.md) | Subordinate | Current bootstrap helper details; new resource-model work is governed by Agent Resource Model. |
| [Agent Resource Model](agent-resource-model.md) | Drafted | Post-Gemini resource model for sharing Tide-owned MCP/runtime/session resources across Codex, Claude, and opencode while keeping provider-native launch details inside adapters. |
| [Provider Signal Spool Ingress](provider-signal-spool-ingress.md) | Drafted | Read runtime-scoped provider hook spool records and route supported Prompt State into Backend events. |
| [Direct API Agent Runtime](tide-api-agent-runtime.md) | Removed | Historical note: the direct API Agent runtime path was removed; Provider CLI Agents are canonical. |
| [Direct API Agent Tool Calls](tide-api-agent-tool-calls.md) | Removed | Historical note: Tide MCP tools are exposed through provider CLI MCP, not a direct API Agent runtime. |
| [Agent Chat File Link Routing](agent-chat-file-link-routing.md) | Drafted | Route local file links in Agent Chat markdown into Workbench Editor Pane open commands. |
| [Tide MCP File Workbench Tools](tide-mcp-file-workbench-tools.md) | Drafted | Let Agents read bounded file state and open visible Editor Panes through Tide-owned Workbench tools. |
| [Tide MCP File Edit And Diff Tools](tide-mcp-file-edit-diff-tools.md) | Drafted | Let Agents apply exact file replacements and expose bounded Diff Panes through Tide-owned Workbench tools. |
| [Tide MCP Open Terminal Tool](tide-mcp-open-terminal-tool.md) | Drafted | Let Agents open visible interactive Terminal Panes through Tide-owned Workbench tools. |
| [Tide MCP Terminal Command Tool](tide-mcp-terminal-command-tool.md) | Drafted | Let Agents run bounded non-interactive commands and expose visible Terminal Pane evidence through Tide-owned Workbench tools. |
| [Tide MCP Code Navigation Tool](tide-mcp-code-navigation-tool.md) | Drafted | Let Agents trigger the same Backend-owned Editor Pane go-to-definition path as Product Shell. |
| [Tide MCP Workbench Mutation Events](tide-mcp-workbench-mutation-events.md) | Drafted | Push Workbench changes from mutating MCP tools to Desktop through existing Backend async events. |
| [Tide MCP Browser Action Tool](tide-mcp-browser-action-tool.md) | Drafted | Let Agents schedule bounded Browser Pane click/type actions and receive Desktop WebView execution evidence. |
| [Desktop Workbench Pane Content Rendering](desktop-workbench-pane-content-rendering.md) | Drafted | Render Browser, Editor, Diff, and Terminal Workbench Pane contract previews in Product Shell. |
| [Workbench Editor Pane Editing](workbench-editor-pane-editing.md) | Drafted | Let humans edit and save Thread-scoped files through visible Workbench Editor Panes without broadening Agent edit tools. |
| [Workbench Editor Code Navigation](workbench-editor-code-navigation.md) | Drafted | Add the first Backend-owned go-to-definition path for Workbench Editor Panes. |
| [Workbench Browser WebView Pane](workbench-browser-webview-pane.md) | Drafted | Render Browser Workbench Pane URLs through an Electron-hosted page surface. |
| [Workbench Browser Pane Evidence Loop](workbench-browser-pane-evidence-loop.md) | Drafted | Store WebView title, URL, and bounded page text in Backend Workbench state for MCP observation. |
| [Workbench Launcher Pane](workbench-launcher-pane.md) | Drafted | Open a real Workbench Launcher Pane when the active Thread has no visible work surface. |
| [Workbench Terminal Pane Session](workbench-terminal-pane-session.md) | Drafted | Open a user-visible Thread-scoped Terminal Pane backed by a Workbench terminal process port. |
| [Workbench Launcher And Terminal Usability](workbench-launcher-terminal-usability.md) | Drafted | Preserve launcher-as-placeholder semantics, Composer Draft Workbench visibility, and prompt Terminal input readiness. |
| [Agent Runtime Live Idle Chat State](agent-runtime-live-idle-chat-state.md) | Drafted | Keep `Working` tied to active turn state, not idle-but-live structured runtime handles. |
| [Workbench FileTree View](workbench-filetree-view.md) | Drafted | Populate the independent right-side FileTree column from Backend-owned Thread root listings. |
| [Tide MCP Stdio Bridge](tide-mcp-stdio-bridge.md) | Drafted | Expose Backend Tide MCP tools through provider-visible MCP JSON-RPC stdio handling. |
| [Backend Thread List Product Shell Bootstrap](backend-thread-list-product-shell-bootstrap.md) | Drafted | Let Product Shell request Backend-owned Thread summaries instead of starting from fixture Thread rows. |
| [Live Backend Persistence Bootstrap](live-backend-persistence-bootstrap.md) | Drafted | Restore and save Tide-owned Thread metadata through the live Backend process. |
| [Live Provider Session Reference Discovery](live-provider-session-reference-discovery.md) | Drafted | Attach provider-owned Raw Agent Session references discovered by live provider evidence to Thread runtime and persistence. |
| [Thread Launch Options Contract](thread-launch-options-contract.md) | Drafted | Preserve selected Launch Options across Thread start, hydrate, list, restore, and Follow-up Composer labels. |

## Rule

Move through the sequence in order unless a later spec exposes a missing premise in an earlier one.

For each spec:

1. Record evidence from current `docs_v2` documents.
2. Separate decided behavior from open questions.
3. Define contracts, flow, invariants, and tests before code.
4. Keep fallback behavior explicit and narrow.
5. Avoid adding alternate runtime paths for the same Agent.
