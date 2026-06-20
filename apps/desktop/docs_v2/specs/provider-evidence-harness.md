# Spec: Provider Evidence Harness

## Scope

This spec defines a repeatable local harness for collecting evidence from provider
CLIs before implementing or changing provider-specific Agent Integrations. Current
active providers are codex, claude, gemini, and opencode; Antigravity notes in older
research are historical.

It covers:

- hidden PTY launch evidence.
- terminal input evidence.
- Provider Readiness screen capture evidence.
- provider-owned Raw Agent Session reference discovery evidence.
- provider-native resume evidence.
- provider hook signal evidence for prompt and permission research.
- Provider Signal fixture capture points.
- bounded output and filesystem evidence.

It does not implement Tide Backend, Desktop UI, Provider Setup Surface UI, real Agent Integration adapters, or production Provider Signal parsing.

## Evidence

- `docs_v2/specs/provider-integration-bootstrap.md` requires provider-specific Agent Integrations and evidence-gated prompt, permission, readiness, launch, resume, and history behavior.
- `docs_v2/research/agent-hidden-pty-provider-signal-smoke.md` records that all supported providers run through hidden PTY, but remaining open research includes Provider transcript identity automation, Provider readiness preflight, permission prompt grammar, hook response paths, alternate screen behavior, and resume semantics.
- `docs_v2/master-plan.md` records hidden PTY as the Agent Runtime path and treats Provider Signals as evidence tied to that PTY, not as a second live runtime transport.
- Current repo scripts live under `scripts/`, and `python3` is available locally.

## Decisions

### D1. Harness is research infrastructure

The harness produces bounded local evidence fixtures.

It is not a runtime path, product feature, fallback path, or provider adapter.

### D2. PTY is the only execution mode

The harness runs provider CLIs inside a PTY.

It does not use provider batch APIs as live evidence for the v2 runtime path unless
the active provider integration explicitly uses that structured protocol.

### D3. Evidence is raw first

The harness records raw PTY Transcript, plain-text transcript, process metadata, configured command, state snapshots, and state diffs.

It does not classify prompt or permission events as structured Prompt State. Classification belongs to later provider-specific integration tests after evidence is captured.

For a permission evidence run, the harness may temporarily inject provider hooks whose only job is to append raw hook stdin payloads to the run directory. This is evidence capture, not production Prompt State classification.

### D4. Provider state scanning is bounded

The harness only scans configured provider state roots with explicit file and directory caps.

Large provider directories produce bounded manifests and warnings instead of unbounded dumps.

### D5. Setup evidence stays user-owned

When the harness reaches authentication, onboarding, legal/data consent, or Directory Trust, it captures bounded transcript evidence.

It does not auto-accept provider setup choices.

## Out Of Scope

- Automated login.
- Automated legal/data consent.
- Automated Directory Trust acceptance.
- Production Provider Signal installation.
- MCP server launch.
- Production history parser.
- Production readiness classifier.
- Electron or Backend process integration.

## Domain Model

### Provider Evidence Run

A Provider Evidence Run is one bounded harness execution.

Fields:

- run id.
- Agent.
- scenario.
- command.
- cwd.
- environment overrides.
- timestamps.
- PTY Transcript path.
- plain transcript path.
- state snapshot paths.
- state diff path.
- warnings.

### Evidence Scenario

Initial scenarios:

| Scenario | Purpose |
|----------|---------|
| `observe` | Start provider and capture startup/readiness screen output without sending a prompt. |
| `message` | Start provider, send Composer-like text, submit with the provider's configured terminal key, and capture resulting output. |
| `manual` | Start provider and keep the PTY open for a bounded period so the user can operate setup in the visible terminal running the harness. |
| `resume` | Start provider with a provider-native Raw Agent Session reference, send follow-up text, and capture whether the same provider-local session continues. |
| `permission` | Start provider with temporary hook signal capture, send a benign prompt that should request command approval, and capture PTY plus raw hook payload evidence. |

### Provider State Root

A Provider State Root is a provider-owned directory or file family inspected before and after the run.

Initial roots:

| Agent | Roots |
|-------|-------|
| Codex | `~/.codex/sessions`, `~/.codex/config.toml`, `~/.codex/history.jsonl` |
| Claude | `~/.claude/projects`, `~/.claude.json` |
| Gemini | `~/.gemini` |
| opencode | `~/.local/share/opencode` |

## Contracts

Harness command:

```text
python3 scripts/provider-evidence-harness.py --agent <codex|claude|gemini|opencode> --scenario <observe|message|manual|resume|permission>
```

Key options:

```text
--cwd <path>
--prompt <text>
--resume-ref <provider-native-ref>
--submit <enter|csi-u-enter|none>
--startup-wait <seconds>
--pre-submit-wait <seconds>
--after-submit-wait <seconds>
--key <enter|csi-u-enter|esc|up|down|left|right|tab|space|ctrl-c|text:<value>|hex:<bytes>>
--timeout <seconds>
--output-root <path>
--cols <number>
--rows <number>
--codex-temp-home
--dry-run
```

Output folder:

```text
<output-root>/<timestamp>-<agent>-<scenario>/
  manifest.json
  pty-transcript.ansi
  pty-transcript.txt
  state-before.json
  state-after.json
  state-diff.json
  signals/provider-signals.jsonl
  signals/capture-provider-signal.py
```

## Flow

### UC-1: Observe Provider Readiness

1. User runs harness with `--scenario observe`.
2. Harness snapshots provider state roots.
3. Harness starts provider CLI inside PTY.
4. Harness captures bounded PTY output.
5. Harness stops the provider process after timeout.
6. Harness snapshots provider state roots again.
7. Harness writes manifest, transcripts, and state diff.

### UC-2: Capture Composer-like message evidence

1. User runs harness with `--scenario message --prompt <text>`.
2. Harness starts provider CLI inside PTY.
3. Harness writes prompt text to PTY.
4. Harness submits using provider-specific terminal key semantics.
5. Harness captures bounded PTY output and state changes.
6. Harness writes evidence artifacts.

### UC-3: Manual setup capture

1. User runs harness with `--scenario manual`.
2. Harness starts provider CLI inside PTY.
3. Harness forwards local terminal input for a bounded period.
4. User completes provider-owned setup choices directly.
5. Harness records transcript and state diff.

### UC-4: Capture provider-native resume evidence

1. User runs harness with `--scenario resume --resume-ref <provider-native-ref> --prompt <text>`.
2. Harness starts the provider CLI with the provider-native resume command.
3. Harness writes prompt text to the resumed PTY session.
4. Harness submits using provider-specific terminal key semantics.
5. Harness captures bounded PTY output and provider state changes.
6. Harness writes evidence artifacts.

### UC-5: Capture provider permission signal evidence

1. User runs harness with `--scenario permission`.
2. Harness creates a run-local signal capture script and provider hook configuration.
3. Harness starts the provider CLI through hidden PTY with the run-local hook configuration.
4. Harness delivers a benign prompt intended to trigger a command permission request through the provider-specific supported path.
5. Provider hook payloads are appended to `signals/provider-signals.jsonl`.
6. Harness captures bounded PTY output, provider state changes, and signal artifacts.

## Invariants

1. Harness executions use PTY transport only.
2. The harness never auto-accepts provider setup choices.
3. The harness writes bounded artifacts to one run directory.
4. Raw provider output remains raw evidence.
5. Provider state snapshots include path, size, and modification time only.
6. Missing providers are recorded as evidence failures, not hidden by alternate runtime paths.
7. The harness does not modify repo source files during evidence runs.
8. Permission evidence hooks write only into the run directory unless the provider requires explicit user-approved plugin installation for a separate research run.
9. Permission evidence does not auto-approve provider prompts.

## Tests

| Rule | Test expectation |
|------|------------------|
| CLI parses required options | `--help` exits successfully. |
| Dry run is non-invasive | `--dry-run` prints the resolved plan without launching a provider. |
| Fake PTY captures transcript | Custom command mode captures PTY output and writes manifest/transcripts. |
| State diff is bounded | State snapshot respects configured file and directory caps. |
| Missing provider is explicit | Unknown or missing provider command returns a non-zero result with a clear message. |
| Resume requires reference | `--scenario resume` without `--resume-ref` exits with a clear message. |
| Permission capture is scoped | `--scenario permission --dry-run` resolves the provider command without launching a provider or writing artifacts. |
| Unsupported permission providers are explicit | Permission capture for a provider without evidence-backed hook setup exits with a clear message. |

## Implementation Notes

- Implement the harness as `scripts/provider-evidence-harness.py` using Python stdlib PTY support.
- Default output root is `/private/tmp/tide-provider-evidence`.
- Keep provider defaults small and overridable.
- Keep Codex roots narrowed to session, trust config, and prompt history files. Scanning the full `~/.codex` tree can hit the bounded directory cap before new rollout files are observed.
- Set `TERM=xterm-256color` and `COLORTERM=truecolor` explicitly to match previous smoke conditions. Caller environments such as `TERM=dumb` must not leak into provider TUI evidence unless explicitly overridden with `--env`.
- Set PTY window size explicitly; provider TUIs may not render useful readiness output when the PTY has no row/column size.
- Use provider-specific submit key sequences captured from evidence.
- Resume commands are provider-native; keep each provider's command in its adapter
  evidence rather than assuming one shared syntax.
- The generic permission scenario currently automates Codex and Claude Code.
- Codex permission capture writes run-local capture hooks, passes them through inline `-c hooks.UserPromptSubmit=...`, `-c hooks.PermissionRequest=...`, and `-c hooks.Stop=...`, enables `features.hooks=true`, configures `PermissionRequest` with `matcher: Bash`, and launches Codex with `--dangerously-bypass-hook-trust --ask-for-approval untrusted`.
- Codex permission capture can use `--codex-temp-home` to copy only `auth.json` and `config.toml` into a temporary `CODEX_HOME`. This allows hook-trust research without persisting test hook trust into the user's real provider home.
- Codex permission capture passes the permission prompt as the CLI initial prompt argument rather than typing it into the Composer over PTY. PTY typing remains the evidence path for normal `message` and `resume` scenarios.
- Claude permission capture writes a run-local `settings.json`, passes it with `claude --settings <path>`, and configures `UserPromptSubmit`, `PermissionRequest`, `Notification`, and `Stop` hooks.
- Allow a short pre-submit wait after writing prompt text so provider TUIs can settle their Composer state before the submit key is sent.
- Respond to terminal capability queries such as cursor position, primary device attributes, color queries, and keyboard protocol queries. These are terminal-emulator responses, not provider setup answers.
- During process cleanup, prefer process-group signaling but fall back to signaling the child process directly when the host denies `killpg`.
- Use custom command mode for local validation without launching real providers.
