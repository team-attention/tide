# Provider Review And Agent Monitor Plan

Date: 2026-07-03

Status: initial implementation in this branch.

This memo narrows the Tide workflow gap discussion to the two areas that look most valuable now:

1. Review / Git handoff.
2. Agent monitoring.

It intentionally deprioritizes scheduled tasks and plugin marketplaces. Without a service-side scheduler, scheduled tasks can only be local app-running reminders. Without a marketplace backend and connector auth model, plugin work should be reduced to local inventory/management later.

Scope note: evidence in this memo is limited to public documentation, user-facing CLI help, and Tide source.

## Implemented In This Branch

This branch implements the first product slice of the plan:

- Workbench `review` pane kind with a renderer Review pane.
- Changes pane `Review` entry point.
- Main-process review runner:
  - Codex: `codex review` CLI fallback for uncommitted/base/commit/custom.
  - Claude: `claude ultrareview` for base-branch review, and local `claude -p` prompt review for other targets.
  - opencode: `opencode run` prompt review.
- Review pane target/provider controls, running state, raw output fallback, simple finding extraction, and "Ask agent to fix" handoff into the composer.
- Main-process Git mutation IPC for file-level and hunk-level stage, unstage, and discard, plus commit and push.
- Changes pane Git handoff bar and hunk action strip wired to those Tide-owned Git IPC commands.
- Persistent Agent Monitor panel derived from existing product-shell thread/runtime/prompt/activity state.

Deferred follow-up:

- Codex app-server `review/start` schema fixture and native review path.
- Inline answer controls inside Agent Monitor.
- Adoption/import of provider-owned background sessions outside Tide.

## Design Principle

Do not design these as "Codex app features copied into Tide."

Tide has three first-class provider CLI agents: Codex CLI, Claude Code, and opencode. Their review, git, background execution, and monitoring surfaces are materially different. Tide should expose one coherent product workflow, but execution and observability must be provider-evidence-gated.

Use this rule:

- Common Tide UI: Review, Changes, Running Agents, Needs Attention.
- Provider-specific adapters: Codex app-server/CLI, Claude stream-json/background agents, opencode ACP/session tooling.
- No generic provider action unless at least two providers can support it through proven signals, or Tide can implement it locally without pretending the provider owns it.

## Evidence Inspected

Local Tide source:

- `apps/desktop/docs_v2/master-plan.md`: Codex CLI, Claude Code, and opencode are first-class Provider CLI Agents.
- `apps/desktop/src/shared/contracts/provider-capability.ts`: provider capabilities can be `provider_method`, `provider_prompt_text`, `provider_config`, `tide_surface`, or `unsupported`.
- `apps/desktop/src/backend/adapters/outbound/agent-integrations/codex/codex-capability-registry.ts`: Codex registers `codex:review` as `review/start`.
- `apps/desktop/src/backend/adapters/outbound/agent-integrations/claude/claude-capability-registry.ts`: Claude command capabilities are live slash/skill commands sent as provider prompt text.
- `apps/desktop/src/backend/adapters/outbound/agent-integrations/opencode/opencode-agent-integration.ts`: opencode is run through ACP (`opencode acp`) and currently exposes no Tide review capability.
- `apps/desktop/docs_v2/specs/git-changes-view.md`: Tide's Changes pane is explicitly read-only; no staging, commit, discard, or push.
- `apps/desktop/src/shared/contracts/agent-runtime.ts`: common runtime states include `running`, `waiting_for_input`, `waiting_for_approval`, `idle`, `stopped`, and `failed`.
- `apps/desktop/src/shared/contracts/events.ts`: runtime events include `agentRuntime.stateChanged`, `usageChanged`, `activityChanged`, `capabilitiesChanged`, `prompt.changed`, and queued inputs.
- `apps/desktop/src/desktop/application/domains/product-shell/state/types.ts`: thread summaries already carry `running`, `attention`, `live`, and `runtimeStartedAt`.
- `apps/desktop/src/desktop/adapters/inbound/react-renderer/product-shell/multitask/live-switcher-hud.tsx`: Tide has a transient live-thread switcher, not a persistent monitor.

Local CLI evidence:

- `codex review --help` supports `--uncommitted`, `--base <BRANCH>`, `--commit <SHA>`, `--title <TITLE>`, and custom prompt input.
- `claude --help` exposes `--background`, `agents`, `--output-format stream-json`, `--permission-mode`, `--plugin-dir`, and related provider-owned surfaces.
- `claude ultrareview --help` describes a cloud-hosted multi-agent code review of the current branch, PR number, or base branch.
- `claude agents --help` supports `--json`, `--all`, and `--cwd`, which makes Claude background sessions script-observable.
- `opencode --help` exposes `acp`, `run`, `serve`, `web`, `session`, `agent`, `pr`, `plugin`, and `github`.
- `opencode run --help` supports `--format json`, `--agent`, `--model`, `--session`, `--continue`, and `--dir`.
- `opencode session --help` exposes session listing/deletion.
- `opencode agent --help` exposes provider-managed agents.

Official docs inspected:

- Codex CLI features: https://developers.openai.com/codex/cli/features
- Codex app review: https://developers.openai.com/codex/app/review
- Codex app commands: https://developers.openai.com/codex/app/commands
- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference
- opencode ACP: https://opencode.ai/docs/acp/
- opencode CLI: https://opencode.ai/docs/cli/
- opencode agents: https://opencode.ai/docs/agents/
- opencode commands: https://opencode.ai/docs/commands/

## Provider Capability Matrix

| Area | Codex | Claude Code | opencode | Tide implication |
| --- | --- | --- | --- | --- |
| Native local review | Yes: `codex review` and app-server `review/start` | No proven local review command; general `-p` prompts can review | No native review command; `opencode run` can run a review prompt | Tide needs a Review Adapter, not a single provider command. |
| Review scopes | Uncommitted, base branch, commit, custom prompt | `ultrareview` target can be PR/base/current branch, but cloud-hosted | Prompt-defined; can use git diff context or provider tools | UI scopes should map to provider-supported subsets. |
| Review as transcript turn | Codex docs say review runs show as transcript turns | Stream-json/print output can be captured, but not same semantic mode | JSON events can be captured from `run --format json` | Tide review result model should be independent from transcript shape. |
| Git changes/diff | Tide can provide locally with git | Tide can provide locally with git | Tide can provide locally with git | Changes pane should remain Tide-owned. |
| Stage/commit/push | Codex app has product flow; Tide now has initial file-level Git handoff | Provider could run git via tools, but Tide should own explicit git actions | Provider could run git via tools, but Tide should own explicit git actions | Git mutation must stay Tide-owned with confirmation. |
| Live runtime state | app-server events | stream-json events and Claude background agents | ACP events | Common monitor can use Tide runtime events first. |
| Background sessions outside Tide | Codex external app-server/cloud surfaces exist, not yet integrated | `claude agents --json` is scriptable | `opencode session list/export`, server/web exist | Monitor can import provider-owned external sessions only after attach/adoption semantics are proven. |

## Plan 1: Review / Git Handoff

### Product Goal

Turn Tide's current read-only Changes pane into an explicit review and handoff workflow:

1. See what changed.
2. Run the best available review for the selected provider.
3. Inspect findings.
4. Ask an agent to fix selected findings.
5. Stage, commit, and push through Tide-owned git commands.

### Non-goals

- No scheduled review automation.
- No marketplace/plugin dependency.
- No blind `git push`.
- No provider-running-git-as-UI-action for staging/commit/push.
- No attempt to make Claude `ultrareview` look identical to Codex local review; it is cloud-hosted and should be labeled as such.

### Review Targets

Use a Tide-owned target model:

```ts
type ReviewTarget =
  | { kind: "uncommitted" }
  | { kind: "base_branch"; baseBranch: string }
  | { kind: "commit"; sha: string; title?: string }
  | { kind: "custom"; instructions: string; diff?: string };
```

Provider mapping:

- Codex:
  - Prefer app-server `review/start` after schema fixture is verified.
  - Fallback to `codex review --uncommitted`, `--base`, or `--commit`.
- Claude:
  - Cloud path: `claude ultrareview [target]`, clearly labeled.
  - Local path: `claude -p --output-format stream-json` with a Tide review prompt and local diff context.
- opencode:
  - `opencode run --format json --agent <plan-or-review> <prompt>`.
  - If no review agent exists, use plan agent or a Tide-generated review prompt.

### Codex App-Server Decision Gate

Do not implement the Codex Review button until this is verified:

- Generate app-server schemas from the current Codex CLI.
- Confirm `ReviewStartParams` exact shape.
- Confirm `ReviewTarget` enum/object shape:
  - uncommitted changes
  - base branch
  - commit
  - custom
- Confirm `ReviewDelivery` behavior:
  - inline current thread
  - detached review thread
- Run a fixture against a scratch git repo and record emitted events.

If fixture quality is insufficient, use the CLI review runner first. The CLI help is stable enough for a first implementation; app-server review can follow.

### Review Result Model

Keep review output independent from provider transcript format:

```ts
interface ReviewRun {
  reviewRunId: string;
  provider: "codex" | "claude" | "opencode";
  target: ReviewTarget;
  cwd: string;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed" | "cancelled";
  source: "codex_app_server" | "codex_cli" | "claude_ultrareview" | "claude_prompt" | "opencode_prompt";
  rawText?: string;
  rawJsonRef?: string;
  findings: ReviewFinding[];
}

interface ReviewFinding {
  findingId: string;
  severity?: "critical" | "high" | "medium" | "low" | "info";
  file?: string;
  line?: number;
  title: string;
  body: string;
  confidence?: "high" | "medium" | "low";
}
```

The review pane can render raw Markdown/text whenever structured parsing is not trustworthy. Structured findings are useful, but raw provider output remains the fallback and evidence trail.

### UX Shape

Entry points:

- Changes pane header: `Review`.
- Composer slash command/capability row: `/review`.
- Thread menu later: `Review changes`.

Review pane:

- Target selector: Uncommitted / Base branch / Commit / Custom.
- Provider label and execution source.
- Running state with elapsed time.
- Findings list first, raw output second.
- File/line opens existing Editor/Diff pane when possible.
- Action: `Ask agent to fix selected` creates a follow-up prompt with selected findings.

### Git Handoff

Keep git mutation Tide-owned:

- Read-only `git status`/diff remains Tide-owned.
- Stage/unstage file or hunk.
- Revert file/hunk with confirmation.
- Commit dialog with generated message.
- Push with explicit remote/branch confirmation.

Initial implementation covers file-level and hunk-level stage/unstage/discard, generated and manual commit messages, and push through an explicit remote/branch target via Main-process IPC.

Implementation should extend Main-process git IPC rather than route these through providers. Provider agents may suggest a commit message, but Tide should execute the git command.

### Remaining Tests And Fixtures

Required before extending this slice:

- Scratch repo fixture with:
  - unstaged file
  - staged file
  - untracked file
  - branch diff
  - commit review
- Provider command mapping tests for Codex, Claude, opencode.
- Renderer tests for review target selection and disabled states.
- Contract tests that unsupported provider paths surface as unavailable, not broken buttons.

## Plan 2: Agent Monitor

### Product Goal

Give the user one persistent operational view of running and waiting agent sessions:

- What is running?
- Which sessions need input or approval?
- Which project/worktree/branch is each session using?
- How long has it been running?
- What is it doing right now?
- What can I do next: focus, stop, open changes, answer prompt?

### Non-goals

- No provider-native background session adoption by default.
- No complete replacement for Claude `agents` or opencode web/server UI.
- No attempt to show every tool token for every background thread.
- No new scheduler.

### Existing Tide Signals

Tide already has enough signals for a monitor:

- `ProductShellThread.running`
- `ProductShellThread.attention`
- `ProductShellThread.live`
- `ProductShellThread.runtimeStartedAt`
- `agentRuntime.stateChanged`
- `agentRuntime.activityChanged`
- `agentRuntime.usageChanged`
- `prompt.changed`
- queued inputs on runtime state changes

Current limitation:

- Some rich details are only kept in the active `agentChat` state.
- Background thread rows get `running` and `attention`, but not a full normalized live snapshot.

### Monitor Snapshot Model

Add a Tide-owned runtime snapshot model, derived from existing events first:

```ts
interface AgentMonitorSession {
  threadId: string;
  agentId: "codex" | "claude" | "opencode";
  title: string;
  cwd?: string;
  projectName?: string;
  branch?: string;
  worktree?: string;
  state: "running" | "waiting_for_input" | "waiting_for_approval" | "idle" | "stopped" | "failed";
  startedAt?: string;
  changedAt?: string;
  elapsedMs?: number;
  queuedInputCount?: number;
  pendingPromptKind?: "approval" | "question" | "mcp_elicitation";
  activityLabel?: string;
  planCompleted?: number;
  planTotal?: number;
  nestedAgents?: number;
  nestedToolCalls?: number;
  usageLabel?: string;
  providerSessionRef?: string;
}
```

The renderer can derive this from product shell state, but the durable shape should be backend-owned so background detail does not depend on which thread is hydrated.

### UX Shape

Open from:

- Top chrome live status button.
- Command palette / shortcut.
- Existing live switcher HUD can include a "details" path later.

Layout:

- Workbench pane or lightweight overlay, not a left-rail rearchitecture.
- Groups:
  - Needs you
  - Running
  - Idle live sessions
  - Failed/stopped
- Row data:
  - agent icon
  - thread title
  - cwd/project
  - branch/worktree
  - elapsed
  - current activity
  - queued input count
  - actions: Focus, Open changes, Stop

Action behavior:

- Focus: switch to thread and hydrate it.
- Open changes: open existing Changes pane for the thread cwd.
- Stop: call existing `agentRuntime.stop`.
- Answer prompt: focus the thread by default; inline answering is acceptable only when the prompt snapshot is complete.

### Provider-Specific Enrichment

Codex:

- Use app-server runtime events.
- Surface plan progress and review mode if emitted.
- Later: distinguish normal turns from review runs.

Claude:

- Existing Tide code already enriches Claude `Task` fan-out using nested agent/tool counts.
- Optional import: `claude agents --json --cwd <path>`.
- Imported Claude background sessions should be marked as external/provider-owned unless Tide can attach/resume safely.

opencode:

- ACP gives live structured events for Tide-started sessions.
- Optional import: `opencode session list --format json` and `opencode export`.
- External opencode sessions should be read-only/adoptable until attach/resume semantics are proven.

### Backend Contract Direction

- Renderer-derived monitor state can use existing `threads`, active `agentChat`, and known runtime events.
- Backend should eventually emit `agentRuntime.monitorChanged` or include `monitorSnapshot` in `agentRuntime.stateChanged`.
- Snapshot is keyed by Tide thread id and can carry provider session refs.
- Product shell stores `runtimeSnapshotsByThreadId`.
- Provider external session import remains provider-specific:
  - Claude: `claude agents --json`.
  - opencode: `opencode session list --format json`.
  - Codex: app-server/cloud exploration only after local protocol evidence.

### Tests And Fixtures

Required:

- Reducer tests for state transitions:
  - running -> idle
  - running -> waiting_for_approval
  - waiting_for_input -> running
  - failed
  - queued input count changes
- Multi-thread monitor rendering fixture with Codex, Claude, and opencode rows.
- Background thread detail preservation test.
- Stop/focus/open-changes command dispatch tests.
- Provider external import tests only after each provider command output is captured.

## Remaining Work Order

1. Harden provider review adapters.
   - Confirm Codex `review/start` schema/fixture before adding a native app-server path.
   - Capture Claude `ultrareview --json` sample if account/environment permits.
   - Capture `opencode run --format json` review-prompt output sample.
   - Decide structured parsing per provider from captured output, not assumptions.

2. Deepen the Review pane.
   - Add structured finding persistence.
   - Link file/line findings into existing Editor/Diff panes.
   - Add renderer tests for target selection, unavailable states, and result rendering.

3. Deepen Tide-owned Git handoff.
   - Broaden scratch-repo fixtures beyond the current file/hunk handoff cases to cover branch diff and commit review cases.

4. Move Agent Monitor toward backend-owned snapshots.
   - Store durable `runtimeSnapshotsByThreadId` or equivalent backend-owned monitor state.
   - Preserve richer background-thread detail even when a thread is not hydrated.
   - Add inline answer controls only when prompt snapshots are complete.
   - Add stop/focus/open-changes dispatch tests.

5. Add provider-specific external session import only after fixtures.
   - Claude: `claude agents --json`.
   - opencode: `opencode session list` / export.
   - Codex: app-server/cloud exploration only after local protocol evidence.

6. Add local plugin inventory.
   - Local installed plugins/skills/MCP inventory per agent.
   - No marketplace claim.

## Open Questions

- Should Codex review run inline in the current thread or detached in a review thread?
- Should Tide normalize provider review output into structured findings immediately, or render raw output first?
- Should Claude `ultrareview` be available by default, given it is cloud-hosted?
- Should opencode review use the `plan` agent by default, or should Tide create/suggest a local `review` agent?
- Should Agent Monitor be a Workbench pane, a top-chrome overlay, or both?
- How much background-thread prompt detail should be answerable inline without switching thread context?

## Decision So Far

Build the next parity work around Review/Git handoff and Agent Monitor, not around scheduled tasks or a plugin marketplace.

The safe architecture is:

- Tide owns Git state and Git mutations.
- Provider adapters own review execution.
- Tide owns the monitor snapshot.
- Provider-specific enrichments are added only after fixture evidence.
