# Master Plan: Codex App Alternative

This is the product master plan for Tide v2 as a free, open-source Codex App alternative with multi-agent support.

It is UX-first. Start from what the user sees and does, then describe the application model needed to support it.

## North Star

Tide v2 is a free, open-source Codex App alternative with multi-agent support.

The baseline user experience follows Codex App:

- Left column: work history.
- Agent Chat: one focused AI Agent chat for the selected Thread.
- Composer: anchored at the bottom of Agent Chat, not at the bottom of the whole app.
- Workbench appears only when the active Thread needs it.

When the screen is split vertically, the default mental model is:

```text
Left Rail | Agent Chat | Workbench
```

Agent Chat owns the conversation narrative, its Composer, and the visible Agent Session. The Agent Runtime is an internal execution detail that users normally do not open or manage. The Workbench is the optional visible work area inside the active Thread. It can contain Browser, Diff, Editor, or Terminal Panes, plus FileTree and context-artifact views for inspection, editing, verification, and direct work. It does not replace Agent Chat as the narrative area.

The Tide difference is local, open, and multi-agent:

- Codex CLI, Claude Code, Gemini CLI, and opencode are first-class Provider CLI Agents.
- Tide v2 represents Agents as provider CLI integrations. Direct API-backed Tide Agents are not part of the current product path.
- A Thread can be powered by any supported Agent.
- The Agent Runtime is a hidden PTY-backed provider CLI session, but the user sees it through the visible Agent Session by default.
- Project folders organize Threads and provide Execution Context.
- Tide should not feel like a project-first IDE on the first screen.

## Product Decisions

1. The first screen follows Codex App before Tide adds new chrome.
2. The Left Rail starts with `New thread`, `Search`, and `Sidebar options`.
3. There are no global status buckets such as `Needs attention`, `Running`, or `Recent` in the default Left Rail.
4. Thread Rows show one small Agent Icon because Tide supports multiple Agents.
5. Thread title is derived from the first meaningful user message. Tide does not run a title-generation prompt.
6. Project is grouping plus Execution Context, not the app root.
7. Composer stays close to Codex App's Composer.
8. Browser, Diff, Editor, and Terminal Panes, plus FileTree and context-artifact views, appear in the Workbench after a Thread needs them; they are not first-screen anchors.
9. Scratch exists for one-off Threads that do not start from an explicit Project.
10. Thread is the primary product object. Project organizes Threads and provides Execution Context.
11. Agent Runtime is an internal execution detail. Users normally interact with Agent Chat and Agent Session, not the hidden runtime surface.

## UX Design

### Flow 1: First Launch

User goal: understand where to start without configuring the app.

Screen:

```text
Left Rail
  New thread
  Search
  Sidebar options

  Pinned
    [agent] Thread title          time

  Projects
    [folder] tide
      [agent] Thread title        time
      [agent] Thread title        time
    [folder] slice
      [agent] Thread title        time

  Scratch
    [agent] Thread title          time

Center
  What can I help with?

Bottom
  Composer
```

The screen shows:

- Existing Threads grouped by Project.
- Pinned shortcuts above Projects and Scratch.
- A blank center state.
- Composer for the next request.

The screen avoids:

- Persistent Agent picker panel.
- Persistent terminal.
- Browser, Diff, Editor, or FileTree panes/views.
- Status-first global queue.
- Setup form.

### Flow 2: Browse Existing Work

User goal: find and reopen prior work.

Left Rail behavior:

- `Pinned` is always above the grouped work list.
- Each Project can collapse or expand.
- Thread Rows are compact and scan-friendly.
- Clicking a Thread opens it.
- Clicking a Pinned Thread opens the same Thread as its Project row.
- Group By controls whether the grouped work list is shown `By project` or `By thread`.

Thread Row:

```text
[agent icon] first user message title        time
```

Optional row details:

- A tiny attention dot may appear only when the Thread requires user action.
- Hover actions include pin and archive.
- Double-click rename keeps rename out of the default hover controls.
- Status text stays out of the default row.

### Flow 3: Start A New Thread

User goal: ask an Agent to do work.

Entry points:

- Global `New thread`.
- New Thread from a Project Row or Project menu.
- New Scratch Thread from the Scratch section.
- Composer while no Thread is selected.

Default behavior:

1. Before send, Tide keeps Composer draft state without creating a persistent Thread.
2. When the user sends the first meaningful message, Tide creates the Thread.
3. Tide applies the selected Agent, Project or Scratch, Worktree, Branch, Permission, and Model values from Start Composer.
4. If the user selected Scratch, Tide creates the per-thread Scratch working directory at send time.
5. The first meaningful user message becomes the Thread title.
6. Tide starts the hidden Agent Runtime for the new Thread.
7. Agent Session renders the Agent Runtime output inside Agent Chat.

Screen before send:

- Left Rail remains stable.
- Center stays blank or shows the first-screen prompt.
- Composer contains the user's draft.
- Agent, Project, Worktree, and Branch controls are visible as compact start controls, not a setup form.

### Flow 4: Continue A Thread

User goal: keep working in an existing conversation.

Screen:

```text
Left Rail
  Same active grouping mode

Agent Chat
  Thread messages and agent work stream
  Follow-up Composer at the bottom

Workbench
  Appears only when opened by user or agent workflow
```

The Thread should show:

- User requests.
- Agent responses.
- Approval requests.
- Work summaries.
- Links or affordances to changed files, diffs, browser previews, and runtime diagnostics.

Workbench panes/views:

- Browser Pane for browser automation details.
- FileTree View for file navigation.
- Diff Pane for review.
- Terminal Pane only when direct command access is needed.

These panes/views are shared visible work areas for the active Thread. They are separate from the hidden Agent Runtime. The coding Agent should be able to know what is open, observe relevant state, and operate the panes/views through provider-neutral tools when the selected Agent Integration supports it.

### Flow 5: Select Or Change Agent

User goal: choose which local or remote coding Agent handles the Thread.

First-screen default:

- Do not show a large Agent picker.
- Show the selected Agent as a compact Composer chip.

Agent selector should support:

```text
Codex CLI        ready
Claude Code      ready
Gemini CLI       ready
opencode         ready
```

Agent identity in the Left Rail:

- Codex, Claude, Gemini, and opencode appear as small Agent Icons.
- The icon is identity, not hierarchy.
- Agent-first grouping is not part of the default Left Rail.
- Agent Icons must be polished asset-backed identities. They should not depend on ad hoc text fallback, compromised icon rendering, or low-quality placeholder shapes in product UI.

### Flow 6: Attach Context

User goal: give the Agent extra material.

Composer affordances:

- Attach file or image.
- Add context from selected files.
- Add current browser or diff context when available.
- Permission/profile control only when relevant.

Context should not dominate the first screen. It is attached to the Thread when the user chooses it or when the Workbench creates it.

### Flow 7: Review And Verify Work

User goal: inspect what changed and decide what to do next.

Workbench panes/views:

- Diff Pane for changed files.
- Editor Pane for focused corrections.
- Browser Pane for local or public page verification.
- Terminal Pane when direct commands are needed.
- Context-artifact view for feedback to the Agent.

Screen principle:

- The Thread remains the work narrative.
- Workbench panes/views provide visible inspection, editing, verification, and direct work context.
- The coding Agent can observe and operate Workbench panes/views through Tide-owned tools when supported.
- The Left Rail remains work history, not a status dashboard.

## Left Rail Design

### Top Entries

```text
New thread
Search
Sidebar options
```

Rules:

- `New thread` starts a new Thread.
- `Search` opens search across visible and archived work.
- `Sidebar options` owns Left Rail grouping and sorting controls.
- Grouping and sorting controls do not live on `Projects` or `Scratch` headers because they affect the whole Left Rail.

### Sidebar Options

```text
Group by >
  By project
  By thread

Sort by >
  Created
  Updated
```

Rules:

- `Group by` changes the section structure.
- `Sort by` changes Thread ordering.
- Grouping and sorting are independent axes.
- `By project` and `By thread` are grouping modes, not sort orders.
- `Created` and `Updated` are sort orders, not grouping modes.

### Group By: By Project

```text
Pinned
  [folder] Project shortcut
  [agent] Thread shortcut

Projects
  [folder] Project
    Thread
    Thread

Scratch
  Thread
```

Rules:

- `Pinned` contains Project shortcuts and Thread shortcuts.
- A pinned Project still exists under Projects.
- A pinned Thread still exists under its Project or under Scratch.
- Project and Thread shortcuts are distinguished by icon only.
- `Projects` contains Project groups.
- Project groups contain Project-bound Threads.
- `Scratch` contains Scratch Threads.
- There are no default status sections.
- Project Rows are lightweight grouping headers, not IDE project explorers.

### Group By: By Thread

```text
Pinned
  [folder] Project shortcut
  [agent] Thread shortcut

Threads
  [agent] Thread
  [agent] Thread
  [agent] Thread
```

Rules:

- `Pinned` remains visible.
- The grouped work list becomes `Threads`.
- `Threads` contains Thread Rows only.
- Project name and Scratch name are not shown by default.
- Thread Rows stay one line.
- Pinned Threads still appear in `Threads` at their normal sorted position.
- Project shortcuts appear only in `Pinned`.

### Pinned

```text
Pinned
  [folder] tide
  [agent] 마스터플랜 봐봐
```

Rules:

- Pinned is a shortcut area.
- Projects can be pinned.
- Threads can be pinned.
- Pinned items are distinguished by icon only.
- Pinning does not move the original Project or Thread.
- Unpinning removes only the shortcut.
- Archiving a Thread removes its Pinned Thread shortcut.

### Projects Section

```text
Projects                         [...] [+]
  [folder] tide                   [...] [+]
    [agent] Thread title          1m
```

Projects header:

- `...` opens Projects section menu.
- `+` opens Project creation menu.

Projects `+` menu:

```text
Create new project
Use existing folder
```

Projects `...` menu:

```text
Archive all project threads
```

Project Row:

```text
default:
[folder] tide

hover:
[folder] tide                         [...] [+]
```

Project Row rules:

- Row click expands or collapses the Project.
- Chevron is not shown.
- `...` opens Project menu.
- `+` starts a new Thread in the Project.
- Project Rows are sorted by updated time descending by default.
- Manual Project ordering is not part of this plan.

Project menu:

```text
Pin project / Unpin project
Open in Finder
Create permanent worktree
Rename project
Archive threads
Remove
```

Dangerous actions:

- `Archive threads` opens a modal confirmation.
- `Remove` opens a modal confirmation.
- `Remove` removes the Project from the sidebar; it does not delete files on disk.

### Scratch Section

```text
Scratch                          [...] [+]
  [agent] Thread title            54m
```

Rules:

- Scratch is the home for Threads started without an explicit Project.
- Each Scratch Thread gets a Tide-managed per-thread working directory when the first message is sent.
- Scratch default storage is under an application support root.
- Scratch storage location can be changed in settings.
- Scratch `+` starts a new Scratch Thread.
- Scratch `...` opens Scratch section menu.

Scratch menu:

```text
Archive all scratch threads
```

### Thread Row

Thread Row shows:

- Agent Icon.
- Thread title.
- Last activity time.

Thread Row default:

```text
[agent] Thread title                         1m
```

Thread Row hover:

```text
[agent] Thread title                    [pin] [archive]
```

Thread Row archive confirm:

```text
[agent] Thread title                    [confirm]
```

Thread Row rules:

- Timestamp is hidden on hover.
- Hover actions are pin and archive.
- Clicking archive hides the other hover buttons and shows only confirm.
- Moving the cursor outside the row cancels archive confirm state.
- Clicking confirm archives the Thread.
- Double-clicking the row opens rename modal.
- Rename is not a default hover action.

### Thread Title

```text
title = first meaningful user message
```

Rules:

- Do not run a title-generation prompt.
- Use the first meaningful line.
- Trim leading and trailing whitespace.
- Collapse newlines.
- Truncate for display.
- Preserve the full original message in Thread history.
- Allow manual rename.
- Use fallback titles for attachment-only Threads, such as `Image thread`, `File review`, or `Untitled`.

### Modal Confirmations

Project bulk actions use modal confirmation.

Archive Project Threads:

```text
Archive 5 threads?

This will archive the threads in slice. You can find them later in your archived threads.

Cancel        Archive all
```

Remove Project:

```text
Remove project?

This removes slice from the sidebar. It will not delete files on disk.

Cancel        Remove
```

Rules:

- Single Thread archive uses inline row confirm.
- Project bulk archive uses modal confirm.
- Project remove uses modal confirm.
- Modal destructive confirm is visually destructive.

## Composer Design

The Composer has two states:

- Start Composer: shown before a Thread has started.
- Follow-up Composer: shown while working inside an existing Thread.

Both states stay Codex-like. The default Composer area is small, and less-common controls live in the Composer menu instead of becoming permanent chips.

### Start Composer

Start Composer answers: what should start, with which defaults?

Default structure:

```text
Ask anything...

[Agent] [Project] [Worktree] [Branch]
[+] [Permission]                         [Model] [Send]
```

Example:

```text
Ask anything...

[Codex CLI] [tide] [current folder] [main]
[+] [Auto-review]                        [GPT-5.5 High] [↑]
```

Always visible controls:

- Text input.
- Agent chip.
- Project chip.
- Worktree chip.
- Branch chip.
- Add/context button.
- Permission chip.
- Model chip.
- Send.

The visible start controls become the Thread's initial Agent Binding, Execution Context, and Launch Options.

Start Composer values are Launch Options. They are applied before the hidden Agent Runtime starts, usually through provider-native CLI flags, config files, environment variables, or Agent Integration launch parameters.

Control meanings:

| Control | Purpose |
|---------|---------|
| Permission | Chooses the provider-native permission or approval setting used at launch, unless the provider supports changing it in-session. |
| Model | Chooses the initial provider-native model at launch. After launch, the same chip can open the provider-native model command when supported. |
| Add/context | Opens attach/context controls and less-common supported Agent features. |
| Agent | Chooses the Thread's Agent Binding. Visible choices are the provider CLI Agents: Codex CLI, Claude Code, Gemini CLI, and opencode. |
| Project | Chooses a Project or Scratch for the Thread. |
| Worktree | Chooses whether the Thread runs in the current folder, a new worktree, or an existing worktree. |
| Branch | Chooses or creates the git branch for the Thread. |

Expanded start controls:

```text
Start options
  Agent          Codex CLI
  Project        tide
  Worktree       current folder
  Branch         main

  Files and images
  Current file or selection

  Supported Agent features
```

Start Composer rules:

- Starting from a Project inherits that Project, current folder, and current branch.
- Starting from Scratch uses Scratch as context and creates a Tide-managed working directory when the first message is sent.
- Agent, Project, Worktree, and Branch are visible before send.
- Agent can be changed only before the Thread starts.
- The first meaningful user message becomes the Thread title.
- Sending the first meaningful message creates the Thread and starts the hidden Agent Runtime.

### Follow-Up Composer

Follow-up Composer answers: what should happen next in this Thread?

Default structure:

```text
Ask for follow-up changes...

[+] [Permission]                         [Model] [Send]
```

Example:

```text
Ask for follow-up changes...

[+] [Auto-review]                        [GPT-5.5 High] [↑]
```

Follow-up Composer inherited context:

```text
Thread context
  Agent          Codex CLI
  Project        tide
  Worktree       current folder
  Branch         main
```

Follow-up Composer rules:

- The active Thread owns Agent, Project, Worktree, and Branch.
- Follow-up messages inherit the active Thread context.
- Agent is locked after the Thread starts. Changing Agent requires starting or forking a different Thread.
- Agent, Project, Worktree, and Branch are read-only Thread context after the Thread starts. They may be shown in Thread chrome or the Composer menu, but they are not edited in place.
- Context controls stay hidden unless the user opens the Composer menu or Tide needs attention.
- If files changed, dirty branch state can appear as a small attention affordance near the Composer menu or in the Thread narrative.
- Agent command suggestions can appear when the user types `/`, `$`, `@`, `!`, or another selected-Agent prefix.
- Agent command suggestions should come from the running Agent Runtime when the provider exposes an interactive menu, completion output, or structured command event.
- Model changes inside a running Thread use the provider-native in-session model command when supported. The Model Chip and `/model` style command entry should lead to the same provider-native interaction.
- Follow-up Composer does not restart the Thread unless the user explicitly forks or creates a new Thread.

Provider-native rule:

- The visible chip position and visual treatment are shared.
- Permission menu values are not normalized into one cross-provider list.
- Model menu values are not normalized into one cross-provider list.
- Launch Options and In-Session Commands are related but separate sources. A setting can exist in both places without becoming one abstract Tide setting.
- Tide may keep internal risk metadata for safety, but the user-facing value stays provider-native.

### Composer Menu

Composer menu is opened from the `+` button. It contains attach/context controls and less-common supported Agent features.

```text
Composer menu
  Files and images
  Current file or selection
  Browser, Diff, Terminal, or FileTree context when available

  Supported Agent features
```

Rules:

- The Composer menu is searchable.
- Before launch, the Composer menu can expose less-common Launch Options.
- After launch, the Composer menu can route into provider-native In-Session Commands.
- Provider-native slash or command suggestions can appear in the same Composer menu when the user types `/`, `$`, `@`, or another provider-supported prefix.
- Tide does not promote every provider command into a permanent Composer chip.
- Tide only keeps default visible chips for values the user commonly checks before sending.

Permission menus:

```text
Codex Permission
  Access
    read-only
    workspace-write
    danger-full-access

  Approval
    untrusted
    on-request
    never
```

```text
Claude Permission
  default
  acceptEdits
  auto
  dontAsk
  plan
  bypassPermissions
```

Model menus:

- Codex model choices come from the Codex Agent Integration.
- Claude model choices come from the Claude Agent Integration.
- Gemini model choices come from the Gemini Agent Integration when the installed CLI exposes model selection.
- opencode model choices come from opencode's provider/vendor catalog.
- Each model menu supports a custom model id when the provider accepts one.

Project menu:

```text
Project
  tide
  slice
  Scratch

  Create new project
  Use existing folder
```

Worktree menu:

```text
Worktree
  current folder
  new worktree
  existing worktree
```

Branch menu:

```text
Branch
  main
  feature/sidebar

  Create new branch
```

Attach and command menu:

```text
Composer menu
  Files and images
  Current file or selection
  Browser, Diff, Terminal, or FileTree context when available
  Agent tools
```

Agent tools:

- Agent tools are provider-specific.
- Codex plugins, Claude plugins, Gemini integrations, opencode provider/vendor config, and MCP servers are not shown as one generic plugin system.
- Plan-like behavior belongs in the provider-native Permission menu when the provider exposes it.
- Goal-like behavior is an advanced provider capability, not a default Composer control.
- Provider-specific command prefixes are passed through to the selected Agent when possible.
- If a prefix has no selected-Agent meaning, Tide can offer to run it as a shell command or keep it as plain text.

Usage:

- Usage and rate-limit information is not a default Composer chip.
- Usage appears only when an Agent Integration can report it reliably.
- If usage is unavailable, Tide does not fabricate a remaining-usage value.

Composer avoids:

- Large setup forms.
- Always-visible terminal/browser buttons.
- Permanent right-side Agent picker.
- Run-mode segmented control on the first screen.
- Cross-provider labels that hide native provider behavior.

## Application Design

### Thread Principle

Thread is the user-facing wrapper around one raw CLI agent session plus Tide UI metadata.

The simplest mental model is:

```text
Thread = Raw Agent Session + Tide UI metadata
```

A Thread should feel like opening an old conversation, not manually resuming a terminal command. Internally, Tide may resume the Raw Agent Session only when the user sends a follow-up or when live runtime attachment is needed.

Rules:

- Thread is the user's stable conversation object.
- Raw Agent Session is the selected Agent's original CLI session, conversation record, or session log.
- Tide stores a reference to the Raw Agent Session, not a copied provider history as the primary source of truth.
- Agent Session is Tide's visible app rendering of the Raw Agent Session.
- Agent Session preserves the meaningful content and conceptual flow of the Raw Agent Session.
- Tide may maintain a derived Agent Session Cache for fast open, but the cache is not the source of truth.
- Opening a Thread rebuilds or loads Agent Session from the provider-native Raw Agent Session source when that source is available.
- Sending a follow-up resumes or attaches to the Raw Agent Session through provider-native resume behavior when possible.
- The UI says open/continue Thread; implementation may call provider resume.

### Core Model

```text
Thread
  Raw Agent Session
  Agent Binding
  Launch Options
  Composer history
  Execution Context
  Last Known State
  Agent Session
  Workbench

Project
  Project-bound Thread

Scratch
  Scratch Thread
```

V1 archive mapping:

The existing Rust/WGPU implementation is archived as v1 reference material. These mappings are useful for understanding prior concepts, not as v2 code ownership.

| Product concept | V1 reference concept |
|-----------------|--------------------------------|
| Thread | Workspace |
| Project | cwd/repo/worktree grouping around a Workspace |
| Scratch Thread | Workspace plus Tide-managed cwd under an application support root |
| Agent Runtime | Hidden PTY-backed provider CLI process |
| Agent Binding | Wrapped Agent, AgentInfo, AgentStatus |
| Raw Agent Session | Provider session id, conversation id, or log path stored beside Workspace metadata |
| Review Workbench Pane | Diff Pane |
| File Workbench Pane/View | Editor Pane or FileTree View |
| Browser Workbench Pane | Browser Pane |
| Thread storage boundary | WorkspaceManager |

### Thread Metadata

Each Thread needs product metadata:

| Field | Purpose |
|-------|---------|
| Thread id | Stable user-facing Thread identity. |
| Thread kind | `project_bound` or `scratch`. |
| Project id | Grouping and default Execution Context for Project-bound Threads. |
| Title | Derived from first meaningful user message unless manually renamed. |
| Title source | `first_user_message`, `manual`, or fallback source. |
| Agent Binding | Codex CLI, Claude Code, Gemini CLI, or opencode. |
| Raw Agent Session ref | Provider-native session id, conversation id, or log path used for resume. |
| Permission setting | Provider-native permission or approval value. |
| Model setting | Provider-native model value or custom model id. |
| Working directory | Project root for Project-bound Threads, per-thread managed directory for Scratch Threads. |
| Worktree setting | Current folder, new worktree, or existing worktree. |
| Branch setting | Current or requested git branch for the Thread. |
| Last known state | Last Tide-observed state for resume, attention UI, and recovery. |
| Created at | Thread creation time, set when the first meaningful user message is sent. |
| Updated at | Last user or Agent activity time, used for Sidebar display and sorting. |
| Pin state | Whether a Pinned Thread shortcut exists. |
| Archived state | Whether the Thread is hidden from normal lists. |
| Storage record path | Tide-owned Thread metadata path under the app data root. |

V2 implementation direction:

- Tide v2 is a new Electron + Node application.
- Desktop owns Electron windows, React Agent Chat, Composer, Workbench UI, and App Chrome.
- Backend owns Thread metadata, Agent Runtime lifecycle, Provider Readiness, Provider Signals, PTY Transcript capture, provider-owned session references, and Agent Session Block production.
- Shared Contracts are the process-boundary DTOs between Desktop and Backend.
- Raw Agent Session logs remain provider-owned. Tide stores provider-native references, Thread UI metadata, and derived Agent Session Cache metadata.
- Resume is a product behavior, not a visible user command.

### Project Metadata

Each Project needs:

| Field | Purpose |
|-------|---------|
| Project id | Stable grouping identity. |
| Display name | Sidebar label, usually folder/repo name. |
| Root path | Default cwd for new Threads. |
| Updated at | Latest activity time of its visible Project-bound Threads. |
| Collapsed state | Sidebar display preference. |
| Pin state | Whether a Pinned Project shortcut exists. |

Project rules:

- Project is created when a Thread is bound to a folder/repo context or when the user creates a Project explicitly.
- Projects are ordered by updated time descending by default.
- Project deletion from sidebar does not delete files.
- Removing a Project hides or archives its grouped Threads only through explicit UX.
- A Thread can move to another Project only through explicit user action.

### Scratch Model

Scratch is a top-level Left Rail section in `By project` grouping mode.

Rules:

- Scratch Threads are Threads without explicit Project context.
- Each Scratch Thread receives its own Tide-managed working directory.
- The default Scratch root lives under an application support root.
- The Scratch root can be changed in settings.
- Scratch Threads appear with normal Thread Rows.

### Pinned Item Model

Pinned items are shortcuts:

```text
PinnedItem {
  target_kind
  target_id
  pinned_at
  order
}
```

Rules:

- Pinning does not duplicate Project or Thread state.
- Pinning does not move a Thread out of its Project or Scratch.
- Unpinning removes only the shortcut.
- Archiving a Thread removes its Pinned Thread shortcut.

### New Thread Lifecycle

```text
New thread
  -> user sends first message
  -> Thread is created
  -> selected Agent, Project or Scratch, Worktree, Branch, Permission, and Model are applied
  -> Scratch working directory is created if needed
  -> title derived from first message
  -> hidden Agent Runtime starts
  -> Agent Session renders Agent Runtime output
```

Important distinction:

- Before first send, the UI may hold Composer draft state, but there is no persistent Thread.
- Thread creation and initial Agent Runtime start happen when the user sends the first meaningful message.
- The Agent Runtime is not a visible Terminal Pane.
- Agent Runtime output appears through the visible Agent Session by default.
- A visible Terminal Pane appears only when direct command access is needed.

### Open Thread Lifecycle

Opening an existing Thread is a UI action. It should feel immediate.

```text
Open Thread
  -> load Thread metadata
  -> load or rebuild Agent Session from the provider-native Raw Agent Session source
  -> show Follow-up Composer
  -> keep Agent Runtime stopped until live attachment is needed
  -> user sends follow-up
  -> resume or attach to Raw Agent Session through selected Agent integration
  -> stream new output into Agent Session
```

Rules:

- Opening a Thread does not have to start the provider runtime immediately.
- Follow-up send is the normal point where Tide resumes the Raw Agent Session.
- If the provider supports native resume, Tide uses the Raw Agent Session ref to call it.
- If resume cannot be proven or fails, Tide shows Agent Chat recovery UI and asks for an explicit user action such as retry, inspect diagnostics, or start/fork a new Thread.
- Provider-native Raw Agent Session history should make old Threads feel like normal chat history.
- Resume failures appear as Agent Chat recovery UI, not as raw terminal errors by default.

### Agent Binding

Agent Binding belongs to the Thread.

Possible values:

- Codex CLI.
- Claude Code.
- Gemini CLI.
- opencode.
- opencode.

Binding rules:

- The Agent chip has one visible selected value, but Agent Binding stores the Agent Runtime Source.
- Codex CLI, Claude Code, Gemini CLI, and opencode use the Provider CLI Agent Runtime Source.
- The selected Agent controls default launch command and wrapper behavior.
- The Agent Icon shown in the Left Rail comes from the Thread's Agent Binding.
- Runtime lifecycle comes from the selected provider CLI integration.
- Agent Binding is chosen before the Thread starts.
- A started Thread does not change Agent Binding. Changing Agent means starting or forking a different Thread.
- Agent-specific capabilities determine which Permission, Model, usage, plugin, extension, skill, and MCP controls appear.
- The Model Chip uses one visual component, but its Model Source follows the selected provider CLI. `Codex CLI > Model` comes from Codex Agent Integration; `opencode > Model` comes from opencode's own provider/vendor catalog.
- API key setup is not a Tide Agent Runtime Source. It belongs only to a provider CLI that explicitly owns that behavior, such as opencode vendor auth.

### Agent Runtime

Agent Runtime is the hidden PTY-backed provider CLI process that powers a Thread. It is an internal execution surface, not a product area the user normally opens or manages.

Runtime transport:

- Tide creates one hidden PTY for the Thread's selected Agent.
- Tide launches the provider's normal interactive CLI inside that hidden PTY.
- Composer input, approval answers, question answers, and provider-native commands are sent through the same hidden PTY control path.
- PTY output is the baseline runtime evidence.
- Hidden PTY input behaves like terminal key input, including negotiated terminal modes such as alternate screen, bracketed paste, and CSI-u key sequences. It is not just plain stdin text plus `\r`.
- Provider hooks, logs, transcripts, and history files are Provider Signals that enrich Agent Session rendering and attention state without becoming separate runtime transports.

Rules:

- Agent Runtime is not shown as a visible Terminal Pane.
- Agent Chat renders the visible Agent Session from Agent Runtime output.
- Composer sends user input to the selected Agent Runtime through the Agent Integration.
- Agent Integration launches the selected provider's interactive CLI in the hidden PTY.
- Composer input is sent to the hidden PTY and provider output is read back into Agent Session.
- Provider questions, approval prompts, permission prompts, and similar runtime interactions are surfaced in Agent Session and answered back through the provider-native mechanism.
- Raw Agent Runtime output is available for inspection only as an explicit log/debug view, not as the default product area.
- A visible Terminal Pane in the Workbench is separate from the hidden Agent Runtime.
- Provider Signals should improve parsing, attention, snippets, and history recovery, while preserving hidden PTY as the only runtime transport.

### Agent Session

Agent Session is the visible app rendering of the Raw Agent Session inside Agent Chat.

It is a faithful rendering, not a summary or replacement workflow. It preserves the meaningful content and conceptual flow a user would expect from the same CLI agent session in a terminal.

It may render:

- Agent text.
- Markdown and code blocks.
- Command summaries.
- Approval or question prompts.
- File change cards.
- Workbench links.
- Errors and needs-input states.

Rules:

- Agent Session is the default way users see Agent Runtime output.
- Agent Session may improve presentation with links, cards, buttons, grouping, and collapsible raw blocks.
- Agent Session should preserve the raw session's meaningful content and conceptual sequence.
- It should not require terminal scraping for every provider behavior.
- Unknown provider output falls back to raw or text blocks without breaking the Thread.

### Agent Session Rendering Model

Agent Session rendering separates provider evidence from Tide presentation. The product model stays renderer-agnostic even though the first Tide v2 UI path is Electron + React.

The rendering pipeline is:

```text
Agent Runtime output
  -> Raw Agent Frame
  -> Agent-specific reader
  -> Agent Session Block
  -> Agent Session UI
```

Evidence from local Agent CLI help, generated schemas, existing Tide wrapper contracts, and provider documentation:

| Agent | Observed output surface | Product implication |
|-------|--------------------------|---------------------|
| Codex CLI | The installed CLI defaults to interactive mode when no subcommand is passed. `codex resume` resumes a previous interactive session. `codex exec` is non-interactive and supports `--json` JSONL events. `codex app-server` has a rich generated protocol, but the existing Tide wrapper deliberately launches direct CLI and uses Codex hooks for `UserPromptSubmit`, `PermissionRequest`, and `Stop`. | Codex Integration uses hidden PTY as its runtime transport. Codex hooks and local rollout history are Provider Signals. `codex exec --json` and app-server schemas are research and fixture sources, not runtime transports for v2. |
| Claude Code | Interactive mode is the default. `--print` is non-interactive. `--output-format stream-json` and `--input-format stream-json` are tied to print mode. Resume/session flags include `--continue`, `--resume`, `--session-id`, and `--fork-session`. Official docs say sessions are stored as JSONL transcripts under `~/.claude/projects/<project>/<session-id>.jsonl`. Hooks expose `UserPromptSubmit`, `PermissionRequest`, `Stop`, `Notification`, `Elicitation`, and transcript/session metadata. Remote Control runs a local Claude Code process controlled from Claude-owned web or mobile surfaces. | Claude Integration uses hidden PTY as its runtime transport. Hooks and transcript files are Provider Signals. Print-mode stream-json and Remote Control are not runtime transports for v2. |
| Gemini CLI | Gemini exposes structured provider/runtime state through its current integration path. | Gemini Integration owns its provider-native launch, model/mode, readiness, and history behavior. |
| opencode | opencode exposes ACP/config options and provider/vendor model data. | opencode Integration owns the runtime and opencode vendor auth path; Tide does not turn opencode vendor keys into a separate Agent Runtime. |

Hidden PTY runtime sufficiency gate:

- Provider readiness: before Tide sends the user's Thread message, the selected Agent Integration has either satisfied or surfaced provider setup gates such as authentication, first-run onboarding, Directory Trust, and hook/bootstrap readiness.
- Stable identity: starting and resuming the hidden PTY session produces a provider-native session id, conversation id, transcript path, or rollout path Tide can store.
- User input: Composer can send a new user message into the hidden PTY session without exposing a default Terminal Pane.
- Terminal protocol: hidden PTY input/output can satisfy the provider TUI's terminal negotiation, including `TERM`, alternate screen, bracketed paste, and CSI-u key sequences when requested.
- Output stream: Tide can observe PTY output and Provider Signals in enough detail to produce Agent Session Blocks for user messages, agent text, tool calls, command output, file changes, errors, and completion.
- Interaction loop: approval prompts, permission prompts, question prompts, command pickers, and model pickers can be surfaced in Agent Chat or Composer and answered through the same hidden PTY session or provider-native hook response path tied to that session.
- Reopen: opening an old Thread can rebuild Agent Session from provider-owned history without starting a new turn.
- Raw access: the PTY Transcript remains available as explicit debug evidence when a Provider Signal or Agent-specific reader misses a Raw Agent Frame.
- Recovery: failed resume, interrupted runtime, and unsupported provider output produce visible recovery UI instead of raw hidden-runtime leakage.

Runtime evidence lanes:

- PTY Transcript Lane: captured input/output from the hidden PTY. This is the baseline runtime evidence.
- Provider Signal Lane: hooks, provider logs, transcript files, history records, session metadata, and other machine-readable evidence emitted by the same provider session.
- Structured Batch Lane: non-interactive JSON, JSONL, or stream output used only for samples, renderer tests, and feature discovery when the provider supports it.

Agent Session Block vocabulary:

- Conversation: user input, agent text, Markdown, and code blocks.
- Runtime: working status, progress status, waiting for input, waiting for approval, and errors.
- Tool and action: tool call, tool result, command run, file read, file edit, search, browser action, and MCP call.
- Review and artifact: file change, diff summary, generated file, link, attachment, and Workbench reference.
- Interaction: approval prompt, question prompt, choice prompt, command picker, and model picker.
- Fallback: raw block.

Rules:

- Raw Agent Session remains the source of truth.
- Agent-specific readers emit richer Agent Session Blocks only when provider output supports that interpretation.
- Unknown Raw Agent Frames become raw blocks and remain visible.
- Composer and In-Session Commands route into provider-native interactive mechanisms when the selected Agent Integration supports them.
- Batch structured modes can prove event vocabulary, but they are not Agent Runtime transports.
- An Agent Integration should not split one Agent's live runtime across multiple control paths. A Thread's selected Agent has one hidden PTY runtime; Provider Signals only observe or enrich that runtime.
- Codex App binary internals are not a product contract. Tide should prefer observable provider processes, local CLI help, provider documentation or source when available, and small bounded samples.
- Current smoke evidence is tracked in [Hidden PTY Provider Signal Smoke](research/agent-hidden-pty-provider-signal-smoke.md).

### Provider Readiness

Provider Readiness is the selected Agent's provider-owned setup state before Tide starts a real Thread turn.

It covers:

- provider authentication.
- first-run onboarding.
- Directory Trust for the Thread Execution Context.
- hook/bootstrap readiness for Provider Signals.
- provider setup prompts that can capture Composer input before it reaches the Agent Runtime conversation.

Rules:

- Provider Readiness is checked before sending the user's first Thread message to the hidden Agent Runtime.
- Directory Trust is treated as provider-owned state for a cwd/root path, not as a Tide-owned permission setting.
- Directory Trust is checked for the selected Thread Execution Context and can appear when starting a Thread in a new Project, Scratch cwd, worktree, or other provider-visible cwd.
- Tide can surface Directory Trust as a setup step for the selected Project, Scratch cwd, or worktree.
- Tide does not silently accept legal terms, data-use consent, or broad trust prompts.
- If Provider Readiness is incomplete, Tide preserves the user's Composer input and shows a Provider Setup Surface instead of starting the Thread turn and losing the input into a provider setup screen.
- Provider Setup Surface runs the provider's own setup flow in a visible terminal surface. Tide does not reimplement or auto-accept provider setup choices.
- Provider first-run onboarding and cwd trust are provider-owned. The same readiness model should be assumed for Codex, Claude, Gemini, and opencode until clean-directory trust behavior is separately proven per provider.

### Supported Agent Features

Supported Agent Features describe what the selected Agent Integration can expose.

Feature groups:

- Launch Options.
- In-Session Commands.
- Permission values.
- Model values.
- Usage or rate-limit status.
- Plugin, extension, skill, or MCP controls.
- Plan-like or goal-like modes.

Rules:

- Tide shows only features the selected Agent Integration can support.
- Feature values keep provider-native names.
- Launch Options come from provider launch flags, config files, environment variables, and wrapper launch parameters.
- In-Session Commands come from the running Agent Runtime, such as interactive command menus, completion output, runtime prompts, or structured command events.
- Tide may map feature values to internal safety metadata, but that metadata is not the primary user-facing label.

### Execution Context

Execution Context belongs to the Thread and is usually inherited from Project.

Fields:

- cwd/root path.
- Project or Scratch.
- Worktree setting.
- git branch when known.
- environment/profile when needed.
- permission profile when needed.

Rules:

- A Project provides default cwd.
- Scratch provides a Tide-managed cwd.
- A Thread may override Execution Context only when explicit.
- Agent Runtime launch uses the Thread Execution Context.
- Workbench panes/views should attach to the active Thread context when opened.

### Workbench

Workbench panes/views are not part of the first-screen hierarchy.

They appear when a Thread needs them:

- Diff Pane for review.
- Editor Pane for file editing.
- Browser Pane for verification.
- FileTree View for file navigation.
- Terminal Pane for direct commands when needed.
- Context-artifact view for comments or artifact creation.

Application rule:

- Workbench panes/views attach to the active Thread.
- Workbench panes/views do not create separate Thread identity.
- Workbench panes/views do not include the hidden Agent Runtime by default.
- Workbench panes/views open through user action or explicit Agent tool use, not automatically because an Agent Runtime exists.
- The active Agent should be able to know which Workbench panes/views are open.
- The active Agent should be able to observe and operate Workbench panes/views through Tide-owned MCP tools when supported.
- Their state should remain inside the Thread backing state unless explicitly shared.

## Decision Backlog

Resolved decisions are recorded in the relevant sections above and in the focused specs under `docs_v2/specs/`. This backlog tracks only evidence-gated provider facts and intentional implementation deferrals.

| Decision | Current proposal | Status |
|----------|------------------|--------|
| Agent Runtime path | All supported Agent Integrations use one hidden PTY-backed interactive CLI session as the runtime transport. Provider-specific hooks, logs, transcripts, and history files are Provider Signals tied to that PTY session, not separate live control paths. | Decided; covered by [Backend Thread and Agent Runtime Lifecycle](specs/backend-thread-agent-runtime-lifecycle.md) and [Provider Integration Bootstrap](specs/provider-integration-bootstrap.md). |
| Provider Signal coverage | Each Agent Integration must prove which Provider Signals it can rely on for attention, snippets, history, and richer Agent Session Blocks while preserving provider-native transcript evidence as the baseline. | Evidence-gated; Codex rollout JSONL, Claude transcript JSONL, Gemini/opencode structured runtime events, and provider prompt/permission payloads are handled by provider-specific integrations. Exhaustive provider hook grammar and native file watching remain evidence-gated work. |
| Provider history source | Tide uses provider-local Raw Agent Session history as the conversation source of truth. Tide stores only Thread metadata, provider-native references, and derived Agent Session Cache metadata. | Decided; covered by [Persistence](specs/persistence.md). |
| Provider Readiness | Each Agent Integration must check or surface provider-owned setup gates before sending Thread input into the hidden PTY. Directory Trust is provider-owned state for the Thread Execution Context. | Initial implementation covers provider-specific preflight/detection, Backend-owned bootstrap artifact generation, Provider Setup Surface Terminal lifecycle, setup terminal-byte routing, and pending-input replay after setup readiness succeeds. Full terminal screen rendering and exhaustive Provider Signal grammar remain separate evidence-gated work. |
| Desktop and Backend architecture | Tide v2 is Electron + React Desktop, process-separated Node Backend, and Shared Contracts under `src/shared/contracts`. Existing Rust/WGPU Tide is archive/reference, not the v2 code foundation. | Decided; covered by [Shared Contracts](specs/shared-contracts.md), [Backend/Desktop Process Connection](specs/backend-desktop-process-connection.md), and [Build and Package](specs/build-and-package.md). |
| Agent Chat UI surface | Agent Chat and Composer use the Electron + React Desktop path first. Agent Session Blocks remain renderer-agnostic product data. | Decided; covered by [Desktop Agent Chat and Composer Shell](specs/desktop-agent-chat-composer-shell.md). |
| WGPU renderer scope | The archived WGPU renderer is not part of the initial v2 UI implementation. If Rust or WGPU returns, it must enter as a focused helper or surface with a concrete product reason. | Decided for v2 initial implementation; no WGPU implementation slice is planned. |
| Workbench and MCP control | Workbench is visible Thread support UI. Agents operate it through Tide-owned MCP tools attached to the same Agent Runtime session. | Decided for first observe/open-browser slice; covered by [Tide MCP Tool Surface for Workbench Observe/Open Browser](specs/tide-mcp-workbench-observe-open-browser.md). |
| App Chrome | App Chrome stays compact, Thread-scoped, and operational. Status Bar and Workbench Tab Strip do not become dashboards or hidden-runtime tabs. | Decided; covered by [App Chrome and Workbench Tab Strip](specs/app-chrome-workbench-tab-strip.md). |
