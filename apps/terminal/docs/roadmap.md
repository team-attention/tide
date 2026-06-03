# Tide Roadmap

Tide started as a terminal-centered macOS app. The next product step is to make it feel like a real human-agent Workspace: the Terminal stays the source of truth, while the Editor Pane, Browser Pane, Diff Pane, Workspace rail, and Agent Gateway become strong enough to carry the whole task.

This roadmap is product direction, not a release-date promise.

## 1. Terminal-First Agent Workspace

The Terminal remains Tide's primary live surface. Agent CLIs should keep running as real terminal programs, while Tide wraps the surrounding task with shared Panes, layout, and MCP tools.

Focus:

- Keep `Workspace` as the task boundary.
- Keep Stage focused on the primary `Terminal Pane`.
- Keep supporting Editor, Browser, Diff, Launcher, secondary Terminal, and Render Panes in the active Terminal's Terminal Context Surface.
- Make `Wrapped Agent` state visible without pretending Tide owns the model or transcript.
- Keep Context Artifacts explicit and scoped to the source Pane's Associated Terminal.

## 2. Editor Pane Maturity

The Editor Pane is currently the biggest product gap. It is useful for task-local edits and context sharing, but it needs to become solid enough that users do not immediately leave Tide for every code-reading or code-editing workflow.

Near-term:

- Make Markdown and prose authoring feel predictable: authoring-first open behavior, Soft Wrap, search, selection, and preview transitions.
- Polish Editor Chrome: header hierarchy, path/status badges, current-line treatment, gutter, and compact mode indicators.
- Make FileFinder the main navigation palette for files, current-file symbols, workspace symbols, and workspace text search.
- Add dependable find and replace inside Editor Panes.

Next:

- Strengthen LSP-backed completion so CompletionPopup ranking, filtering, insertion, and snippet cleanup feel deterministic.
- Add diagnostics, hover hints, and inline syntax/type feedback.
- Add go-to-definition, go-to-references, and return navigation.
- Add outline navigation for the focused file.
- Add folding and basic multi-cursor quality-of-life where it pays for itself.

Later:

- Improve project-wide indexing so large workspaces can search files, symbols, references, and text without UI stalls.
- Add richer refactor actions only after navigation, diagnostics, and completion are reliable.

## 3. Workspace Rail as Task Monitor

The Workspace rail should not be a thin list of numbers. It should be the left-side task monitor: compact enough for many concurrent tasks, but informative enough to decide where attention belongs.

Hierarchy per Workspace row:

- Identity: task name, branch, or cwd.
- State: active, running, idle, or needs input when a Wrapped Agent signal exists.
- Change signal: dirty state, changed-file count, or review/diff availability.
- Activity hint: short last-event or last-agent-output snippet when useful.
- Context signal: Browser Pane, Diff Pane, or Context Artifact presence when it affects the task.

Rules:

- Keep rows dense; do not turn the rail into large cards or terminal previews.
- Prefer stable task identity over raw Workspace numbering.
- Show useful inactive-Workspace metadata without creating a second state boundary outside `WorkspaceManager`.
- Use the rail for monitoring; keep Stage for the selected task.

## 4. Browser Review Loop

Browser Pane should be the default verification surface for local previews, file-backed previews, docs, and public pages that do not require a regular browser profile.

Focus:

- Keep Tide Browser Pane Runtime as the first browser runtime for Wrapped Agents inside Tide.
- Make Browser Operation state visible while the agent is observing or acting.
- Keep Browser Automation Cursor visible and honest: it shows targeting, not OS pointer ownership.
- Let users create Browser Pane comments and selections as Context Artifacts for the paired agent.
- Escalate to External Browser Runtime only when Tide cannot represent the target or the user asks for that handoff.

## 5. Review and Change Management

Diff Pane should become a first-class review surface attached to the active task, not a secondary afterthought.

Focus:

- Open and refresh Diff Panes inside the active Terminal's Terminal Context Surface.
- Let users comment on Diff, Editor, Browser, and Terminal selections through one Context Artifact flow.
- Keep staging, committing, pushing, and test-running Terminal-bound unless a narrow inward port exists.
- Surface review state in the Workspace rail only when it helps task triage.

## 6. Local Actions

Tide should make common project actions easy without hiding the Terminal.

Focus:

- Define Workspace-local actions such as test, build, lint, run dev server, and open preview.
- Execute actions in the selected Terminal or an explicitly chosen action Terminal.
- Show action state in Pane chrome or Workspace rail without turning the titlebar into a dense toolbar.
- Keep actions usable for normal shells and unwrapped agents, not only Wrapped Agents.

## 7. Multi-Agent Work

Multiple agents should feel like multiple tasks, not a pile of terminals.

Focus:

- Keep separate tasks in separate Workspaces by default.
- Let the Workspace rail show which task needs attention.
- Let Stage splits support active comparison, not long-term task monitoring.
- Keep Context Artifact delivery scoped to the paired agent through Associated Terminal ownership.

## Near-Term Priority

The next public-facing push should emphasize three things:

1. Tide is terminal-first, but no longer terminal-only.
2. Editor Pane maturity is the most important product gap after the Browser Pane Runtime.
3. Workspace rail needs real task hierarchy: identity, status, change signal, activity hint, and context signal.
