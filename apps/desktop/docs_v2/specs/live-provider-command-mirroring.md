# Spec: Live Provider Command Mirroring

## Goal

The composer's `/` (commands) and `$` (skills) menu shows the agent's **real,
full command set** — the exact list the underlying coding agent itself exposes —
for **all four providers** (Claude, Codex, Gemini, opencode), **including on the
Start Composer** (before any thread has started). Tide is a faithful front-end to
the coding agent; the slash menu must mirror the agent, not a Tide-curated subset.

Concretely: on the Start Composer scoped to this repo + Claude, typing `/` lists
the same ~32 commands `claude` reports in its own init (`check`, `work`, `verify`,
`code-review`, `loop`, `run`, `insights`, `security-review`, `usage`, **`goal`**,
…) — not just the 5 `.claude/commands/*.md` files + 9 hardcoded built-ins.

## Current state & gap

- The real command set IS already parsed per provider and emitted as a uniform
  `commands` StructuredProviderEvent, but ONLY while a runtime is live:
  - claude — stream-json `init.slash_commands` + `skills` (`claude-stream-json-client.ts:452`). **Verified live: 32 commands incl. `goal`.**
  - gemini / opencode — ACP `session/update { available_commands_update }` (`acp-client.ts:578`).
  - codex — app-server `skills/list` at startup (`codex-app-server-client.ts:192`).
  - → `agentRuntime.commandsChanged` → `setProductShellProviderCommands` REPLACES the list (`events.ts:105`).
- **Gap:** with no running runtime (Start Composer, or an idle hydrated thread
  before its first message) Tide falls back to `discoverProviderCommands`
  (`provider-command-discovery.ts`) = file globs (`.claude/commands/*.md`, …) **+
  a hand-curated hardcoded built-in list** (claude: 9). Commands that aren't
  cwd files and aren't in the hardcoded list (e.g. `/goal`, `/verify`,
  `/code-review`, plugin/skill commands) are simply missing.

The old spec (`provider-command-discovery.md`) deliberately chose file-only / no
spawn. This spec supersedes that decision for the built-in/full set: we MUST ask
the agent, because only the agent knows its real command set.

## Decision

Add a backend **command-discovery probe**: a handshake-only runtime that captures
the provider's `commands` event without running a turn, cached per `(agentId,
cwd)`. Uniform across providers, reusing each existing client's `commands`
parsing — not a re-implementation per provider.

- **acp (gemini, opencode)** & **codex**: spawn with **no initial prompt** — the
  protocol reports commands during the `initialize`/`session.new`/`skills/list`
  handshake, before any turn. Free (no model call).
- **claude**: stream-json input mode emits `init` only after the first stdin
  write, so the probe writes a **minimal throwaway input** to trigger `init`,
  captures `slash_commands`+`skills`, then **stops immediately** (kills before the
  turn produces output). Near-zero cost.
- **Hard timeout** (default 8s) + guaranteed teardown; on timeout/failure the
  probe resolves empty and the file-discovery fallback stands.
- **Cache** the result per `(agentId, cwd)` in the backend for the process
  lifetime; real `commands` events from actual runs refresh the same cache for
  free. The Start Composer reads the cache instantly, triggering a probe only on
  a cache miss.
- **Codex auth safety:** Codex must not have its auth disturbed while Codex.app is
  running (known constraint). The codex probe does the app-server handshake only
  (no turn, no login mutation); if it ever proves unsafe, codex degrades to
  cache-from-real-runs + file skills rather than an aggressive spawn.

File discovery (`.claude/commands/*.md`, `.codex/skills`, `.gemini/commands`)
stays as the **instant first paint** and offline fallback; the probe result, when
it arrives, replaces it (richer + authoritative). The hardcoded built-in list is
removed (superseded by the real reported set).

## Contracts

- New backend command `provider.discoverCommands { agentId, cwd }` (renderer →
  main → backend). Backend runs the probe (or returns cache) and emits
  `agentRuntime.commandsChanged` extended with `{ agentId, cwd, commands }` so the
  renderer scopes the result to the active (agent, cwd).
- `AgentRuntimeEventSource` already has optional `queryCommands?`; add a
  `discoverCommands(agentId, cwd): Promise<commands>` to the runtime port (spawns
  handshake-only client, awaits first `commands` event, stops).
- Renderer: the Start-Composer effect (`product-shell.tsx:297`) dispatches
  `provider.discoverCommands(agentId, cwd)` in addition to the instant file list.

## Verification (device-verified through the real app)

Harnesses: `pw-start-slash-verify.cjs` (claude Start Composer) +
`pw-agent-commands-verify.cjs` (switches the composer agent chip → `/`). All via
the real backend probe → `commandsChanged`; never sends a turn.

1. **claude ✅** — Start Composer `/` lists the full **32** incl. `/goal`. Cached;
   same scope does not re-spawn. claude needs a throwaway `initialPrompt` to emit
   its init (probe stops the instant `commands` arrive). Descriptions are a
   placeholder ("Claude command") — claude's init reports names only.
2. **gemini ✅** — **20** real commands incl. subcommands (`/memory show`,
   `/extensions list`, …) WITH rich descriptions, via ACP `available_commands_update`
   at handshake (slow, ~7-9s; read after the 8s probe timeout). Subcommands are
   distinct names (not dupes); the menu dedupes by name defensively.
3. **opencode ✅** — **3** commands (`/customize-opencode`, `/init`, `/review`) via
   ACP handshake (no prompt).
4. **codex — faithful but empty here.** codex's app-server exposes `skills/list`
   (the `$` skills trigger), NOT its built-in `/` slash commands (those are
   TUI-only, never sent over the machine protocol). This repo has no `.codex/skills`
   → empty `/`. We mirror what codex exposes; it exposes no programmatic slash
   commands. (Handshake only — never disturbs Codex.app auth.)
5. In-thread behavior unchanged (live `commands` event still authoritative).
6. Offline / probe-timeout: `discoverCommands` resolves `[]` (8s), the instant
   file-discovery list stands — no hang, no crash.

Remaining polish: merge file-discovery descriptions into the claude set so
`/check` etc. show their real description instead of the "Claude command"
placeholder (commandsChanged currently REPLACES `providerCommands`).

## Out of scope

- Executing the command (still just inserts the token into the draft).
- Per-command argument hints / autocomplete beyond name + description.
