# Tide Terminal Product Standard

Tide Terminal should become a terminal-grade collaborative workbench. It does
not need to borrow another terminal product's identity. It does need to feel
credible as a terminal product before the workbench model can earn trust.

## Product Promise

Tide Terminal is a native macOS terminal workspace for agent-led software work.
The Terminal stays the live source of truth. Around it, Tide gives the human and
the wrapped agent shared Editor, Browser, Diff, Render, and Context surfaces
that both sides can inspect through the same local app model.

The short version:

> A serious terminal for agent work, with a visible shared workbench around the
> task instead of a hidden chat loop beside it.

## What We Are Building Toward

### 1. A Credible Terminal

The app must feel like a real terminal first, not a terminal-shaped launcher.
Users should trust it for ordinary command-line work even before they care about
agent workflows.

Required bar:

- Terminal rendering is fast, stable, and measurable.
- Terminal protocol support is documented, including known gaps.
- Copy, paste, links, search, scrollback, selection, resize, IME, and modifier
  keys feel predictable.
- Settings cover the basics users expect: font, theme, cursor, shell, scrollback,
  clipboard policy, keybindings, and terminal behavior.
- Keybinding customization is documented as an action reference, not only a JSON
  escape hatch.
- Shell integration works beyond one happy path and explains what it enables.
- SSH and remote workflows have an explicit story, even if early versions are
  modest.
- The README can show screenshots, a demo flow, and limitations without apology.

### 2. Tide's Workbench Model

Tide should not become a generic IDE or a dashboard of mini apps. Its model is
stronger than that:

- `Workspace` is the task boundary.
- `Stage` is the primary live Terminal area.
- `Terminal Context Surface` is the active Terminal's supporting surface.
- Supporting Panes exist because they help the current task: Editor, Browser,
  Diff, Launcher, secondary Terminal, and Render.
- `FileTree View` is project structure, not the center of the product.
- Context moves through explicit `Context Artifact` records, not invisible prompt
  stuffing.

This means every new surface should answer one question: how does this help a
human and a wrapped agent work on the same task through visible state?

### 3. Agent Collaboration As Product, Not Plumbing

The Agent Gateway and Tide MCP Runtime are not just integration details. They
are the product's collaboration layer.

Required bar:

- Agents can observe the Workspace, Pane geometry, visible Browser state, and
  relevant Context Artifacts through stable MCP tools.
- Browser operations are visible and honest: the user can see what the agent is
  doing, which target it is using, and when the operation is done.
- Human comments on Terminal, Editor, Browser, and Diff selections can become
  scoped Context Artifacts for the paired agent.
- Wrapped agent state is visible in Pane chrome and Workspace rail: running,
  idle, needs input, detached, or errored.
- Notifications are task-oriented, not just process noise.
- Agent wrappers remain provider-neutral. Claude Code, Codex, Gemini, opencode,
  and future CLIs should all speak the same Tide concepts.

### 4. Product Proof

A product this unusual needs proof immediately.

Required bar:

- First screen and README show the real product, not abstract copy.
- A new user can understand the model in under a minute: Workspace, Stage,
  Terminal Context Surface, Browser, Context Artifact.
- The demo shows a complete human-agent loop: run agent, open Browser, inspect
  page, create comment/artifact, deliver it, continue in Terminal, review Diff.
- Known limitations are explicit and calm.
- Install, update, signing, and source build paths are clear.

## Tide's Product Standard

Terminal credibility comes from native feel, speed, compatibility,
configuration, themes, keybindings, shell integration, and SSH details because
terminal users notice every rough edge. Agent workbench credibility comes from
clear task identity, attention signals, notifications, session restore, browser
automation, CLI control, and remote-work boundaries that feel operational instead
of experimental.

Tide's answer:

- We keep the terminal as the live execution substrate.
- We make workspaces task-native, not just tabs with prettier labels.
- We let agents operate the same visible Browser, Editor, Diff, and Render
  surfaces humans use.
- We treat MCP as a local shared-workbench contract, not as hidden automation.
- We keep context explicit, scoped, and inspectable.

## Product Principles

1. Real terminal first.
2. Shared visible surfaces over hidden automation.
3. Workspace equals task.
4. Terminal owns execution, surrounding Panes provide context.
5. MCP exposes Tide concepts, not implementation trivia.
6. Context is explicit and reviewable.
7. Dense, native, low-glare UI beats decorative novelty.
8. Agent features must also improve human control.
9. Defaults should work before customization becomes necessary.
10. Public claims must be backed by visible product proof.

## Not-Embarrassed Checklist

Use this checklist before presenting Tide Terminal as a serious terminal product.

### Terminal Credibility

- [x] Publish a current terminal feature and protocol support matrix.
- [x] Add an initial repeatable terminal compatibility smoke test suite.
- [x] Expose terminal compatibility diagnostics as a headless command.
- [x] Add a repeatable terminal-core throughput, search, and resize benchmark.
- [x] Add a repeatable WGPU rendering and input-to-GPU-complete latency
  benchmark.
- [x] Define Tide's conservative `TERM=xterm-256color` and terminfo strategy.
- [x] Document all configurable keybinding action names.
- [x] Expand settings beyond font size, font family, light/dark, and OSC52 read.
- [x] Surface scrollback and OSC 52 read policy in a Terminal settings tab.
- [x] Add theme import or a serious built-in theme set.
- [x] Make shell integration understandable and multi-shell.
- [x] Define the SSH and remote workflow.

### Workbench Credibility

- [x] Surface Workspace rail identity, agent state, cwd or branch, changed file
  count, and pending/delivered Context Artifact state.
- [x] Surface the last useful wrapped-agent notification event in the Workspace
  rail and MCP task monitor without turning the Stage into a dashboard.
- [x] Surface terminal exit as a Workspace task event in the rail and MCP task
  monitor.
- [x] Surface Browser and Diff state as Workspace task events in the rail and
  MCP task monitor.
- [x] Surface Terminal Context Surface mode and support-pane count in Workspace
  rail, titlebar metadata, and MCP task monitor terminal summaries.
- [x] Surface Terminal Context Surface ownership, mode, and pane count in the
  context header identity label.
- [x] Add hover help labels for Terminal Context Surface split, stack, and add
  actions.
- [x] Expand task-monitor event summaries to session/preferences restore events.
- [x] Surface Browser Pane operation state in single-pane headers and active tab
  badges.
- [x] Expose Editor Pane search to MCP with bounded match, context, cursor, and
  file metadata.
- [x] Expose bounded Editor Pane replacements to MCP for task-local focused
  edits.
- [x] Make Editor Pane solid enough for broader editing workflows, including
  human-facing replace UI and larger refactors.
- [x] Make Browser Pane review loops visible end-to-end, including comments and
  review history.
- [x] Make Diff Pane a first-class review surface with selection-backed Context
  Artifact creation and file-specific source labels.
- [x] Add project-local workspace/action configuration.

### Agent Collaboration

- [x] Document the Tide MCP Runtime as a public contract.
- [x] Add a headless workbench compatibility diagnostic for MCP-visible surfaces.
- [x] Expose an MCP-visible Workspace task monitor with pane, agent, Terminal
  Context Surface, and Context Artifact summaries.
- [x] Include Context Artifact delivered, pending, and delivery-count summaries
  in the MCP-visible Workspace task monitor.
- [x] Add a caller-scoped terminal observation tool for visible output, cursor,
  cwd, scrollback, selection, and link metadata.
- [x] Add a caller-scoped terminal find tool for bounded scrollback and visible
  output search.
- [x] Keep Context Artifact delivery history visible through MCP list/read/send
  results so review comments are not fire-and-forget.
- [x] Show agent tool guidance in product docs with real examples.
- [x] Surface wrapped-agent lifecycle and notification state per Workspace.
- [x] Add an unread or attention panel for task notifications.
- [x] Define session restore and agent resume behavior by provider.
- [x] Keep browser automation visible by default and explicit when it falls back.

### Product Surface

- [x] Show a real screenshot or video in the public README surfaces.
- [x] Add a first-run explanation that teaches the model without a wall of text.
- [x] Add a public known-limitations page.
- [x] Clarify install, auto-update, signing, and source-build expectations.
- [x] Make the README describe Tide Terminal with confidence, not apology.

## Suggested Sequence

### Phase 0: Narrative And Proof

Update the README, screenshots, demo flow, docs index, and limitations. Make the
product promise clear before expanding scope.

### Phase 1: Terminal Credibility

Focus on settings, keybinding docs, terminal compatibility checks, shell
integration, theme basics, and performance numbers.

### Phase 2: Task Monitor

Upgrade Workspace rail into the core task monitor. It should show which task
needs attention without turning the Stage into a dashboard.

### Phase 3: Collaboration Loop

Make Context Artifacts, Browser review, Diff review, and paired-agent delivery
feel like one loop instead of separate features.

### Phase 4: Remote And Restore

Add a clear SSH/remote story, then session restore and provider-specific agent
resume where the providers make it possible.
