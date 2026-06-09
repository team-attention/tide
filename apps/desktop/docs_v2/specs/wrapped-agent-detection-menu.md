# Spec: Wrapped-Agent Local Detection + Menu Availability

v2 treats provider CLIs as **locally-detected Wrapped Agents** (like v1), NOT bundled:
- **Detect** each agent CLI on the local system (`which`). If present → the agent is
  available (and Tide **wraps** it: MCP tool surface + hooks bootstrap so it runs as a
  Tide agent, not a raw CLI).
- **Never remove** an agent from the composer agent menu. If its CLI is absent, show
  the row **disabled** (greyed), not gone — so the user sees what exists and what to
  install.
- **No bundling.** Tide uses the user's installed CLI (version follows the system).

This replaces the current behavior where Antigravity was deleted from the menu and
gemini was spawned raw (no wrapping).

## Decisions

1. **Detection in the backend infrastructure.** `createLiveBackendContractMessageAdapter`
   already holds the integrations + `resolveExecutable`. Compute an
   `availableAgents: ProviderCliAgentId[]` once (resolveExecutable per agent) and expose
   it so the renderer can disable absent rows. Surface it on the `thread.listed`
   response (the renderer's startup command) — no new event channel needed.
2. **Menu shows all four** provider CLIs always: codex, claude, gemini, antigravity.
   Row `disabled = !availableAgents.includes(agentId)`. Selecting a disabled row is a
   no-op. Antigravity is re-added (disabled unless its CLI resolves) — note it also
   can't authenticate when spawned, a separate runtime limitation.
3. **Wrapping when present.** A detected agent is launched WRAPPED:
   - claude/codex/antigravity already bootstrap MCP + hooks (provider-bootstrap-artifacts).
   - **gemini must too**: write `~/.gemini/settings.json` hooks (Claude-compatible:
     PreInvocation/PostToolUse→agent-running, Stop→agent-idle) + Tide MCP server entry,
     so gemini's turn-end comes from the runtime-keyed hook and the Tide tool surface is
     attached — same as the others. (Current gemini runs raw `--yolo`, unwrapped.)
4. **Availability is provider-CLI scoped**, independent per agent; one absent agent never
   disables another.

## Contract

- `thread.listed` payload gains `availableAgents: ProviderCliAgentId[]`.
- Product Shell state stores `availableAgents`; defaults to all-enabled until the first
  `thread.listed` (avoid a flash of all-disabled).

## Renderer

- `agentChatChoiceSurface` agent_menu rows: render all four, `disabled` per availability.
- `composerAgentIdForRow` / selection: ignore selection of a disabled row.

## Wrapping (gemini bootstrap)

- Extend `provider-bootstrap-artifacts` with a gemini settings path; write hooks + MCP
  into `~/.gemini/settings.json` (merge, don't clobber the user's settings).
- gemini adapter: prefer turn-end from the Stop hook (last_assistant_message if present)
  via the uniform `turnEndFromHook`, falling back to the session-JSONL
  `turnEndFromHistory` already implemented.

## Tests / Verification

- Unit: detection maps installed→available; menu rows disabled when absent; disabled row
  selection is a no-op.
- Judge: `scripts/v2-provider-smoke.mjs --agent gemini` stays green; gemini wrapped run
  still answers + settles; Tide MCP tool callable from gemini.

## Out of scope (now)

- Auto-install of missing CLIs. Showing an install hint on the disabled row is a later
  polish.
