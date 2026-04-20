# Claude Code GUI Revamp Research

Date: 2026-04-16

## Question

What should Tide learn from the April 2026 Claude Code desktop redesign, and what should a Tide-native Claude Code GUI revamp prioritize without copying Claude Desktop directly?

## Evidence

### External product evidence

- Anthropic announced a redesigned Claude Code desktop app on 2026-04-14, positioned around running more Claude Code tasks at once, with a sidebar for active/recent sessions, drag-and-drop workspace layout, integrated terminal and file editor, and performance improvements. Source: https://claude.com/blog/claude-code-desktop-redesign
- The redesign frames the user as an orchestrator with multiple agentic tasks in flight, checking results, steering drift, and reviewing diffs before shipping. Source: https://claude.com/blog/claude-code-desktop-redesign
- Claude Desktop now documents parallel sessions with Git worktree isolation, drag-and-drop layout, integrated terminal, file editor, preview pane, side chats, visual diff review, live app preview, PR monitoring, connectors, and local/SSH/cloud environments. Source: https://code.claude.com/docs/en/desktop
- Claude Desktop view modes are Normal, Verbose, and Summary. The docs describe them as transcript-density controls: summaries, full tool-call detail, or final responses plus changes. Source: https://code.claude.com/docs/en/desktop
- Claude Desktop session isolation uses Git worktrees under `.claude/worktrees/` by default, with sidebar filters by status, project, and environment, plus project grouping. Source: https://code.claude.com/docs/en/desktop
- Claude Desktop side chats branch off from a main session, read the main context, and do not feed content back into the main conversation. Source: https://code.claude.com/docs/en/desktop
- Claude Desktop shared configuration includes `CLAUDE.md`, MCP servers in Claude Code settings files, hooks, skills, and project/user settings. Desktop-chat MCP config is separate from Claude Code MCP config. Source: https://code.claude.com/docs/en/desktop
- Claude Desktop's feature comparison lists computer use as app and screen control on macOS and Windows. Source: https://code.claude.com/docs/en/desktop

### Tide repo evidence

- Tide's vision already defines the product as an Integrated Task Environment where the unit of work is a task, not a file, and the core tools are Terminal, Editor, Browser, Diff, Launcher, and agent-generated UI. Source: `docs/vision.md`
- Tide already treats every Pane as observable or controllable by agents through MCP, including `tide_list_panes`, `tide_capture_pane`, `tide_get_layout`, `tide_send_keys`, `tide_open_editor`, `tide_open_browser`, and `tide_render_html`. Source: `docs/vision.md`, `crates/tide-app/src/adapter/inward/cli_adapter/mcp.rs`
- Tide has zero-config wrapper integration for the fixed Wrapped Agent set `claude`, `codex`, and `gemini`. The current Claude wrapper injects a Tide MCP server and hooks `Notification`, `Stop`, and `UserPromptSubmit` into `tide notify` lifecycle events. Source: `docs/specs/agent-auto-integration.md`, `crates/tide-app/resources/bin/claude`
- Tide normalizes wrapper lifecycle into `AgentStatus`, then chrome derives `AgentChromeState` from `AgentStatus` plus Wrapped Agent Presence. Current UI projection maps `Running` to green, `Idle`/`NeedsInput` to attention, and gateway-connected/no-status to connected-idle. Source: `docs/specs/agent-auto-integration.md`, `docs/research/wrapped-agent-lifecycle-matrix.md`, `crates/tide-app/src/adapter/outward/view/header.rs`
- Tide already has Render Pane support through Browser Pane render mode. A render-mode Browser Pane hides the URL bar, stores `render_title`, stores agent-provided `render_html`, and builds a full render document with the runtime wrapper. Source: `crates/tide-app/src/domain/pane/browser.rs`
- Tide has a Context Artifact model for explicit human-to-agent context. Artifacts are Workspace-local, bound to a source Pane and Associated Terminal, and delivered only to the paired agent. Source: `docs/specs/agent-coworking-context.md`
- Tide's glossary defines WorktreeInfo as cached git worktree metadata including path, branch, `is_main`, and `is_current` flags. Source: `docs/glossary.md`

## Interpretation

Claude Desktop is converging on the same broad shape Tide already states in its vision: a shared task environment with terminal, editor, browser/preview, diff, and agent control. The difference is framing:

- Claude Desktop centers the Claude session and adds local tools around it.
- Tide centers the Workspace and Pane system, then lets any Wrapped Agent operate inside it.

That means a Tide revamp should not be "Claude Desktop inside Tide." It should make Tide's own Workspace orchestration clearer, then use Claude-specific wrapper data to make Claude Code feel first-class when it is the active Wrapped Agent.

## Product Principles

1. Keep `Workspace` as the primary unit, not an imported Claude session abstraction.
2. Treat each direct Stage `Terminal` running a Wrapped Agent as the live task owner.
3. Make agent state scannable across Workspaces without requiring users to inspect terminal scrollback.
4. Preserve explicit context boundaries: use Context Artifacts and Associated Terminal authorization instead of invisible prompt injection.
5. Prefer dedicated Tide tools over broad screen control. Claude Desktop's computer-use model is useful context, but Tide already has lower-risk Agent Gateway tools for Pane observation and action.
6. Keep CLI compatibility. The Claude wrapper must remain additive to user MCP and hook settings, as it is today.

## Recommended Revamp Tracks

### Track 1: Agent Workspace Sidebar

Goal: make parallel agent work easy to scan and resume.

Suggested behavior:

- Show Workspaces grouped by project/worktree when available.
- Show the strongest direct Stage Terminal state per Workspace: attention, running, connected-idle, or none.
- Add filters for active attention, running, connected-idle, project, and environment when Tide can determine the environment.
- Surface the latest Notification Snippet or final response snippet for each Workspace.
- Add an archive/complete affordance for Workspaces whose task is finished, but keep it separate from deleting panes or worktree files.

Why: Claude Desktop's sidebar is explicitly built around many active/recent sessions. Tide already has Workspaces and workspace-level wrapped-agent projection; the gap is richer scannability and grouping.

### Track 2: Agent Task Header

Goal: replace dot-only state with a compact, inspectable control surface for the active Wrapped Agent.

Suggested behavior:

- Keep the existing dot colors, but add a click target that opens details for the active Wrapped Agent.
- Show `AgentStatus`, Wrapped Agent Presence, source Terminal, cwd/worktree, last Notification Snippet, and notification authorization state.
- Distinguish `Idle` from `NeedsInput` in text even if both continue sharing the attention color family.
- Offer primary actions: focus source Terminal, create Context Artifact from focused Dock Pane, open latest generated Render Pane, and acknowledge attention.

Why: current evidence shows `Idle` and `NeedsInput` share the same orange attention dot family, so the dot alone is not enough for orchestrating multiple agents.

### Track 3: Tide-Native Side Question Flow

Goal: support "ask without derailing" while preserving Tide's explicit context model.

Suggested behavior:

- Do not send side-question text into the paired Terminal's main prompt.
- Model the side question as a separate Pane or modal flow that can read Context Artifacts and Pane snapshots.
- Let the user convert a useful side-question result into a Context Artifact if it should enter the main agent flow.
- Keep a visible "not sent to paired agent" state so users know the main Claude Code turn is untouched.

Why: Claude Desktop side chats read the main context but do not add back to the main thread. Tide should match the workflow value without weakening Associated Terminal and Context Artifact boundaries.

### Track 4: Review And Preview Cockpit

Goal: make the Dock feel like the place to review and ship agent work.

Suggested behavior:

- Treat Diff, Browser Pane, Render Pane, and Editor Pane as review companions for the source Terminal.
- Add a "review layout" preset that places Diff + Browser/Render Pane + Editor beside the active agent Terminal's Dock.
- Expose dev-server preview controls in Browser Pane chrome when Tide can infer a local server from Terminal Context or a future launch config.
- Keep Render Pane as the first-class surface for agent-generated dashboards, checklists, or implementation summaries.

Why: Claude Desktop now emphasizes diff review, previews, and spot edits without leaving the app. Tide already has most Pane kinds and `tide_render_html`; the missing piece is a cohesive review mode.

### Track 5: Transcript Density Modes

Goal: reduce cognitive load when monitoring several Wrapped Agents.

Suggested behavior:

- Add a per-Terminal display mode for agent output: raw terminal, summarized turns, and final-response focus.
- Use wrapper hook payloads where available before falling back to terminal grid extraction.
- Keep raw terminal always accessible; summaries should not hide errors permanently.

Why: Claude Desktop added Verbose/Normal/Summary modes because multi-session orchestration needs scan speed. Tide's Terminal-first model needs an equivalent that does not destroy terminal fidelity.

### Track 6: Worktree-Aware New Task Flow

Goal: start multiple Claude Code tasks safely from Tide.

Suggested behavior:

- Add a "New Agent Task" flow that can create a new Workspace, optional git worktree, Stage Terminal, and Wrapped Agent launch.
- Show WorktreeInfo in the Workspace sidebar and Agent Task Header.
- Make worktree cleanup explicit and reversible where practical.

Why: Claude Desktop uses automatic worktrees to isolate sessions. Tide already has WorktreeInfo and multi-Workspace architecture, so worktree-aware task spawning is the natural Tide-native parallelism path.

## Risks And Constraints

- A Claude-specific GUI should not weaken Tide's agent-agnostic stance. The Wrapped Agent layer should keep Claude, Codex, and Gemini support structurally similar.
- Adding a broad "computer use" capability would overlap with Claude Desktop's highest-risk path. Tide should first deepen Agent Gateway tools because they are Pane-scoped and more auditable.
- If Tide introduces side-question UI, it must not accidentally paste into the paired Terminal or create hidden context injection. This is the same class of boundary that Context Artifact delivery already handles.
- If summary modes depend on hook payloads, each Wrapped Agent needs an evidence-backed wrapper contract. Do not infer external hook behavior beyond checked-in wrapper resources and official docs.

## Suggested Next Spec

Create `docs/specs/agent-workspace-orchestration.md`.

Initial use cases:

- UC-1: ScanWrappedAgentWorkspaces
- UC-2: FilterWorkspaceListByAgentState
- UC-3: InspectActiveWrappedAgent
- UC-4: AskSideQuestionWithoutMainTerminalInjection
- UC-5: OpenReviewLayoutForWrappedAgent
- UC-6: StartWorktreeBackedAgentTask

Initial bounded contexts:

- `workspace`: Workspace list, grouping, archive state, active Workspace selection
- `gateway`: Wrapped Agent lifecycle, Notification Snippet, connected status
- `terminal`: Terminal Context, WorktreeInfo, Wrapped Agent launch
- `layout`: review layout preset and Pane placement
- `pane`: Context Artifact and selection capture surfaces
- `renderer`: sidebar, header, status affordances, density controls
