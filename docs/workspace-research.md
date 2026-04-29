# Workspace Model Research

Research on workspace/context management in terminal apps to inform Tide UI redesign.

Core question: **What model allows organizing and switching between multiple project contexts while preserving the terminal app experience?**

Note: shortcuts in the external-tool sections describe those tools or earlier proposals. Current Tide defaults are `Cmd+E` for Workspace rail, `Cmd+B` for FileTree View, `Cmd+\` for Dock, `Cmd+[` / `Cmd+]` for Workspace switching, and `Cmd+Shift+N` for new Workspace.

---

## Current Tide Structure

```
Tide Window → [Workspace rail | Stage | Terminal Context Surface | FileTree View]
```

- Multiple Workspaces. Each Workspace has its own panes, layout, focus, and extras.
- Stage is the primary execution surface.
- Terminal Context Surface follows the focused Stage Terminal.
- FileTree View is independent right-side chrome.

---

## Terminal App Spectrum

```
Terminal ◄──────────────────────────────────────────► IDE
Ghostty  Rio  Kitty  tmux  Zellij  iTerm2  WezTerm  Wave  Warp
                                      ↑
                                    Tide (current)
```

---

## Analysis by Approach

### 1. "Just Do Terminals Well" — Ghostty, Rio

**Model:** Window > Tab > Split

- Only saves layout (window position, tab structure, split direction).
- No session/workspace concept.
- Ghostty: `window-save-state` option (layout only, no scrollback preservation).
- Rio: No session persistence at all.

**Pros:** Clean. Focused on a single role.
**Cons:** Doesn't solve the context-switching problem. Delegates to tmux/zellij.

**Implications for Tide:** Tide has already moved beyond this stage with FileTree View, Editor Panes, Browser Panes, and Terminal Context Surface. Going back would be a regression.

---

### 2. Session-Based Multiplexers — Zellij, tmux

**Model:** Session > Tab > Pane

A terminal inside a terminal. Sessions are workspaces.

#### Zellij Key Features

- **Session Resurrection:** Auto-serializes session to KDL file every 1 second (`~/.cache/zellij/<session>.kdl`). Revives via `zellij attach <session>` after crash/exit.
- **Safety Guard:** Resurrected sessions show "Press ENTER to run..." banner before executing commands. Prevents dangerous auto-execution.
- **KDL Layout Files:** Declarative tab/pane/command definitions:
  ```kdl
  layout {
      tab name="code" {
          pane command="nvim" { cwd "/project"; }
          pane split_direction="vertical" {
              pane command="cargo" { args "watch"; }
              pane
          }
      }
      tab name="logs" {
          pane command="tail" { args "-f" "log.txt"; }
      }
  }
  ```
- **WASM Plugins:** Welcome Screen, Session Manager, Filepicker all implemented as WASM plugins.
- **Floating/Stacked Panes:** Supports floating and stacked panes beyond normal tiling.

#### tmux Comparison

- Session persistence relies on external plugins (tmux-resurrect, tmux-continuum).
- Prefix key interaction (Ctrl-B). Steep learning curve.
- Zellij improves accessibility with mode-based UI + on-screen keybinding hints.

**Pros:** Clear mental model: session = project. Instant switching. Full state preservation.
**Cons:** A layer on top of terminal apps. Structural conflict with native GPU-rendering apps like Tide.

**Implications for Tide:** Zellij's auto-serialization + resurrection pattern is worth referencing. But since Tide itself acts as a multiplexer, layering another multiplexer on top is unnatural.

---

### 3. Layout Save/Restore — iTerm2, Kitty

#### iTerm2: Window Arrangements + Profiles

**Model:** Window > Tab > Split Pane (+ Profiles, Arrangements as cross-cutting concepts)

- **Profile:** Named settings bundle (colors, font, startup command, working directory, badge, etc.). Create profiles per project.
- **Window Arrangement:** Complete spatial state save — window position/size, tab structure, split layout, each pane's profile.
  - Save with `Cmd+Shift+S`, restore with `Cmd+Shift+R`.
  - Can assign keyboard shortcut to specific arrangements.
- **Dynamic Profiles:** Define profiles via JSON files → version control, team sharing.
- **Session Restore:** macOS system window restore + "auto-restore last arrangement" option.

**Power user pattern:** Create per-project Window Arrangements ("Frontend Dev", "Backend API"), switch arrangements when switching context.

#### Kitty: Session Files

**Model:** OS Window > Tab > Window (Pane)

- Plain text session files (`.kitty-session`):
  ```
  layout tall
  cd ~/project
  launch nvim .
  launch zsh

  new_tab logs
  cd ~/project
  launch tail -f app.log
  ```
- Auto-load via `startup_session` config.
- `--relocatable` flag for relative paths → portability.
- No auto save/restore. Community tools (kitty-save-session) fill the gap.
- Kittens (Python scripts) + remote control API for programmatic control.

**Pros:** Declarative and version-controllable. Intuitive text format.
**Cons:** Manual. Requires explicit save/load. Requires "non-terminal-like" behavior.

**Implications for Tide:** Layout declaration files are referenceable, but "explicit save" conflicts with Tide's desired direction. Auto-persist is needed.

---

### 4. Built-in Workspaces — WezTerm ★

**Model:** Workspace > MuxWindow > Tab > Pane

The terminal app closest to Tide's position that has built-in workspaces.

#### Core Structure

- **Workspace = string label.** Windows and tabs belong to a workspace.
- On workspace switch, only related windows are shown; others are hidden.
- `wezterm-mux-server` for session persistence — can replace tmux.
- New workspaces created with a single keybinding (name input prompt).

#### Programmatic Workspaces via Lua Config

```lua
wezterm.on("gui-startup", function()
    local tab, pane, window = mux.spawn_window{ workspace = "coding" }
    pane:send_text("cd ~/project && nvim .\n")

    local tab2, pane2, window2 = mux.spawn_window{ workspace = "monitoring" }
    pane2:send_text("htop\n")

    mux.set_active_workspace("coding")
end)
```

#### Domain Abstraction

- **Domain** = connection context (local, SSH, WSL, remote mux server)
- Can mix tabs/panes from different domains within a single workspace
- Remote sessions managed like local ones

#### Workspace Switching UX

- `Cmd+Shift+S` → fuzzy finder to select workspace → instant switch
- Happens inside the terminal app. Minimal GUI overhead.

**Pros:**
- Preserves terminal app identity (GPU rendering, native tabs)
- Workspaces are lightweight with instant switching
- Infinitely customizable via Lua config
- Full session persistence via mux-server

**Cons:**
- Workspace creation is still explicit (name input required)
- No auto-detection/auto-creation

**Implications for Tide:** WezTerm's "workspace = label, switch = swap visibility" model is the best fit for Tide. Combining it with auto-persist instead of explicit creation would be more natural.

---

### 5. Block-Based Dashboard — Wave Terminal

**Model:** Window > Workspace > Tab > Block

#### Core Innovation: Block

- Block = modular content container. Not just terminals: file preview, browser, AI chat, code editor, system monitor, etc.
- Each block can independently SSH-connect (mix local + remote in one tab).
- Blocks arranged in tiling layout (binary tree based).
- Magnify: expand a single block to fill the tab / restore.

#### Workspace Management

- Workspaces are ephemeral by default. Must explicitly "Save workspace" for permanent preservation.
- Workspace Switcher: icon and color customization available.
- Save targets: tab structure, layout, terminal scrollback, AI conversations, editor state.
- **Durable SSH sessions (v0.14.0):** SSH sessions persist across network disconnects, sleep, app restarts.

#### `wsh` CLI

- Control Wave from within the terminal:
  ```
  wsh edit file.txt    # open editor block
  wsh web url          # open browser block
  wsh ai "explain"     # open AI block
  ```
- Works from SSH remote sessions to control local Wave.

**Pros:** Best-in-class context preservation (scrollback, AI, editor included). Flexible block types.
**Cons:** Drifts away from terminal experience. Electron-based with performance limits. Requires explicit save.

**Implications for Tide:** Block concept is similar to Tide's PaneKind (Terminal, Editor, Diff, Browser). CLI bridge like `wsh` is referenceable for Phase 3 (Extensibility). But following the entire model would move away from being a terminal app.

---

### 6. Agent Terminal — Warp

**Model:** Window > Tab > Block (command-as-unit)

#### Blocks (Command Units)

- Instead of traditional scrollback, each command execution is an individual Block.
- Prompt + Command Input + Output as a single unit.
- Individual block search, filter, copy, share available.
- Input area behaves like a code editor (multi-line, syntax highlighting).

#### Warp 2.0 — Agentic Development Environment

- Integrates 4 areas: Code, Agents, Terminal, Drive.
- AI agents control terminal, read/write files, debug.
- `WARP.md` for project context definition.

**Pros:** Treating commands as individual units is innovative.
**Cons:** Breaks the traditional PTY model. More an AI dev environment than a terminal. Proprietary.

**Implications for Tide:** Block concept is interesting but diverges from Tide's direction. Tide is traditional PTY-based (alacritty_terminal). Fundamentally different architecture makes direct application difficult.

---

## Comparison Table

| App | Hierarchy | Session Persist | Project Isolation | Auto Save | Terminal Feel |
|---|---|---|---|---|---|
| Ghostty | Window > Tab > Split | Layout only | None | Yes (layout) | ★★★★★ |
| Rio | Window > Tab > Split | None | None | No | ★★★★★ |
| Kitty | OS Window > Tab > Window | Session file (manual) | OS Window = project | No | ★★★★☆ |
| tmux | Session > Window > Pane | Plugin-dependent | Session = project | No | ★★★★☆ |
| Zellij | Session > Tab > Pane | 1s auto-serialization | Session = project | Yes | ★★★★☆ |
| iTerm2 | Window > Tab > Split | Arrangements (manual) | Arrangement = project | Partial | ★★★★☆ |
| **WezTerm** | **Workspace > Window > Tab > Pane** | **Mux server** | **Workspace = project** | **Yes** | **★★★★☆** |
| Wave | Workspace > Tab > Block | Saved workspace (manual) | Workspace = project | No | ★★★☆☆ |
| Tabby | Window > Tab > Split | Plugin-dependent | Profile Groups | No | ★★★☆☆ |
| Warp | Window > Tab > Block | Partial | WARP.md | Partial | ★★☆☆☆ |

---

## Key Patterns Summary

### Zellij — Auto-Serialization + Safe Resurrection
- Auto-serializes session state to file every 1 second
- Resurrected commands wait for Enter before execution (safety guard)
- Declarative KDL layout files

### WezTerm — In-App Workspaces ★
- Workspace = string label. Lightweight and fast switching.
- Fuzzy finder for workspace selection.
- Programmatic configuration via Lua scripts.
- Session persistence via mux server.

### iTerm2 — Window Arrangement
- Spatial state snapshot save/restore
- Profile system for per-pane settings isolation

### Wave — Durable SSH + CLI Bridge
- SSH sessions survive network disconnects / app restarts
- `wsh` CLI for controlling GUI from within the terminal

### Ghostty — Undo Close
- Can undo split/tab close within a timeout
- Small but meaningful UX innovation

---

## Tide Application Direction (Draft)

### Most Promising Model: WezTerm-style Workspaces + Zellij-style Auto-Persist

```
Tide Workspace (label/directory)
├── Workspace rail item state
├── Stage layout (SplitLayout)
│   ├── Terminal panes (CWD, scrollback)
│   └── Editor/Diff/Browser panes
├── Terminal Context Surface state
├── FileTree View state
└── Focus state, scroll positions, etc.
```

- **Workspace = label** (whether directory-based or name-based)
- **Auto-persist** — Periodic serialization like Zellij. No explicit save.
- **Switch = swap visibility** — Swap only related state like WezTerm. Instant.
- **Switcher = fuzzy finder** — a future Workspace picker action for workspace list → select → switch.
- **Preserve terminal app identity** — Opening Tide starts with the last workspace immediately. No separate launcher/manager.

### Open Questions

1. **Workspace creation trigger:** Directory-based auto-creation vs explicit creation (name input). The former is natural but raises "cd vs workspace root" ambiguity. The latter requires an extra step.
2. **Cross-workspace pane movement:** Should users be able to move a terminal from one workspace to another?
3. **Multi-window vs single-window:** Does workspace switching happen within the same window, or are workspaces separated by window?
4. **Terminal process preservation:** How to handle running processes in background terminals during workspace switch?
5. **Scrollback preservation:** Keep all workspaces' scrollback in memory? Swap to disk?
