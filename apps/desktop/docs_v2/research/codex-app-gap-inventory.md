# Codex App Gap Inventory

Date: 2026-07-03

Scope:

- User-provided Codex UI screenshots for Scheduled, Plugins, thread actions, and Environment surfaces.
- Codex CLI help for user-facing commands such as `review`, `plugin`, `mcp`, `app-server`, `remote-control`, and `cloud`.
- Official Codex documentation where available.
- Tide desktop source for left rail, thread actions, provider command discovery, provider capabilities, workbench panes, goal/checklist, usage, and settings.

Scope note: this document tracks product and workflow gaps only. Evidence should come from public docs, user-facing CLI help, user-facing UI, or Tide source.

## What Tide Already Has

Do not count these as missing:

- Local desktop shell with left rail, projects, threads, pinned items, archive, rename, settings, and search.
- Provider CLI agents for Codex CLI, Claude Code, and opencode.
- Local workbench panes: Browser, Terminal, Editor, Diff, Changes, Markdown/HTML preview, Image, File Tree, and Launcher.
- Local git context: branch/worktree controls, uncommitted Changes pane, file diffs.
- Composer controls for agent, model, permission, environment, branch/worktree, attachments, queued follow-ups, prompt/approval cards, slash commands, and Codex skill discovery from `.codex/skills`.
- Provider capability model covering commands, skills, session actions, model controls, permission controls, MCP surfaces, tools, setup, usage, and goal state.
- Tide-owned MCP tool surface for agents to operate Tide workbench panes.
- Thread goals and read-only checklist panel.
- Provider usage/rate-limit display where reported.

## Product Navigation Gaps

Codex exposes first-class top-level product areas that Tide does not:

- `Scheduled` left rail entry.
- `Plugins` left rail entry.
- Plugins/Skills tabbed app area.
- Scheduled Tasks/Templates tabbed app area.
- Pull Requests page.
- Remote connections page/settings.
- Local environments settings page.
- Cloud environments settings page.
- Worktrees settings page and dedicated worktree setup flows.
- Browser Use and Computer Use settings pages.
- MCP settings page.
- Plugin detail pages.
- Skills settings page.

## Scheduled Tasks And Automations

Codex exposes scheduled tasks as a first-class system:

- Scheduled page with `Tasks` and `Templates` tabs.
- Empty state with Daily brief, Weekly review, and Project monitor prompts.
- `Create via chat` and manual/template draft creation paths.
- Thread overflow action to add a scheduled task.
- Scheduled-task side panel tab/title for a new scheduled task.
- Automation history archive/unarchive paths.
- App/plugin awareness inside automations.

Tide has no scheduled-task domain, scheduler, persistence model, left rail entry, templates, creation flow, automation history, or background run/notification loop.

## Plugin, Skill, And Connector Gaps

Codex has a real plugin system:

- CLI: `codex plugin list/add/remove` and `codex plugin marketplace add/list/upgrade/remove`.
- Marketplace snapshots from local and Git sources.
- `.codex-plugin/plugin.json` manifests with display metadata, category, capabilities, prompts, logos, skills, MCP servers, apps, screenshots, terms/privacy URLs, and install/auth policy.
- Plugin install/uninstall UX, detail pages, search, filters, Installed/Featured sections, By OpenAI, workspace, and Personal tabs.
- Skills page and settings, recommended skills, and skill install/refresh UX.
- Plugin sharing feature flag.

Codex plugin/category examples visible from the product and CLI surface:

- Productivity plugins such as documents, PDF, spreadsheets, presentations, and template creation.
- Tooling plugins such as browser, computer use, Figma, GitHub, and Chrome-style browser integration.
- Connector categories such as Google Workspace, Slack/Teams-style collaboration, issue/PR trackers, deployment platforms, databases, observability, commerce, and CRM tools.

Tide only discovers provider-native slash commands and local Codex skills for composer suggestions. It does not yet have plugin marketplaces, plugin install/remove, plugin cache, plugin manifests, plugin detail pages, plugin categories, plugin icons/screenshots, plugin auth policies, skill marketplace/install UX, or connector account linking.

## MCP Management Gap

Codex CLI exposes external MCP management:

- `codex mcp list/get/add/remove/login/logout`.
- Stdio and streamable HTTP MCP servers.
- MCP env values, bearer-token env vars, OAuth client/resource options.
- MCP settings UI and MCP plugin/detail integration.

Tide exposes its own MCP tool surface to running agents, and it maps some Codex MCP capability methods, but it lacks user-facing external MCP server management, OAuth login/logout for MCP servers, server install/config UX, health/status UI, and marketplace integration.

## Thread And Chat Command Gaps

The provided Codex thread overflow screenshots include:

- Pin/unpin chat.
- Rename chat.
- Archive chat.
- Open side chat.
- Copy working directory.
- Copy session ID.
- Copy deeplink.
- Copy as Markdown.
- Fork chat.
- Open in new window.
- Add scheduled task.

Tide covers pin/archive/rename in left rail contexts, but lacks side chats, fork UI, session/deeplink copy, copy full conversation as Markdown, open thread in new window, and schedule-from-thread entry points.

## Environment And Sources Gap

The provided Codex screenshots show a floating Environment card with:

- Changes count.
- Local/remote environment selector.
- Branch selector.
- Commit or push action.
- Sources strip.

Codex also has product concepts around local/cloud environments, remote connections, and worktree setup flows.

Tide has local environment/worktree/branch controls and a Changes pane, but lacks the Codex-style environment card, remote/cloud environment model, Sources strip/source attribution surface, and integrated Commit or push workflow.

## Remote, Cloud, And App-Server Gaps

Codex CLI exposes:

- `codex app-server` daemon/proxy plus TypeScript and JSON schema generation for the app server protocol.
- `codex remote-control start/stop`.
- `codex cloud exec/status/list/apply/diff` for Codex Cloud tasks.

Tide currently focuses on local provider CLI runtimes. It lacks Codex Cloud task browsing/apply, remote-control daemon management, remote connection authorization UX, cloud environment settings, and app-server protocol tooling as a user-facing product area.

## Browser, Chrome, Computer Use, And Recording Gaps

Codex has:

- In-app Browser plugin and Browser Use settings.
- Chrome plugin/extension flow for existing Chrome profile state.
- Computer Use plugin for macOS app control.
- Record & Replay plugin to capture workflows and turn them into skills.
- Permission and setup UX for local desktop/browser automation.

Tide has an in-app Browser Pane with Tide MCP control, but lacks Chrome profile/extension control, Computer Use desktop automation, Record & Replay, and native permission UX for those flows.

## Artifact And Productivity Runtime Gaps

Codex productivity plugins provide dedicated workflows for:

- Documents and Word-style `.docx` work.
- PDF read/create/render/inspect.
- Spreadsheets and CSV/TSV/XLS/XLSX workflows.
- Presentations.
- Reusable artifact template creation.

Tide has source/code/markdown/html/image/file panes, but lacks the dedicated document, PDF, spreadsheet, presentation, and template runtimes.

## Sites And App-Generation Gap

Codex exposes site/app-generation-oriented product areas through its plugin/product surface.

Tide has no first-class site/app generation, hosting, deployment, project publishing, hosted version management, or Sites terms/settings flow.

## Onboarding, Discovery, And Settings Gaps

Codex has onboarding plugin suggestions and richer settings areas for:

- Plugin suggestions.
- Browser Use.
- Computer Use.
- Remote connections.
- Local/cloud environments.
- Worktrees.
- MCP.
- Skills.

Tide settings currently focus on theme, worktree behavior, providers/models, and usage. It lacks the broader marketplace/onboarding/discovery/settings system.

## Suggested Parity Order

This initial inventory was screenshot-driven. The follow-up provider analysis changes the near-term recommendation: prioritize Review/Git handoff and Agent Monitor over scheduled tasks or plugin marketplace parity.

See `provider-review-monitor-plan.md` for the current evidence-based plan.

Recommended near-term order:

1. Provider-specific Review adapter research and fixtures.
2. Read-only Review pane over Tide-owned Git diffs.
3. Persistent Agent Monitor using existing runtime state/events.
4. Tide-owned Git handoff: stage, revert, commit, push with explicit confirmation.
5. Local plugin/skill/MCP inventory per provider.

Deferred:

- Scheduled tasks, until Tide has a credible scheduler/background execution model.
- Marketplace-style plugin install/auth/discovery, until Tide has marketplace and connector account infrastructure.

Later parity backlog:

1. Fork, side chat, new window, deeplink, and session-copy workflows.
2. Computer Use, Chrome, and Record & Replay.
3. Documents, PDF, spreadsheets, presentations, and template runtimes.
4. Sites, app generation, hosting, and publication workflows.
5. Pull Requests and Codex Cloud task workflows.
