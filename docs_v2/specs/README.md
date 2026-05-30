# Tide v2 Specs

This folder contains focused implementation specs derived from `docs_v2/master-plan.md` and `docs_v2/implementation/concrete-design-backlog.md`.

Each spec must be narrow enough to test and implement as one slice.

## Sequence

| Order | Spec | Status |
|-------|------|--------|
| 1 | [Shared Contracts](shared-contracts.md) | Drafted |
| 2 | [Backend Thread and Agent Runtime Lifecycle](backend-thread-agent-runtime-lifecycle.md) | Drafted |
| 3 | [Provider Integration Bootstrap](provider-integration-bootstrap.md) | Drafted |
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
| [Provider Evidence Harness](provider-evidence-harness.md) | Drafted | Repeatably collect provider PTY, readiness, prompt, and history-reference evidence before implementing real Agent Integrations. |
| [Composer Agent Runtime Source](composer-agent-runtime-source.md) | Drafted | Keep one visible Composer Agent chip while distinguishing Provider CLI Agents from Tide API Agents and source-specific Model Chip behavior. |
| [Provider Setup Surface Workbench Command](provider-setup-surface-workbench-command.md) | Drafted | Connect Provider Readiness setup actions to Thread-scoped Workbench Terminal Panes. |
| [Provider Setup Surface Terminal Lifecycle](provider-setup-surface-terminal-lifecycle.md) | Drafted | Start and stop the visible Provider Setup Surface process through Backend-owned Workbench Terminal Pane state. |
| [Provider Setup Surface Input And Retry](provider-setup-surface-input-and-retry.md) | Drafted | Route setup terminal bytes and replay preserved pending input after setup readiness succeeds. |
| [Provider Signal Prompt Ingress](provider-signal-prompt-ingress.md) | Drafted | Record provider-observed Prompt State in Backend and emit Desktop prompt events. |
| [Provider Bootstrap Artifacts](provider-bootstrap-artifacts.md) | Drafted | Generate and verify Tide-owned provider hook, MCP, and plugin bootstrap files for live Provider CLI Agents. |
| [Provider Signal Spool Ingress](provider-signal-spool-ingress.md) | Drafted | Read runtime-scoped provider hook spool records and route supported Prompt State into Backend events. |
| [Tide API Agent Runtime](tide-api-agent-runtime.md) | Drafted | Route the OpenAI API Tide API Agent through Backend-owned Provider Account readiness and the OpenAI Responses API. |
| [Tide API Agent Tool Calls](tide-api-agent-tool-calls.md) | Drafted | Let the OpenAI API Tide API Agent call Tide-owned tools and render tool calls/results in the Agent Session. |
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
