# Native Agent Runtime Fidelity

Status: public design record
Date: 2026-07-02
Execution plan: `native-agent-runtime-rebuild-plan.md`

This document records the public, implementation-facing decisions for making
Tide a first-class host for coding agents such as Codex CLI, Claude Code,
opencode, and Qwen Code.

Unredacted local scratch material is intentionally not recorded here. Public
docs and committed fixtures should contain only provider executable help,
generated runtime schemas, captured runtime protocol frames, redacted fixtures,
and implementation contracts.

## Documentation Boundary

Allowed in public docs and committed fixtures:

- provider executable names and versions;
- provider command help for runtime commands;
- generated schema from the selected runtime executable;
- live protocol frame summaries after redaction;
- Tide-owned launch plans and runtime contracts;
- implementation decisions and unsupported feature notes.

Not allowed in public docs or committed fixtures:

- local absolute paths from a developer machine;
- non-runtime application package internals;
- machine-specific process observations;
- unredacted scratch captures;
- unredacted prompts, command output, diffs, credentials, env, or filesystem
  paths that are not required for a fixture.

Keep unredacted scratch captures outside the repo. Convert them into sanitized
runtime facts before writing docs, code comments, fixtures, or tests.

## Goal

Tide should host coding agents with high runtime fidelity:

- preserve native turn, item, tool, permission, question, and session lifecycle;
- render live tool progress, command output, file changes, reasoning, and
  approvals in context;
- expose provider-native command, skill, model, permission, MCP/tool, and
  session-action capabilities;
- avoid flattening provider semantics too early into generic text blocks;
- keep one shared Tide product model while allowing provider-specific specs
  behind adapters.

High fidelity means semantic fidelity, not cloning another product's UI.

## Runtime Evidence Principle

Every provider feature must be implemented from the selected runtime executable
and its machine protocol, not from a guessed UI analogy.

Evidence can come from:

- executable version/help output;
- generated runtime schema;
- live protocol frames;
- redacted replay fixtures;
- provider protocol documentation when it matches captured behavior.

The shared Tide system should stay general: native events, provider reducers,
semantic blocks, capability catalog, evidence storage, and renderer contracts.
Provider adapters own the vendor-specific details: launch args, protocol
methods, capability invoke kinds, native ids, usage/activity events, permission
choices, and unsupported-feature boundaries.

Do not degrade provider-specific features into generic prompt text or generic
blocks when the runtime exposes a structured method or event. Do not invent a
capability when the selected executable does not prove it.

## Evidence Sources

The public implementation evidence is limited to runtime-facing surfaces:

| Provider | Public evidence source | Runtime implication |
| --- | --- | --- |
| Codex CLI | `codex --version`, `codex app-server --help`, generated app-server schema | Use Tide-owned `codex app-server` as the runtime. |
| Claude Code | `claude --version`, `claude --help`, stream-json runtime frames | Use Tide-owned stream-json CLI runtime. |
| opencode | `opencode --version`, `opencode acp --help`, ACP handshake frames, `opencode serve --help` and redacted OpenAPI summary | Use Tide-owned ACP runtime. Keep `serve` for support/evidence surfaces. |
| Qwen Code | `qwen --version`, `qwen --help`, ACP initialize/auth-required fixture | Treat as ACP-family target. Do not expose as selectable until authenticated session/tool fixtures exist. |
| Gemini CLI | no longer in Tide scope | Do not build a Gemini adapter in this rebuild. |
| agy | `agy --version`, `agy --help` | Deferred until robust ACP or another structured runtime protocol is proven. |

## Runtime Decisions

### Process Ownership

Every agent turn runs in a Tide-owned runtime process.

Allowed:

- Tide-spawned `codex app-server`;
- Tide-spawned Claude Code stream-json process;
- Tide-spawned `opencode acp`;
- future Tide-spawned `qwen --acp`;
- Tide-owned support processes for provider setup/catalog operations.

Not allowed:

- attaching agent turns to already-running provider-owned processes;
- requiring non-runtime companion applications to be installed;
- using two runtime transports for one live thread.

### Provider Transports

| Provider | Runtime transport | Status |
| --- | --- | --- |
| Codex CLI | `codex_app_server` | Primary |
| Claude Code | `claude_stream_json` | Primary |
| opencode | `acp` | Primary |
| Qwen Code | `acp` | ACP-family target; selectable runtime planned after authenticated fixtures |
| Gemini CLI | none | Out of scope |
| agy | none | Deferred until robust structured protocol evidence exists |

### opencode ACP vs serve

Default runtime: `opencode acp`.

Reason:

- ACP already matches Tide's structured runtime shape.
- ACP is the common open-agent path for opencode and Qwen Code.
- Live ACP handshake exposes session lifecycle, config options, command updates,
  and runtime events.

`opencode serve` is not the default runtime. Use it only for provider support
surfaces or for future evidence if ACP cannot preserve required opencode
semantics.

Rule: do not mix ACP and serve in one live opencode thread.

### Active Input

Product default: queue follow-up input while a turn is running, with interrupt
available to stop the current turn and run queued input.

Codex app-server exposes a native active-turn steering capability. Tide should
preserve that as provider capability metadata, but should not make it the default
cross-provider behavior.

## Native Evidence

Provider-owned history logs and Tide-owned native evidence are different
artifacts.

- Provider logs remain provider-owned history/resume state.
- Tide stores reduced native evidence for debugging projection and replay.
- Raw native frames are opt-in debug evidence only.
- Thread archive/delete/export must explicitly handle Tide-owned native
  evidence.

Default retention:

- reduced native snapshots per semantic block;
- native ids, method/kind, timestamps, status, and redacted summary;
- no full prompts, full command output, full diffs, credentials, or raw tool
  payloads by default.

Debug retention:

- bounded raw frame ring;
- byte and count caps;
- TTL;
- explicit export opt-in.

## Semantic Blocks

Tide uses semantic blocks for shared lifecycles, with provider-native ids and
evidence snapshots preserved:

- `message`
- `reasoning`
- `plan`
- `command_run`
- `file_change`
- `tool_call`
- `mcp_call`
- `approval_prompt`
- `question_prompt`
- `session_event`
- `config_state`
- `agent_activity`
- `usage`
- `notice`

Provider-specific block kinds are allowed only when a semantic block would be
misleading.

`usage` and `agent_activity` are first-class runtime state surfaces, not just
final transcript text:

- `usage` covers token, cost, quota, rate-limit, and cache counters when the
  provider exposes them, scoped to turn, thread, session, or provider account.
- `agent_activity` covers provider-emitted subagent, task, worker, or team
  lifecycle: name/role, status, current summary, parent/child relationship,
  native ids, start/end timestamps, and failure/cancel state.

Do not synthesize usage totals or team/subagent activity from vague prose. If a
provider does not expose structured evidence for a field, show it as unavailable
instead of inventing it.

## Capability Catalog

Tide builds one provider capability catalog and renders it in distinct UI
sections.

Capability kinds:

- prompt command;
- skill;
- session action;
- config control;
- permission control;
- MCP/tool surface;
- provider setup.

Invoke kinds:

- provider runtime method;
- provider prompt text;
- provider structured prompt metadata;
- provider config;
- Tide-local surface;
- unsupported.

Slash commands, skills, model/effort/permission controls, MCP/tool surfaces,
and session actions should not be presented as one flat autocomplete list.

## Provider-Specific Directions

### Codex CLI

Runtime: Tide-owned app-server.

Use generated app-server schema as the source of truth for methods such as:

- `thread/start`
- `turn/start`
- `turn/steer`
- `turn/interrupt`
- `thread/compact/start`
- `thread/fork`
- `thread/goal/*`
- `thread/settings/update`
- `skills/list`
- `review/start`
- `model/list`
- `permissionProfile/list`
- `mcpServer*`

Codex slash/session rows must not default to inserting strings into the
composer. Each capability needs an explicit invoke kind.

### Claude Code

Runtime: Tide-owned stream-json process.

Preserve:

- stream message/content block identity;
- tool use/tool result correlation;
- control request ids;
- permission/question prompts;
- subagent/task activity ids when emitted;
- usage/accounting events when emitted;
- model/effort/permission config behavior;
- skill and command metadata reported by the runtime.

Do not build a non-runtime application adapter without a documented,
Tide-spawnable runtime protocol.

### ACP Family

Runtime: Tide-owned ACP process.

Providers:

- opencode now;
- Qwen Code after authenticated session/tool fixtures.

Preserve:

- session id;
- config options/model catalog;
- available commands;
- tool call ids and updates;
- permission request ids;
- usage/quota updates;
- provider task/worker/team extension fields;
- provider extension fields.

Do not reduce ACP to a lowest-common-denominator shape that discards provider
extensions.

### agy

Do not expose as a structured agent in this rebuild. Reconsider only after
robust ACP or another structured runtime protocol is proven through public
executable help, protocol docs, or captured runtime frames.

## Evidence Follow-Ups

These are implementation evidence tasks, not unresolved product direction:

| Follow-up | Direction |
| --- | --- |
| Native evidence sizing | Measure representative runtime frames and enforce reduced snapshots by default. |
| Semantic block fixtures | Compare Codex, Claude, and ACP fixtures before finalizing exact block fields. |
| Codex command registry | Map generated app-server methods and unsupported actions into explicit invoke kinds. |
| Skill invocation contracts | Capture provider-specific skill invocation behavior before implementing `$` sends. |
| Capability grouping | Keep a unified catalog but render commands, skills, config, permissions, MCP/tools, and session actions distinctly. |
| ACP provider extensions | Capture opencode and Qwen Code ACP frames and preserve extension metadata. |
| opencode serve audit | Keep ACP runtime; document any serve-only semantics that are omitted or used out of band. |

## Scrub Requirement

Before committing docs, tests, fixtures, or code comments, scan for leaked raw
scratch details:

- local absolute paths;
- non-runtime application internals;
- machine-specific process notes;
- unredacted scratch labels;
- unredacted prompts, command output, diffs, credentials, or env.

If a detail is needed for implementation, rewrite it as a runtime contract or
redacted protocol fixture.
