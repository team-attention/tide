# Spec: Wrapped-Agent Local Detection + Menu Availability

v2 treats provider CLIs as **locally-detected Wrapped Agents** (like v1), NOT bundled:
- **Detect** each agent CLI on the local system (`which`). If present → the agent is
  available (and Tide **wraps** it: MCP tool surface + hooks bootstrap so it runs as a
  Tide agent, not a raw CLI).
- **Never remove** an agent from the composer agent menu. If its CLI is absent, show
  the row **disabled** (greyed), not gone — so the user sees what exists and what to
  install.
- **No bundling.** Tide uses the user's installed CLI (version follows the system).

This replaces the old behavior where provider availability and wrapping diverged
between agents.

## Decisions

1. **Detection in the backend infrastructure.** `createLiveBackendContractMessageAdapter`
   already holds the integrations + `resolveExecutable`. Compute an
   `availableAgents: ProviderCliAgentId[]` once (resolveExecutable per agent) and expose
   it so the renderer can disable absent rows. Surface it on the `thread.listed`
   response (the renderer's startup command) — no new event channel needed.
2. **Menu shows all four** provider CLIs always: codex, claude, gemini, opencode.
   Row `disabled = !availableAgents.includes(agentId)`. Selecting a disabled row is a
   no-op.
3. **Wrapping when present.** A detected agent is launched WRAPPED:
   - codex and claude use their provider-native bootstrap/hook paths.
   - gemini and opencode run through ACP over stdio with Tide MCP attached through the
     provider integration.
4. **Availability is provider-CLI scoped**, independent per agent; one absent agent never
   disables another.

## Contract

- `thread.listed` payload gains `availableAgents: ProviderCliAgentId[]`.
- Product Shell state stores `availableAgents`; defaults to all-enabled until the first
  `thread.listed` (avoid a flash of all-disabled).

## Renderer

- `agentChatChoiceSurface` agent_menu rows: render all four provider CLIs, `disabled`
  per availability.
- `composerAgentIdForRow` / selection: ignore selection of a disabled row.

## Wrapping

- codex/claude keep their existing provider bootstrap paths.
- gemini/opencode use ACP structured runtime plumbing.
- opencode vendor/model catalog and auth state are discovered separately so startup
  availability is not blocked by slower opencode subprocesses.

## Tests / Verification

- Unit: detection maps installed→available; menu rows disabled when absent; disabled row
  selection is a no-op.
- Judge: provider smoke stays green for available provider CLIs; Tide MCP remains
  callable from wrapped agents.

## Out of scope (now)

- Auto-install of missing CLIs. Showing an install hint on the disabled row is a later
  polish.
