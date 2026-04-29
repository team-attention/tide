# Tide Vision

## One Sentence

Tide is an **Integrated Task Environment**: a native macOS Workspace where humans and coding agents work on the same task through shared Terminal, Editor, Diff, Browser, and Render Panes.

## Why This Exists

IDEs organize software work around files and projects. Agent-led work is organized around tasks: run commands, inspect output, edit files, check a Browser Pane, review a Diff Pane, leave feedback, and ask the agent to continue.

Today those surfaces usually live in separate apps. The human sees the browser and editor; the agent sees its Terminal stream. Tide makes the task itself the shared environment.

| | IDE | Tide |
|---|---|---|
| Unit of work | File / project | Workspace task |
| Worker | Human | Human + Wrapped Agent |
| Primary surfaces | Editor, compiler, debugger | Terminal, Editor, Browser, Diff, Render Pane |
| Agent role | Assistant inside one surface | Coworker operating shared Panes |
| Context flow | Copy-paste and descriptions | MCP tools and explicit Context Artifacts |

## Product Model

Tide keeps the Terminal as the primary session, then gives it structured surroundings:

| Surface | Human use | Agent use |
|---------|-----------|-----------|
| Terminal Pane | Run commands and agent CLIs | Receive keys through `tide_send_keys`; expose output through `tide_capture_pane` |
| Editor Pane | Read and make focused edits | Open files through `tide_open_editor`; expose text through capture tools |
| Browser Pane | Preview local apps, docs, and public pages | Open, observe, and act through Tide Browser Pane Runtime |
| Diff Pane | Review changes visually | Provide review context through captures and comments |
| Render Pane | View generated task UI | Render HTML through `tide_render_html` |
| Workspace | Keep a task isolated | Scope Pane identity, layout, and Context Artifacts |

The Dock is the active Terminal's Terminal Context Surface. It keeps supporting Panes attached to the task through Associated Terminal ownership instead of becoming a global pile of tabs.

## Agent Interface

Wrapped Agents connect through the Agent Gateway and Tide MCP Runtime. The current MCP surface covers these families:

- Observe Tide surfaces, Pane geometry, focus, and Browser Pane visual fit with `tide_observe_workspace`.
- Open and capture Terminal, Editor, Browser, and Render Panes.
- Use Tide Browser Pane Runtime with `tide_open_browser`, `tide_browser_observe`, `tide_browser_action`, and BrowserSnapshot tools.
- Adjust layout through product-level Layout Targets with `tide_layout_action`.
- Create, list, read, and send Context Artifacts for explicit human feedback.

Browser work defaults to the shared Tide Browser Pane. External browser runtimes, including browser-use style runtimes, are explicit fallbacks when Tide cannot represent the target or the user asks for that handoff.

## Context Flow

Tide's current context model is explicit:

- A human can select text or page content, add a comment, and create a Workspace-local Context Artifact.
- The artifact is bound to the source PaneId and Associated Terminal.
- The paired agent can list, read, or receive the artifact through MCP and Terminal delivery.
- Browser Pane comments and selections stay visible in the same Workspace instead of becoming hidden prompt state.

This keeps collaboration inspectable. The human can see what was shared, and the agent can ask for more context through stable tools.

## Agent Lifecycle

Wrapped Agents report lifecycle state through Tide's wrapper-managed paths. Tide projects that state into the interface as Pane and Workspace attention, including running, idle, and needs-input states.

## What Tide Is Not

- **Not a replacement editor.** Editor Panes are for task-local reading, focused edits, and context sharing.
- **Not only a terminal app.** Terminal Panes are the substrate; the product is the shared Workspace around them.
- **Not an LLM vendor.** Tide runs the agent CLIs you bring, including Claude Code, Codex, and Gemini.
- **Not a second hidden browser.** Browser Pane work is human-visible by default; external browser runtimes are explicit fallbacks.

## Direction

- Make Editor Pane mature enough for real task-local code work: workspace search, symbols, diagnostics, completion polish, hover, and source navigation.
- Make Workspace rail a task monitor with compact identity, status, change, activity, and context signals.
- Make Browser Pane review feel as direct as code review: visible operations, comments, and paired-agent delivery.
- Keep expanding Tide MCP Runtime around product concepts: Workspace, Pane, Terminal Context Surface, Layout Target, Browser Operation, and Context Artifact.
- Support multiple agents by keeping each task's Workspace, Panes, and context boundaries explicit.

See [Roadmap](roadmap.md) for the current product sequence.
