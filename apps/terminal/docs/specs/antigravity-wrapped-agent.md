# Spec: Antigravity Wrapped Agent

## Overview

### As-Is

Tide auto-integration wraps a **fixed Wrapped Agent set of exactly three CLIs — `claude`, `codex`, and `gemini`**. Antigravity CLI (`agy`, a Gemini-backed Cascade agent) runs **unwrapped**: it never receives Tide MCP Runtime tools, so it cannot observe or mutate Tide Panes, layout, or Browser Panes, and falls back to its own built-in tools (`read_url_content`, `run_command`, …) for work the user expects to happen inside Tide.

Repo / environment evidence:

| Area | Evidence |
|------|----------|
| Fixed set is three agents | `docs/specs/agent-auto-integration.md` Invariant 3: "Keep the supported Wrapped Agent list fixed to `claude`, `codex`, and `gemini`." `discover_agent_resources()` doc (line 8) repeats the fixed set. |
| Only three wrapper scripts exist | `crates/tide-app/resources/bin/` contains `claude`, `codex`, `gemini` — there is no `agy` wrapper. PATH injection (`__TIDE_TERMINAL_WRAPPER_DIR`) therefore never shadows the real `agy`. |
| `agy` is unwrapped at runtime | Latest mmm2 Antigravity transcript (`~/.gemini/antigravity-cli/brain/.../transcript_full.jsonl`) shows zero `tide_*` / `tide-terminal` tool references; only `run_command`, `write_to_file`, `view_file`, `list_dir`, `grep_search`, `read_url_content`. |
| `agy` supports standard MCP | `agy` binary embeds the official `modelcontextprotocol/go_sdk` and an `mcpServers` config schema (command/args/env/serverUrl/headers/disabled/enabledTools/disabledTools). |
| `agy` reads a global MCP config file | `~/.gemini/config/mcp_config.json` (with `~/.gemini/antigravity/mcp_config.json` symlinked to it). Writing a `tide-terminal` entry there caused `agy` to attempt to start the server (`mcp_manager.go` logged `tide-terminal`). |
| Canonical config read path (verified) | `agy` reads `~/.gemini/config/mcp_config.json`. `CASCADE_GLOBAL_CONFIG_OVERRIDE=<dir>` did **not** re-route the mcp config (traced: server never spawned), so the wrapper cannot rely on that env as a config-path override. |
| **Handshake VERIFIED WORKING** | Traced exchange (fresh server name to bypass `agy`'s failed-server cache): `agy` sends `initialize` with `protocolVersion:"2025-11-25"` + `capabilities.elicitation/roots`; our server replies `2024-11-05`; `agy` **accepts it**, sends `notifications/initialized` + `tools/list`, and receives all **29 `tide_*` tools**. No error. There is **no protocol bug**. |
| Earlier "invalid request" explained | The original `mcp_manager.go:1570 ... invalid request` for `tide-terminal` was a **stale failed-server cache** in the live `agy` daemon from an earlier broken probe (a since-deleted trace command). A fresh launch / fresh server name connects cleanly. |
| Per-Pane identity via env inheritance | `mcp.rs` reads `TIDE_TERMINAL_PANE/SOCKET/WINDOW` from its own process env, which the spawned `tide mcp` inherits from `agy`'s PTY env. A single shared static `tide-terminal` config entry therefore routes correctly per-Pane without a per-Pane `env` block. |
| `agy` supports hooks | Binary embeds `hooks.json`, `settings.json`, `HooksPath`, `hooks_config`, `exa.hooks_pb`, `GetStopHooks` — a hooks/settings file mechanism exists (format to confirm). |
| `agy` supports hooks | Binary embeds `exa.hooks_pb`, `GetStopHooks`, `runStopHooks`, `WriteHooksTo` — lifecycle hook injection is feasible but the format is UNVERIFIED. |
| `agy` invocation | Binary at `/Users/eatnug/.local/bin/agy`; flags include `--print/-p`, `--prompt-interactive/-i`, `--dangerously-skip-permissions`, `--continue`, subcommands `plugin`, `install`, `update`. There is no additive `--mcp-config` flag like Claude has. |

### To-Be

**Acceptance bar: from the user's point of view, `agy` behaves identically to `codex`, `claude`, and `gemini` inside Tide.** Antigravity becomes a full member of the Wrapped Agent set with feature parity, not a partial integration. Concretely, parity means all of:

- **Tide MCP Runtime tools** — `agy` lists and calls every `tide_*` tool (observe workspace, open browser/editor, send keys, layout actions, capture, context artifacts, …), scoped to its Caller Pane, exactly like the other three.
- **Wrapper-managed lifecycle attention** — `agy` reports `Running` / `Idle` / `NeedsInput` so the Workspace rail, split-Pane highlight, and inactive-Workspace highlight react the same as for Codex/Claude/Gemini (`Wrapped Agent Presence`, attention dot, etc.).
- **Tide Tool Discovery Context** — `agy` receives the same startup guidance to prefer Tide tools before macOS default-app commands.
- **Non-mutating, per-Pane, zero-config** — launching `agy` in any Pane "just works" with that Pane's identity, and the user's real Antigravity config is never rewritten.

A checked-in `agy` Agent Wrapper delivers this using Antigravity's own configuration/hook surfaces, and the Tide MCP server completes the MCP handshake with Antigravity's MCP client. Tide MCP Runtime stays provider-neutral: no new provider-specific tool surface is added; Antigravity is just another Wrapped Agent that speaks the same contract.

> Internal mechanism (which override env var, hook format, handshake fix) is an implementation detail chosen during build — it is not surfaced to the user. The only externally meaningful requirement is parity with the existing three agents.

### Approach

1. **(Done in investigation) Handshake verified working** — no `mcp.rs` fix required for connectivity. Add a regression test for the Antigravity-style initialize sequence and optionally echo the client's `protocolVersion`.
2. **Add a checked-in `agy` Agent Wrapper** at `crates/tide-app/resources/bin/agy`, modeled on the Gemini wrapper: resolve the real `agy`, skip injection when `TIDE_TERMINAL_BIN` is unset, ensure a `tide-terminal` MCP server entry exists, and add Tide Tool Discovery Context + lifecycle.
3. **Injection mechanism = additive merge of the canonical `~/.gemini/config/mcp_config.json`.** `agy` has no additive `--mcp-config` flag and `CASCADE_GLOBAL_CONFIG_OVERRIDE` does not re-route the config path, so the wrapper merges a `tide-terminal` entry (`command: $TIDE_TERMINAL_BIN`, `args:["mcp"]`) into the canonical file **additively** — preserving every existing user server and only inserting/refreshing the `tide-terminal` key. Per-Pane identity comes from process-env inheritance, so no per-Pane `env` block is needed. The merge must be idempotent and never drop or alter user entries.
4. **Register Antigravity in the Wrapped Agent set** so `discover_agent_resources()` ships the new wrapper and PATH injection shadows the real `agy`, and update `agent-auto-integration.md` Invariant 3 and `open-terminal-codex-app.md` fact 7 from a three-agent fixed set to include Antigravity.
5. **Wire lifecycle signals to reach parity.** Map Antigravity's lifecycle to Tide's `agent-running`/`agent-idle`/`agent-needs-input` so attention behaves like the other three. Use Antigravity's hook surface (`exa.hooks_pb` / stop hooks) if its format is confirmed; otherwise use the wrapper's OSC 9 `tide:wrapped-agent:` fallback already supported by `tide_notify`. Whatever the mechanism, the user-visible attention behavior must match Codex/Claude/Gemini.
6. **Add glossary entry** recognizing Antigravity / `agy` as a Wrapped Agent provider, keeping runtime names provider-neutral.
7. **Add behavior tests** for wrapper injection and for the MCP handshake compatibility.

## Bounded Contexts

| Context | Path | Responsibility |
|---------|------|----------------|
| Agent Gateway / MCP bridge | `adapter/inward/cli_adapter/mcp.rs` | MCP JSON-RPC handshake compatibility with Antigravity's client. |
| Agent Wrappers | `crates/tide-app/resources/bin/` | New `agy` wrapper: MCP + discovery context injection, per-Pane env. |
| Terminal / PTY env | `domain/terminal/mod.rs` | `discover_agent_resources()` and PTY env already export `TIDE_TERMINAL_*`; the wrapper set grows to include Antigravity. |
| Notify / lifecycle | `adapter/inward/cli_adapter/notify.rs` | Best-effort lifecycle signals for the Antigravity wrapper. |

## Use Cases

### UC-1: WrapAntigravityWithTideMcp

Actor: User running `agy` inside a Tide Terminal Pane

Trigger: User launches `agy` in a Tide Pane with auto-integration enabled.

Precondition: Tide exported `TIDE_TERMINAL_BIN/SOCKET/PANE/WINDOW` into the PTY and the wrapper bin dir is on PATH.

Flow:

1. PATH resolves `agy` to the Tide wrapper, which finds the real `agy`.
2. The wrapper writes a wrapper-owned Antigravity config containing the `tide-terminal` MCP server with the current Pane's `TIDE_TERMINAL_*` env.
3. The wrapper points Antigravity at that config via Antigravity's non-mutating override surface and execs the real `agy`.
4. Antigravity starts the `tide-terminal` MCP server, completes the handshake, and lists `tide_*` tools.

Postcondition: `agy` can call Tide MCP Runtime tools (observe workspace, open browser/editor, send keys, layout actions, …) scoped to its Caller Pane.

Business Rules:

- BR-1: The wrapper must skip all injection when `TIDE_TERMINAL_BIN` is unset (running outside Tide), execing the real `agy` unchanged.
- BR-2: The injected `tide-terminal` server must carry the launching Pane's `TIDE_TERMINAL_SOCKET`, `TIDE_TERMINAL_PANE`, and `TIDE_TERMINAL_WINDOW`.
- BR-3: Antigravity must be part of the Wrapped Agent set discovered by `discover_agent_resources()` and shadowed via `__TIDE_TERMINAL_WRAPPER_DIR`.
- BR-4: Tide MCP Runtime tool surface must stay provider-neutral — no Antigravity-specific tool is added.

### UC-2: KeepTideMcpServerCompatibleWithAntigravityClient

> Status: **handshake already verified working** (29 tools delivered to `agy`). This UC is now compatibility *hardening + a regression guard*, not a bug fix. The only optional improvement is echoing the client's requested `protocolVersion` so a future stricter Antigravity build still negotiates.

Actor: Antigravity MCP client (Go MCP SDK) ↔ `tide-terminal mcp`

Trigger: Antigravity starts the `tide-terminal` MCP server and begins the JSON-RPC handshake.

Precondition: The `tide-terminal` server is launched as a child of `agy`.

Flow:

1. Antigravity sends `initialize` with its `protocolVersion`, capabilities, and `clientInfo`.
2. The Tide MCP server responds with a compatible `protocolVersion` and capabilities.
3. Antigravity sends `notifications/initialized` and any handshake methods its SDK requires.
4. Antigravity sends `tools/list`; the server returns all `tide_*` tools.
5. `tools/call` proxies to the Agent Gateway as today.

Postcondition: The connection stays open; no `invalid request` / unexpected-close occurs; existing Claude/Codex/Gemini handshakes still pass.

Business Rules:

- BR-1: The server must not close the connection or emit a malformed/`invalid request` response during a standard MCP initialize → initialized → tools/list sequence from the Go MCP SDK.
- BR-2: `protocolVersion` negotiation must return a version the Antigravity client accepts.
- BR-3: Handshake methods/notifications the client sends (e.g. `notifications/initialized`, `ping`) must be answered per the JSON-RPC + MCP spec (notifications get no response; unknown requests get a well-formed error, never a malformed frame).
- BR-4: The fix must not regress the existing Claude, Codex, and Gemini MCP handshakes.

### UC-3: PreserveUserAntigravityConfig

Actor: Tide `agy` Agent Wrapper

Trigger: The wrapper injects the `tide-terminal` MCP server.

Precondition: The user may already have an Antigravity `mcp_config.json` with their own servers.

Flow:

1. The wrapper reads the user's existing `~/.gemini/config/mcp_config.json` (or empty), inserts/refreshes only the `tide-terminal` server key, and writes it back.
2. Every pre-existing user server and top-level key is preserved verbatim.

Postcondition: The user's own Antigravity MCP servers and settings are never lost, reordered destructively, or overwritten by Tide; the only Tide-owned change is the additive `tide-terminal` key.

Business Rules:

- BR-1: The merge must be **additive and idempotent** — it inserts/refreshes only the `tide-terminal` key and must never remove or alter any user server entry or other top-level key.
- BR-2: A malformed or empty existing config must be tolerated (treated as no user servers) without erroring the wrapper or losing recoverable user data.

### UC-4: ReportAntigravityLifecycleLikeOtherAgents

Actor: User watching the Workspace rail / split-Pane attention

Trigger: `agy` starts a turn, finishes a turn, or asks for input.

Precondition: `agy` is launched through the Tide wrapper in a Pane.

Flow:

1. On turn start, the wrapper reports `agent-running` for the Pane.
2. On turn completion, the wrapper reports `agent-idle`.
3. When `agy` requests input, the wrapper reports `agent-needs-input`.
4. Tide updates `Wrapped Agent Presence` and attention exactly as it does for Codex/Claude/Gemini.

Postcondition: The rail dot, split highlight, and inactive-Workspace highlight behave identically to the other three agents.

Business Rules:

- BR-1: The Antigravity wrapper must emit `agent-running`, `agent-idle`, and `agent-needs-input` for its Pane via a wrapper-managed path (hooks or OSC 9), so attention matches the other Wrapped Agents.
- BR-2: Wrapper attach must establish `Wrapped Agent Presence` for the Pane even before the first lifecycle signal, like the other wrappers.

## Invariants

1. **User-facing parity:** every Wrapped Agent capability the user can observe for Codex/Claude/Gemini (MCP tools, lifecycle attention, discovery context, zero-config per-Pane launch) holds equally for Antigravity.
2. Tide MCP Runtime stays provider-neutral; Antigravity is a Wrapped Agent, not a new tool family.
3. Wrapped Agent injection is per-Pane: each launched `agy` gets its own Pane's `TIDE_TERMINAL_*` identity.
4. Agent Wrappers never destructively change the user's real agent configuration. Claude/Codex/Gemini use additive flags / lowest-priority overlays; the Antigravity wrapper uses an additive, idempotent merge of a single Tide-owned `tide-terminal` key (Antigravity exposes no additive override surface).
5. The "fixed Wrapped Agent set" is amended from `{claude, codex, gemini}` to `{claude, codex, gemini, antigravity}`; `agent-auto-integration.md` and `open-terminal-codex-app.md` must be updated to match.

## Tests

| UC | BR | Test module | Test (proposed) |
|----|----|-------------|-----------------|
| UC-1 | BR-1 | `wrapped_agent_release_integration` | `antigravity_wrapper_skips_injection_outside_tide` |
| UC-1 | BR-2, BR-3 | `wrapped_agent_release_integration` | `antigravity_wrapper_injects_tide_mcp_with_pane_env` |
| UC-1 | BR-4 | `tide_mcp_runtime` | (existing) provider-neutral tool surface tests cover no-new-tool |
| UC-2 | BR-1, BR-2, BR-3 | `tide_mcp_runtime` | `mcp_handshake_completes_for_go_sdk_initialize_sequence` |
| UC-2 | BR-4 | `tide_mcp_runtime` | (existing) `mcp_initialize_for_test` / tools-list tests must still pass |
| UC-3 | BR-1, BR-2 | `wrapped_agent_release_integration` | `antigravity_wrapper_preserves_user_mcp_config` |
| UC-4 | BR-1, BR-2 | `wrapped_agent_release_integration` | `antigravity_wrapper_emits_lifecycle_signals_like_other_agents` |

## Location

| Layer | Path | Notes |
|-------|------|-------|
| Spec | `docs/specs/antigravity-wrapped-agent.md` | This file. |
| Glossary | `docs/glossary.md` | Add Antigravity / `agy` as a recognized Wrapped Agent provider. |
| MCP bridge | `crates/tide-app/src/adapter/inward/cli_adapter/mcp.rs` | Handshake compatibility fix (UC-2). |
| Agent Wrapper | `crates/tide-app/resources/bin/agy` | New wrapper (UC-1, UC-3). |
| Wrapped Agent set | `crates/tide-app/src/domain/terminal/mod.rs` | `discover_agent_resources()` ships and shadows `agy`. |
| Amended specs | `docs/specs/agent-auto-integration.md`, `docs/specs/open-terminal-codex-app.md` | Grow the fixed set to include Antigravity. |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/wrapped_agent_release_integration.rs`, `.../tide_mcp_runtime.rs` | Wrapper + handshake coverage. |

## Open Questions

1. ~~Non-mutating override mechanism~~ **RESOLVED**: no config-path override; use additive merge of `~/.gemini/config/mcp_config.json`.
2. ~~Root cause of `invalid request`~~ **RESOLVED**: stale failed-server cache in the live daemon, not a protocol bug; handshake verified delivering 29 tools.
3. **Antigravity hook format (OPEN)** — exact `hooks.json` / `settings.json` schema `agy` reads for lifecycle. Needed for full `Running`/`Idle`/`NeedsInput` parity (UC-4). Until confirmed, the wrapper establishes `Wrapped Agent Presence` on attach/detach and emits best-effort signals; turn-level lifecycle parity is finished once the schema is verified.
