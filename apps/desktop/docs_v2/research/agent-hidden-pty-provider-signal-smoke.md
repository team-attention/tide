# Research: Hidden PTY Provider Signal Smoke

## Purpose

This document defines the evidence gate for Agent Integrations in Tide v2.

The product decision is:

```text
Every supported Agent Integration runs the provider's normal interactive CLI in one hidden PTY.
Provider Signals observe and enrich that PTY-backed session.
Provider Signals do not become a second live runtime transport for the same Agent.
```

## Evidence Already Found

### Tide v1 reference points

Existing Tide v1 code has useful mechanics to reuse:

| Area | Evidence | v2 relevance |
| --- | --- | --- |
| PTY creation | `crates/tide-app/src/domain/terminal/mod.rs` creates the PTY, sets Tide env vars, starts the event loop, and routes input through `Event::PtyWrite`. | Hidden Agent Runtime can reuse the same PTY substrate without showing a default Terminal Pane. |
| Terminal factory | `crates/tide-app/src/application/ports/outward/terminal_factory_port/mod.rs` and `crates/tide-app/src/adapter/outward/terminal_factory_adapter/mod.rs` isolate terminal creation behind an outward port. | v2 should introduce hidden Agent Runtime creation through a port boundary instead of coupling it to visible Pane creation. |
| Wrapper hooks | `crates/tide-app/resources/bin/codex`, `crates/tide-app/resources/bin/claude`, and `crates/tide-app/resources/bin/gemini` inject provider hook config around direct CLI launches. | The wrapper pattern is the right source for Provider Signal collection. |
| Notify bridge | `crates/tide-app/src/adapter/inward/cli_adapter/notify.rs` sends fire-and-forget `tide notify` JSON-RPC events to the owning Tide instance. | v2 can keep a small local bridge for Provider Signals tied to one Agent Runtime. |
| Status normalizer | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` maps `agent-running`, `agent-idle`, `agent-needs-input`, and `codex-stop` into `AgentStatus`. | v2 needs the same idea, but scoped to Thread attention and Agent Session rendering instead of visible Terminal Pane chrome. |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/agent_gateway.rs` checks direct Codex CLI launch, hook injection, permission request snippets, and Codex stop handling. | These tests identify the existing regression boundaries that v2 should preserve or replace with Thread-level tests. |

### Provider facts already checked locally

| Agent | Local evidence | Decision impact |
| --- | --- | --- |
| Codex CLI | `codex --help` shows interactive CLI mode, `codex resume`, `codex exec --json`, `codex app-server`, `--remote`, and `--no-alt-screen`. Existing Tide wrapper omits app-server and launches direct CLI with Codex hooks. Local Codex sessions exist as JSONL rollout files under `~/.codex/sessions/...`. | Runtime transport is hidden PTY. Codex hooks and rollout JSONL are Provider Signals. `exec --json` and app-server are fixture or research inputs only. |
| Claude Code | `claude --help` shows interactive default mode, print-mode JSON options, session flags, and permission flags. Local Claude transcripts exist under `~/.claude/projects/.../*.jsonl`. Claude Remote Control help requires a Claude-owned remote surface login. | Runtime transport is hidden PTY. Hooks and JSONL transcripts are Provider Signals. Print-mode JSON and Remote Control are not the v2 runtime path. |
| Antigravity CLI | `agy --help` shows `--prompt-interactive`, `--continue`, `--conversation`, `--print`, `--log-file`, and sandbox flags. Local Antigravity state includes a cwd-to-conversation cache and `.pb` conversation records under `~/.gemini/antigravity-cli/...`. | Runtime transport is hidden PTY. Hooks, log files, conversation refs, and transcript paths are Provider Signals. |

## Provider History Ownership

Raw Agent Session history stays provider-local and provider-owned.

Tide stores only:

| Tide-owned record | Purpose |
| --- | --- |
| Thread id | User-facing identity for opening, pinning, archiving, and searching. |
| Agent id | Which Agent Integration owns the Thread. |
| Project or Scratch scope | Where the Thread belongs in Tide's UI model. |
| Provider session reference | Provider-native session id, conversation id, transcript path, rollout path, or resume identity. |
| Render cache metadata | Optional cache invalidation and fast-open metadata for Agent Session rendering. |

Tide does not make a Tide-owned conversation-history cache the source of truth.

## Smoke Matrix

Each Agent Integration must pass the same core smoke, then prove its own Provider Signal coverage.

### Core Hidden PTY Smoke

| Gate | Pass condition |
| --- | --- |
| Launch | Tide can start the provider's normal interactive CLI inside a hidden PTY. |
| Input | Composer text can be written to that PTY as the user's message. |
| Output | PTY Transcript captures provider output without exposing a default Terminal Pane. |
| Attention | A provider wait state can be surfaced in Agent Chat or Composer without changing the runtime transport. |
| Answer | The user's response to an approval, question, command picker, or model picker is sent through the same hidden PTY session unless the provider hook explicitly defines a response path tied to that same session. |
| Stop | Tide can detect when the turn is idle or complete. |
| Resume | Tide can reopen a Thread using the provider-local Raw Agent Session reference. |
| Terminal protocol | Tide can satisfy the provider TUI's terminal negotiation, including `TERM`, alternate screen, bracketed paste, and CSI-u key sequences when requested. |

### Codex Smoke

| Signal | Required evidence |
| --- | --- |
| PTY launch | Interactive `codex` starts inside a PTY, preferably with `--no-alt-screen` for capture stability if the CLI supports it. |
| User message | Sending a prompt through PTY produces a visible PTY Transcript and a provider-local session update. |
| Running | `UserPromptSubmit` hook or equivalent Provider Signal marks the Thread running. |
| Needs input | `PermissionRequest` hook payload is captured with a usable snippet. |
| Stop | `Stop` hook payload is captured, including any available transcript or session reference. |
| History | New or updated rollout JSONL under `~/.codex/sessions/...` can be mapped to the Thread's provider session reference. |
| Resume | `codex resume <ref>` or equivalent provider-native resume path can continue the Raw Agent Session through hidden PTY. |

### Claude Code Smoke

| Signal | Required evidence |
| --- | --- |
| PTY launch | Interactive `claude` starts inside a PTY. |
| User message | Sending a prompt through PTY produces a visible PTY Transcript and a provider-local transcript update. |
| Running | `UserPromptSubmit` hook or equivalent Provider Signal marks the Thread running. |
| Needs input | `Notification`, `PermissionRequest`, or `Elicitation` hook payload can be mapped to an app-level prompt. |
| Stop | `Stop` hook payload is captured with `session_id` and `transcript_path` when present. |
| History | `~/.claude/projects/<project>/<session-id>.jsonl` remains the Raw Agent Session source. |
| Resume | `claude --resume`, `--continue`, or `--session-id` can continue the Raw Agent Session through hidden PTY. |

### Antigravity CLI Smoke

| Signal | Required evidence |
| --- | --- |
| PTY launch | Interactive `agy` starts inside a PTY, using `--prompt-interactive` when needed. |
| User message | Sending a prompt through PTY produces a visible PTY Transcript and provider-local conversation update. |
| Running | `PreInvocation`, `PreToolUse`, or equivalent Provider Signal can mark the Thread running. |
| Needs input | Any hook or PTY-visible prompt for approval/question input can be mapped to Agent Chat or Composer. |
| Stop | `Stop` hook payload with `fullyIdle` can mark the Thread idle. |
| History | Provider conversation id, transcript path, log path, or `.pb` record remains the Raw Agent Session source. |
| Resume | `agy --continue` or `agy --conversation <id>` can continue the Raw Agent Session through hidden PTY. |

## Local Smoke: 2026-05-26

Harness:

- Used `/usr/bin/expect` to spawn provider CLIs inside a PTY.
- Used `/private/tmp/tide_agent_pty_smoke.py` for timed PTY writes and bounded PTY capture when `expect` was too coarse.
- Set `TERM=xterm-256color` and `COLORTERM=truecolor` for realistic interactive TUI behavior.
- Wrote bounded PTY capture logs under `/private/tmp`.
- Used minimal exact-response prompts such as `PONG`, `CODEXCR`, `CODEXCSIU`, `AGYGLOBALHOOK`, and `AGYGLOBALPTY`.

### Results

| Agent | Result | Evidence | Follow-up |
| --- | --- | --- | --- |
| Codex CLI | Pass for core hidden PTY launch, input, submit, output, provider-local history, and resume. | `codex --no-alt-screen` inside a PTY produced a visible `PONG` answer and rollout JSONL at `~/.codex/sessions/2026/05/26/rollout-2026-05-26T22-14-02-019e646b-b9d7-70d1-b1f9-27c33a699b07.jsonl`. Composer-like PTY writes also worked: plain CR submitted `CODEXCR`, and CSI-u Enter submitted `CODEXCSIU`. Resume smoke used session id `019e6488-0abc-77b1-854d-4d9aa3abc489`; `codex resume --no-alt-screen 019e6488-0abc-77b1-854d-4d9aa3abc489` appended `CODEXRESUMEFOLLOWUP` to the same rollout file that already contained `CODEXRESUMEBASE`. | Verify Codex `PermissionRequest` hook payload shape. Top-level `codex` rejected `--skip-git-repo-check`, so v2 launch args must be checked against top-level interactive help. |
| Claude Code | Pass for launch, input, submit, output, stop, provider-local history, and resume. Plain CR inserted text but did not submit. CSI-u Enter submitted the turn. | PTY output contained the assistant answer `PONG` after sending `ESC[13u`. Claude wrote provider transcript `~/.claude/projects/-Users-you-Workspace-tide/90aab38b-d634-448f-943b-34a8b9cf904f.jsonl` with user, assistant, `stop_hook_summary`, `turn_duration`, and `last-prompt` records. Resume smoke used `claude --resume 47196818-e477-4634-9021-2947d0feb12c`; the same transcript file then contained `CLAUDERESUMEBASE` and `CLAUDERESUMEFOLLOWUP` with the same `sessionId`. | Hidden PTY input must support the key protocol requested by the TUI, not only raw `\r`. Verify permission, notification, and elicitation payloads. |
| Antigravity CLI | Pass for hidden PTY launch, input forwarding, provider-local history, Provider Signal identity, resume identity, and hidden PTY follow-up after setup/trust. | `agy --prompt-interactive` inside a PTY negotiated alternate screen, authenticated, created conversations, forwarded the user message, and completed model streams. With a temporary global hook plugin, the hidden PTY run produced hook payloads with `conversationId` `c5066b65-57d4-4d39-a8f3-fe4d2bebf303`, `transcriptPath` `~/.gemini/antigravity-cli/brain/c5066b65-57d4-4d39-a8f3-fe4d2bebf303/.system_generated/logs/transcript.jsonl`, `artifactDirectoryPath`, and `Stop` `fullyIdle: true`. Resume smoke used conversation id `8567e05f-e999-4334-b427-c24bae6fb6f8`; `agy --conversation 8567e05f-e999-4334-b427-c24bae6fb6f8 --print ...` appended `AGYRESUMEFOLLOWUP` to the same transcript. After first-run onboarding and workspace trust were completed, hidden PTY `agy --conversation ...` accepted Composer-like input; provider log recorded `HandleUserInput` and the same transcript appended `AGYRESUMEPTY3` as `USER_INPUT` and `MODEL` `PLANNER_RESPONSE`. | Add preflight handling for first-run onboarding and workspace trust before starting a real Thread. Verify `PreToolUse`/`PostToolUse` and approval/question prompt payloads. |

### Fresh-State Readiness: 2026-05-27

User-observed fresh-state launches after backing up provider state showed that all three providers have setup or trust gates before normal Composer input.

#### Codex

- Fresh launch showed sign-in choices: ChatGPT account, device code, or API key.
- ChatGPT sign-in opened browser OAuth, then returned to a signed-in state.
- After sign-in, Codex showed safety/autonomy notes before continuing.
- Codex then showed a Directory Trust prompt for the current cwd, asking whether the user trusts the directory contents because trusting allows project-local config, hooks, and exec policies to load.
- Directory Trust choices were `Yes, continue` and `No, quit`.

#### Claude Code

- Fresh launch showed text style/theme selection before login.
- Claude then showed login method selection: Claude subscription account, Anthropic Console account, or third-party platform.
- When browser open did not complete automatically, Claude printed an OAuth URL and prompted: `Paste code here if prompted >`.
- After login, Claude showed security notes and required Enter to continue.
- Claude then showed a workspace trust prompt for `/Users/you/Workspace/test-claude`, explaining that Claude Code can read, edit, and execute files there.
- Workspace trust choices were `Yes, I trust this folder` and `No, exit`; Enter confirmed the selected choice and Esc canceled.
- After trust, Claude opened the main TUI with account/model context and Composer.

#### Antigravity CLI

- Fresh launch showed not signed in, then signing in.
- After auth, Antigravity showed color scheme selection.
- It then showed Terms of Service & Data Use with a checkbox and separate Done action.
- The user observed that the terms checkbox and Done action require arrow-key focus movement; this is not a simple Enter-only prompt.
- Antigravity then showed workspace trust for the current project, with `Yes, I trust this folder` and `No, exit`.

### Harness Observe: 2026-05-27

The first `provider-evidence-harness.py` observe runs produced these bounded artifacts:

| Agent | Evidence path | Result | Interpretation |
| --- | --- | --- | --- |
| Codex | `/private/tmp/tide-provider-evidence/20260527-152119-codex-observe` | PTY transcript contained terminal capability queries and no text output; provider state diff was empty. | The harness needed terminal-emulator query responses before Codex readiness output could be observed. |
| Claude Code | `/private/tmp/tide-provider-evidence/20260527-152153-claude-observe` | PTY transcript showed a workspace trust prompt for `/Users/you/Workspace/tide`; provider state diff was empty. | Claude Directory Trust is an Execution Context-scoped Provider Readiness blocker and is observable through PTY. |
| Antigravity CLI | `/private/tmp/tide-provider-evidence/20260527-152235-agy-observe` | PTY transcript showed `flag needs an argument: -prompt-interactive`; provider state diff was empty. | Harness default command was wrong for observe mode. Antigravity should launch as `agy` unless a prompt-interactive scenario supplies a prompt argument. |

Harness fixes after these runs:

- Respond to terminal capability queries such as cursor position, primary device attributes, color queries, and keyboard protocol queries.
- Launch Antigravity as `agy` by default.

Follow-up observe runs after those fixes:

| Agent | Evidence path | Result | Interpretation |
| --- | --- | --- | --- |
| Codex | `/private/tmp/tide-provider-evidence/20260527-153057-codex-observe` | PTY transcript still contained terminal capability negotiation only; provider state diff was empty. | Harness also needs an explicit PTY window size before Codex readiness output can be treated as observed. |
| Antigravity CLI | `/private/tmp/tide-provider-evidence/20260527-153119-agy-observe` | PTY transcript had no text, but provider state diff added a CLI log and modified `cli.log` plus `last_check.timestamp`. The CLI log recorded startup, project discovery for `/Users/you/Workspace/tide`, authentication through keyring, selected model propagation, and CLI ready before harness shutdown. | Antigravity observe can produce useful Provider Readiness evidence through Provider Signals/logs even when the PTY transcript is visually empty. |

Additional harness fix:

- Set PTY window size explicitly. Provider TUIs may not render useful readiness output when a bare PTY has no row/column size.

Final Codex observe after setting PTY window size:

| Agent | Evidence path | Result | Interpretation |
| --- | --- | --- | --- |
| Codex | `/private/tmp/tide-provider-evidence/20260527-154004-codex-observe` | PTY transcript showed a Directory Trust prompt for `/Users/you/Workspace/tide`; provider state diff was empty. | Codex Directory Trust is an Execution Context-scoped Provider Readiness blocker and is observable through PTY when the harness supplies terminal query responses and PTY window size. |

Manual Directory Trust completion runs:

| Agent | Evidence path | Result | Interpretation |
| --- | --- | --- | --- |
| Codex | `/private/tmp/tide-provider-evidence/20260527-154303-codex-manual` | User accepted Directory Trust and Codex reached the main TUI for `~/Workspace/tide`; provider session state diff was empty because the harness only scanned `~/.codex/sessions`. | Codex trust persistence must also scan `~/.codex/config.toml`, where project trust is recorded as `trust_level = "trusted"` for the cwd. |
| Claude Code | `/private/tmp/tide-provider-evidence/20260527-154329-claude-manual` | User accepted workspace trust and Claude reached the main TUI for `~/Workspace/tide`; provider transcript state diff was empty because the harness only scanned `~/.claude/projects`. | Claude trust persistence must also scan `~/.claude.json`, where project trust is recorded under the project entry. |

Harness fix after manual runs:

- Include `~/.codex/config.toml` in Codex state roots and `~/.claude.json` in Claude state roots so future readiness runs capture trust persistence diffs.

### Harness Message: 2026-05-27

Message scenario runs checked whether Composer-like input reaches the provider conversation and creates or updates provider-local Raw Agent Session state.

| Agent | Evidence path | Result | Interpretation |
| --- | --- | --- | --- |
| Codex | `/private/tmp/tide-provider-evidence/20260527-154941-codex-message` | PTY transcript showed the prompt text `Reply exactly: CODEX_EVIDENCE` in the Codex Composer. State diff only modified `~/.codex/config.toml`, and no Codex session file was added under the harness state roots used by that run. | This run proves prompt text reached the visible Codex Composer, but it does not yet prove submit/answer/session update. The harness needs a readiness-aware or longer settle period before Codex message evidence is accepted. |
| Claude Code | `/private/tmp/tide-provider-evidence/20260527-154950-claude-message` | PTY transcript showed the prompt text and assistant answer `CLAUDE_EVIDENCE`. State diff added `~/.claude/projects/-Users-you-Workspace-tide/6a26b8ab-c91e-4846-aae5-f51ce6b04a39.jsonl` and modified `~/.claude.json`. The added JSONL contains the user prompt and assistant answer with session id `6a26b8ab-c91e-4846-aae5-f51ce6b04a39`. | Claude passes repeatable message evidence: PTY input, provider output, and provider-local Raw Agent Session identity are tied together. |
| Antigravity CLI | `/private/tmp/tide-provider-evidence/20260527-154958-agy-message` | PTY transcript showed sign-in progress followed by workspace trust for `/Users/you/Workspace/tide`, with `Yes, I trust this folder` and `No, exit`. State diff added a CLI log and modified `cli.log`; the prompt text did not reach a conversation. | Antigravity message evidence is blocked by Provider Readiness for this Execution Context. The next evidence run should complete workspace trust through manual setup, then rerun the message scenario. |

Harness fix after message runs:

- Add `--pre-submit-wait` so message scenarios can wait briefly after writing prompt text and before sending the provider-specific submit key.
- Keep Codex state roots narrowed to `~/.codex/sessions`, `~/.codex/config.toml`, and `~/.codex/history.jsonl`. A full `~/.codex` scan can hit the bounded directory cap before the new rollout file is observed.

Follow-up message runs after Agy workspace trust and Codex pre-submit wait:

| Agent | Evidence path | Result | Interpretation |
| --- | --- | --- | --- |
| Antigravity CLI | `/private/tmp/tide-provider-evidence/20260527-160221-agy-manual` | User completed workspace trust for `/Users/you/Workspace/tide`. State diff modified `~/.gemini/antigravity-cli/settings.json` and added an implicit provider record plus a run log. | Antigravity Provider Readiness for this Execution Context was completed through the provider-native setup surface. |
| Antigravity CLI | `/private/tmp/tide-provider-evidence/20260527-160251-agy-message` | PTY transcript showed prompt text `Reply exactly: AGY_EVIDENCE` and answer `AGY_EVIDENCE`. State diff added `brain/ede860c4-e4ee-4f61-8017-29598b924020/.system_generated/logs/transcript.jsonl`, `transcript_full.jsonl`, `conversations/ede860c4-e4ee-4f61-8017-29598b924020.pb`, `cache/last_conversations.json`, `history.jsonl`, and a CLI log. The readable transcript contains `USER_INPUT` for the prompt and `PLANNER_RESPONSE` with `AGY_EVIDENCE`. | Antigravity passes repeatable message evidence after Provider Readiness: PTY input, provider output, conversation id, and provider-local Raw Agent Session reference are tied together. |
| Codex | `/private/tmp/tide-provider-evidence/20260527-160301-codex-message` | PTY transcript showed prompt text `Reply exactly: CODEX_EVIDENCE`, a running state, and answer `CODEX_EVIDENCE`. A new rollout file was found at `~/.codex/sessions/2026/05/27/rollout-2026-05-27T16-03-02-019e683e-6ca4-7422-9c36-3a929746c5ec.jsonl`; it contains session id `019e683e-6ca4-7422-9c36-3a929746c5ec`, the user prompt, and the assistant answer. | Codex passes repeatable message evidence with the pre-submit wait. The state diff for this run did not list the rollout file because the then-current Codex state root scanned full `~/.codex` and hit the bounded directory cap. |

### Harness Resume Prep: 2026-05-27

Provider help output confirms the provider-native resume commands that the harness should smoke next:

| Agent | Resume command evidence | Harness command shape |
| --- | --- | --- |
| Codex | `codex resume --help` shows `codex resume [OPTIONS] [SESSION_ID] [PROMPT]` and `--no-alt-screen`. | `codex resume --no-alt-screen <session-id>` |
| Claude Code | `claude --help` shows `--resume [value]`, `--continue`, and `--session-id <uuid>`. | `claude --resume <session-id>` |
| Antigravity CLI | `agy --help` shows `--conversation` for resuming a previous conversation by ID and `--continue` for the most recent conversation. | `agy --conversation <conversation-id>` |

Harness support was extended with `--scenario resume --resume-ref <provider-native-ref>` so resume evidence can use the same hidden PTY path as message evidence.

First Codex resume attempt:

| Evidence path | Result | Interpretation |
| --- | --- | --- |
| `/private/tmp/tide-provider-evidence/20260527-161649-codex-resume` | Command launched as `codex resume --no-alt-screen 019e683e-6ca4-7422-9c36-3a929746c5ec`, but the PTY transcript showed `TERM is set to "dumb"` and Codex refused to start the interactive TUI. State diff was empty. | The caller's `TERM=dumb` leaked into the provider environment because the harness used `setdefault`. Hidden PTY launch code must set a real terminal environment explicitly. |

Harness fixes after the failed Codex resume attempt:

- Set `TERM=xterm-256color` and `COLORTERM=truecolor` explicitly, while still allowing explicit `--env` overrides.
- During cleanup, fall back from process-group signaling to child-process signaling if the host denies `killpg`.

Resume scenario runs after those fixes:

| Agent | Evidence path | Result | Interpretation |
| --- | --- | --- | --- |
| Codex | `/private/tmp/tide-provider-evidence/20260527-161911-codex-resume` | PTY transcript showed the previous `CODEX_EVIDENCE` turn, then prompt text `Reply exactly: CODEX_RESUME_EVIDENCE`, running state, and answer `CODEX_RESUME_EVIDENCE`. State diff modified `~/.codex/history.jsonl` and the existing rollout file `~/.codex/sessions/2026/05/27/rollout-2026-05-27T16-03-02-019e683e-6ca4-7422-9c36-3a929746c5ec.jsonl`. The rollout contains the same session id `019e683e-6ca4-7422-9c36-3a929746c5ec`, the original prompt/answer, and the resume prompt/answer. | Codex passes resume evidence through hidden PTY using `codex resume --no-alt-screen <session-id>`. The Raw Agent Session reference can be the session id plus rollout path. |
| Claude Code | `/private/tmp/tide-provider-evidence/20260527-162056-claude-resume` | PTY transcript showed prior `CLAUDE_EVIDENCE` content, prompt text `Reply exactly: CLAUDE_RESUME_EVIDENCE`, and answer `CLAUDE_RESUME_EVIDENCE`. State diff modified `~/.claude.json` and the existing transcript `~/.claude/projects/-Users-you-Workspace-tide/6a26b8ab-c91e-4846-aae5-f51ce6b04a39.jsonl`; the JSONL contains both original and resumed turns under session id `6a26b8ab-c91e-4846-aae5-f51ce6b04a39`. | Claude passes resume evidence through hidden PTY using `claude --resume <session-id>`. The Raw Agent Session reference can be the session id plus transcript path. |
| Antigravity CLI | `/private/tmp/tide-provider-evidence/20260527-162247-agy-resume` | PTY transcript showed the prior `AGY_EVIDENCE` turn, prompt text `Reply exactly: AGY_RESUME_EVIDENCE`, and the resumed conversation. State diff modified `brain/ede860c4-e4ee-4f61-8017-29598b924020/.system_generated/logs/transcript.jsonl`, `transcript_full.jsonl`, `conversations/ede860c4-e4ee-4f61-8017-29598b924020.pb`, and `cache/last_conversations.json`. The readable transcript contains the original `USER_INPUT`/`PLANNER_RESPONSE` pair and the resumed `USER_INPUT`/`PLANNER_RESPONSE` pair with `AGY_RESUME_EVIDENCE`. | Antigravity passes resume evidence through hidden PTY using `agy --conversation <conversation-id>`. The Raw Agent Session reference can be the conversation id plus transcript path. |

### Permission And Prompt Signal Prep: 2026-05-27

Existing Tide v1 wrapper and behavior-test evidence gives a useful lower bound for v2 Prompt State, but it is not enough for Antigravity.

| Agent | Evidence | Interpretation |
| --- | --- | --- |
| Codex | `crates/tide-app/resources/bin/codex` injects `UserPromptSubmit`, `PermissionRequest` with `matcher: Bash`, and `Stop` hooks into an overlay `CODEX_HOME`, enables `features.hooks=true`, forwards PermissionRequest and Stop hook stdin through `tide notify --payload-stdin`, and does not use a Codex `Notification` hook. `agent_gateway.rs` tests assert that PermissionRequest snippets prefer `tool_input.description`, then `tool_input.command`; raw visible CLI approval text does not mark NeedsInput; `PreToolUse` with `permissionDecision: ask` is not treated as a supported wait signal. | Codex Prompt State should be structured from the `PermissionRequest` hook payload. PTY-visible approval text is evidence for raw rendering, not enough to create structured Prompt State. |
| Claude Code | `crates/tide-app/resources/bin/claude` injects MCP config and a settings file with `Notification`, `Stop`, and `UserPromptSubmit` hooks. Tests assert that `Notification` and `Stop` hook stdin are forwarded through `tide notify --payload-stdin`. | Claude Prompt State can start from provider hook payloads carried by `Notification` or related prompt hooks, but v2 still needs fresh Claude permission/question payload fixtures. |
| Gemini wrapper | `crates/tide-app/resources/bin/gemini` uses `BeforeAgent`, `AfterAgent`, and `Notification` hooks through `GEMINI_CLI_SYSTEM_DEFAULTS_PATH`. | This is useful wrapper-pattern evidence only. It is not Antigravity evidence, because v2 support targets `agy` and earlier research already records Antigravity-specific state and transcript behavior. |
| Notify bridge | `crates/tide-app/src/adapter/inward/cli_adapter/notify.rs` reads optional hook payload JSON from stdin and sends one fire-and-forget JSON-RPC notification to the owning Tide socket. | v2 needs the same concept scoped to Thread/Agent Runtime identity: Provider Signals should carry raw provider payload plus the owning runtime reference. |

Permission smoke status:

| Agent | Status | Remaining work |
| --- | --- | --- |
| Codex | Captured real `UserPromptSubmit` and `PermissionRequest` hook payloads tied to the same PTY-launched session. | Decide production hook bootstrap/trust UX. Dynamic per-run hooks trigger a hook review gate before normal operation. |
| Claude Code | Captured real `UserPromptSubmit`, `PermissionRequest`, and `Notification` hook payloads tied to the same PTY-launched session. | Decide how Prompt State prioritizes `PermissionRequest` versus `Notification`. |
| Antigravity CLI | Captured runtime `PreInvocation`, `PreToolUse`, `PostToolUse`, `PostInvocation`, and `Stop` payloads with a temporary user-approved global plugin tied to the same hidden PTY session. | Production support needs an explicit Provider Readiness/bootstrap step for plugin install and layout verification. AGY is a required v2 Agent Integration alongside Codex and Claude. |

Harness support after permission research:

- Codex permission capture uses inline `-c hooks.UserPromptSubmit=...`, `-c hooks.PermissionRequest=...`, and `-c hooks.Stop=...` config, plus `features.hooks=true`, `bypass_hook_trust=true`, `--dangerously-bypass-hook-trust`, and `--ask-for-approval untrusted`.
- Codex permission capture can use `--codex-temp-home` to copy only provider auth/config into a temporary `CODEX_HOME`. This keeps hook-trust test state out of the user's real `~/.codex` while still using real provider credentials.
- Claude permission capture writes a run-local `settings.json`, passes it with `claude --settings <path>`, and configures `UserPromptSubmit`, `PermissionRequest`, `Notification`, and `Stop` hooks.
- The permission scenario does not auto-approve command execution prompts. It captures the provider-visible wait state and raw hook payloads.
- Antigravity permission capture is not automated in the harness. Local research used a temporary user-approved global plugin and then removed it. Production should treat plugin bootstrap as Provider Readiness, not as an invisible per-run side effect.

Codex permission fixture progression:

| Run | Evidence | Interpretation |
| --- | --- | --- |
| `/private/tmp/tide-provider-evidence/20260527-170422-codex-permission` | PTY Transcript reached Codex's command approval UI for `python3 -c 'print("CODEX_PERMISSION_FIXTURE")'`, and provider state added rollout `~/.codex/sessions/2026/05/27/rollout-2026-05-27T17-04-24-019e6876-9e05-7322-aea7-9d0ca8131375.jsonl`. `manifest.json` reported `signals.count: 0`. | Hidden PTY can reproduce Codex permission waiting, but the first hook fixture did not capture hook payloads. The next harness run must bypass hook trust for the isolated run-local hook config. |
| `/private/tmp/tide-provider-evidence/20260527-171609-codex-permission` | Manifest showed `--dangerously-bypass-hook-trust`, PTY Transcript showed Codex's hook-trust bypass warning, but `signals.count` remained `0`. The rollout and history recorded only `-c 'print("CODEX_PERMISSION_FIXTURE")'`, so the intended long permission prompt was not received intact by Codex. | Hook trust bypass alone is not enough. The next harness run must pass `core.hooksPath` explicitly and pass the permission prompt as Codex's CLI initial prompt argument instead of typing the long prompt into the Composer. |
| `/private/tmp/tide-provider-evidence/20260527-173558-codex-permission` | The command included `core.hooksPath`, but Codex stopped before the prompt because the harness had set `CODEX_HOME` to an overlay with symlinked sqlite state. PTY Transcript reported `attempt to write a readonly database` for `state_5.sqlite`. | `CODEX_HOME` overlay is the wrong evidence-harness default for Codex permission capture. Use normal `CODEX_HOME` plus explicit `core.hooksPath` so hook config is run-local while provider-owned auth/sqlite state stays provider-owned. |
| `/private/tmp/tide-provider-evidence/20260527-174847-codex-permission` | The command used inline `hooks.UserPromptSubmit`, `hooks.PermissionRequest`, and `hooks.Stop` config. PTY Transcript stopped at Codex's hook review screen and `signals.count` stayed `0`. | Inline hook config was loaded, but Codex hook review is a Provider Readiness gate. |
| `/private/tmp/tide-provider-evidence/20260527-181327-codex-permission` | The command also included `bypass_hook_trust=true`, but PTY Transcript still stopped at hook review and `signals.count` stayed `0`. | For the installed `codex-cli 0.134.0`, config/CLI bypass did not remove the initial hook review gate in this dynamic-hook path. |
| `/private/tmp/tide-provider-evidence/20260527-181831-codex-permission` | The run used `--codex-temp-home` and startup keys for the temporary hook review gate. `manifest.json` reported `signals.count: 2` and real `~/.codex` state diff counts were all zero. `provider-signals.jsonl` captured `UserPromptSubmit` and `PermissionRequest` with the same `session_id` `019e68ba-86a7-7a20-8946-173af0377df3`, `turn_id`, cwd, model, permission mode, and `transcript_path`. The `PermissionRequest` payload included `tool_name: "Bash"` and `tool_input.command: "python3 -c 'print(\"CODEX_PERMISSION_FIXTURE\")'"`. | Codex hook payload capture is proven. Production should treat hook trust/bootstrap as Provider Readiness, then use `PermissionRequest` as structured Prompt State evidence. |

Claude permission fixture:

| Run | Evidence | Interpretation |
| --- | --- | --- |
| `/private/tmp/tide-provider-evidence/20260527-182233-claude-permission` | The command used `claude --settings <run settings.json>` with run-local hooks. `manifest.json` reported `signals.count: 3`. `provider-signals.jsonl` captured `UserPromptSubmit`, `PermissionRequest`, and `Notification` for session `09a10091-c9d4-4479-832d-6bef29703ff5`, all tied to transcript `~/.claude/projects/-Users-you-Workspace-tide/09a10091-c9d4-4479-832d-6bef29703ff5.jsonl`. `PermissionRequest` included `tool_name: "Bash"`, `tool_input.command`, `tool_input.description`, and `permission_suggestions`. `Notification` reported `notification_type: "permission_prompt"` and message `Claude needs your permission`. | Claude hook payload capture is proven. Prompt State should use `PermissionRequest` for the structured action and may use `Notification` as an attention signal. |

Antigravity hook layout evidence:

| Evidence | Interpretation |
| --- | --- |
| Official Google Antigravity [hook docs](https://antigravity.google/docs/hooks) describe `hooks.json`, events `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, and `Stop`, and common stdin fields including `conversationId`, `workspacePaths`, `transcriptPath`, and `artifactDirectoryPath`. Official [plugin docs](https://antigravity.google/docs/plugins) describe `plugin.json` as the required marker file and plugins under `.agents/plugins/`, `_agents/plugins/`, or `~/.gemini/config/plugins/`; [CLI feature docs](https://antigravity.google/docs/cli-features) also describe `agy plugin install` staging into `~/.gemini/antigravity-cli/plugins/<plugin_name>/`. | Antigravity has a provider-native hook model suitable for Provider Signals, but it is plugin/customization-based rather than a per-launch `--settings` file like Claude. |
| Local event-string checks against the installed `agy` binary found `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `conversationId`, `transcriptPath`, `fullyIdle`, `Allow sandbox bypass for command execution?`, `Yes, grant permission for %s in this conversation`, and `loaded %d named hooks from %d hooks.json file(s)`. | The installed local binary contains the hook/event and permission prompt strings needed by the Provider Integration. |
| `agy plugin validate /private/tmp/tide-agy-plugin-validate/tide-evidence` with only a root `hooks.json` reported `hooks: skipped (not found)`. The same plugin with `hooks/tide-hooks.json` reported `hooks: 1 processed`. | The installed validator recognizes `hooks/*.json` in a plugin. Runtime loading still needs a separate smoke because validator behavior and runtime behavior differ. |
| Workspace-level `.agents/plugins/tide-evidence/hooks/tide-hooks.json` validated in `/private/tmp/tide-agy-runtime-workspace`, but message runs `/private/tmp/tide-provider-evidence/20260527-183809-agy-message` and `/private/tmp/tide-provider-evidence/20260527-183948-agy-message` did not produce hook signals. | Workspace plugin validation was not enough to prove runtime loading for installed `agy 1.0.2`. Production should not rely on workspace plugin discovery until that path is separately proven. |
| After user approval, `agy plugin install /private/tmp/tide-agy-plugin-runtime/tide-evidence` installed the plugin under `/Users/you/.gemini/config/plugins/tide-evidence`. Runtime run `/private/tmp/tide-provider-evidence/20260527-184638-agy-message` only produced hook signals after `hooks.json` existed at the installed plugin root. The provider log recorded `Loaded hooks.json from /Users/you/.gemini/config/plugins/tide-evidence/hooks.json: 1 named hooks, 5 total handlers`. | Runtime hook loading is proven for a global plugin with root `hooks.json`. The production bootstrap must verify the exact installed-layout contract instead of assuming validator layout equals runtime layout. |
| Direct shell mode run `/private/tmp/tide-provider-evidence/20260527-185232-agy-message` executed `python3 -c 'print("AGY_TOOL_FIXTURE")'` through the PTY and the provider log registered the shell command, but no hook signal was appended. Model-driven run `/private/tmp/tide-provider-evidence/20260527-185409-agy-message` produced `PreToolUse` and `PostToolUse` payloads for `run_command` with `toolCall.args.CommandLine`. | AGY Provider Signals observe model-driven tool calls, not direct user bang/bash-mode commands. Direct user shell input should be treated as PTY Transcript evidence unless another provider signal is proven. |
| The first model-driven hook script printed `{}` to stdout and the PTY showed `Tool call denied by jsonhook__tide-provider-signal_PreToolUse_0_0`. After removing stdout from the capture script, run `/private/tmp/tide-provider-evidence/20260527-185821-agy-message` reached AGY's native tool confirmation prompt: `Requesting permission for: python3 -c 'print("AGY_TOOL_ALLOW_FIXTURE")'`. The log recorded `PreToolUse` hook execution and `Surfacing tool confirmation: "Bash" at step 3`. | Passive AGY capture hooks must not emit stdout unless they intentionally return a provider-supported decision. Approval answering should use the same hidden PTY unless a future AGY-specific response contract is proven. |

### Antigravity Notes

Additional Antigravity observations:

- Fresh-state Antigravity CLI launch on 2026-05-27 showed a first-run sequence before normal Composer input: not signed in, signing in, color scheme selection, Terms of Service & Data Use, and workspace trust. The color scheme screen uses up/down navigation and Enter confirmation. The terms screen has a checkbox and separate Done action; the user observed that focus must move with arrow keys rather than treating the checkbox screen as a simple Enter-only prompt. The workspace trust screen also uses up/down navigation and Enter confirmation.
- `.pb` conversation files under `~/.gemini/antigravity-cli/conversations/` were not useful as direct text history in bounded `rg -a` and `strings` checks.
- `~/.gemini/antigravity-cli/cache/last_conversations.json` maps cwd to the last conversation id.
- Hook payloads provide the better Raw Agent Session reference because they include both `conversationId` and a readable `transcriptPath`.
- The installed `agy 1.0.2` validated hook plugins only after a `hooks/*.json` file existed, while runtime logs showed root `hooks.json` loaded from the global plugin directory. The Antigravity Integration needs a small bootstrap/install check for the exact plugin layout supported by the installed CLI.
- Workspace-level `.agents/plugins/...` validation succeeded in the temporary workspace, but runtime hook execution was only observed after installing the temporary plugin under `~/.gemini/config/plugins/tide-evidence` and adding root `hooks.json`. The smoke plugin was removed after verification.
- AGY model-driven command approval is visible through both Provider Signals and PTY: `PreToolUse` includes `toolCall.name: "run_command"` and `toolCall.args.CommandLine`, while the PTY shows the provider-native `Bash(...)` confirmation UI. Tide should surface the Provider Signal as structured Prompt State and send the user's answer through the hidden PTY.
- `agy --conversation <id>` is a valid resume identity. In print-mode it appended to the existing transcript. In hidden PTY mode it loaded the existing conversation. Before setup/trust, onboarding screens captured follow-up keystrokes. After onboarding and workspace trust, hidden PTY Composer-like input reached the conversation and appended to the same transcript.
- After onboarding, `~/.gemini/antigravity-cli/settings.json` existed with `trustedWorkspaces`. The first post-onboarding PTY run may still show a workspace trust prompt for the cwd.
- Directory Trust should be treated as a provider-wide readiness gate, not as an Antigravity-only concern. Antigravity showed the local evidence; Codex and Claude should be smoke-tested in clean or untrusted directories before finalizing their readiness adapters.

### Interpretation

The local smoke supports the hidden PTY runtime decision and adds four hard requirements.

First, Provider Readiness must be satisfied before user input is sent to a real Thread turn:

```text
Provider setup screens can capture Composer bytes before they reach the Agent Runtime conversation.
Tide must detect authentication, onboarding, Directory Trust, and hook/bootstrap setup before sending the user's Thread message.
When setup is incomplete, Tide should preserve pending Composer input and surface a provider-native setup path instead of treating setup prompts as a normal Thread turn.
```

Second, Agent Runtime input must behave like terminal input:

```text
Agent Runtime input cannot be implemented as plain text plus '\r'.
It must behave like a terminal input layer that can honor the provider TUI's negotiated keyboard protocol.
Provider Setup Surface input, when hosted inside Tide, also needs terminal input behavior because readiness and onboarding screens may require arrows, focus movement, checkbox toggles, and CSI-u Enter.
```

Existing Tide v1 already has a terminal key-to-bytes path in `crates/tide-app/src/domain/terminal/key_input.rs`, including CSI-u bytes for Shift+Enter. v2 should reuse or generalize that layer for hidden Agent Runtime input instead of creating a simpler stdin writer.

Third, Agent Session rendering should prefer provider-local readable history when available:

```text
PTY Transcript is the baseline evidence.
Provider transcripts and hook payloads are the clean rendering source when they are tied to the same PTY session.
```

Codex rollout JSONL, Claude transcript JSONL, and Antigravity hook-provided transcript JSONL all produced cleaner Agent Session evidence than ANSI PTY screen capture.

Fourth, each Agent Integration needs an identity bootstrap:

```text
The Agent Runtime launch must return or discover the provider-native Raw Agent Session ref.
That ref can be a rollout path, transcript path, session id, conversation id, or resume identity.
```

## Failure Classification

| Failure | Meaning |
| --- | --- |
| PTY launch fails | The Agent Integration is not ready for v2 runtime support. |
| PTY works but Provider Signals are missing | The Agent can still ship with PTY Transcript as baseline, but rich Agent Session Blocks and attention quality stay limited. |
| Provider Signals work but PTY does not | The Agent Integration is not acceptable for v2 because it violates the one-runtime-transport decision. |
| Resume cannot be proven | New Thread creation may work, but persisted Thread reopen/follow-up remains blocked. |
| Provider history cannot be located | Tide can render live PTY Transcript, but old Threads cannot rely on provider-local Raw Agent Session history yet. |
| Provider history is readable only through hooks | The Agent can still ship, but the Agent Integration must install or inject the provider hook configuration before starting the hidden PTY. |
| Provider setup captures input | Tide must pause Thread launch and surface Provider Readiness before sending the user's prompt to the hidden PTY. |

## Implementation Implications

- Add an Agent Runtime port for hidden PTY creation and PTY input/output capture.
- Keep Provider Signal collection as an observer layer tied to the Agent Runtime identity.
- Store Thread metadata and provider session references under Application Support.
- Keep Raw Agent Session history in provider-local storage.
- Treat app-server, print-mode JSON, and exec JSON streams as research and fixture inputs unless a future product decision replaces the hidden PTY runtime model for an entire Agent Integration.

## Open Research Items

The repeatable local harness is specified in [Provider Evidence Harness](../specs/provider-evidence-harness.md) and implemented by `scripts/provider-evidence-harness.py`.

| Item | Why it matters |
| --- | --- |
| Hook response path per provider | Some providers may support direct hook responses for approvals or questions. If used, it must still be tied to the same hidden PTY session and not become an independent runtime path. AGY evidence currently favors passive capture plus PTY-native approval answering. |
| Provider transcript identity automation | Tide needs a reliable implementation path to map each newly started PTY session to the observed provider-local history file or conversation id. |
| Alternate screen behavior | PTY capture quality may depend on disabling alternate screen, terminal width, or CLI-specific UI modes. |
| Provider readiness preflight | First-run onboarding, authentication, Directory Trust, and hook/bootstrap prompts can capture keystrokes before they reach the conversation Composer. |
| Permission prompt grammar | Each Agent has different approval/question UI. Tide needs per-provider prompt classifiers backed by hook payloads where available. |
