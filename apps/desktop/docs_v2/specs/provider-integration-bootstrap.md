# Spec: Provider Integration Bootstrap

## Scope

This spec defines the provider bootstrap contract and the concrete Agent Integration implementation path as each provider slice is proven.

Codex CLI was the first implementation provider. Claude Code was the second provider slice. This slice adds the Antigravity CLI Agent Integration bootstrap from `agy` evidence.

It covers:

- Agent Integration responsibilities.
- hidden PTY as the single runtime transport.
- Codex launch/resume bootstrap evidence gates.
- Claude Code launch/resume bootstrap evidence gates.
- Antigravity CLI launch/resume bootstrap evidence gates.
- Provider Readiness preflight.
- Directory Trust and onboarding handling.
- hook/bootstrap setup.
- Tide MCP Tool Surface attachment.
- provider-owned Raw Agent Session reference discovery.
- prompt, permission, and elicitation signal collection.

It does not implement full Agent Session readers, Workbench tool contracts, Desktop UI, persistence storage, a real PTY process adapter, or provider smoke execution.

## Evidence

- `docs_v2/implementation/electron-node-architecture-decisions.md` says each Agent Integration starts or resumes a provider CLI in hidden PTY, attaches Tide MCP Tool Surface when supported, sends user input, reads PTY Transcript and Provider Signals, surfaces Provider Readiness, and emits Agent Session Blocks.
- `docs_v2/implementation/concrete-design-backlog.md` selects provider-specific integrations behind one capability contract and rejects one generic CLI adapter.
- `docs_v2/research/agent-hidden-pty-provider-signal-smoke.md` says Codex, Claude, and Antigravity passed core hidden PTY launch/input/output/history/resume smoke with provider-specific follow-up work.
- `docs_v2/research/agent-hidden-pty-provider-signal-smoke.md` says Provider Readiness must be satisfied before sending user input because setup screens can capture Composer bytes.
- `docs_v2/research/agent-hidden-pty-provider-signal-smoke.md` records fresh-state Codex, Claude Code, and Antigravity CLI setup screens observed on 2026-05-27: authentication, onboarding/theme/safety/terms, and Directory Trust can all appear before the normal Composer.
- User decision on 2026-05-27 selected Codex CLI as the first Provider Integration bootstrap provider.
- `crates/tide-app/resources/bin/codex` injects Codex hooks, Tide MCP config, and a Tide skill into an overlay `CODEX_HOME`.
- `crates/tide-app/resources/bin/claude` injects Claude MCP config with `--mcp-config`, hook settings with `--settings`, and a Tide context prompt.
- `crates/tide-app/resources/bin/gemini` shows the existing wrapper pattern for a Gemini-like CLI using system defaults, MCP config, hooks, and context injection. Antigravity v2 must be researched and implemented as Antigravity-specific, not assumed to be the same binary.
- `docs_v2/master-plan.md` says Codex `exec --json`, Claude print-mode JSON, Claude Remote Control, and batch modes are research or fixture inputs, not v2 runtime transports.
- Official Claude Code [hooks reference](https://code.claude.com/docs/en/hooks) says `AskUserQuestion` is handled through `PreToolUse` as a tool requiring user interaction, while `Elicitation` is a separate hook event for MCP-server user input requests.
- Claude permission fixture `/private/tmp/tide-provider-evidence/20260527-182233-claude-permission` captured `UserPromptSubmit`, `PermissionRequest`, and `Notification` for the same session and transcript; `PermissionRequest` carried tool/action structure, while `Notification` carried `notification_type: "permission_prompt"` and the attention message.
- Official Antigravity plugin docs say plugins can contain root `plugin.json`, `mcp_config.json`, `hooks.json`, skills, and rules, and can be loaded from workspace or global plugin directories.
- Official Antigravity CLI features docs say `agy plugin install` stages plugins under `~/.gemini/antigravity-cli/plugins/<plugin_name>/`, and the CLI exposes `/mcp` for MCP management.
- Official Antigravity migration docs say Antigravity CLI stores MCP servers in `~/.gemini/antigravity-cli/mcp_config.json` globally or `.agents/mcp_config.json` per workspace, not inline in Gemini `settings.json`.
- Local validation on 2026-05-27 with installed `agy` processed one MCP server from `/private/tmp/tide-agy-plugin-mcp/tide-bootstrap/mcp_config.json` using `agy plugin validate`.
- Local validation on 2026-05-27 with installed `agy` processed one hook file when the temporary plugin included `hooks/tide-hooks.json`; prior runtime smoke remains the proof that installed global plugin root `hooks.json` is loaded during execution.
- Local `codex --help` on 2026-05-29 shows interactive launch supports `--model`, `--sandbox`, `--ask-for-approval`, and `--dangerously-bypass-approvals-and-sandbox`.
- Local `claude --help` on 2026-05-29 shows interactive launch supports `--model` and `--permission-mode`.
- Local `agy --help` on 2026-05-29 shows interactive launch supports `--sandbox`, `--dangerously-skip-permissions`, and `--conversation`, and does not show an interactive model flag.

## Decisions

### D1. Provider-specific integrations

Codex, Claude, and Antigravity each get a provider-specific Agent Integration.

The shared Agent Integration contract describes Tide capabilities. It does not erase provider-specific launch, resume, readiness, prompt, history, or hook details.

### D2. Hidden PTY is the runtime transport

Each Agent Integration launches the provider's normal interactive CLI in one hidden PTY.

Provider Signals observe and enrich that same session.

No Agent Integration uses a second live runtime path for the same Thread.

### D3. Bootstrap before user input

Agent Integration bootstrap runs before the user's Thread message is written to the hidden PTY.

Bootstrap must establish or surface:

- provider executable availability.
- authentication or first-run readiness.
- Directory Trust for the Execution Context.
- hook/bootstrap readiness.
- Tide MCP Tool Surface attachment when supported.
- provider-native Raw Agent Session reference discovery strategy.
- Provider Setup Surface command when setup must be completed by the user.

### D4. Provider Readiness is explicit

When readiness is incomplete, the Agent Integration returns Provider Readiness blockers.

Backend emits those blockers to Desktop and does not write the user's prompt to PTY.

### D5. Provider setup stays provider-native

Provider onboarding, authentication, legal/data consent, and Directory Trust choices stay provider-owned.

Directory Trust is not treated as one-time onboarding. It is checked for the selected Execution Context and can be required when the user starts or resumes a Thread in a Project, Scratch cwd, worktree, or other provider-visible cwd.

When Provider Readiness is incomplete, Tide preserves pending Composer input and offers a Provider Setup Surface that runs the provider's own setup flow in a visible terminal surface for the selected Execution Context.

Tide does not reimplement or auto-accept provider setup choices. After the user completes setup, Backend re-runs Provider Readiness before starting the Thread turn.

If Tide hosts the Provider Setup Surface inside the app, input is terminal input: arrows, Enter, Esc, checkbox toggles, paste prompts, copy hints, and provider-specific key protocols where required.

### D6. Prompt and permission signatures are evidence-gated

Prompt and permission detection must be backed by provider hook payloads, provider logs, provider transcript records, or bounded PTY evidence.

Unknown prompt-looking text may be rendered as raw Agent Session output, but it does not become a structured Prompt State without evidence.

### D7. Provider-owned history stays provider-owned

The Agent Integration returns provider session references such as rollout path, transcript path, session id, conversation id, or resume identity.

Tide stores references and render cache metadata. Tide does not become the conversation source of truth.

### D8. Antigravity is not Gemini-by-assumption

The current v1 wrapper evidence covers `gemini`, while v2 target support includes Antigravity CLI.

Antigravity bootstrap must be specified and smoked from `agy` behavior and local Antigravity state, not copied from Gemini wrapper behavior without verification.

### D9. Codex remains provider-specific

The first provider slice implemented a Codex Agent Integration adapter.

The adapter builds Backend-internal Codex launch and resume plans, reports Provider Readiness blockers, exposes Codex capabilities, and keeps Tide MCP Tool Surface and hook/bootstrap configuration in the provider-specific adapter layer.

Claude Code and Antigravity CLI must not be hidden behind the Codex adapter or genericized from Codex behavior.

### D10. Claude Code prompt signals are single-source

Claude Code Prompt State classification must use one provider-owned structured event for each Prompt State kind.

- `PermissionRequest` creates a permission Prompt State.
- `PreToolUse` with `tool_name: "AskUserQuestion"` creates a question Prompt State.
- `Elicitation` creates a question Prompt State for MCP-server user input.
- `Notification` does not create Prompt State. It is an attention Provider Signal only.

Tide must not implement hybrid or optional fallback classification where both `Notification` and another structured hook can create the same Prompt State.

### D11. Claude Code launch context matches the Codex wrapper pattern

Codex's existing Tide wrapper injects three provider-owned bootstrap surfaces: hooks, Tide MCP config, and Tide context guidance through a Tide skill.

Claude Code's matching provider-owned context guidance is `--append-system-prompt`. The Claude Code Agent Integration start and resume plans include `--mcp-config`, `--settings`, and `--append-system-prompt` together, rather than deferring the context prompt to a later Workbench slice.

### D12. Antigravity bootstrap is plugin-owned

Antigravity CLI does not expose Codex-style inline config or Claude-style `--settings`/`--mcp-config` launch flags in the local `agy --help` evidence.

Antigravity Tide MCP and Provider Signal bootstrap therefore use Antigravity plugin/customization files:

- `mcp_config.json` for the Tide MCP Tool Surface.
- `hooks.json` and the validated hook layout for Provider Signals.

The Antigravity Agent Integration marks Tide MCP support true only when plugin/bootstrap readiness is satisfied. If the required plugin/customization files are not installed or verified, preflight returns `hook_bootstrap_required` and does not start the real Thread turn.

The Antigravity launch plan remains the normal interactive `agy` hidden PTY session. Resume uses `agy --conversation <conversation-id>`.

### D13. Launch Options become provider-native launch args only when proven

Start Composer values are Launch Options for the selected Agent Integration.

The Agent Integration maps Launch Options to provider-native launch args only when local provider help or other evidence proves the flag exists for the interactive runtime path.

- Codex maps `model` to `--model <value>`, `read-only` / `workspace-write` / `danger-full-access` to `--sandbox <value>`, `untrusted` / `on-request` / `never` / `on-failure` to `--ask-for-approval <value>`, and `dangerously-bypass-approvals-and-sandbox` to `--dangerously-bypass-approvals-and-sandbox`.
- Claude maps non-default `model` values to `--model <value>` and `acceptEdits` / `auto` / `bypassPermissions` / `default` / `dontAsk` / `plan` to `--permission-mode <value>`.
- Antigravity maps `sandbox` to `--sandbox` and `dangerously-skip-permissions` to `--dangerously-skip-permissions`.

Default labels and unsupported provider values are not fabricated into launch args.

### D14. Codex input waits for the initial TUI render window

Live hidden PTY evidence showed that writing a Composer message immediately after spawning `codex --no-alt-screen` can place the user text before Codex finishes its update notice and hook-trust warning render.

Codex launch and resume plans therefore include a Codex-specific startup delay before the first Composer input is written. This is provider-specific Agent Integration timing, not a generic Agent Runtime rule.

### D14a. Claude input waits for the initial TUI render window

Live Claude hidden PTY evidence showed that a normal `claude` PTY run submits with CSI-u Enter after the initial TUI is rendered, while the Tide live launch path without a startup delay echoed `ESC[13u` as literal raw output and did not create an Agent message.

Claude launch and resume plans therefore include a Claude-specific startup delay before the first Composer input is written. The submit key remains CSI-u Enter; the startup delay only waits for the provider TUI to enter its Composer-ready state.

### D15. Hidden PTY launch provides basic terminal identity

Live Codex hidden PTY diagnostics showed one-character-per-line TUI rendering when the PTY bridge opened a pseudo-terminal without setting rows and columns.

The Backend PTY launcher therefore sets an explicit default terminal window size before spawning provider CLIs. Provider TUIs must not depend on the operating system's unspecified PTY size default.

The Backend PTY launcher also replies to the basic terminal capability queries observed in provider evidence runs: cursor position report, foreground/background color query, primary device attributes, and keyboard protocol query. These replies are hidden PTY transport behavior, not a user-visible terminal renderer.

### D16. Codex hook trust is Provider Readiness

Live Codex hidden PTY diagnostics showed `PermissionRequest hooks ... hook needs review` blocking Composer input even when the launch included `--dangerously-bypass-hook-trust`.

Codex hook trust is therefore a Provider Readiness gate. Tide must preserve provider-written `hooks.state` trust entries in the generated Codex overlay config, and must not launch a real Thread turn until the generated Tide hooks are trusted for the overlay `hooks.json`.

The Codex hook setup action may run the provider setup surface with the overlay `CODEX_HOME`, while authentication, onboarding, and Directory Trust setup stay provider-native against the user's real Codex home.

The generated Codex hook command must point at a stable Tide-owned provider signal runner script, not directly at whichever Node, Electron Main, or Electron utilityProcess executable happened to create the bootstrap files. Otherwise the hook command changes between Backend-only smoke and Electron smoke, making previously trusted Codex hook entries stale while still looking present in the overlay config.

When Tide rewrites the Codex overlay, it may preserve existing `hooks.state` entries only if the previous `hooks.json` content matches the next generated `hooks.json` content. If the hook definition changes, Backend must treat hook trust as incomplete and return Provider Readiness instead of starting the Thread turn.

### D17. Codex overlay mirrors the full real home except Tide-owned entries

The overlay `CODEX_HOME` exists only so Tide can own a few entries (`config.toml`, `hooks.json`, `skills`) without mutating the user's real `~/.codex`. Every other entry in the real Codex home must be symlinked into the overlay, mirrored dynamically rather than from a fixed allow-list.

Codex keeps live state in version-suffixed sqlite databases (observed 2026-06-03: `state_5.sqlite`, `goals_1.sqlite`, `logs_2.sqlite`, `memories_1.sqlite`, plus their `-wal`/`-shm` siblings and a `sqlite/` directory). Their names change across Codex releases. A hardcoded allow-list that omits them — and a prune step that deletes anything not on the list — leaves the overlay without a usable database, so Codex refuses to start with "its local database appears to be damaged". The v1 wrapper (`crates/tide-app/resources/bin/codex`) already mirrors the full home (`for entry in *`, excluding only Tide-owned entries); the v2 overlay must do the same so it survives Codex adding new state files. The prune step may remove only overlay entries that are neither Tide-owned nor present in the real home (stale/dangling links).

## Out Of Scope

- Full provider parser implementation.
- Complete tool call and tool result block grammar.
- Workbench MCP tool names and authorization.
- Electron process spawn implementation.
- Persistence schema.
- UI setup screens.
- Batch runtime transports.
- Running a real provider smoke as part of the default test suite.

## Domain Model

### Agent Integration

Agent Integration is a provider adapter behind a shared Backend port.

Responsibilities:

- detect executable.
- preflight Provider Readiness.
- prepare wrapper or launch environment.
- start hidden PTY.
- resume hidden PTY.
- attach Provider Signal readers.
- attach Tide MCP Tool Surface.
- identify provider-owned Raw Agent Session reference.
- classify provider prompts and permissions when evidence supports it.
- stop provider process.

### Agent Integration Capability

Capabilities are confirmed facts, not desired symmetry.

Initial capability fields:

| Field | Meaning |
|-------|---------|
| `supportsHiddenPty` | Provider can run interactive CLI in hidden PTY. |
| `supportsResume` | Provider has a proven resume path for Raw Agent Session. |
| `supportsTideMcp` | Provider can attach Tide MCP Tool Surface to the same runtime session. |
| `supportsHooks` | Provider can emit hook payloads tied to the runtime session. |
| `supportsReadableHistory` | Provider exposes readable history or transcript for rendering. |
| `requiresTerminalKeyProtocol` | Provider TUI needs terminal key semantics beyond plain CR. |

### Provider Bootstrap Result

Provider bootstrap returns one of:

- ready to launch.
- blocked by Provider Readiness.
- unsupported provider installation.
- failed bootstrap with Contract Error.

## Contracts

Backend port:

```ts
interface AgentIntegrationPort {
  preflight(input: AgentPreflightInput): Promise<AgentPreflightResult>;
  buildStartPlan(input: AgentStartPlanInput): Promise<ProviderLaunchPlan>;
  buildResumePlan(input: AgentResumePlanInput): Promise<ProviderLaunchPlan>;
  detectPromptState(input: AgentPromptSignalInput): PromptState | null;
}
```

Provider-specific bootstrap data:

```ts
interface AgentPreflightResult {
  agentId: AgentId;
  ready: boolean;
  blockers: ProviderReadinessBlocker[];
  capabilities: AgentIntegrationCapabilities;
  launchPlan?: ProviderLaunchPlan;
}

interface ProviderLaunchPlan {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  inputTiming?: {
    startupDelayMs?: number;
    preSubmitDelayMs?: number;
  };
  expectedSignalSources: ProviderSignalSource[];
}
```

The launch plan is Backend-internal. It does not cross to Desktop as a user-facing Contract DTO.
Provider Launch Plans may carry provider-specific input timing so the hidden PTY runtime can wait for startup/auth readiness and split Composer text from the submit key when provider TUIs need a settle window.

Provider Readiness blockers can include a Provider Setup Surface action:

```ts
interface ProviderReadinessBlocker {
  kind:
    | "not_installed"
    | "not_authenticated"
    | "onboarding_required"
    | "directory_trust_required"
    | "hook_bootstrap_required";
  scope: "provider" | "execution_context" | "integration";
  message: string;
  setup?: ProviderSetupSurfaceAction;
}

interface ProviderSetupSurfaceAction {
  command: string;
  args: string[];
  cwd: string;
  expectedCompletion: "process_exit" | "retry_preflight";
}
```

The setup action is not a Thread launch plan. It exists to complete provider-owned setup before the real Agent Runtime starts.

## Provider Bootstrap Requirements

### Codex

First implementation must prove:

- executable detection for `codex`.
- interactive hidden PTY launch.
- resume using provider-native resume identity.
- hook/bootstrap path for running, permission request, and stop signals.
- Tide MCP config injection.
- rollout JSONL or equivalent Raw Agent Session reference discovery.
- top-level interactive flags verified against installed `codex --help`.
- authentication readiness detection for ChatGPT, device code, and API key paths.
- post-login safety/autonomy note handling.
- Directory Trust readiness detection for the Execution Context.

First implementation behavior:

- `preflight` returns `not_installed` when the Codex executable cannot be resolved.
- `preflight` returns `not_authenticated` when provider state says Codex auth is incomplete.
- `preflight` returns `directory_trust_required` when the selected Execution Context cwd is not trusted by provider-owned Codex state.
- `preflight` returns `hook_bootstrap_required` when Tide-owned Codex hook/bootstrap config is missing or not yet approved.
- ready `preflight` returns a Backend-internal launch plan.
- start launch plan uses `codex --no-alt-screen --dangerously-bypass-hook-trust` with Codex hook and Tide MCP config arguments.
- start and resume launch plans apply proven Codex Launch Options as provider-native flags.
- resume launch plan uses `codex resume --no-alt-screen <provider-native-session-ref>`.
- launch and resume plans set `TERM=xterm-256color` and `COLORTERM=truecolor`.
- launch and resume plans include a short pre-submit input timing window so Composer text and Enter are written separately.
- launch and resume plans include expected Provider Signal sources for PTY Transcript, Codex hooks, and Codex rollout history.
- Codex Prompt State bootstrap evidence recognizes `PermissionRequest` hook payloads as structured permission evidence.
- Codex Prompt State bootstrap does not classify arbitrary PTY text as a structured Prompt State.

Initial known reference:

- Existing v1 wrapper injects `mcp_servers.tide`, hook config, and overlay `CODEX_HOME`.
- Smoke found `codex --no-alt-screen` usable inside PTY and `codex resume` appending to rollout history.
- Fresh-state Codex showed sign-in choices, browser OAuth, post-login safety/autonomy notes, and Directory Trust before normal use.

### Claude

Must prove:

- executable detection for `claude`.
- interactive hidden PTY launch.
- resume using `--resume`, `--continue`, or session id semantics proven by smoke.
- hook/bootstrap path for running, notification, permission, elicitation, and stop signals.
- Tide MCP config through provider-supported config.
- Tide context guidance through `--append-system-prompt`, matching Codex's Tide skill bootstrap pattern.
- transcript JSONL reference discovery.
- terminal key protocol support for CSI-u Enter when required.
- authentication readiness detection for Claude account, Anthropic Console, and third-party platform paths.
- first-run theme/text-style onboarding detection.
- OAuth URL plus code-paste prompt handling.
- post-login security note handling.
- workspace trust readiness detection for the Execution Context.

Initial known reference:

- Existing v1 wrapper uses `--mcp-config`, `--settings`, hooks, and a Tide context prompt through `--append-system-prompt`.
- Smoke found CSI-u Enter submitted turns and provider transcript JSONL supported resume evidence.
- Fresh-state Claude showed theme selection, login method selection, browser OAuth with `Paste code here if prompted >`, security notes, workspace trust, and then the main TUI.

First implementation behavior:

- `preflight` returns `not_installed` when the Claude executable cannot be resolved.
- `preflight` returns `not_authenticated` when provider state says Claude auth is incomplete.
- `preflight` returns `onboarding_required` when theme/text-style, OAuth code paste, or security note setup is incomplete.
- `preflight` returns `directory_trust_required` when the selected Execution Context cwd is not trusted by provider-owned Claude state.
- `preflight` returns `hook_bootstrap_required` when Tide-owned Claude hook/bootstrap config is missing.
- ready `preflight` returns a Backend-internal launch plan.
- start launch plan uses `claude` with provider-supported `--settings`, `--mcp-config`, and `--append-system-prompt` arguments.
- start and resume launch plans apply proven Claude Launch Options as provider-native flags.
- resume launch plan uses `claude --resume <provider-native-session-ref>` with the same `--settings`, `--mcp-config`, and `--append-system-prompt` bootstrap arguments.
- launch and resume plans set `TERM=xterm-256color` and `COLORTERM=truecolor`.
- launch and resume plans include a startup input timing window and a short pre-submit input timing window so Composer text and CSI-u Enter are written after the Claude TUI is Composer-ready.
- launch and resume plans include expected Provider Signal sources for PTY Transcript, Claude hooks, Claude transcript JSONL, and Tide MCP.
- Claude capabilities mark `requiresTerminalKeyProtocol` true because CSI-u Enter is required for submitted turns in observed hidden PTY evidence.
- Claude permission Prompt State is created only from `PermissionRequest`.
- Claude question Prompt State is created only from `PreToolUse` where `tool_name` is `AskUserQuestion`.
- Claude MCP elicitation question Prompt State is created only from `Elicitation`.
- Claude `Notification` is recorded as attention Provider Signal only and does not create Prompt State.

### Antigravity

Must prove:

- executable detection for `agy`.
- interactive launch using `agy` by default; `--prompt-interactive` only when a scenario supplies an initial provider prompt.
- resume using `--conversation` or `--continue` semantics proven by smoke.
- hook/plugin bootstrap layout for installed Antigravity version.
- Tide MCP Tool Surface bootstrap through Antigravity `mcp_config.json`, not Gemini inline settings.
- readable transcript path or conversation id discovery.
- onboarding and Directory Trust readiness detection.
- terminal protocol handling for alternate screen, provider TUI input, arrow-key focus movement, checkbox toggles, and Enter confirmation.

Initial known reference:

- Smoke found hidden PTY launch, hook payloads with `conversationId` and `transcriptPath`, resume with `--conversation`, and onboarding/trust gates.
- User-approved hook research proved runtime `PreInvocation`, `PreToolUse`, `PostToolUse`, `PostInvocation`, and `Stop` payloads through a global plugin with root `hooks.json`; workspace plugin validation alone did not prove runtime loading.
- Model-driven command approval produced both structured `PreToolUse` evidence and AGY's native PTY `Bash(...)` permission prompt.
- Fresh-state onboarding showed color scheme selection, Terms of Service & Data Use checkbox plus Done action, and workspace trust; these screens require terminal navigation keys, not only text plus Enter.
- Existing v1 Gemini wrapper is only pattern evidence for MCP/hooks/context injection, not Antigravity proof.

First implementation behavior:

- `preflight` returns `not_installed` when the Antigravity executable cannot be resolved.
- `preflight` returns `not_authenticated` when provider state says Antigravity auth is incomplete.
- `preflight` returns `onboarding_required` when color scheme, Terms of Service & Data Use, or other first-run setup is incomplete.
- `preflight` returns `directory_trust_required` when the selected Execution Context cwd is not trusted by provider-owned Antigravity state.
- `preflight` returns `hook_bootstrap_required` when Tide-owned Antigravity plugin/bootstrap config is missing or not verified.
- ready `preflight` returns a Backend-internal launch plan.
- start launch plan uses `agy` with terminal env and no print/batch runtime flag.
- start and resume launch plans apply proven Antigravity Launch Options as provider-native flags.
- resume launch plan uses `agy --conversation <conversation-id>`.
- launch and resume plans set `TERM=xterm-256color` and `COLORTERM=truecolor`.
- launch and resume plans include startup and pre-submit input timing windows so auth/model readiness can settle before the first Composer submit.
- launch and resume plans include expected Provider Signal sources for PTY Transcript, Antigravity hooks, Antigravity readable transcript history, and Tide MCP.
- Antigravity capabilities mark `requiresTerminalKeyProtocol` true because observed setup and provider TUI screens require arrows, checkbox toggles, and provider-native focus movement.
- Antigravity permission Prompt State is created from `PreToolUse` hook payloads for `toolCall.name: "run_command"` using `toolCall.args.CommandLine`.
- Antigravity direct user shell-mode PTY input does not create structured Prompt State without Provider Signal evidence.
- Antigravity passive capture hooks must not emit stdout because local evidence showed stdout `{}` can deny the tool call.

## Flow

### UC-1: Preflight Codex before Thread start

1. Backend receives `thread.start`.
2. Backend asks Codex Agent Integration to preflight.
3. Codex Agent Integration checks executable, auth/setup, Directory Trust for the selected Execution Context, hook/bootstrap, and MCP support.
4. If ready, Backend proceeds to launch.
5. If blocked, Backend emits Provider Readiness and preserves pending user input.
6. Desktop shows a Provider Setup Surface action when the Agent Integration can provide one.
7. After user setup completes or the user retries, Backend re-runs preflight.

### UC-2: Build Codex hidden PTY launch plan

1. Codex Agent Integration builds provider-specific launch plan.
2. Backend Agent Runtime port starts hidden PTY with launch plan.
3. Codex Agent Integration attaches Provider Signal readers.
4. Codex Agent Integration discovers provider-owned Raw Agent Session reference.
5. Backend writes Composer input through terminal input semantics.

### UC-3: Build Codex Raw Agent Session resume plan

1. Backend resolves provider session reference from Thread metadata.
2. Codex Agent Integration builds provider-specific resume command.
3. Backend starts hidden PTY with resume command.
4. Provider output and Provider Signals are tied back to the same Thread.

### UC-4: Capture Codex prompt or permission signal

1. Codex emits hook payload, rollout record, or PTY-visible text.
2. Codex Agent Integration classifies it only when evidence matches a known signature.
3. Backend creates Prompt State.
4. User answer is routed through the same hidden PTY session unless a proven hook response path exists.

### UC-5: Preflight Antigravity before Thread start

1. Backend receives `thread.start`.
2. Backend asks Antigravity Agent Integration to preflight.
3. Antigravity Agent Integration checks executable, auth/setup, Directory Trust for the selected Execution Context, plugin hook/bootstrap, and MCP bootstrap.
4. If ready, Backend proceeds to launch.
5. If blocked, Backend emits Provider Readiness and preserves pending user input.
6. Desktop shows a Provider Setup Surface action when the Agent Integration can provide one.
7. After user setup completes or the user retries, Backend re-runs Provider Readiness.

### UC-6: Build Antigravity hidden PTY launch plan

1. Antigravity Agent Integration builds provider-specific launch plan.
2. Backend Agent Runtime port starts hidden PTY with `agy`.
3. Antigravity Agent Integration observes Provider Signals from the verified plugin.
4. Antigravity Agent Integration discovers provider-owned Raw Agent Session reference from hook payloads, readable transcript paths, provider logs, or conversation cache evidence.
5. Backend writes Composer input through terminal input semantics.

### UC-7: Build Antigravity Raw Agent Session resume plan

1. Backend resolves provider conversation reference from Thread metadata.
2. Antigravity Agent Integration builds provider-specific resume command.
3. Backend starts hidden PTY with `agy --conversation <conversation-id>`.
4. Provider output and Provider Signals are tied back to the same Thread.

### UC-8: Capture Antigravity permission signal

1. Antigravity emits `PreToolUse` hook payload for a model-driven `run_command` tool call.
2. Antigravity Agent Integration classifies it only when evidence matches the provider-owned payload shape.
3. Backend creates permission Prompt State.
4. User answer is routed through the same hidden PTY session because no separate AGY hook response path is proven for Tide.

## Invariants

1. Each supported Agent has a provider-specific Agent Integration.
2. Each Thread uses one hidden PTY runtime transport for its selected Agent.
3. Provider Signals do not become a second live runtime transport.
4. Provider Readiness is checked before writing user input to a real provider PTY.
5. Directory Trust is provider-owned state for an Execution Context.
6. Provider-owned history remains the Raw Agent Session source of truth.
7. Prompt State requires provider evidence; unknown output remains raw or text.
8. Antigravity support is based on `agy` evidence, not Gemini wrapper assumptions.
9. Claude Prompt State classification is single-source by event kind; `Notification` never creates Prompt State.
10. Claude launch and resume bootstrap includes provider-native Tide context guidance to match Codex's Tide skill bootstrap pattern.
11. Antigravity Tide MCP bootstrap uses Antigravity plugin/customization `mcp_config.json`, not Gemini inline settings.
12. Antigravity Prompt State classification uses AGY Provider Signal evidence; direct user shell-mode PTY text stays raw unless separately proven.
13. Launch Options become provider-native launch args only for flags proven by each selected Agent Integration.
14. Codex first input waits for Codex-specific startup timing before write/submit.

## Tests

| Rule | Test expectation |
|------|------------------|
| Codex missing executable blocks preflight | `codex_preflight_reports_not_installed_when_codex_executable_is_missing` resolves no command, returns `not_installed`, and returns no launch plan. |
| Codex auth blocks preflight | `codex_preflight_reports_not_authenticated_before_launch_plan` marks auth incomplete, returns `not_authenticated`, and does not expose command env internals as Desktop DTOs. |
| Codex Directory Trust is Execution Context scoped | `codex_directory_trust_is_checked_against_the_selected_execution_context` trusts cwd A, checks cwd B, and returns `directory_trust_required`. |
| Codex hook bootstrap blocks preflight | `codex_preflight_requires_hook_bootstrap_before_ready_launch` marks hook/bootstrap incomplete and returns `hook_bootstrap_required`. |
| Codex ready preflight builds start plan | `codex_ready_preflight_returns_hidden_pty_start_plan_with_hooks_mcp_and_terminal_env` returns `codex --no-alt-screen --dangerously-bypass-hook-trust`, hook config, Tide MCP config, `TERM=xterm-256color`, `COLORTERM=truecolor`, Codex startup/input timing, and expected signal sources. |
| Codex Launch Options become args | `codex_launch_plan_applies_provider_native_model_sandbox_and_approval_options` proves Codex model, sandbox, and approval Launch Options are included as provider-native flags. |
| Codex resume uses provider session ref | `codex_resume_plan_uses_provider_native_session_ref` builds `codex resume --no-alt-screen <session-id>` from `ProviderSessionRef`. |
| Codex launch plan stays internal | `backend_application_does_not_import_codex_adapter_or_shared_contracts` proves Backend application depends on the Agent Integration port, not the Codex adapter or Shared Contracts. |
| Codex Prompt State is evidence-gated | `codex_permission_prompt_detection_requires_permission_request_hook_payload` returns Prompt State for a Codex `PermissionRequest` hook payload and returns no Prompt State for unknown PTY text. |
| One runtime transport per Agent | `codex_launch_plan_does_not_use_exec_json_app_server_or_remote_runtime` fails if the Codex plan contains `exec`, `app-server`, `--remote`, or print/batch runtime flags. |
| Provider-specific adapter location | `provider_specific_agent_integrations_stay_under_backend_adapters` fails if Codex integration code appears in Desktop or Shared Contracts. |
| Claude missing executable blocks preflight | `claude_preflight_reports_not_installed_when_claude_executable_is_missing` resolves no command, returns `not_installed`, and returns no launch plan. |
| Claude readiness blockers are provider-owned | `claude_preflight_reports_auth_onboarding_directory_trust_and_hook_bootstrap_blockers` returns the exact blocker kinds from Claude provider state without inferring readiness from generic CLI text. |
| Claude ready preflight builds start plan | `claude_ready_preflight_returns_hidden_pty_start_plan_with_settings_mcp_context_and_terminal_env` returns `claude`, `--settings`, `--mcp-config`, `--append-system-prompt`, `TERM=xterm-256color`, `COLORTERM=truecolor`, input timing, and expected signal sources. |
| Claude Launch Options become args | `claude_launch_plan_applies_provider_native_model_and_permission_mode` proves Claude model and permission Launch Options are included as provider-native flags. |
| Claude resume uses provider session ref | `claude_resume_plan_uses_provider_native_session_ref` builds `claude --resume <session-id>` from `ProviderSessionRef`. |
| Claude launch plan keeps one runtime path | `claude_launch_plan_does_not_use_print_stream_json_or_remote_control_runtime` fails if the plan contains `--print`, stream-json runtime flags, or Remote Control flags. |
| Claude permission Prompt State is single-source | `claude_permission_prompt_detection_uses_permission_request_not_notification` returns Prompt State for `PermissionRequest` and returns null for `Notification` permission prompts. |
| Claude AskUserQuestion is PreToolUse only | `claude_question_prompt_detection_uses_pretooluse_ask_user_question` returns question Prompt State only for `PreToolUse` with `tool_name: "AskUserQuestion"`. |
| Claude Elicitation is its own Prompt State source | `claude_elicitation_prompt_detection_uses_elicitation_event` returns question Prompt State only for `Elicitation` payloads and does not treat `Notification` as elicitation fallback. |
| Antigravity missing executable blocks preflight | `antigravity_preflight_reports_not_installed_when_agy_executable_is_missing` resolves no command, returns `not_installed`, and returns no launch plan. |
| Antigravity readiness blockers are provider-owned | `antigravity_preflight_reports_auth_onboarding_directory_trust_and_plugin_bootstrap_blockers` returns the exact blocker kinds from Antigravity provider state without inferring readiness from Gemini wrapper behavior. |
| Antigravity ready preflight builds start plan | `antigravity_ready_preflight_returns_hidden_pty_start_plan_with_plugin_mcp_hooks_and_terminal_env` returns `agy`, `TERM=xterm-256color`, `COLORTERM=truecolor`, startup/pre-submit input timing, and expected signal sources including Tide MCP. |
| Antigravity Launch Options become args | `antigravity_launch_plan_applies_provider_native_permission_flags` proves Antigravity sandbox Launch Options are included as provider-native flags and unsupported model values are not fabricated. |
| Antigravity resume uses provider conversation ref | `antigravity_resume_plan_uses_provider_native_conversation_ref` builds `agy --conversation <conversation-id>` from `ProviderSessionRef`. |
| Antigravity launch plan keeps one runtime path | `antigravity_launch_plan_does_not_use_print_prompt_interactive_or_gemini_runtime` fails if the plan contains `--print`, `--prompt`, `--prompt-interactive`, Gemini commands, app-server, or stream-json runtime flags. |
| Antigravity MCP bootstrap is plugin-owned | `antigravity_launch_plan_does_not_use_gemini_settings_for_mcp` proves the launch plan does not use `GEMINI_CLI_SYSTEM_DEFAULTS_PATH`, Gemini `settings.json`, or Gemini wrapper paths. |
| Antigravity permission Prompt State is evidence-gated | `antigravity_permission_prompt_detection_uses_pretooluse_run_command_payload` returns Prompt State for AGY `PreToolUse` `run_command` payload and returns null for raw PTY prompt text. |
| Antigravity provider-specific adapter location | `antigravity_provider_specific_agent_integration_stays_under_backend_adapters` fails if Antigravity integration code appears in Desktop or Shared Contracts. |

## Implementation Notes

- Start with the Codex Agent Integration adapter and fake dependency readers. Do not run real Codex in unit tests.
- Add real provider smoke only after fake lifecycle and adapter tests pass.
- Keep provider-specific launch and parser logic inside Agent Integration adapters.
- Keep Provider Readiness blockers structured and visible.
- Keep hook response paths as open provider facts until individually proven.
- Do not use Codex `exec --json`, Claude print-mode JSON, Claude Remote Control, or Antigravity print mode as live runtime transports in this spec.
- Do not copy the Gemini wrapper into Antigravity. Use AGY plugin/customization evidence for MCP and hooks.
