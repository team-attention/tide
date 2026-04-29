# Spec: Browser Agent Runtime Plan

## Overview

### As-Is

Tide already has the core Browser Pane, Context Artifact, and Agent Gateway pieces needed for a first-class coding-agent browser loop, but those pieces need one durable operating contract.

Repo evidence:

| Area | Evidence |
|------|----------|
| Product model | `Pane` is the content container, `Workspace` is the isolated task boundary, and `Browser Pane` is a `PaneKind::Browser` backed by native `WKWebView`. See [docs/glossary.md](/Users/eatnug/Workspace/tide/docs/glossary.md:11), [docs/glossary.md](/Users/eatnug/Workspace/tide/docs/glossary.md:15), and [docs/glossary.md](/Users/eatnug/Workspace/tide/docs/glossary.md:111). |
| Browser state | `BrowserSnapshot` is cached page text and metadata from the Browser Pane `WKWebView` bridge, `Browser Page Map` is bounded visible region/interactable geometry from that bridge, and `Browser Automation Cursor` is the Browser Pane automation marker state. See [docs/glossary.md](/Users/eatnug/Workspace/tide/docs/glossary.md:23), [docs/glossary.md](/Users/eatnug/Workspace/tide/docs/glossary.md:24), and [docs/glossary.md](/Users/eatnug/Workspace/tide/docs/glossary.md:43). |
| Terminal attachment | `Terminal Context`, `Associated Terminal`, `Paired Agent`, `Pinned Context`, and `Artifact Delivery` already define the one-terminal context boundary. See [docs/glossary.md](/Users/eatnug/Workspace/tide/docs/glossary.md:75). |
| Context surface | Terminal Context Surface is the Dock region attached to one Stage Terminal and can show Browser Pane, Diff, Editor, Launcher, secondary Terminal, or Render Pane. See [docs/glossary.md](/Users/eatnug/Workspace/tide/docs/glossary.md:103). |
| Context Artifact | A `Context Artifact` is Workspace-local, stores optional captured Pane selection plus optional user comment, and is bound to source `PaneId` plus `Associated Terminal`. `Source Label` provides a human-readable origin. See [docs/glossary.md](/Users/eatnug/Workspace/tide/docs/glossary.md:108) and [docs/glossary.md](/Users/eatnug/Workspace/tide/docs/glossary.md:109). |
| Open-terminal Codex app model | Existing product spec says Browser review and browser use should translate to Browser Pane in the active Terminal's Terminal Context Surface, with comments delivered as `Context Artifact`s to the `Associated Terminal`. See [docs/specs/open-terminal-codex-app.md](/Users/eatnug/Workspace/tide/docs/specs/open-terminal-codex-app.md:15). |
| Task surface model | Existing product spec says `Workspace` is the task boundary, `Terminal` is the main session, active Stage Terminal owns one Terminal Context Surface, and Browser Pane is the verification surface. See [docs/specs/open-terminal-codex-app.md](/Users/eatnug/Workspace/tide/docs/specs/open-terminal-codex-app.md:35), [docs/specs/open-terminal-codex-app.md](/Users/eatnug/Workspace/tide/docs/specs/open-terminal-codex-app.md:43), and [docs/specs/open-terminal-codex-app.md](/Users/eatnug/Workspace/tide/docs/specs/open-terminal-codex-app.md:46). |
| Browser verification loop | Existing product spec says browser verification should preserve Browser Pane UX hardening, create `Context Artifact`s from page selections or screen areas, and avoid a second browser automation stack. See [docs/specs/open-terminal-codex-app.md](/Users/eatnug/Workspace/tide/docs/specs/open-terminal-codex-app.md:82). |
| Browser use case | Existing product spec says users or Browser-capable agents open pages in Browser Pane, review rendered state, leave comments, and Browser-use may operate the Browser Pane when explicitly requested and allowed. See [docs/specs/open-terminal-codex-app.md](/Users/eatnug/Workspace/tide/docs/specs/open-terminal-codex-app.md:237). |
| Browser Pane UX | Browser Pane UX already requires state-driven focus, truthful URL state, manual external handoff, ModalStack overlay behavior, unsupported capability boundaries, and full-bleed native content. See [docs/specs/browser-pane-ux.md](/Users/eatnug/Workspace/tide/docs/specs/browser-pane-ux.md:29) and [docs/specs/browser-pane-ux.md](/Users/eatnug/Workspace/tide/docs/specs/browser-pane-ux.md:208). |
| Browser Pane V2 boundary | Browser Pane V2 is the later track for downloads, auth/session behavior, permissions, context menus, popup windows, storage management, progress, and dev tools. See [docs/specs/browser-pane-v2.md](/Users/eatnug/Workspace/tide/docs/specs/browser-pane-v2.md:21) and [docs/specs/browser-pane-v2.md](/Users/eatnug/Workspace/tide/docs/specs/browser-pane-v2.md:187). |
| Current Browser Pane domain | `BrowserPane` stores URL state, loading/progress, back/forward availability, native `WKWebView`, `BrowserSnapshot`, page selection, Browser Automation Cursor, context menu, permission/certificate state, render mode, data clearing, and download state. See [browser.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/domain/pane/browser.rs:97). |
| Navigation | `BrowserPane::navigate()` normalizes bare URLs, defaults localhost to `http://`, updates URL state, resets progress, clears pending permission/certificate and page snapshot/selection state, dispatches to the live webview when present, and records pending initial navigation otherwise. See [browser.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/domain/pane/browser.rs:374). |
| Automation cursor and action dispatch | Browser Pane can read/set/clear Browser Automation Cursor, sync it through page JavaScript, and dispatch automation click/type/press JavaScript helpers. See [browser.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/domain/pane/browser.rs:830) and [browser.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/domain/pane/browser.rs:879). |
| Bridge and selection | Browser Pane installs the selection bridge, re-syncs the automation cursor overlay after bridge install, requests page snapshot refresh, updates `BrowserSnapshot`, updates page selection, and normalizes page selection content. See [browser.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/domain/pane/browser.rs:1002). |
| Agent Gateway commands | CLI dispatch currently exposes `capture-selection`, `browser-observe`, `browser-eval`, `browser-action`, `open-browser`, and Context Artifact create/list/read/pin/remove/send commands. See [commands.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/inward/cli_adapter/commands.rs:105). |
| Structured Browser observe | `cli_browser_observe` returns Browser Pane `pane_id`, title, URL, loading/progress, back/forward availability, snapshot, selection, and automation cursor. See [commands.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/inward/cli_adapter/commands.rs:406). |
| Structured Browser action | `cli_browser_action` supports `navigate`, `move`, `click`, `type`, `press`, and `clear-cursor`, returns dispatch status and automation cursor, and refreshes BrowserSnapshot after live click/type/press dispatch. See [commands.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/inward/cli_adapter/commands.rs:487). |
| BrowserSnapshot transient state | `BrowserPane` owns `page_snapshot`, `page_selection`, `automation_cursor`, `agent_observed_generation`, and `agent_reobserve_required`; `clear_transient_state()` drops snapshot/selection/observation state. See [browser.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/domain/pane/browser.rs:136) and [browser.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/domain/pane/browser.rs:551). |
| Workspace cold storage | `save_active_workspace()` calls `clear_transient_state()` on Browser Pane state before cold-storing a Workspace. See [workspace_infra_service/mod.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/application/services/workspace_infra_service/mod.rs:212). |
| Selection capture | `capture_selection` supports Browser Pane URL selection, page selection, render HTML fallback, and Browser/render kind labels. See [commands.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/inward/cli_adapter/commands.rs:692). |
| MCP instructions and tools | MCP initialization tells agents to use `tide_open_browser` / `tide_open_editor`, prefer `tide_browser_observe` and `tide_browser_action` over raw browser eval, and avoid opening new Stage terminals for side tasks. MCP tools expose browser, selection, and Context Artifact commands. See [mcp.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/inward/cli_adapter/mcp.rs:147), [mcp.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/inward/cli_adapter/mcp.rs:255), and [mcp.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/inward/cli_adapter/mcp.rs:427). |
| Caller Pane injection | MCP injects `_caller_pane` from `TIDE_PANE` before mapping `tide_browser_action` to `browser-action`; command handlers receive the routed command after the caller fields are stripped. See [mcp.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/inward/cli_adapter/mcp.rs:427) and [commands.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/inward/cli_adapter/commands.rs:487). |
| Wrapped Agent identity | `AgentInfo` stores `wrapper_managed`, `gateway_connected`, and `status`; `GatewayStatus::notify` is the lifecycle event path used by wrapper-managed agent reporting. See [gateway_status.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/domain/state/gateway_status.rs:28), [gateway_status.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/domain/state/gateway_status.rs:117), and [docs/glossary.md](/Users/eatnug/Workspace/tide/docs/glossary.md:121). |
| Context Artifact capture and delivery | Action service computes human-readable source labels, captures Browser Pane URL/page selection into the Context Comment Composer, shows the comment badge only when a paired gateway-connected agent exists, injects artifact text into the paired Terminal with paste wrapping, and emits owner-scoped delivery events. See [action_service/mod.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/application/services/action_service/mod.rs:45), [action_service/mod.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/application/services/action_service/mod.rs:103), and [action_service/mod.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/application/services/action_service/mod.rs:265). |
| Coworking spec | Existing coworking spec targets Workspace-local/session-local Context Artifacts, explicit list/read, immediate paired-agent delivery, Associated Terminal authorization, and Browser selection capture. See [docs/specs/agent-coworking-context.md](/Users/eatnug/Workspace/tide/docs/specs/agent-coworking-context.md:23), [docs/specs/agent-coworking-context.md](/Users/eatnug/Workspace/tide/docs/specs/agent-coworking-context.md:83), [docs/specs/agent-coworking-context.md](/Users/eatnug/Workspace/tide/docs/specs/agent-coworking-context.md:134), and [docs/specs/agent-coworking-context.md](/Users/eatnug/Workspace/tide/docs/specs/agent-coworking-context.md:196). |
| Codex Browser Use plugin | Local Browser Use plugin is for Codex in-app browser automation, local targets, current in-app browser tab, and read/write/interactive capabilities. See [/Users/eatnug/.codex/plugins/cache/openai-bundled/browser-use/0.1.0-alpha1/.codex-plugin/plugin.json](/Users/eatnug/.codex/plugins/cache/openai-bundled/browser-use/0.1.0-alpha1/.codex-plugin/plugin.json:2) and [/Users/eatnug/.codex/plugins/cache/openai-bundled/browser-use/0.1.0-alpha1/.codex-plugin/plugin.json](/Users/eatnug/.codex/plugins/cache/openai-bundled/browser-use/0.1.0-alpha1/.codex-plugin/plugin.json:20). |
| Codex Browser Use skill | Local skill requires the Browser `browser-client` runtime with `iab` backend, says Browser is preferred over Computer Use when present, exposes `agent.browser.*`, requires observe-after-action discipline, and documents CUA coordinate actions plus Playwright DOM snapshots. See [SKILL.md](/Users/eatnug/.codex/plugins/cache/openai-bundled/browser-use/0.1.0-alpha1/skills/browser/SKILL.md:8), [SKILL.md](/Users/eatnug/.codex/plugins/cache/openai-bundled/browser-use/0.1.0-alpha1/skills/browser/SKILL.md:183), [SKILL.md](/Users/eatnug/.codex/plugins/cache/openai-bundled/browser-use/0.1.0-alpha1/skills/browser/SKILL.md:217), [SKILL.md](/Users/eatnug/.codex/plugins/cache/openai-bundled/browser-use/0.1.0-alpha1/skills/browser/SKILL.md:338), and [SKILL.md](/Users/eatnug/.codex/plugins/cache/openai-bundled/browser-use/0.1.0-alpha1/skills/browser/SKILL.md:347). |

### To-Be

Coding agents should use Tide's `Browser Pane` as the shared browser surface whenever the target is local preview, file-backed preview, unauthenticated public page review, visual verification, or page-comment feedback for the active coding task.

The target model is:

1. Human and coding agent share the same `Browser Pane` `WKWebView` when possible.
2. The Browser Pane remains visible state: agent clicks, typing, navigation, Browser Automation Cursor, page selection, comments, loading state, and URL state must be inspectable by the human.
3. Tide does not create a second browser runtime by default. External browser runtimes, Codex Browser Use, Browser Use Cloud, Playwright, or Computer Use are fallbacks or research references, not the default Tide Browser Pane runtime.
4. Browser Pane ownership is explicit. Human interruption, modal comment entry, auth/payment/sensitive flows, and permission prompts can pause or supersede agent control.
5. Coding agents operate through Tide MCP/Gateway tools first: `tide_open_browser`, `tide_browser_observe`, `tide_browser_action`, `tide_capture_selection`, Context Artifact tools, then raw `tide_browser_eval` only as an escape hatch.
6. Browser Automation Cursor is a visible hint, not a full remote mouse model. It marks the last agent-targeted viewport point, keeps optional label text as structured tool metadata only, survives bridge reinstall inside the same Browser Pane session, and clears only by explicit action or Pane/session lifecycle.
7. Human Browser Pane comments and selections produce Workspace-local `Context Artifact`s bound to the source `PaneId` and `Associated Terminal`, delivered only to the paired agent, and available through explicit list/read/pull behavior.
8. Browser Page Map is a V1 Browser Pane runtime requirement: observations must expose bounded visible regions and interactable geometry so agents can understand where page affordances are and target them without BrowserSnapshot-only guessing or raw DOM workarounds. Element/region comments, screenshot crops, persistent DOM identity, and full accessibility-tree parity remain future gaps.
9. Browser Pane V2 remains the boundary for stronger browser profile/session behavior, in-app downloads, auth state, passkeys, permissions, popups, cookie/storage management, and deeper standalone-browser parity.
10. A user-requested browser task is a Browser Operation: Tide starts the operation no later than the first Tide Browser Pane runtime tool used by the authorized Wrapped Agent, keeps Agent Browser Control Mode and Browser Automation Cursor visible while operating, and finishes the operation after final observation or Wrapped Agent idle.

### Approach

1. Use this file as the V1 implementation contract for the shared coding-agent `Browser Pane` runtime.
2. Keep `docs/specs/browser-pane-automation.md` as the implementation slice for current structured observe/action, and keep it current with source behavior.
3. Keep Browser Pane UX and Browser Pane V2 specs as capability boundaries: this plan composes them, it does not replace them.
4. Implement only the testable V1 behavior in this unit: MCP/Gateway guidance, structured observe/action discipline, Browser Automation Cursor limits, Browser selection capture, Context Artifact delivery, sensitive-flow gating where callers explicitly mark the action, and external-runtime fallback policy.
5. Leave screenshot crop, full comment-region capture, persistent DOM identity, persistent profiles, cookies, saved passwords, passkeys, extensions, regular-browser tab access, and automatic external runtime bridges to future Browser Pane V2 or external-runtime work.
6. Add behavior tests before implementation for every runtime change, using `crates/tide-app/src/application/behavior_tests/` and the test names listed in this spec.

### Implementation Addendum: BrowserSnapshot Tools And Agent Browser Control Mode

This implementation unit promotes the BrowserSnapshot tools and Agent Browser Control Mode from plan to testable V1 behavior. It implements the bounded in-memory read/search/diff surface and wrapper-managed visual-control gate while keeping the explicit future exclusions below out of scope.

Implementation must preserve the existing Spec -> behavior tests -> code order:

1. Update this spec and any narrower implementation spec with the final Business Rules.
2. Add behavior tests under `crates/tide-app/src/application/behavior_tests/` for each Business Rule.
3. Implement the application, domain, Gateway, MCP, and view changes only after those tests exist.

The BrowserSnapshot tools are bounded in-memory tools over cached Browser Pane state:

| Tool | Contract |
|------|----------|
| `read_snapshot` | Reads the current cached `BrowserSnapshot` for one Browser Pane without forcing a page refresh. Returns `pane_id`, `generation`, `page_title`, `page_url`, bounded `text`, truncation metadata, and stale/missing snapshot status. |
| `find_in_snapshot` | Searches the cached `BrowserSnapshot` by literal query without refreshing the page. Future query modes require separate spec and tests. Returns bounded matches with offsets or line numbers, truncation metadata, `pane_id`, and `generation`. |
| `diff_since` | Compares the current cached `BrowserSnapshot` for one Browser Pane against a caller-supplied `Generation` anchor for the same `PaneId` and Workspace. Rejects missing, stale, cross-Pane, or cross-Workspace anchors instead of silently diffing unrelated state. |

The BrowserSnapshot tool state must be per-PaneId, per-Workspace, bounded, and memory-safe:

1. Store only bounded in-memory BrowserSnapshot history. Proposed V1 limits are: at most 128 KiB of snapshot text per BrowserSnapshot returned to a caller, at most two retained BrowserSnapshot Generations per Browser Pane for `diff_since`, at most 50 `find_in_snapshot` matches per call, at most 2 KiB of context per match, and at most 64 KiB of diff output per call. Overflow must be represented as truncation metadata.
2. Do not persist BrowserSnapshot history to disk, do not include it in cold Workspace storage, and do not expose it as ambient agent prompt context.
3. Treat each BrowserSnapshot anchor as owned by exactly one Browser Pane and one Workspace. A stale PaneId, missing Caller Pane, wrong Associated Terminal, wrong Workspace, or stale Generation must return an explicit error or stale status.
4. Preserve current transient cleanup: closing a Browser Pane, clearing transient Browser Pane state, or cold-storing a Workspace drops BrowserSnapshot history and invalidates anchors.
5. Missing snapshot behavior is explicit: `read_snapshot` reports missing, `find_in_snapshot` returns no matches with missing status, and `diff_since` rejects missing baseline or missing current BrowserSnapshot.

Agent Browser Control Mode is separate from ordinary Gateway/MCP behavior. It is a visual mode for natural Browser Automation Cursor mimic behavior, not an authorization shortcut:

1. Agent Browser Control Mode may be enabled only when the Caller Pane resolves to a direct Wrapped Agent whose `AgentInfo.wrapper_managed` and `gateway_connected` are true, whose `AgentStatus` is compatible with active agent work, and whose Associated Terminal owns the target Browser Pane in the same Workspace.
2. Wrapper-managed caller gating must be explicit in the wrapper-managed caller path. A non-wrapper Gateway/MCP caller may still use ordinary `browser-observe` and `browser-action` if otherwise allowed, but it must not enter Agent Browser Control Mode and must not receive wrapper-managed privileges.
3. Browser Automation Cursor mimic behavior should feel natural: move/click actions move a visible cursor-shaped overlay, type/press preserve the last cursor position, optional labels are preserved as tool metadata but not rendered beside the cursor, clear works explicitly, re-observe is required when the Browser Pane Generation changes, and the overlay never implies OS pointer ownership, element identity, human consent, or permission to bypass ModalStack or sensitive-action checks.
4. Agent Browser Control Mode state must be scoped to the target Browser Pane and Workspace. Multiple Browser Panes and inactive Workspaces must not read, diff, or visually project each other's BrowserSnapshot or Browser Automation Cursor state through stale identifiers.
5. Browser Operation state must hold Agent Browser Control Mode across the whole user-requested browser task, not only during a single `browser-action` call. It must seed a visible Browser Automation Cursor when the Browser Pane is opened, observed, or explicitly started by an authorized Wrapped Agent, keep that state stable across repeated actions, and clear the visual operation state when the operation finishes.

### Implementation Addendum: Browser Page Map

This implementation unit promotes Browser Page Map from a future gap to V1 observe/action behavior.

The Browser Page Map is a bounded, generation-scoped perception layer captured from the same Browser Pane `WKWebView` bridge as BrowserSnapshot:

1. `tide_browser_observe` returns `page_map` with the current Browser Pane Generation, visible page `regions`, visible `interactables`, truncation/limit metadata, and viewport `Rect` values in Browser Pane page coordinates.
2. Each Browser Page Element has a short `ref` that is valid only for the observed Browser Pane Generation. It is a targeting handle for the next structured action, not persistent DOM identity, CSS selector identity, or proof of human consent.
3. Browser Page Map collection must be bounded and visible-first. Hidden elements, zero-area elements, bridge-owned automation cursor nodes, and unbounded body text must not dominate the returned map.
4. `tide_browser_action` accepts `target_ref` for supported visible interactions. For `click`, Tide moves the Browser Automation Cursor to the element center and dispatches a normal Browser Pane click through the bridge. For `type`, Tide focuses the element at its center and dispatches typed text through the same visible Browser Pane runtime.
5. `target_ref` actions must preserve the initial observe-before-action discipline. After that initial observe, a `click` or `type` may continue through a currently cached, enabled Browser Page Element `target_ref` even when the previous action requested re-observe, as long as the agent is not making a new decision from changed page content. Coordinate actions, unknown refs, disabled refs, missing Browser Page Map state, and first content actions still fail explicitly rather than falling back to broad BrowserSnapshot text or raw eval.
6. `tide_browser_observe` supports a compact detail mode for routine action loops. Compact observations return Browser Observation Summary data, including Browser Page Map targeting refs and short text excerpts, without returning the full BrowserSnapshot body.
7. Browser Page Map does not authorize app-internal API calls, credential-bearing URL shortcuts, URL-parameter launch shortcuts, or raw DOM mutation. Those remain explicit fallbacks only when the user asked to test that internal route.

## Ambiguity Resolution

### Stale Browser Pane Automation As-Is

`docs/specs/browser-pane-automation.md` contains an older As-Is statement that `docs/specs/cli-server.md` exposed only `open-browser`, `capture-pane`, and `browser-eval`, so there was no structured Browser Pane automation contract. See [docs/specs/browser-pane-automation.md](/Users/eatnug/Workspace/tide/docs/specs/browser-pane-automation.md:7). That statement is stale relative to current source.

Current source evidence resolves the ambiguity:

1. CLI dispatch exposes `browser-observe` and `browser-action` today. See [commands.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/inward/cli_adapter/commands.rs:112) and [commands.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/inward/cli_adapter/commands.rs:115).
2. `cli_browser_observe` returns structured Browser Pane state with snapshot, selection, and Browser Automation Cursor. See [commands.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/inward/cli_adapter/commands.rs:406).
3. `cli_browser_action` implements the bounded action set `navigate`, `move`, `click`, `type`, `press`, and `clear-cursor`. See [commands.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/inward/cli_adapter/commands.rs:487).
4. MCP publishes `tide_browser_observe` and `tide_browser_action` and maps those tool names to Gateway methods. See [mcp.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/inward/cli_adapter/mcp.rs:272), [mcp.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/inward/cli_adapter/mcp.rs:282), [mcp.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/inward/cli_adapter/mcp.rs:442), and [mcp.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/inward/cli_adapter/mcp.rs:443).
5. The correct current As-Is is: structured Browser Pane observe/action exists in source, but this repo still lacks a durable runtime plan that tells coding agents when to use Tide Browser Pane, how to share ownership with humans, and when not to fall back to another browser runtime.

### Browser Use Name Collision

This spec uses `Browser Pane` for Tide's `PaneKind::Browser` backed by native `WKWebView`. It uses `Browser Use` for the Codex/OpenAI plugin or the browser-use project/runtime.

The local Browser Use plugin controls Codex's in-app browser through `browser-client` with `iab` backend. See [SKILL.md](/Users/eatnug/.codex/plugins/cache/openai-bundled/browser-use/0.1.0-alpha1/skills/browser/SKILL.md:8). That is not automatically the same runtime as Tide's Browser Pane. Tide agents should prefer Tide MCP/Gateway tools when the target is a Tide Browser Pane, because those tools operate Tide's in-app `WKWebView` and preserve `PaneId`, `Workspace`, and `Associated Terminal` context.

### Browser Pane vs Computer Use

Official Codex docs say the in-app browser is for shared rendered web pages inside a thread, local development servers, file-backed previews, public pages without sign-in, and visual comments. They also say Browser use lets Codex operate the in-app browser directly, while Computer Use is for GUI tasks and local web apps should use the in-app browser first. Sources: <https://developers.openai.com/codex/app/browser> lines 572-593 and 596-629; <https://developers.openai.com/codex/app/computer-use> lines 572-605 and 606-631.

Resolution: Tide Browser Pane is the first browser surface for Tide task verification. Computer Use is a fallback when the task requires a desktop app, system UI, a regular browser profile, extensions, login state unavailable in Browser Pane, or a GUI not reachable through Tide MCP/Gateway.

## Research Synthesis

| Source | Relevant finding | Plan implication |
|--------|------------------|------------------|
| OpenAI Codex in-app browser, <https://developers.openai.com/codex/app/browser> lines 572-593 | Codex browser docs describe a shared human/Codex rendered page view, local/file/public pages without sign-in, Browser use operating the in-app browser, and allowed/blocked site controls. | Tide should expose one shared Browser Pane view, avoid silent second runtimes, and keep agent browser operation explicit and permissioned. |
| OpenAI Codex browser comments, <https://developers.openai.com/codex/app/browser> lines 596-629 | Codex preview flow starts the dev server, opens an unauthenticated page, reviews rendered state with the diff, leaves comments on elements or areas, and asks Codex to address them. | Tide needs Browser Pane comments/selections that become Context Artifacts and can be delivered to the paired agent. |
| OpenAI Computer Use, <https://developers.openai.com/codex/app/computer-use> lines 572-605 | Computer Use controls macOS GUI apps and is for GUI tasks where command-line tools or structured integrations are not enough; local web apps should use the in-app browser first. | Tide should prefer Browser Pane MCP/Gateway before Computer Use for browser verification. |
| OpenAI Computer Use safety, <https://developers.openai.com/codex/app/computer-use> lines 606-631 | Computer Use has separate macOS permissions, app approvals, and sensitive/disruptive action prompts. | Browser Pane should keep a narrower permission scope than Computer Use and escalate to explicit human approval for sensitive flows. |
| Browser Use Actor basics, <https://docs.browser-use.com/open-source/legacy/actor/basics> lines 71-114 | Browser Use offers low-level Playwright-like automation with Browser/BrowserSession, Page, Element, and Mouse classes. | This is evidence of an external full browser runtime model; Tide should not adopt it by default because Tide already has a Browser Pane tied to PaneId/Workspace/Associated Terminal. |
| Browser Use custom tools, <https://docs.browser-use.com/open-source/customize/tools/add> lines 68-147 and 187-218 | Browser Use agents can be extended with custom tools, domain restrictions, human-in-the-loop actions, and injectable browser_session parameters. | Tide can borrow the idea of domain-scoped and human-in-the-loop tools for future Browser Pane actions, but must expose them through Tide MCP/Gateway naming and authorization. |
| Browser Use live preview, <https://docs.browser-use.com/cloud/browser/live-preview> lines 62-103 | Browser Use Cloud exposes a live URL and iframe for watching the agent browser in real time. | Tide already has the visible Browser Pane; the Browser Pane itself should be the live preview rather than a separate embedded remote session. |
| Browser Use profiles, <https://docs.browser-use.com/cloud/guides/authentication> lines 64-83 | Browser Use Cloud profiles persist browser state such as cookies, localStorage, and saved passwords. | Persistent browser profiles are a separate capability track and align with Browser Pane V2, not this Browser Pane runtime plan. |
| browser-use GitHub, <https://github.com/browser-use/browser-use> lines 291-293, 404-414, 462-468, and 547-549 | The repository presents Browser Use as an MIT-licensed browser automation project, includes browser infrastructure capabilities, and shows active releases. | Browser Use is useful ecosystem research, but integrating it directly would create a separate browser runtime unless Tide explicitly bridges it to Browser Pane in a future phase. |
| Local Browser Use plugin, [plugin.json](/Users/eatnug/.codex/plugins/cache/openai-bundled/browser-use/0.1.0-alpha1/.codex-plugin/plugin.json:2) and [SKILL.md](/Users/eatnug/.codex/plugins/cache/openai-bundled/browser-use/0.1.0-alpha1/skills/browser/SKILL.md:183) | The local plugin is explicitly for Codex in-app browser automation and only the Node REPL `js` tool controls that surface. | Codex Browser Use is not a Tide Browser Pane MCP tool. Tide should define its own MCP/Gateway Browser Pane contract and only bridge to Codex Browser Use if a future integration makes the runtime identity explicit. |

## Bounded Contexts

| Context | Role |
|---------|------|
| `domain/pane/browser.rs` | Owns Browser Pane state, native `WKWebView` handle, BrowserSnapshot, Browser page selection, Browser Automation Cursor, render mode state, and Browser Pane V2 capability state. |
| `adapter/inward/cli_adapter/commands.rs` | Owns Agent Gateway command dispatch for Browser Pane observe/action/eval, selection capture, and Context Artifact operations. |
| `adapter/inward/cli_adapter/mcp.rs` | Publishes stable MCP tool names and instructions for agent use of Tide Browser Pane. |
| `application/services/action_service/` | Owns Context Comment Composer snapshots, `Source Label`, comment badge eligibility, Context Artifact terminal injection, and delivery notifications. |
| `domain/state/context_artifact.rs` | Owns the Context Artifact record shape, formatting, and explicit list/read/send semantics. |
| `domain/state/associations.rs` | Resolves `Associated Terminal` authorization and paired-agent delivery boundaries. |
| `adapter/outward/platform_adapter/macos/webview.rs` | Owns native `WKWebView` integration and any future Browser Pane V2 native capability behavior. |
| `adapter/outward/view/` | Renders Browser Pane chrome, Browser Automation Cursor visibility when domain rendering is possible, Context Comment Composer, and future element/region comment affordances. |
| `application/services/workspace_infra_service/` | Preserves Workspace-local Browser Pane and Context Artifact behavior across active/cold Workspace switching. |

## Use Cases

### UC-1: OpenBrowserPaneForAgentVerification

- **Actor**: Coding agent
- **Trigger**: Agent needs to inspect or verify a local route, file-backed preview, unauthenticated public page, or rendered UI bug
- **Precondition**: Agent is operating in a Tide `Workspace` with a paired `Terminal`
- **Flow**:
  1. Agent calls `tide_open_browser` with the target URL or opens an empty Browser Pane when URL discovery is still needed.
  2. Tide opens Browser Pane in the active Terminal's Terminal Context Surface.
  3. Tide records or preserves the Browser Pane's `Associated Terminal`.
  4. Agent calls `tide_browser_observe` before acting.
  5. Human can see the same Browser Pane state the agent is using.
- **Postcondition**: The Browser Pane is the task-local verification surface.
- **Business Rules**:
  - BR-1: Agents must prefer `tide_open_browser` over launching an external browser for task-local web verification.
  - BR-2: Browser Pane must remain attached to the active task through `Workspace` and `Associated Terminal`.
  - BR-3: Agent must observe the Browser Pane before issuing click/type/press actions.
  - BR-4: If the URL is already loaded in the target Browser Pane, the agent must not navigate to the same URL unless a reload is intentional.

### UC-2: OperateSharedBrowserPane

- **Actor**: Coding agent
- **Trigger**: Agent needs to click, type, press a key, navigate, or move its Browser Automation Cursor
- **Precondition**: Target Pane is a navigation-mode `Browser Pane`
- **Flow**:
  1. Agent calls `tide_browser_observe` to get URL, title, loading/progress, snapshot, selection, and Browser Automation Cursor.
  2. Agent chooses a bounded `tide_browser_action`: `navigate`, `move`, `click`, `type`, `press`, or `clear-cursor`.
  3. Tide applies the action to the existing Browser Pane `WKWebView` and returns dispatch status.
  4. Agent observes again after actions that can change page state.
- **Postcondition**: Agent operation is visible and bounded to the shared Browser Pane.
- **Business Rules**:
  - BR-5: Agents must prefer `tide_browser_action` over `tide_browser_eval` for supported actions.
  - BR-6: `tide_browser_action` must not create a second browser runtime.
  - BR-7: Agent actions must update or preserve Browser Automation Cursor according to the action. `click` must move the visible Browser Automation Cursor before dispatching mouse events.
  - BR-8: After `click`, `type`, `press`, or intentional `navigate`, the next agent decision must be grounded in a fresh observe result, a compact Browser Observation Summary, or a clear reason the existing observation is still valid.

### UC-3: UseBrowserAutomationCursor

- **Actor**: Coding agent and human
- **Trigger**: Agent targets a viewport coordinate
- **Precondition**: Target Browser Pane has a live page bridge or can store cursor state for later sync
- **Flow**:
  1. Agent sends `move` or `click` with viewport `x`, `y`, and optional `label`.
  2. Tide stores Browser Automation Cursor in Browser Pane state.
  3. Tide mirrors the cursor into the page DOM when the bridge is installed.
  4. Human sees where the agent is targeting.
  5. Agent calls `clear-cursor` when the marker is no longer useful.
- **Postcondition**: The Browser Automation Cursor communicates targeting without implying full mouse ownership.
- **Business Rules**:
  - BR-9: Browser Automation Cursor is a marker for last agent-targeted viewport point, not a guarantee of current OS pointer position.
  - BR-10: Browser Automation Cursor must not be treated as element identity.
  - BR-11: Browser Automation Cursor must not be used to infer human consent for sensitive actions.
  - BR-12: Browser Automation Cursor must be explicitly clearable.
  - BR-13: Cursor state can be stale after scroll, layout shift, navigation, or responsive resize; the agent must re-observe before relying on it. First visible Browser Automation Cursor placement should animate from the last known or seeded cursor point instead of jumping directly to the target. Cursor motion duration must scale with travel distance, bounded by minimum and maximum motion durations, so long moves do not complete in the same fixed time as short moves.

### UC-4: CaptureHumanBrowserSelection

- **Actor**: Human or agent
- **Trigger**: Human selects text in Browser Pane page content or URL bar, then requests comment/capture
- **Precondition**: Source Browser Pane is in the active Workspace
- **Flow**:
  1. Tide captures URL bar selection when URL bar focus and URL selection are active.
  2. Tide captures page selection when the Browser Pane bridge has `page_selection`.
  3. Tide normalizes selection content through the same shape used by other Pane kinds.
  4. The caller can create a Context Artifact or read the selection directly through `tide_capture_selection`.
- **Postcondition**: Browser text selection is available to the explicit artifact flow.
- **Business Rules**:
  - BR-14: Current supported Browser Pane selection is URL text selection and page text/HTML/context selection from the bridge.
  - BR-15: Render-mode Browser Pane selection can fall back to render HTML when no page selection exists.
  - BR-16: Element identity, CSS selector, accessibility node identity, bounding box, screenshot crop, and arbitrary region selection are future gaps.
  - BR-17: Browser Pane page selection must not be silently promoted into broad body-text extraction.

### UC-5: CreateBrowserContextArtifact

- **Actor**: Human
- **Trigger**: Human opens Context Comment Composer from Browser Pane and submits a comment
- **Precondition**: Browser Pane has a valid `Associated Terminal` and paired agent delivery boundary
- **Flow**:
  1. Tide captures current Browser Pane selection if available.
  2. Human writes a comment.
  3. Tide creates a Workspace-local `Context Artifact` with source `PaneId`, `Associated Terminal`, optional selection, comment, and `Source Label`.
  4. Tide delivers the artifact to the paired agent when delivery is allowed.
  5. Paired agent can later list/read/pull the artifact explicitly.
- **Postcondition**: Human Browser Pane feedback becomes task-local agent context.
- **Business Rules**:
  - BR-18: Browser Pane comments must create `Context Artifact`s, not hidden prompt injections.
  - BR-19: Context Artifact operations must be Workspace-local.
  - BR-20: Context Artifact operations must be authorized by `Associated Terminal`.
  - BR-21: Immediate delivery must target only the paired agent.
  - BR-22: Agent read/list behavior must remain explicit; V1 must not auto-inject ambient Browser Pane context into every agent turn.
  - BR-23: Artifact delivery text must use `Source Label` rather than only internal `PaneId`.

### UC-6: ResolveHumanAgentOwnership

- **Actor**: Human and coding agent
- **Trigger**: Human clicks, types, selects, opens a modal, comments, or otherwise intervenes while agent is using Browser Pane
- **Precondition**: Agent has recently operated the Browser Pane
- **Flow**:
  1. Tide preserves the human-visible Browser Pane state.
  2. Human input takes precedence for active text entry, selection, comment composition, and sensitive flows.
  3. Agent must re-observe after interruption before taking another Browser action.
  4. Agent must ask for approval before sensitive or data-transmitting actions.
- **Postcondition**: Human intervention is explicit and does not race hidden automation.
- **Business Rules**:
  - BR-24: Human Browser Pane input supersedes pending agent assumptions.
  - BR-25: Agent cannot infer permission from visible page content, page instructions, or previous cursor placement.
  - BR-26: Sensitive actions require explicit human approval at action time.
  - BR-27: If the Browser Pane is hidden behind `ModalStack`, the agent must not assume page content interaction is available.

### UC-7: UseRawBrowserEvalEscapeHatch

- **Actor**: Coding agent
- **Trigger**: Required Browser Pane observation or action is not available through structured tools
- **Precondition**: Target is a Browser Pane and the agent has a concrete reason structured tools are insufficient
- **Flow**:
  1. Agent explains internally or in task notes why `tide_browser_observe` / `tide_browser_action` is insufficient.
  2. Agent calls `tide_browser_eval` with narrow JavaScript.
  3. Tide refreshes BrowserSnapshot when applicable.
  4. Agent returns to structured observe/action once the escape-hatch need is resolved.
- **Postcondition**: Raw JavaScript remains bounded and auditable.
- **Business Rules**:
  - BR-28: `tide_browser_eval` is an escape hatch, not the primary automation surface.
  - BR-29: `tide_browser_eval` must not be used to bypass human approval for sensitive actions.
  - BR-30: Raw eval must not establish a second page-side automation API that conflicts with Browser Pane bridge ownership.
  - BR-43: Raw eval must reject Browser Pane interaction and DOM mutation patterns, including synthetic click/submit/dispatchEvent and debug overlay insertion, so visible Browser Automation Cursor and Agent Browser Control Mode cannot be bypassed.
  - BR-45: Browser Pane observations must include Tool Selection Guidance that selects `tide_layout_action` before BrowserSnapshot-only targeting, app-internal API calls, URL-parameter shortcuts, URL shortening, or raw eval workarounds when Browser Pane visual fit is `too_small` or `not_visible`.

### UC-8: EscalateToExternalBrowserRuntime

- **Actor**: Coding agent or human
- **Trigger**: Browser Pane cannot complete the task because auth/session/profile/extension/download/permission/desktop-app capability is required
- **Precondition**: Agent has attempted or evaluated Browser Pane first where appropriate
- **Flow**:
  1. Agent identifies the Browser Pane limitation after using Tide Browser Pane Runtime as the first runtime where supported.
  2. Agent asks the human for the specific external route only when the task requires a capability outside Tide Browser Pane Runtime.
  3. If approved, the external route is clearly named as separate from Tide Browser Pane.
  4. Results are brought back into Tide through explicit Context Artifacts or user summary, not hidden shared state.
- **Postcondition**: External browser runtime use is explicit and does not confuse Browser Pane state.
- **Business Rules**:
  - BR-31: Normal MCP browser guidance must present Tide Browser Pane Runtime as the required first runtime and must not advertise external browser runtime choices in the default browser path.
  - BR-32: Browser profile/cookie persistence is Browser Pane V2 or external-runtime work, not this plan's default.
  - BR-33: Computer Use is appropriate only when a GUI or regular browser capability is required and structured Tide Browser Pane tools are insufficient.
  - BR-46: Tide-wrapped Codex must disable Codex Browser Use plugin so the provider-specific browser runtime cannot silently compete with Tide Browser Pane Runtime.

### UC-9: ReadAndDiffBrowserSnapshot

- **Actor**: Coding agent
- **Trigger**: Agent needs cached page text, search results, or a Generation-anchored diff without refreshing the Browser Pane
- **Precondition**: Caller Pane resolves to a Terminal authorized for the target Browser Pane through Workspace and Associated Terminal
- **Flow**:
  1. Agent calls `read_snapshot`, `find_in_snapshot`, or `diff_since` with a target Browser Pane `PaneId`.
  2. Tide resolves Caller Pane, Workspace, Associated Terminal, target Browser Pane, and BrowserSnapshot ownership.
  3. Tide reads bounded in-memory BrowserSnapshot state without forcing a live page refresh.
  4. Tide returns bounded output with Generation, truncation, and missing/stale status.
  5. Agent uses the result only as cached Browser Pane state, then calls `browser-observe` before content-changing actions when required.
- **Postcondition**: BrowserSnapshot access is explicit, bounded, and scoped to one Browser Pane in one Workspace.
- **Business Rules**:
  - BR-34: `read_snapshot` returns only the bounded current BrowserSnapshot for the target Browser Pane and reports missing snapshot state explicitly.
  - BR-35: `find_in_snapshot` searches only the cached BrowserSnapshot without refreshing the Browser Pane and returns bounded match results.
  - BR-36: `diff_since` requires a Generation anchor owned by the same Browser Pane and Workspace and rejects stale, missing, or mismatched anchors.
  - BR-37: BrowserSnapshot tools must enforce per-PaneId ownership, Associated Terminal authorization, Caller Pane presence, and Workspace locality.
  - BR-38: Closing a Browser Pane, clearing transient Browser Pane state, or cold-storing a Workspace must drop BrowserSnapshot history and invalidate snapshot anchors.

### UC-10: GateAgentBrowserControlMode

- **Actor**: Wrapped Agent or ordinary Gateway/MCP caller
- **Trigger**: Caller issues a Browser Pane action that could visually mimic direct browser control
- **Precondition**: Target Pane is a Browser Pane and the command includes or lacks Caller Pane identity
- **Flow**:
  1. Tide resolves Caller Pane to the active or routed Workspace.
  2. Tide checks whether the Caller Pane is a direct Wrapped Agent with `AgentInfo.wrapper_managed`, `gateway_connected`, and compatible `AgentStatus`.
  3. Tide checks that the target Browser Pane belongs to the same Workspace and Associated Terminal boundary.
  4. If all wrapper-managed checks pass, Tide may enter Agent Browser Control Mode and render natural Browser Automation Cursor mimic behavior.
  5. If the caller is non-wrapper, missing, stale, associated with the wrong terminal, or routed to the wrong Workspace, Tide executes only ordinary allowed Gateway/MCP behavior and never grants wrapper-managed visual privileges.
- **Postcondition**: Agent Browser Control Mode is available only to authorized wrapper-managed callers and remains separate from ordinary Gateway/MCP behavior.
- **Business Rules**:
  - BR-39: Non-wrapper `browser-action` callers must not enter Agent Browser Control Mode or gain wrapper-managed privileges.
  - BR-40: Wrapper-managed `browser-action` callers may enter Agent Browser Control Mode only when Caller Pane, Wrapped Agent, AgentStatus, Associated Terminal, and Workspace checks all pass.
  - BR-41: Agent Browser Control Mode must preserve ModalStack, sensitive-action approval, observe-before-action, and Generation freshness rules.
  - BR-42: Multiple Browser Panes and inactive Workspaces must not expose or project each other's BrowserSnapshot, Browser Automation Cursor, or Agent Browser Control Mode state through stale PaneId, missing Caller Pane, wrong Associated Terminal, or wrong Workspace.
  - BR-44: Browser Panes in Agent Browser Control Mode must project a visible agent-control indicator through normal Tide chrome, including Terminal Context Surface tab/header rendering.

### UC-11: HoldBrowserOperation

- **Actor**: Wrapped Agent
- **Trigger**: User asks the agent to operate a Browser Pane for one bounded browser task
- **Precondition**: Target Pane is a Browser Pane and the Caller Pane is the Wrapped Agent's direct Stage Terminal
- **Flow**:
  1. Agent opens, locates, observes, or explicitly starts work on the target Browser Pane.
  2. Tide applies Agent Browser Control Mode gating using Caller Pane, Wrapped Agent, AgentStatus, Associated Terminal, and Workspace checks.
  3. Tide makes Browser Automation Cursor visible immediately, before the first content click, without rendering tool-label text beside the cursor.
  4. Agent operates through `browser-observe` and `browser-action`, choosing layout correction when Tool Selection Guidance reports poor Browser Pane visual fit.
  5. Agent calls `browser-operation` with `action=finish` after the final observation, or Tide clears the operation when the Wrapped Agent reports Idle or NeedsInput.
- **Postcondition**: The Browser Pane visibly remains under Wrapped Agent operation for the task duration and returns to ordinary visual state afterward.
- **Business Rules**:
  - BR-47: `browser-operation start`, `open-browser`, and `browser-observe` must enter Agent Browser Control Mode for an authorized Wrapped Agent caller.
  - BR-48: Browser Operation start must keep Browser Automation Cursor visible even before the first click and must not render tool-label text beside the cursor.
  - BR-49: `browser-operation finish` must clear Agent Browser Control Mode and Browser Automation Cursor for the target Browser Pane.
  - BR-50: MCP instructions must frame browser task work as a Browser Operation and require human-like Browser Pane observe/action work before app-internal API, credential-bearing URL, URL parameter, or DOM mutation shortcuts unless the user explicitly asks for that internal route.
  - BR-51: Repeated Browser Pane runtime calls within the same Browser Operation must not regenerate Agent Browser Control Mode when the caller and Associated Terminal are unchanged.
  - BR-52: Wrapped Agent Idle or NeedsInput lifecycle signals must clear Browser Operation visual state for Browser Panes owned by that Terminal.

### UC-12: UseBrowserPageMapForTargeting

- **Actor**: Coding agent
- **Trigger**: Agent needs to understand where controls, lists, forms, or major page regions are before choosing a Browser Pane action
- **Precondition**: Target Pane is a navigation-mode Browser Pane with a cached Browser Page Map from the page bridge
- **Flow**:
  1. Agent calls `tide_browser_observe`.
  2. Tide returns BrowserSnapshot text plus Browser Page Map regions and interactables with viewport `Rect`s and generation-scoped `ref`s.
  3. Agent chooses a visible `target_ref` instead of guessing coordinates from BrowserSnapshot text or probing with raw eval.
  4. Tide resolves the `target_ref` in the same Browser Pane Generation, moves Browser Automation Cursor to the target center when applicable, and dispatches the structured Browser Pane action.
  5. Agent observes again after the action when it needs changed page content, or continues with another currently cached enabled `target_ref` when the same visible Browser Page Map is enough.
- **Postcondition**: Agent page targeting is grounded in the shared Browser Pane's visible structure and remains inspectable by the human.
- **Business Rules**:
  - BR-53: `tide_browser_observe` must return Browser Page Map `regions` and `interactables` with bounded text metadata, viewport `Rect`s, limits, and the Browser Pane Generation that produced them.
  - BR-54: Browser Page Element `ref`s are generation-scoped targeting handles and must not be presented as persistent DOM identity, CSS selectors, or authorization.
  - BR-55: `tide_browser_action` `click` with `target_ref` must resolve the observed Browser Page Element, move Browser Automation Cursor to its center, and dispatch through Tide Browser Pane Runtime after the Cursor motion reaches the target rather than raw eval or an external browser runtime.
  - BR-56: `tide_browser_action` `type` with `target_ref` must focus the observed Browser Page Element at its center and type through Tide Browser Pane Runtime after the Cursor motion reaches the target rather than relying on stale active-element state.
  - BR-57: Unknown, stale, or missing `target_ref`s must fail explicitly before dispatch.
  - BR-58: After the first Browser Pane observe, `click` and `type` may chain through currently cached, enabled Browser Page Element refs without an intervening observe; coordinate actions and disabled or missing refs must still require a fresh observe.
  - BR-59: Compact Browser Pane observations must preserve Browser Page Map refs and geometry while omitting full BrowserSnapshot text so routine action loops do not repeatedly flood the agent with page body text.

## Invariants

1. **Single Browser Pane runtime by default**: Agent Browser Pane work acts on Tide's existing in-app `WKWebView`; no second browser runtime is created unless explicitly approved.
2. **Shared human/agent visibility**: Browser Pane state used by an agent must remain visible and inspectable by the human whenever the Pane is visible.
3. **Workspace locality**: Browser Pane Context Artifacts are local to the active Workspace and must not leak across Workspaces.
4. **Associated Terminal authorization**: Browser Pane Context Artifact creation, delivery, list/read, and send flows must respect the source Pane's `Associated Terminal`.
5. **Paired-agent delivery only**: Browser Pane comments/selections deliver only to the paired agent for the source Pane.
6. **Explicit pull/read**: Agents list and read Browser Pane Context Artifacts explicitly; ambient prompt injection is not part of V1.
7. **Structured tools first**: `tide_browser_observe`, `tide_browser_action`, and `tide_capture_selection` are preferred over raw JavaScript eval.
8. **Cursor limits**: Browser Automation Cursor is visible targeting state, not element identity, pointer ownership, or authorization.
9. **Browser Pane UX preservation**: Browser Pane runtime work must preserve Browser Pane UX invariants for URL truthfulness, search precedence, ModalStack visibility, explicit external handoff, and content-frame consistency.
10. **Browser Pane V2 boundary**: Auth profiles, persistent cookies, downloads, passkeys, permissions, popups, storage management, and standalone browser parity remain Browser Pane V2 or explicit fallback work.
11. **Bounded BrowserSnapshot memory**: BrowserSnapshot read/search/diff tools must use bounded in-memory state scoped by Workspace, PaneId, Associated Terminal, Caller Pane, and Generation.
12. **Wrapper-managed mode separation**: Agent Browser Control Mode is available only to authorized Wrapped Agent callers; ordinary Gateway/MCP callers keep ordinary Browser Pane privileges and never inherit wrapper-managed visual control privileges.
13. **Operation-level visibility**: Browser Operation keeps Browser Automation Cursor and Agent Browser Control Mode visible for the task duration, not only for individual Browser Pane actions.

## Roadmap

### Phase 0: Documentation And MCP Guidance

1. Land this V1 implementation contract.
2. Update stale wording in `docs/specs/browser-pane-automation.md` so it reflects existing structured observe/action commands.
3. Add agent-facing MCP instructions that explicitly document the structured Browser Pane tool order: open, observe, act, capture selection, create/list/read/send Context Artifacts, eval only as escape hatch.

### Phase 1: Shared Browser Pane Runtime Discipline

1. Add behavior tests for observe-before-action and observe-after-action expectations where testable.
2. Ensure Browser Automation Cursor state is consistently visible after bridge install, navigation, and reload.
3. Add agent/user ownership state if needed to detect human interruption and force re-observe.
4. Add visual-fit discipline before Browser Pane work: inspect Pane geometry with `tide_observe_workspace` or `tide_browser_observe`, follow Tool Selection Guidance to resize the relevant Layout Target when Browser Pane visual fit is poor, re-observe after layout correction, and prefer structured `tide_browser_action` over `tide_browser_eval` so the Browser Automation Cursor remains visible. Do not treat app-internal API calls, URL parameter shortcuts, or URL shortening as layout substitutes unless the user explicitly asked to test that internal route.

### Phase 1A: BrowserSnapshot Tools And Agent Browser Control Mode

1. Specify exact size and history limits for bounded in-memory BrowserSnapshot history.
2. Add behavior tests for `read_snapshot`, `find_in_snapshot`, `diff_since`, stale Generation handling, per-PaneId ownership, Workspace locality, Caller Pane presence, Associated Terminal authorization, and transient cleanup.
3. Add behavior tests for wrapper-managed Agent Browser Control Mode gating separately from ordinary Gateway/MCP behavior.
4. Implement the new tools and visual mode after the tests exist, without adding element/region capture, Browser Pane V2 profile/session parity, or external-runtime bridges.

### Phase 1B: Browser Operation Transaction

1. Add behavior tests for Browser Operation start/finish around Agent Browser Control Mode and Browser Automation Cursor visibility.
2. Expose a provider-neutral `tide_browser_operation` MCP tool that maps to Agent Gateway `browser-operation`.
3. Update MCP instructions so Codex, Claude, Gemini, and other Wrapped Agents treat user-requested Browser Pane work as a Browser Operation and avoid hidden app-internal shortcuts unless explicitly requested.

### Phase 2: Browser Pane Selection And Comments

1. Harden `tide_capture_selection` for Browser page selection metadata.
2. Add Browser Pane comment composer tests for page selection, URL selection, empty comment with no selection, render-mode selection, Workspace locality, and paired-agent delivery.
3. Define the future element/region selection data model without implementing full visual region capture yet.

### Phase 3: Element And Region Feedback

1. Add element selection capture with stable fields such as page URL, text, role/name when available, bounding box, and optional CSS/accessibility hints.
2. Add region selection capture with viewport coordinates, screenshot crop or page snapshot reference, and comment text.
3. Preserve Browser Automation Cursor and human region selection as separate concepts.
4. V1 must report this as unsupported/future rather than silently promoting broad body text into a region or element selection.

### Phase 4: External Runtime Bridges

1. Define when Codex Browser Use, Browser Use Cloud, Playwright, or Computer Use can be invoked from a Tide task.
2. If a bridge is built, require explicit runtime identity, approval, and result import into Tide Context Artifacts.
3. Do not make Browser Use Cloud profiles or persistent browser state implicit Browser Pane state.

### Phase 5: Browser Pane V2 Capability Work

1. Implement in-app download/session/permission/storage/popup work only through Browser Pane V2 specs and tests.
2. Keep V2 capability state scoped to Browser Pane and Workspace lifecycle rules.

## Non-Goals

1. This V1 implementation does not replace Browser Pane Automation, Browser Pane UX, Browser Pane V2, or Agent Coworking Context specs.
2. This V1 implementation does not make Codex Browser Use control Tide Browser Pane automatically.
3. This V1 implementation does not add persistent browser profiles, cookies, saved passwords, passkeys, extension support, or regular-browser tab access.
4. This V1 implementation does not allow hidden prompt injection from Browser Pane state into agent turns.
5. This V1 implementation does not make Browser Automation Cursor a full remote-control pointer, pointer ownership model, consent signal, or element selector.
6. This V1 implementation does not implement screenshot crop, full visual region capture, Browser Pane V2 session parity, or full external-runtime bridges.
7. This V1 implementation adds BrowserSnapshot tool definitions, Gateway command handlers, bounded BrowserSnapshot history, and Agent Browser Control Mode gating only for UC-9 and UC-10; renderer-specific visual polish remains separate view work.
8. `read_snapshot`, `find_in_snapshot`, and `diff_since` do not refresh the live page, do not persist BrowserSnapshot state to disk, and do not bypass Associated Terminal or Workspace boundaries.
9. Agent Browser Control Mode does not give non-wrapper callers wrapper-managed privileges and does not bypass ModalStack, sensitive-action approval, observe-before-action, or Generation freshness checks.
10. Browser Page Map refs are scoped to one Browser Pane Generation and never authorize hidden Browser Pane content, app-internal API shortcuts, or raw DOM mutation.

## Risks

1. **Runtime confusion**: The phrase Browser Use can refer to Codex's plugin, the browser-use project, or generic browser automation. This spec resolves Tide work around `Browser Pane` and `tide_*` tools.
2. **Stale docs**: Existing specs can become stale as source changes, as shown by the older Browser Pane Automation As-Is claim.
3. **Selection fidelity**: Current Browser Pane selection support is text-oriented; element and region comments need a separate data model.
4. **Coordinate brittleness**: Browser Automation Cursor coordinates can become stale after layout shifts, scrolling, reloads, or responsive viewport changes.
5. **Auth pressure**: Users and agents may expect signed-in browser behavior because external browser runtimes support profiles. Tide must keep Browser Pane V2 boundaries explicit.
6. **Safety pressure**: Browser automation can transmit data. Tide should preserve action-time confirmation for sensitive submissions, uploads, permissions, and account changes.
7. **Workspace leakage**: Context Artifact list/read/send must remain Workspace-local and Associated Terminal-authorized.
8. **Snapshot leakage**: BrowserSnapshot history could leak page text across Browser Panes or Workspaces unless every tool validates Caller Pane, Associated Terminal, PaneId, Workspace, and Generation ownership.
9. **Privilege confusion**: Wrapper-managed visual control could be mistaken for ordinary MCP privilege unless Agent Browser Control Mode gating is tested separately for wrapper-managed and non-wrapper caller paths.
10. **Tool selection blind spot**: Agents can receive BrowserSnapshot text or DOM-derived facts while the Browser Pane inside the Terminal Context Surface is too small for normal visual targeting. Tide must surface Layout Target correction as Tool Selection Guidance in the same observation path, so agents choose `tide_layout_action` and re-observe instead of compensating with app-internal API calls, URL parameter shortcuts, URL shortening, BrowserSnapshot-only targeting, or raw eval workarounds.
11. **Action-only visibility gap**: If visual control state starts only during `browser-action`, a user-requested browser task can appear idle while the agent observes, reasons, or prepares its first action. Browser Operation moves that visual state to the first Browser Pane runtime tool boundary.
12. **Page-map overconfidence**: Browser Page Map is still a bounded visible map, not a complete accessibility tree. Agents must re-observe after mutations when they need changed page content and keep using human-visible Browser Pane actions when the map is incomplete.
13. **Observation payload bloat**: Full BrowserSnapshot text plus Browser Page Map can be too large for routine loops. Compact observations must keep targeting data while avoiding repeated full page-body payloads.

## Tests

V1 implementation must add or update behavior tests before code changes. Required test coverage:

| UC | BR | Test module | Test |
|----|----|-------------|------|
| UC-1: OpenBrowserPaneForAgentVerification | BR-1, BR-2 | `browser_agent_runtime` | `agent_open_browser_creates_browser_pane_in_terminal_context_surface` |
| UC-1: OpenBrowserPaneForAgentVerification | BR-3 | `browser_agent_runtime` | `agent_browser_action_requires_prior_observe_guidance` |
| UC-1: OpenBrowserPaneForAgentVerification | BR-4 | `browser_agent_runtime` | `same_url_navigation_requires_intentional_reload` |
| UC-2: OperateSharedBrowserPane | BR-5, BR-6 | `browser_agent_runtime` | `browser_action_uses_existing_browser_pane_runtime` |
| UC-2: OperateSharedBrowserPane | BR-7 | `browser_agent_runtime` | `browser_actions_update_or_preserve_automation_cursor` |
| UC-2: OperateSharedBrowserPane | BR-8 | `browser_agent_runtime` | `browser_action_refreshes_observable_state_after_live_input` |
| UC-3: UseBrowserAutomationCursor | BR-9, BR-10, BR-11, BR-12 | `browser_agent_runtime` | `browser_automation_cursor_marks_and_clears_agent_target` |
| UC-3: UseBrowserAutomationCursor | BR-13 | `browser_agent_runtime` | `browser_automation_cursor_requires_reobserve_after_navigation` |
| UC-4: CaptureHumanBrowserSelection | BR-14, BR-17 | `browser_agent_runtime` | `browser_capture_selection_prefers_page_selection_over_url_fallback` |
| UC-4: CaptureHumanBrowserSelection | BR-15 | `browser_agent_runtime` | `render_mode_browser_capture_selection_falls_back_to_render_html` |
| UC-4: CaptureHumanBrowserSelection | BR-16 | `browser_agent_runtime` | `browser_region_selection_is_reported_as_unsupported_until_region_model_exists` |
| UC-5: CreateBrowserContextArtifact | BR-18, BR-21 | `browser_agent_runtime` | `browser_context_artifact_delivers_only_to_paired_agent` |
| UC-5: CreateBrowserContextArtifact | BR-19, BR-20 | `browser_agent_runtime` | `browser_context_artifact_list_read_are_workspace_and_terminal_scoped` |
| UC-5: CreateBrowserContextArtifact | BR-22 | `browser_agent_runtime` | `browser_context_artifacts_require_explicit_read` |
| UC-6: ResolveHumanAgentOwnership | BR-24 | `browser_agent_runtime` | `human_browser_intervention_requires_agent_reobserve` |
| UC-6: ResolveHumanAgentOwnership | BR-25, BR-26 | `browser_agent_runtime` | `sensitive_browser_action_requires_explicit_approval_at_action_time` |
| UC-6: ResolveHumanAgentOwnership | BR-27 | `browser_agent_runtime` | `browser_action_rejects_content_interaction_while_modal_hides_webview` |
| UC-7: UseRawBrowserEvalEscapeHatch | BR-28, BR-30 | `browser_agent_runtime` | `browser_eval_is_available_but_not_advertised_as_primary_action` |
| UC-7: UseRawBrowserEvalEscapeHatch | BR-29 | `browser_agent_runtime` | `browser_eval_requires_approval_for_marked_sensitive_flow` |
| UC-7: UseRawBrowserEvalEscapeHatch | BR-43 | `browser_agent_runtime` | `browser_eval_rejects_interactive_dom_actions_and_debug_overlays` |
| UC-8: EscalateToExternalBrowserRuntime | BR-31, BR-33 | `browser_agent_runtime` | `browser_runtime_guidance_focuses_on_tide_browser_pane_runtime` |
| UC-8: EscalateToExternalBrowserRuntime | BR-32 | `browser_agent_runtime` | `browser_pane_v2_profile_cookie_persistence_is_not_v1_default` |
| UC-8: EscalateToExternalBrowserRuntime | BR-46 | `agent_gateway` | `codex_wrapper_disables_browser_use_plugin_inside_tide` |
| UC-9: ReadAndDiffBrowserSnapshot | BR-34 | `browser_agent_runtime` | `browser_snapshot_read_returns_bounded_current_snapshot` |
| UC-9: ReadAndDiffBrowserSnapshot | BR-35 | `browser_agent_runtime` | `browser_snapshot_find_searches_cached_snapshot_without_refresh` |
| UC-9: ReadAndDiffBrowserSnapshot | BR-36 | `browser_agent_runtime` | `browser_snapshot_diff_rejects_stale_generation` |
| UC-9: ReadAndDiffBrowserSnapshot | BR-37, BR-42 | `browser_agent_runtime` | `browser_snapshot_cache_is_pane_and_workspace_scoped` |
| UC-9: ReadAndDiffBrowserSnapshot | BR-38 | `browser_agent_runtime` | `closing_or_cold_storing_browser_pane_drops_snapshot_history` |
| UC-10: GateAgentBrowserControlMode | BR-39 | `browser_agent_runtime` | `non_wrapper_browser_action_does_not_enter_agent_browser_control_mode` |
| UC-10: GateAgentBrowserControlMode | BR-40 | `browser_agent_runtime` | `wrapper_managed_browser_action_enters_agent_browser_control_mode` |
| UC-10: GateAgentBrowserControlMode | BR-41 | `browser_agent_runtime` | `agent_browser_control_mode_preserves_modal_sensitive_and_generation_gates` |
| UC-10: GateAgentBrowserControlMode | BR-42 | `browser_agent_runtime` | `browser_snapshot_tools_reject_missing_caller_wrong_terminal_and_wrong_workspace` |
| UC-10: GateAgentBrowserControlMode | BR-44 | `header` | `browser_agent_control_mode_projects_agent_chrome_state` |
| UC-11: HoldBrowserOperation | BR-47, BR-48, BR-49 | `browser_agent_runtime` | `browser_operation_transaction_keeps_agent_indicator_and_cursor_visible_until_finish` |
| UC-11: HoldBrowserOperation | BR-47, BR-48 | `browser_agent_runtime` | `open_browser_starts_operation_visuals_for_wrapped_agent_before_first_action` |
| UC-11: HoldBrowserOperation | BR-47, BR-48, BR-51 | `browser_agent_runtime` | `browser_observe_starts_operation_visuals_and_keeps_generation_stable` |
| UC-11: HoldBrowserOperation | BR-52 | `browser_agent_runtime` | `wrapped_agent_idle_clears_browser_operation_visuals` |
| UC-11: HoldBrowserOperation | BR-50 | `tide_mcp_runtime` | `mcp_instructions_route_browsers_provider_neutrally` |
| UC-12: UseBrowserPageMapForTargeting | BR-53, BR-54 | `browser_agent_runtime` | `browser_observe_returns_browser_page_map_regions_and_interactables` |
| UC-12: UseBrowserPageMapForTargeting | BR-55 | `browser_agent_runtime` | `browser_action_click_targets_browser_page_element_ref` |
| UC-12: UseBrowserPageMapForTargeting | BR-56 | `browser_agent_runtime` | `browser_action_type_targets_browser_page_element_ref` |
| UC-12: UseBrowserPageMapForTargeting | BR-55, BR-56 | `browser_agent_runtime` | `browser_target_ref_actions_delay_dispatch_until_cursor_motion_settles` |
| UC-12: UseBrowserPageMapForTargeting | BR-57 | `browser_agent_runtime` | `browser_action_rejects_unknown_browser_page_element_ref` |
| UC-12: UseBrowserPageMapForTargeting | BR-58 | `browser_agent_runtime` | `browser_action_chains_current_page_map_target_refs_after_live_input` |
| UC-12: UseBrowserPageMapForTargeting | BR-59 | `browser_agent_runtime` | `browser_observe_compact_returns_browser_observation_summary` |
| UC-1: ObserveTideWorkspace | BR-45 | `tide_mcp_runtime` | `observing_workspace_guides_layout_correction_before_browser_workarounds` |

## Acceptance Criteria

This implementation unit is accepted when:

1. `docs/specs/browser-agent-runtime-plan.md` describes the implemented Browser Pane Agent Runtime behavior for UC-9 and UC-10 while preserving explicit future exclusions.
2. `read_snapshot`, `find_in_snapshot`, and `diff_since` are implemented as bounded in-memory BrowserSnapshot tools with size limits, per-PaneId ownership, Generation anchors, stale/missing snapshot behavior, Associated Terminal authorization, Caller Pane validation, and Workspace locality.
3. Agent Browser Control Mode is separated from ordinary Gateway/MCP behavior: wrapper-managed caller gating may enable visual Browser Automation Cursor mimic behavior, while non-wrapper caller behavior does not gain wrapper-managed privileges.
4. Behavior tests under `crates/tide-app/src/application/behavior_tests/` prove multiple Browser Panes and inactive Workspaces cannot read or diff each other's BrowserSnapshot state through stale PaneId, missing Caller Pane, wrong Associated Terminal, wrong Workspace, or stale Generation.
5. The implementation preserves the required Spec -> behavior tests -> code order and maps each new Business Rule to behavior tests.
6. Glossary and krow language dual-write stays aligned for Agent Browser Control Mode and Browser Operation.

## Location

| Layer | Path | Notes |
|-------|------|-------|
| Runtime spec | `docs/specs/browser-agent-runtime-plan.md` | This file. |
| Existing implementation slice | `docs/specs/browser-pane-automation.md` | Structured observe/action implementation rules; stale As-Is should be corrected separately. |
| Browser Pane domain | `crates/tide-app/src/domain/pane/browser.rs` | Current Browser Pane state, BrowserSnapshot, Browser Automation Cursor, bridge, action helpers, and selection capture helpers. |
| Agent Gateway commands | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` | Current CLI command dispatch, Browser observe/action/eval, selection, and Context Artifact methods. |
| MCP surface | `crates/tide-app/src/adapter/inward/cli_adapter/mcp.rs` | Current `tide_*` tool definitions and MCP instructions. |
| Context Artifact service | `crates/tide-app/src/application/services/action_service/mod.rs` | Current comment snapshot, source label, badge eligibility, paired-terminal injection, and delivery notification behavior. |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/` | Acceptance tests before implementation. |
| BrowserSnapshot domain work | `crates/tide-app/src/domain/pane/browser.rs` | Bounded BrowserSnapshot history, Generation anchors, and transient cleanup hooks. |
| Gateway command work | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` | `read_snapshot`, `find_in_snapshot`, `diff_since`, and wrapper-managed Agent Browser Control Mode gating. |
| MCP tool work | `crates/tide-app/src/adapter/inward/cli_adapter/mcp.rs` | BrowserSnapshot tools and Browser Operation tools that preserve `_caller_pane` caller identity semantics. |
| Future view work | `crates/tide-app/src/adapter/outward/view/` | Additional renderer-specific Agent Browser Control Mode polish after this V1 behavior. |
