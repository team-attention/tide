# Tide — Vision

## One sentence

Tide is an **Integrated Task Environment (ITE)** — the workspace where humans and AI agents get work done together.

## What is an ITE?

The IDE (Integrated Development Environment) unified everything a programmer needs: editor, compiler, debugger, version control — all in one place. But IDEs are built around **code**. The unit of work is a file.

An ITE (Integrated Task Environment) unifies everything needed to **complete a task with AI agents**: terminal, editor, browser, agent-generated UI — all in one place. The unit of work is a **task**, not a file. And the worker is not just the human — it's human + agent, together.

| | IDE | ITE |
|---|---|---|
| **Unit of work** | File / Project | Task |
| **Worker** | Human | Human + Agent |
| **Core tools** | Editor, compiler, debugger | Terminal, editor, browser, generative UI |
| **AI role** | Autocomplete assistant | Co-worker with full environment access |
| **Context sharing** | Manual (copy-paste, @-mentions) | Automatic (ambient context, MCP) |

## The problem

Today, humans and AI agents use computers through separate interfaces:

- **Humans** use terminals, editors, browsers — each in its own window, its own app, its own context.
- **AI agents** (Claude Code, Codex, Gemini, ...) run in a terminal and see only their own text stream. They cannot see what the human is editing, browsing, or looking at.

When a human wants to collaborate with an agent, they must manually bridge these worlds: copy-paste context, describe what's on screen, switch between apps. The tools don't share a workspace — the human is the glue.

Meanwhile, IDEs like Cursor embed AI inside a code editor. This works for coding, but the agent is trapped in the editor's worldview. Terminal workflows, web research, visual design — all outside. And the unit of work is still a file.

## The insight

The right unit is not "a file being edited" but **a task being done**. A task might involve running commands, editing code, checking a web page, reviewing a diff, and asking an agent to generate a dashboard — all at once. The environment should hold all of that, and both human and agent should be able to see and act on all of it.

## What Tide is

Tide is a native macOS ITE that provides multiple **interaction panes** in a shared layout:

| Pane | For the human | For the agent |
|------|--------------|---------------|
| **Terminal** | Run commands, use the shell | Execute commands via `tide_send_keys`, read output via `tide_capture_pane` |
| **Editor** | Edit code with syntax highlighting, LSP | Read what the human is editing (agent-context-injection), open files via `tide_open_editor` |
| **Browser** | Browse the web | Open URLs via `tide_open_browser`, render agent-generated UI via `tide_render_html` |
| **Diff** | Review changes visually | (future: propose changes as diffs) |
| **Launcher** | Quick-create any pane type | — |

The key: **every pane is observable and controllable by both human and agent.** The environment is shared — the task is shared.

## How it works

### MCP (Model Context Protocol)

Agents connect to Tide via MCP. Tide exposes 13+ tools that let agents observe and act:

- **Observe**: `tide_list_panes`, `tide_capture_pane`, `tide_get_layout`
- **Act**: `tide_send_keys`, `tide_open_terminal`, `tide_open_editor`, `tide_open_browser`, `tide_split_vertical`, `tide_close_pane`, ...
- **Create UI**: `tide_render_html` — agents can generate ad-hoc interfaces on the fly

### Auto-integration

When you launch an agent (Claude Code, Codex, Gemini) inside Tide, the MCP connection and hooks are configured automatically. No setup required. The agent immediately gains awareness of the workspace.

### Context flow

- **Ambient context**: Every prompt submission automatically includes what the human is editing in other panes (agent-context-injection)
- **Pinned context**: `Cmd+L` in an editor sends a specific selection to the agent
- **Agent-initiated**: Agents can call `tide_get_context` or `tide_capture_pane` at any time

### Agent lifecycle

Tide tracks agent status (Running / Idle / NeedsInput) and routes notifications:
- Tab dot indicators (green = running, orange = needs input)
- macOS system notifications when the window is not focused
- Dock badge bounce for background alerts

## What Tide is not

- **Not a code editor.** The editor pane exists for quick edits and context sharing, not to replace VS Code or Neovim.
- **Not a terminal emulator.** The terminal is the substrate, not the product. Tide is powered by alacritty_terminal, but the value is the integrated task environment.
- **Not an AI product.** Tide doesn't bundle or sell an LLM. It's the environment where any agent can work. Bring your own agent.

## Where this goes

- Agent context injection (ambient + pinned context)
- Richer MCP tools (file tree access, git status, search)
- Multi-agent workspaces (different agents in different terminals, same workspace)
