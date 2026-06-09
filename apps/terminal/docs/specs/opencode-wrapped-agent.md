# Spec: opencode Wrapped Agent

## Overview

### As-Is

Tide auto-integration wraps a **fixed Wrapped Agent set of four CLIs — `claude`, `codex`, `gemini`, and `agy` (Antigravity)**. [opencode](https://opencode.ai) (`opencode`, the SST open-source terminal coding agent) runs **unwrapped**: launched in a Tide Pane it never receives Tide MCP Runtime tools, so it cannot observe or mutate Tide Panes, layout, or Browser Panes, and reports no lifecycle attention (the Workspace rail dot / split highlight never reflect its turns).

Repo / environment evidence:

| Area | Evidence |
|------|----------|
| Fixed set is four agents | `crates/tide-app/resources/bin/` contains exactly `claude`, `codex`, `gemini`, `agy` — there is no `opencode` wrapper. PATH injection (`__TIDE_TERMINAL_WRAPPER_DIR`) therefore never shadows the real `opencode`. |
| `discover_agent_resources()` ships the bin dir | `domain/terminal/mod.rs` prepends the bundled `resources/bin/` dir to every PTY's PATH, so any file added there shadows the real binary — no per-binary registration is needed. |
| opencode honors additive config env vars | The opencode binary loads config from `OPENCODE_CONFIG` (custom file, loaded **between global and project** config), `OPENCODE_CONFIG_DIR`, and `OPENCODE_CONFIG_CONTENT`. All three **merge with** existing config rather than replacing it ([docs/config](https://opencode.ai/docs/config)). The global config lives at `~/.config/opencode/opencode.json`. |
| opencode supports local (stdio) MCP servers | Config key `mcp.<name> = { "type": "local", "command": [bin, ...args], "environment": {…}, "enabled": true }` ([docs/mcp-servers](https://opencode.ai/docs/mcp-servers)). `command` is an **argv array**, env block key is `environment` (not `env`). |
| opencode supports custom context | Config `instructions` is an array of file paths / glob patterns "loaded as system context"; **absolute paths and `~` are allowed** ([docs/config](https://opencode.ai/docs/config)). |
| opencode supports lifecycle plugins | opencode plugins are JS/TS modules exporting `async (input) => Hooks`. The `@opencode-ai/plugin` `Hooks` type (verified in `~/.config/opencode/node_modules/@opencode-ai/plugin/dist/index.d.ts`) exposes `"chat.message"` ("Called when a new message is received"), `"permission.ask"` `(input: Permission, output: {status})`, and a generic `event` hook receiving the SDK `Event` union (which includes `EventSessionIdle = { type: "session.idle" }`, verified in `@opencode-ai/sdk/.../types.gen.d.ts`). Plugins receive `$` (Bun shell) and run in-process, so they read `process.env`. |
| A config `plugin` entry can be a **local file path** | The opencode plugin spec resolver classifies a spec as a `"file"` plugin (vs `"npm"`) when it `startsWith("file://")`, `startsWith(".")`, or is an absolute path (`G(q)` / `x(q)` in the bundled `ConfigPlugin` resolver). An absolute `.js` path therefore loads deterministically, with no dependency on the `.opencode/plugins/` directory-scan name. |
| opencode is installed | `/Users/.../.opencode/bin/opencode`, upgraded to v1.16.2 during this work. |

### To-Be

**Acceptance bar: from the user's point of view, `opencode` behaves identically to `claude`, `codex`, `gemini`, and `agy` inside Tide.** opencode becomes a full member of the Wrapped Agent set with feature parity:

- **Tide MCP Runtime tools** — opencode lists and calls every `tide_*` tool (observe workspace, open browser/editor, send keys, layout actions, capture, context artifacts, …), scoped to its Caller Pane, exactly like the other agents.
- **Wrapper-managed lifecycle attention** — opencode reports `Running` / `Idle` / `NeedsInput` so the Workspace rail dot, split-Pane highlight, and inactive-Workspace highlight react the same as for the others (`Wrapped Agent Presence`, attention dot, etc.).
- **Tide Tool Discovery Context** — opencode receives the same startup guidance to prefer Tide tools before macOS default-app commands.
- **Non-mutating, per-Pane, zero-config** — launching opencode in any Pane "just works" with that Pane's identity, and the user's real `~/.config/opencode` config is never read, reordered, or overwritten.

Tide MCP Runtime stays provider-neutral: no opencode-specific tool surface is added; opencode is just another Wrapped Agent that speaks the same contract.

> Internal mechanism (which env var, which config keys, which plugin hooks) is an implementation detail chosen during build — the only externally meaningful requirement is parity with the existing agents.

### Approach

1. **Add a checked-in `opencode` Agent Wrapper** at `crates/tide-app/resources/bin/opencode`, modeled on the Gemini wrapper: resolve the real `opencode` (stripping the wrapper dir from PATH), skip all injection when `TIDE_TERMINAL_BIN` is unset, and emit `agent-attached` / `agent-detached` presence.
2. **Injection mechanism = a single Tide-owned `OPENCODE_CONFIG` file** under the wrapper config root (`…/agent-wrappers/opencode/opencode.json`), refreshed idempotently each launch, carrying three additive surfaces in one file:
   - `mcp.tide-terminal` — the `tide-terminal` MCP server (`command: [$TIDE_TERMINAL_BIN, "mcp"]`, `environment` = this Pane's `TIDE_TERMINAL_SOCKET/PANE/WINDOW`, `type: "local"`).
   - `instructions: ["<tide-context>.md"]` — Tide Tool Discovery Context, by absolute path.
   - `plugin: ["<tide-terminal>.js"]` — the lifecycle plugin, by absolute path (a `"file"` plugin).
   The wrapper launches the real opencode with `OPENCODE_CONFIG=<that file>`. Because `OPENCODE_CONFIG` is loaded **between global and project** config and **merges**, the user's own `~/.config/opencode` is never edited and their own MCP servers / plugins / instructions still apply.
3. **Lifecycle plugin** (`tide-terminal.js`): `"chat.message"` → `agent-running`, `"permission.ask"` → `agent-needs-input`, `event` with `event.type === "session.idle"` → `agent-idle`. It reads `TIDE_TERMINAL_BIN` / `TIDE_TERMINAL_PANE` from the inherited `process.env` (the wrapper exports them) and runs `tide notify` via the Bun `$` shell, so a single shared plugin routes to the right Pane. Outside Tide the env is unset and the plugin no-ops.
4. **Register opencode in the Wrapped Agent set** — adding the wrapper file is sufficient for PATH shadowing; also map its `--agent opencode` lifecycle hint to a stable display name and update the fixed-set specs.
5. **Close the Antigravity display-name gap** — `wrapped_agent_display_name` currently lacks `antigravity` (so auto-registered Antigravity hooks show the generic "Agent"); add both `antigravity` → "Antigravity" and `opencode` → "opencode".
6. **Add glossary entry** recognizing opencode as a Wrapped Agent provider, keeping runtime names provider-neutral.
7. **Add behavior tests** for wrapper injection, lifecycle wiring, and the display-name mapping.

## Bounded Contexts

| Context | Path | Responsibility |
|---------|------|----------------|
| Agent Wrappers | `crates/tide-app/resources/bin/opencode` | New wrapper: MCP + discovery context + lifecycle plugin injection via `OPENCODE_CONFIG`, per-Pane env. |
| Terminal / PTY env | `domain/terminal/mod.rs` | `discover_agent_resources()` already ships `resources/bin/`; the wrapper set grows to include opencode. |
| Notify / lifecycle | `adapter/inward/cli_adapter/notify.rs`, `cli_adapter/commands.rs` | Best-effort lifecycle signals; auto-register display name. |
| Gateway status | `domain/state/gateway_status.rs` | `wrapped_agent_display_name` maps the `--agent` hint to a stable display name. |

## Use Cases

### UC-1: WrapOpencodeWithTideMcp

Actor: User running `opencode` inside a Tide Terminal Pane

Trigger: User launches `opencode` in a Tide Pane with auto-integration enabled.

Precondition: Tide exported `TIDE_TERMINAL_BIN/SOCKET/PANE/WINDOW` into the PTY and the wrapper bin dir is on PATH.

Flow:

1. PATH resolves `opencode` to the Tide wrapper, which finds the real `opencode`.
2. The wrapper writes the Tide-owned `OPENCODE_CONFIG` file (`mcp.tide-terminal` + `instructions` + `plugin`), the context markdown, and the plugin JS, then launches the real opencode with `OPENCODE_CONFIG` set.
3. opencode merges the Tide config between global and project, starts the `tide-terminal` MCP server (with this Pane's `TIDE_TERMINAL_*` env), completes the handshake, and lists `tide_*` tools.
4. The plugin reports lifecycle to Tide as opencode runs.

Postcondition: opencode can call Tide MCP Runtime tools scoped to its Caller Pane.

Business Rules:

- BR-1: The wrapper must skip all injection when `TIDE_TERMINAL_BIN` is unset (running outside Tide), execing the real `opencode` unchanged.
- BR-2: The injected `tide-terminal` server must carry the launching Pane's `TIDE_TERMINAL_SOCKET`, `TIDE_TERMINAL_PANE`, and `TIDE_TERMINAL_WINDOW` in its `environment` block.
- BR-3: opencode must be shadowed via the bundled `resources/bin/` dir on PATH (`__TIDE_TERMINAL_WRAPPER_DIR`).
- BR-4: Tide MCP Runtime tool surface must stay provider-neutral — no opencode-specific tool is added.

### UC-2: PreserveUserOpencodeConfig

Actor: Tide `opencode` Agent Wrapper

Trigger: The wrapper injects the `tide-terminal` MCP server, context, and plugin.

Precondition: The user may already have an `~/.config/opencode/opencode.json` with their own MCP servers, plugins, and instructions.

Flow:

1. The wrapper writes only Tide-owned files under `…/agent-wrappers/opencode/` and sets `OPENCODE_CONFIG` to point at the Tide-owned config file.
2. The user's real `~/.config/opencode` config and any project `opencode.json` are untouched and still merge (global before, project after the Tide overlay).

Postcondition: The user's own opencode MCP servers, plugins, and instructions are never read, reordered, or overwritten by Tide; Tide only owns its own config file under the wrapper config root.

Business Rules:

- BR-1: The wrapper must write only inside its own `agent-wrappers/opencode/` directory and must not edit `~/.config/opencode/opencode.json` or any project `opencode.json`.
- BR-2: Re-running the wrapper is idempotent (refreshes the Tide-owned files to the current `$TIDE_TERMINAL_BIN`).
- BR-3: Injection uses `OPENCODE_CONFIG` (additive, merged between global and project) — never a destructive rewrite of the user's config.

### UC-3: ReportOpencodeLifecycleLikeOtherAgents

Actor: User watching the Workspace rail / split-Pane attention

Trigger: opencode starts a turn, finishes a turn, or asks for permission.

Precondition: opencode is launched through the Tide wrapper in a Pane.

Flow:

1. On a new user message, the plugin's `chat.message` hook reports `agent-running` for the Pane.
2. On `session.idle`, the plugin's `event` hook reports `agent-idle`.
3. When opencode requests permission, the plugin's `permission.ask` hook reports `agent-needs-input`.
4. Tide updates `Wrapped Agent Presence` and attention exactly as it does for the other agents.

Postcondition: The rail dot, split highlight, and inactive-Workspace highlight behave identically to the other Wrapped Agents.

Business Rules:

- BR-1: The opencode wrapper/plugin must emit `agent-running`, `agent-idle`, and `agent-needs-input` for its Pane via a wrapper-managed path, so attention matches the other Wrapped Agents.
- BR-2: Wrapper attach must establish `Wrapped Agent Presence` for the Pane (`agent-attached`) before the first lifecycle signal, and `agent-detached` on exit, like the other wrappers.
- BR-3: The plugin must resolve the Pane from the inherited `TIDE_TERMINAL_PANE` env (a single shared plugin file cannot bake a Pane id).

### UC-4: NameWrappedAgentsConsistently

Actor: Tide gateway auto-registering a wrapper lifecycle hook

Trigger: A wrapper lifecycle hook (`notify … --agent <name>`) arrives before the process scan has detected the agent.

Precondition: `wrapped_agent_display_name` maps the `--agent` hint to a stable display name; an unmapped hint falls back to the generic "Agent".

Flow:

1. The opencode plugin fires `notify agent-running --agent opencode`.
2. The gateway auto-registers the Pane's agent with display name from `wrapped_agent_display_name("opencode")`.

Postcondition: opencode (and Antigravity) auto-registered agents show their real names, not "Agent".

Business Rules:

- BR-1: `wrapped_agent_display_name("opencode")` returns "opencode".
- BR-2: `wrapped_agent_display_name("antigravity")` returns "Antigravity" (closing the pre-existing gap where Antigravity auto-registered as "Agent").

## Invariants

1. **User-facing parity:** every Wrapped Agent capability the user can observe for the existing agents (MCP tools, lifecycle attention, discovery context, zero-config per-Pane launch) holds equally for opencode.
2. Tide MCP Runtime stays provider-neutral; opencode is a Wrapped Agent, not a new tool family.
3. Wrapped Agent injection is per-Pane: each launched `opencode` gets its own Pane's `TIDE_TERMINAL_*` identity.
4. Agent Wrappers never destructively change the user's real agent configuration. opencode uses an additive `OPENCODE_CONFIG` overlay (merged between global and project), parallel to Claude's `--mcp-config`/`--settings`, Codex's `-c` + `CODEX_HOME` overlay, Gemini's `GEMINI_CLI_SYSTEM_DEFAULTS_PATH`, and Antigravity's plugin dir.
5. The "fixed Wrapped Agent set" grows from `{claude, codex, gemini, antigravity}` to `{claude, codex, gemini, antigravity, opencode}`; `agent-auto-integration.md` and `open-terminal-codex-app.md` are updated to match.

## Tests

| UC | BR | Test module | Test |
|----|----|-------------|------|
| UC-1 | BR-1 | `wrapped_agent_release_integration` | `opencode_wrapper_skips_injection_outside_tide` |
| UC-1 | BR-2, BR-3 + UC-2 BR-1, BR-3 | `wrapped_agent_release_integration` | `opencode_wrapper_injects_mcp_and_context_via_opencode_config_without_mutating_user_config` |
| UC-3 | BR-1, BR-2, BR-3 | `wrapped_agent_release_integration` | `opencode_wrapper_wires_lifecycle_hooks_and_presence_like_other_agents` |
| UC-4 | BR-1, BR-2 | `wrapped_agent_release_integration` | `wrapped_agent_display_name_covers_opencode_and_antigravity` |

## Location

| Layer | Path | Notes |
|-------|------|-------|
| Spec | `docs/specs/opencode-wrapped-agent.md` | This file. |
| Glossary | `docs/glossary.md` | Add opencode as a recognized Wrapped Agent provider. |
| Agent Wrapper | `crates/tide-app/resources/bin/opencode` | New wrapper injecting the Tide `OPENCODE_CONFIG` overlay (UC-1, UC-2, UC-3). |
| Display name | `crates/tide-app/src/domain/state/gateway_status.rs` | `wrapped_agent_display_name` gains `opencode` and `antigravity` (UC-4). |
| Wrapped Agent set | `crates/tide-app/src/domain/terminal/mod.rs` | `discover_agent_resources()` already ships `resources/bin/`; doc comment grows to include opencode. |
| Amended specs | `docs/specs/agent-auto-integration.md`, `docs/specs/open-terminal-codex-app.md` | Grow the fixed set to include opencode. |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/wrapped_agent_release_integration.rs` | Wrapper + lifecycle + display-name coverage. |

## Open Questions

1. ~~Non-mutating override mechanism~~ **RESOLVED**: `OPENCODE_CONFIG` custom config file, merged between global and project — never edits the user's config.
2. ~~Lifecycle hook surface~~ **RESOLVED**: `@opencode-ai/plugin` `Hooks` — `chat.message` → running, `permission.ask` → needs-input, `event`/`session.idle` → idle (types verified locally).
3. ~~Plugin loading without directory-name ambiguity~~ **RESOLVED**: a `plugin` array entry with an absolute path is a `"file"` plugin per the bundled resolver, so no reliance on the `.opencode/plugins/` scan name.
