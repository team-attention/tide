# Glossary V2

This glossary defines product and UX language for Tide v2. It is separate from `docs/glossary.md`, which remains the current implementation glossary.

## Rule

Use v2 terms when describing what users see, choose, continue, pin, rename, or send.

Use implementation terms only when describing the current code boundary that backs the v2 product concept.

## Product Terms

| Term | Meaning |
|------|---------|
| **Project** | A local folder or repository grouping. It organizes Project-bound Threads and provides the default execution context for new agent work. A Project is not the app root. |
| **Thread** | A user-facing work conversation. A Thread is what the user opens, continues, pins, renames, archives, and searches. Once started, it wraps one Raw Agent Session plus Tide UI metadata. It can be Project-bound or Scratch. |
| **Pinned Item** | A global shortcut to a Project or Thread. Pinning does not move the original item out of its normal section. |
| **Pinned Project** | A Pinned Item that points to a Project. It is distinguished from a Pinned Thread by its folder icon. |
| **Pinned Thread** | A Pinned Item that points to a Thread. It is distinguished from a Pinned Project by its Agent Icon. |
| **Composer** | The bottom input area where the user writes the next request. It includes text input, compact visible chips for common send-time choices, an options menu for contextual controls, and send. |
| **Start Composer** | The Composer state shown before a Thread starts. It creates the initial Thread request, initial Execution Context, and Launch Options. |
| **Follow-up Composer** | The Composer state shown inside an existing Thread. It inherits the active Thread's Agent, Project, Worktree, and Branch. The Agent is locked after the Thread starts. |
| **Composer Options** | The searchable options menu opened from the Composer. Before a Thread starts, it contains Launch Options. After an Agent Runtime starts, it can also expose In-Session Commands and attach/context controls without making every option a permanent chip. |
| **Composer Attachment** | An image the user attaches to the next Composer message via paste, shown as a preview chip. On send, Tide materializes it to a file in the Thread workspace and references its absolute path in the message text so the Agent can read it. |
| **Workspace Trust** | The provider-owned record that an Execution Context cwd is trusted to run the Agent (claude `hasTrustDialogAccepted`, codex `trust_level`, provider-specific equivalents). Tide can grant it on the user's behalf from the directory-trust readiness blocker. |
| **Agent** | The coding worker selected for a Thread. Current visible choices are Codex CLI, Claude Code, Gemini CLI, and opencode. |
| **Agent Icon** | A compact visual identity shown in a Thread row to indicate which Agent owns or last ran that Thread. |
| **Agent Binding** | The selected provider CLI Agent identity attached to a Thread. It controls default launch behavior, model source, readiness path, and sidebar identity. |
| **Agent Runtime Source** | The source that powers a selected Agent. Current v2 supports Provider CLI source only. |
| **Provider CLI Agent** | An Agent backed by a provider-native CLI, such as Codex CLI, Claude Code, Gemini CLI, or opencode. It uses an Agent Integration, structured provider runtime, Provider Signals, and provider-owned Raw Agent Session history. |
| **Agent Integration** | The Tide connection layer for one Agent. It launches and resumes the provider CLI through its structured provider transport, sends user input, reads runtime output and provider signals, exposes confirmed supported features, and preserves the Raw Agent Session reference. |
| **Agent Runtime** | The Backend-owned structured provider runtime that powers a Thread. It is not shown as a Terminal Pane and is not scraped from a hidden visible terminal. |
| **Agent Runtime State** | Backend-owned operational state for a Thread's Agent Runtime, such as not started, starting, running, waiting for input, waiting for approval, idle, stopping, stopped, or failed. |
| **Prompt State** | Backend-owned state for a provider question, approval, permission, choice, or command picker that currently requires user action. It is shown at the Composer or active input surface and may also be recorded in Agent Session. |
| **Backend** | The process-separated Tide v2 code boundary that owns Agent Runtime lifecycle, Provider Readiness, Provider Signals, PTY Transcript capture, provider-owned session references, and Agent Session Block production. The Backend is separate from the Desktop UI. |
| **Desktop** | The Electron app surface that owns windows, menus, the React renderer, Agent Chat presentation, Composer UI, and Workbench UI. Desktop talks to Backend through Shared Contracts. |
| **Shared Contracts** | The serializable message and event contracts crossing the Desktop and Backend boundary. They are process-boundary DTOs, not Backend domain models. |
| **Contract DTO** | A JSON-serializable data object defined in Shared Contracts for crossing the Desktop and Backend boundary. It carries product state or command intent without exposing Backend domain objects. |
| **BackendCommand** | A Contract DTO sent from Desktop to Backend to request a product action such as hydrating a Thread, starting or stopping an Agent Runtime, sending Composer input, answering a prompt, or operating a Workbench surface. |
| **BackendEvent** | A Contract DTO sent from Backend to Desktop to report accepted commands, command results, runtime state, Provider Readiness, prompt state, Agent Session Block updates, Workbench changes, or contract errors. |
| **RequestId** | A Desktop-generated correlation id attached to a BackendCommand and copied onto every BackendEvent that acknowledges, completes, streams, or fails that command. |
| **Contract Version** | The numeric compatibility marker on Shared Contracts envelopes. It lets Desktop and Backend reject incompatible messages explicitly. |
| **Contract Error** | A serializable BackendEvent payload that reports command rejection, validation failure, unsupported contract version, provider failure, runtime failure, or internal failure without passing raw JavaScript Error objects across the boundary. |
| **Stream Update** | A BackendEvent that updates an existing user-visible object, such as an Agent Session Block, Agent Runtime state, prompt state, or Workbench Pane state, while a command or runtime turn is still in progress. |
| **Tide MCP Tool Surface** | The provider-visible tool surface that lets the selected Agent observe and operate Tide-owned UI such as Agent Chat context, Workbench Panes, Browser Pane, Diff/File views, and Thread state. It is attached by the Agent Integration when launching the provider CLI and routes tool calls back to Tide. |
| **Provider Readiness** | The selected Agent's provider-owned setup state required before a real Thread turn can start. It includes authentication, first-run onboarding, Directory Trust, hook/bootstrap readiness, and any provider setup prompt that can capture Composer input before it reaches the Agent Runtime conversation. |
| **Provider Readiness Terminal Action** | A Provider Readiness action that opens a normal Workbench Terminal Pane to run a provider-owned install, login, onboarding, trust, update, or vendor auth command. It is not the Agent Runtime conversation. |
| **Provider Setup Surface** | Historical implementation name for Provider Readiness Terminal Action. New product and code language should prefer Terminal Pane/readiness action instead of modeling a separate setup surface. |
| **Directory Trust** | A provider-owned safety decision that allows an Agent to read, edit, or execute in a cwd/root path. It is attached to the provider and directory, not to Tide's Thread identity. It can be required when starting a Thread for a new Project, Scratch cwd, worktree, or other Execution Context. Tide may surface or remember that the provider asked for it, but the provider remains the source of truth. |
| **Raw Agent Session** | The original provider CLI session that could also be seen in a terminal. It includes the provider-owned session id, conversation id, log path, output, and resume identity. |
| **Agent Chat** | The central UI region inside a Thread. It contains the visible Agent Session and Composer. |
| **App Chrome** | The compact non-content UI around Agent Chat and Workbench, including top chrome, status bar, Workbench Tab Strip, Pane toolbars, icon buttons, menus, and small state indicators. |
| **Status Bar** | A compact App Chrome surface for operational state such as Backend connection, selected Agent, Agent Runtime state, Provider Readiness, or active Project/Branch context. It is not a global Thread queue or settings panel. |
| **Workbench Tab Strip** | The App Chrome surface that shows visible Workbench Panes for the active Thread and provides Pane-level actions such as focus, close, overflow, and future split controls. It does not include the hidden Agent Runtime. |
| **Chrome Action** | A small App Chrome command, usually represented by an icon button or compact menu item, with an explicit tooltip, disabled/loading state, and narrow command meaning. |
| **Agent Session** | The visible app rendering of the Raw Agent Session inside Agent Chat. It preserves the meaningful content and conceptual flow of the raw CLI session while adding app-native affordances such as links, cards, buttons, grouping, and collapsible raw blocks. |
| **Agent Session Block** | One renderable unit inside Agent Session, such as user input, agent text, tool call, tool result, command run, file change, approval prompt, question prompt, status, error, or raw fallback. |
| **Agent Session Cache** | Tide's cached render model for the Agent Session. It lets old Threads open quickly while Tide reconciles with the Raw Agent Session. |
| **Raw Agent Frame** | A small observed unit from Agent Runtime output before rendering. It can come from structured provider output, provider hooks, provider logs, provider history, or command stdout/stderr from explicit Workbench command runs. |
| **Provider Signal** | Machine-readable evidence emitted by the Agent Runtime's provider, such as hook payloads, provider logs, transcript files, or session metadata. Provider Signals enrich Agent Session rendering without becoming a separate runtime control path. |
| **PTY Transcript** | The captured terminal input/output stream for a visible Workbench Terminal Pane. It is not the Agent Runtime conversation model. |
| **Last Known State** | Tide's last observed Thread state, such as idle, running, waiting for input, waiting for approval, failed, or archived. It is internal state used for resume and attention UI, not a default Left Rail grouping. |
| **Launch Options** | Provider-native settings applied when starting an Agent Runtime, such as initial model, permission mode, cwd, branch, worktree, sandbox, profile, or config arguments. |
| **In-Session Commands** | Provider-native commands available after the Agent Runtime starts, such as slash commands, model pickers, skill commands, plugin commands, shell escapes, or other interactive command menus. |
| **Permission Chip** | A Composer chip that shows the selected provider-native permission or approval value for the Thread. |
| **Model Chip** | A Composer chip that shows the selected provider-native model value. Before launch it sets a Launch Option. After launch it opens or mirrors the provider-native model In-Session Command when supported. |
| **Model Source** | The source of values and behavior behind the Model Chip. It is the selected provider CLI Agent Integration or provider-native in-session model command. |
| **Project Option** | A Composer option that shows or changes the selected Project or Scratch context. |
| **Worktree Option** | A Composer option that shows whether the Thread runs in the current folder, a new worktree, or an existing worktree. |
| **Branch Option** | A Composer option that shows or changes the git branch selected for the Thread. |
| **Supported Agent Feature** | A confirmed feature exposed by the selected Agent Integration through Launch Options, In-Session Commands, runtime prompts, or structured events. Examples include provider-native permission values, model values, usage status, plugins, extensions, skills, MCP controls, plan-like modes, or goal-like modes. |
| **Execution Context** | The cwd, repository, branch, worktree, environment, and permission profile used when the Thread starts an Agent or shell runtime. |
| **Workbench** | The optional visible work area inside a Thread. It contains Workbench Panes such as Browser, Diff, Editor, or Terminal, plus Workbench Views such as FileTree and context-artifact views. It does not include the hidden Agent Runtime by default. |
| **Workbench Pane** | A visible Pane inside the Workbench, such as Browser Pane, Diff Pane, Editor Pane, or Terminal Pane. |
| **Workbench View** | A visible non-Pane view inside the Workbench, such as FileTree View or a context-artifact view. |
| **Left Rail** | The left-side work history area. It contains New thread, Search, Sidebar options, Pinned, and either Projects/Scratch or Threads depending on Group by mode. |
| **Sidebar Options** | The top-level Left Rail entry that controls grouping and sorting. It exposes Group by and Sort by choices without attaching those controls to a specific section header. |
| **Group By** | The Left Rail grouping mode. `By project` shows Pinned, Projects, and Scratch. `By thread` shows Pinned and Threads. |
| **Sort By** | The Thread ordering mode, independent from Group By. Current choices are Created and Updated. |
| **Thread Row** | A compact row in the Left Rail showing Agent icon, Thread title, and last activity time. |
| **Project Row** | A grouping row in the Left Rail for one Project. Clicking the row expands or collapses its Threads. Hover shows Project actions. |
| **Scratch** | A Left Rail section for Threads started without an explicit Project. Each Scratch Thread receives a Tide-managed per-thread working directory. |
| **Scratch Thread** | A Thread under Scratch. It behaves like a normal Thread but uses a Tide-managed working directory instead of a user-selected Project folder. |

## Product To Implementation Mapping

| V2 product term | Current implementation term |
|-----------------|-----------------------------|
| Thread | Workspace |
| Project | cwd/repo/worktree grouping around a Workspace |
| Pinned Item | Workspace-indexed or project-indexed shortcut metadata |
| Pinned Project | Project shortcut metadata |
| Pinned Thread | Workspace-indexed shortcut metadata |
| Scratch Thread | Workspace plus Tide-managed cwd under an application support root |
| Agent | Wrapped Agent, AgentInfo, AgentStatus, or provider CLI Agent metadata |
| Agent Runtime Source | Provider CLI runtime source selection |
| Provider CLI Agent | Agent-specific launch, resume, input, output, and feature-detection code |
| Agent Integration | Agent-specific provider CLI launch, resume, input, output, and feature-detection code |
| Agent Runtime | Hidden PTY-backed provider CLI process |
| Agent Chat | Active Workspace main interaction area |
| Raw Agent Session | Provider-owned session log, conversation record, or resume identity |
| Agent Session | Product renderer over Raw Agent Session output |
| Agent Session Cache | Cached render blocks derived from Raw Agent Session output |
| Launch Options | Provider CLI flags, config files, environment variables, and initial runtime parameters |
| In-Session Commands | Provider TUI command menus, slash commands, command completions, or runtime command events |
| Start Composer | Draft Thread creation area |
| Follow-up Composer | Active Workspace input area |
| Composer Options | Supported Agent Feature metadata plus Thread execution metadata |
| Permission Chip | Provider-native CLI permission, approval, sandbox, or policy arguments |
| Model Chip | Provider-native launch model argument plus provider-native in-session model command when supported |
| Model Source | Provider CLI capability metadata |
| Project Option | Project metadata or Scratch Thread metadata |
| Worktree Option | cwd/worktree launch metadata |
| Branch Option | git branch launch metadata |
| Supported Agent Feature | Agent-specific feature metadata |
| Workbench | Terminal Context Surface plus related Thread-bound visible panes/views |
| Workbench Pane | Pane |
| Workbench View | FileTree View or context-artifact UI |
| Review Workbench Pane | Diff Pane |
| File Workbench Pane/View | Editor Pane or FileTree View |
| Browser Workbench Pane | Browser Pane |
| Thread storage boundary | WorkspaceManager |

## Naming Boundaries

- Product docs should say `Thread`, not `Workspace`, when talking about user-facing work.
- Implementation docs should say `Workspace`, not `Thread`, until a concrete Thread type exists in code.
- Product docs should say `Project`, not `open workspace`, when talking about folder/repo grouping.
- `Pinned Item` is a shortcut. It is not copied state and not a separate hierarchy.
- `Agent` is user-facing. `Wrapped Agent` is implementation-facing.
- Composer chip names are user-facing. Provider menu values stay provider-native.
- Product docs should say `Worktree Option`, not `Workspace Option`, in the Composer.

## Open Terms

These terms still need final naming:

- The exact name for the first-screen empty center state.
- The exact name for archived Threads.
