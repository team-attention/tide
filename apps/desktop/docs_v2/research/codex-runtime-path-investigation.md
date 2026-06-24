# Investigation: Codex Runtime Path Difference

Date: 2026-06-24

## Scope

This note records the evidence behind a user-visible mismatch:

- Running `codex` directly in a normal terminal usually behaves reliably.
- Starting a Codex Thread inside Tide can behave differently, including tool calls
  that appear stuck.

This is not a general claim that the host terminal is broken. The narrow question
is whether Tide currently starts Codex through the same runtime path as a user
typing `codex` in Terminal.app/iTerm, and what would be required to make those
paths equivalent.

## Findings

Tide currently does not start Codex the same way as a normal terminal session.

The current Tide path is:

```text
Tide Electron backend
-> resolveExecutable("codex")
-> spawn codex app-server
-> JSON/stdin/stdout structured protocol
-> thread/start { cwd, sandbox, approvalPolicy, model, effort }
-> Tide renders structured runtime events as Agent Session Blocks
```

A normal direct terminal path is:

```text
Terminal.app/iTerm
-> user's login/interactive shell
-> codex
-> Codex interactive TUI / PTY path
-> Codex CLI applies its own config, flags, sandbox, approvals, tools, and auth
```

That difference is enough to explain why "it works when I run Codex in a
terminal" and "it stalled inside Tide" can both be true.

## Code Evidence

Current Codex integration builds a structured app-server launch plan:

- `apps/desktop/src/backend/adapters/outbound/agent-integrations/codex/codex-agent-integration.ts:253`
  says the transport is the app-server protocol over plain stdio.
- `apps/desktop/src/backend/adapters/outbound/agent-integrations/codex/codex-agent-integration.ts:261`
  through `:274` build args containing `"app-server"` and return
  `transport: "codex_app_server"`.
- `apps/desktop/src/backend/adapters/outbound/agent-runtime/runtime-ports/agent-integration-agent-runtime-port.ts:42`
  through `:45` define the live structured runtime as provider machine protocols
  over plain stdio with "no PTY".
- `apps/desktop/src/backend/adapters/outbound/agent-runtime/runtime-ports/agent-integration-agent-runtime-port.ts:545`
  selects `createCodexAppServerClient` for `codex_app_server`.
- `apps/desktop/src/backend/adapters/outbound/agent-runtime/structured/codex-app-server-client.ts:1`
  through `:15` documents that Codex uses the app-server protocol, spawned as
  `codex app-server`, with `thread/start {cwd, approvalPolicy, sandbox, model?}`.
- `apps/desktop/src/backend/adapters/outbound/agent-runtime/structured/codex-app-server-client.ts:197`
  through `:200` sends `thread/start` with the launch plan cwd and protocol
  params.

Tide also maps the visible Codex permission chip into explicit protocol
permission values:

- `apps/desktop/src/shared/agent-descriptors.ts:50` through `:55` define the
  Codex permission default as `approve-for-me`.
- `apps/desktop/src/backend/adapters/outbound/agent-integrations/codex/codex-agent-integration.ts:341`
  through `:350` map:
  - `ask-for-approval` -> `sandbox = "workspace-write"`,
    `approvalPolicy = "on-request"`
  - `approve-for-me` -> `sandbox = "workspace-write"`,
    `approvalPolicy = "on-failure"`
  - `full-access` -> `sandbox = "danger-full-access"`,
    `approvalPolicy = "never"`

Tide tries to approximate a user's shell environment, but this is still not the
same thing as being launched by the exact currently open terminal session:

- `apps/desktop/src/backend/infrastructure/node/live/resolve-shell-path.ts:4`
  through `:12` explain why a GUI app does not inherit the terminal PATH and why
  Tide asks the login shell for PATH.
- `apps/desktop/src/backend/infrastructure/node/live/resolve-shell-path.ts:167`
  through `:176` say provider runtimes should see the same auth/tool environment
  as `codex`, `claude`, and `opencode` launched by the user's normal terminal,
  then obtain a shell environment snapshot.
- `apps/desktop/src/backend/infrastructure/node/live/live-backend.ts:243`
  through `:251` wires Codex through `createCodexAgentIntegration`, resolving the
  `codex` executable and injecting Tide MCP config.

## Documentation Evidence

There are two different architectural records in the repo.

The older v2 product direction records hidden PTY as the Agent Runtime path:

- `apps/desktop/docs_v2/master-plan.md:989` defines Agent Runtime as a hidden
  PTY-backed provider CLI process.
- `apps/desktop/docs_v2/master-plan.md:993` through `:995` say Tide creates one
  hidden PTY, launches the provider's normal interactive CLI inside it, and sends
  Composer input and approvals through the same hidden PTY path.
- `apps/desktop/docs_v2/master-plan.md:1054` says Codex Integration uses hidden
  PTY as runtime transport and treats app-server as research/fixture input.
- `apps/desktop/docs_v2/master-plan.md:1092` says an Agent Integration should not
  split one Agent's live runtime across multiple control paths.
- `apps/desktop/docs_v2/research/agent-hidden-pty-provider-signal-smoke.md:14`
  through `:16` say every supported Agent Integration runs the provider's normal
  interactive CLI in one hidden PTY and Provider Signals do not become a second
  live runtime transport.
- `apps/desktop/docs_v2/research/agent-hidden-pty-provider-signal-smoke.md:125`
  records a passing Codex hidden PTY smoke using `codex --no-alt-screen`.
- `apps/desktop/docs_v2/research/agent-hidden-pty-provider-signal-smoke.md:379`
  through `:383` list follow-up work for hidden PTY creation/capture and say
  app-server/JSON streams are research or fixture inputs unless a future product
  decision replaces hidden PTY for an entire Agent Integration.

The current structured runtime spec records a later direction:

- `apps/desktop/docs_v2/specs/structured-agent-runtime.md:3` through `:6` says
  structured runtime supersedes hidden PTY transport for active provider CLIs.
- `apps/desktop/docs_v2/specs/structured-agent-runtime.md:15` through `:16` say
  Tide now uses the supported CLIs' structured machine interfaces and has no
  fallback path.
- `apps/desktop/docs_v2/specs/structured-agent-runtime.md:41` lists
  `codex_app_server` as a transport.
- `apps/desktop/docs_v2/specs/structured-agent-runtime.md:66` says the Codex
  spawn command is `codex app-server`.

The code matches the structured runtime spec, not the older hidden-PTY product
direction.

## Session Evidence: PR Ready Hang

Observed local session:

```text
Thread: /Users/eatnug/Library/Application Support/Tide/threads/id-ab14f327ae33
Codex rollout:
/Users/eatnug/.codex/sessions/2026/06/24/rollout-2026-06-24T19-10-12-019ef91b-d7fe-79c1-904c-30afa6dc7de9.jsonl
```

The GitHub connector itself was not completely unusable:

- Rollout line `1016` starts `_create_pull_request`.
- Rollout line `1017` records `mcp_tool_call_end` for
  `github.create_pull_request`.
- Rollout line `1018` records a `function_call_output` with
  `Wall time: 1.6568 seconds` and PR `#200`.

The later "ready for review" connector call did not return:

- Rollout line `1058` starts `_mark_pull_request_ready_for_review` with
  `repository_full_name: "team-attention/tide"` and `pr_number: 200`.
- Rollout line `1059` records only `aborted by user after 435.6s`.
- Tide's Agent Session cache line `504` keeps the corresponding block as
  `status: "pending"` with title
  `codex_apps.github.mark_pull_request_ready_for_review`.

The local SQLite log did not explain the connector internals:

```text
Database:
/Users/eatnug/Library/Application Support/Tide/agent-wrappers/codex/home/logs_2.sqlite

Schema table:
logs(id, ts, ts_nanos, level, target, feedback_log_body, ...)

Rows in database:
333326

Queried interval:
2026-06-24T10:46:40Z..2026-06-24T11:03:20Z

Queries:
- WARN/ERROR rows in the interval
- rows whose target/body mention mcp, github, connector,
  mark_pull_request_ready_for_review, or call_YukYjO0qMg1ks4lRY8qYrIxm

Result:
no rows returned
```

Therefore the exact internal reason the GitHub connector did not return is not
proven by local Tide logs. The proven facts are only:

- PR creation via the same connector succeeded quickly.
- Mark-ready via the connector started.
- It produced no result for 435.6 seconds.
- The user aborted it.
- Tide's cached Agent Session block remained pending.

## Session Evidence: Tool Sandbox Is Not The Normal Terminal

The same Codex rollout records the current turn's tool sandbox:

- Rollout line `5` has `approval_policy: "on-failure"` and
  `sandbox_policy: { type: "workspace-write", network_access: false, ... }`.

This evidence applies to Codex tool calls run inside this managed session, for
example `exec_command`. It is not evidence that the user's normal terminal has
restricted networking. Network failures observed from `exec_command` should not
be used as proof that Terminal.app/iTerm or direct `codex` has the same network
environment.

## What Would Make Tide Equivalent To Direct Terminal Codex

If the product contract is "Tide behaves like I opened a terminal and typed
`codex`", Codex should run through a hidden PTY, not `codex app-server`:

```text
Tide backend
-> create hidden PTY
-> start codex --no-alt-screen, or codex resume --no-alt-screen <session>
-> send Composer text, Enter, approvals, questions, and model/menu input through PTY
-> read PTY output plus Codex rollout/hooks as Provider Signals
-> render Agent Session Blocks from those observed signals
```

Implementation requirements for that path:

- Replace the Codex active runtime transport from `codex_app_server` to a hidden
  PTY runtime for Codex.
- Keep Tide MCP attached to that same Codex process; do not add a second live
  control path for the same Thread.
- Set an explicit terminal environment (`TERM`, PTY size, alternate-screen
  behavior, bracketed paste / CSI-u handling as needed).
- Use the same cwd, `HOME`, `CODEX_HOME`, `SHELL`, `PATH`, `SSH_AUTH_SOCK`,
  GitHub/keychain/auth-related environment, and config resolution that a normal
  terminal `codex` launch sees.
- Add a diagnostics panel or log record that captures exact Codex launch argv,
  cwd, selected env keys, sandbox/approval values, and resolved executable path.
- Add a comparison command that records the same keys from an ordinary terminal
  shell so differences are visible instead of inferred.

If the product contract remains "Tide uses structured provider transports",
then Tide should not claim terminal equivalence for Codex. In that case the
necessary fixes are different:

- Keep `codex app-server` as the runtime.
- Make the permission chip and actual `thread/start` sandbox/approval params
  visible in diagnostics.
- Add hard timeouts and fallback paths for external connector calls that can
  leave Agent Session blocks pending.
- For GitHub PR operations, prefer local `gh` fallback when the connector does
  not return within the product timeout.

## Open Product Decision

The repo currently contains both:

- hidden PTY product direction and smoke evidence, and
- structured runtime spec and implementation.

Before changing Codex runtime code, Tide needs one explicit decision:

```text
Should Codex in Tide be terminal-equivalent interactive Codex, or a structured
IDE-like Codex app-server integration?
```

That decision determines whether the next engineering slice is:

- hidden PTY Codex runtime parity with direct terminal `codex`, or
- structured app-server reliability, timeout, fallback, and diagnostics work.
