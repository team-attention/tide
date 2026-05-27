# Spec: Provider Integration Bootstrap

## Scope

This spec defines the first provider bootstrap contract and the first concrete Agent Integration implementation path.

The first implementation provider is Codex CLI. Claude Code and Antigravity CLI remain supported design targets, but their concrete adapters stay out of this slice.

It covers:

- Agent Integration responsibilities.
- hidden PTY as the single runtime transport.
- Codex launch/resume bootstrap evidence gates.
- Provider Readiness preflight.
- Directory Trust and onboarding handling.
- hook/bootstrap setup.
- Tide MCP Tool Surface attachment.
- provider-owned Raw Agent Session reference discovery.
- prompt and permission signal collection.

It does not implement Claude or Antigravity adapters, full Agent Session readers, Workbench tool contracts, Desktop UI, persistence storage, a real PTY process adapter, or provider smoke execution.

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

### D9. First implementation provider is Codex CLI

This slice implements a Codex Agent Integration adapter only.

The adapter builds Backend-internal Codex launch and resume plans, reports Provider Readiness blockers, exposes Codex capabilities, and keeps Tide MCP Tool Surface and hook/bootstrap configuration in the provider-specific adapter layer.

Claude Code and Antigravity CLI must not be hidden behind the Codex adapter or genericized from Codex behavior.

## Out Of Scope

- Full provider parser implementation.
- Complete tool call and tool result block grammar.
- Workbench MCP tool names and authorization.
- Electron process spawn implementation.
- Persistence schema.
- UI setup screens.
- Claude Code or Antigravity CLI adapter implementation.
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
  expectedSignalSources: ProviderSignalSource[];
}
```

The launch plan is Backend-internal. It does not cross to Desktop as a user-facing Contract DTO.

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
- start launch plan uses `codex --no-alt-screen` with Codex hook and Tide MCP config arguments.
- resume launch plan uses `codex resume --no-alt-screen <provider-native-session-ref>`.
- launch and resume plans set `TERM=xterm-256color` and `COLORTERM=truecolor`.
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
- transcript JSONL reference discovery.
- terminal key protocol support for CSI-u Enter when required.
- authentication readiness detection for Claude account, Anthropic Console, and third-party platform paths.
- first-run theme/text-style onboarding detection.
- OAuth URL plus code-paste prompt handling.
- post-login security note handling.
- workspace trust readiness detection for the Execution Context.

Initial known reference:

- Existing v1 wrapper uses `--mcp-config`, `--settings`, hooks, and a Tide context prompt.
- Smoke found CSI-u Enter submitted turns and provider transcript JSONL supported resume evidence.
- Fresh-state Claude showed theme selection, login method selection, browser OAuth with `Paste code here if prompted >`, security notes, workspace trust, and then the main TUI.

### Antigravity

Must prove:

- executable detection for `agy`.
- interactive launch using `--prompt-interactive` when needed.
- resume using `--conversation` or `--continue` semantics proven by smoke.
- hook/plugin bootstrap layout for installed Antigravity version.
- readable transcript path or conversation id discovery.
- onboarding and Directory Trust readiness detection.
- terminal protocol handling for alternate screen, provider TUI input, arrow-key focus movement, checkbox toggles, and Enter confirmation.

Initial known reference:

- Smoke found hidden PTY launch, hook payloads with `conversationId` and `transcriptPath`, resume with `--conversation`, and onboarding/trust gates.
- User-approved hook research proved runtime `PreInvocation`, `PreToolUse`, `PostToolUse`, `PostInvocation`, and `Stop` payloads through a global plugin with root `hooks.json`; workspace plugin validation alone did not prove runtime loading.
- Model-driven command approval produced both structured `PreToolUse` evidence and AGY's native PTY `Bash(...)` permission prompt.
- Fresh-state onboarding showed color scheme selection, Terms of Service & Data Use checkbox plus Done action, and workspace trust; these screens require terminal navigation keys, not only text plus Enter.
- Existing v1 Gemini wrapper is only pattern evidence for MCP/hooks/context injection, not Antigravity proof.

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

## Invariants

1. Each supported Agent has a provider-specific Agent Integration.
2. Each Thread uses one hidden PTY runtime transport for its selected Agent.
3. Provider Signals do not become a second live runtime transport.
4. Provider Readiness is checked before writing user input to a real provider PTY.
5. Directory Trust is provider-owned state for an Execution Context.
6. Provider-owned history remains the Raw Agent Session source of truth.
7. Prompt State requires provider evidence; unknown output remains raw or text.
8. Antigravity support is based on `agy` evidence, not Gemini wrapper assumptions.

## Tests

| Rule | Test expectation |
|------|------------------|
| Codex missing executable blocks preflight | `codex_preflight_reports_not_installed_when_codex_executable_is_missing` resolves no command, returns `not_installed`, and returns no launch plan. |
| Codex auth blocks preflight | `codex_preflight_reports_not_authenticated_before_launch_plan` marks auth incomplete, returns `not_authenticated`, and does not expose command env internals as Desktop DTOs. |
| Codex Directory Trust is Execution Context scoped | `codex_directory_trust_is_checked_against_the_selected_execution_context` trusts cwd A, checks cwd B, and returns `directory_trust_required`. |
| Codex hook bootstrap blocks preflight | `codex_preflight_requires_hook_bootstrap_before_ready_launch` marks hook/bootstrap incomplete and returns `hook_bootstrap_required`. |
| Codex ready preflight builds start plan | `codex_ready_preflight_returns_hidden_pty_start_plan_with_hooks_mcp_and_terminal_env` returns `codex --no-alt-screen`, hook config, Tide MCP config, `TERM=xterm-256color`, `COLORTERM=truecolor`, and expected signal sources. |
| Codex resume uses provider session ref | `codex_resume_plan_uses_provider_native_session_ref` builds `codex resume --no-alt-screen <session-id>` from `ProviderSessionRef`. |
| Codex launch plan stays internal | `backend_application_does_not_import_codex_adapter_or_shared_contracts` proves Backend application depends on the Agent Integration port, not the Codex adapter or Shared Contracts. |
| Codex Prompt State is evidence-gated | `codex_permission_prompt_detection_requires_permission_request_hook_payload` returns Prompt State for a Codex `PermissionRequest` hook payload and returns no Prompt State for unknown PTY text. |
| One runtime transport per Agent | `codex_launch_plan_does_not_use_exec_json_app_server_or_remote_runtime` fails if the Codex plan contains `exec`, `app-server`, `--remote`, or print/batch runtime flags. |
| Provider-specific adapter location | `provider_specific_agent_integrations_stay_under_backend_adapters` fails if Codex integration code appears in Desktop or Shared Contracts. |

## Implementation Notes

- Start with the Codex Agent Integration adapter and fake dependency readers. Do not run real Codex in unit tests.
- Add real provider smoke only after fake lifecycle and adapter tests pass.
- Keep provider-specific launch and parser logic inside Agent Integration adapters.
- Keep Provider Readiness blockers structured and visible.
- Keep hook response paths as open provider facts until individually proven.
- Do not use Codex `exec --json`, Claude print-mode JSON, Claude Remote Control, or Antigravity print mode as live runtime transports in this spec.
