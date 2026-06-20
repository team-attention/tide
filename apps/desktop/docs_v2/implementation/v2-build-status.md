# Tide v2 Build Status and Unblock Runbook

## Status

This implementation note was reset on 2026-06-20 after the direct API-agent path was
removed.

Current architecture:

- Desktop app: Electron + React Product Shell.
- Product flow: Thread rail -> Thread detail Agent Chat -> Thread-owned Workbench.
- Agents: Codex, Claude, Gemini, and opencode provider CLI integrations.
- Runtime: hidden provider runtime for Agent work; visible Workbench Terminal is an optional
  Thread-owned pane, not the default product surface.
- MCP: provider CLI Agents operate their own Thread Workbench through Tide MCP.
- opencode vendor auth: provider-owned opencode credential path, not a Tide-owned API Agent.

## Verification

Current full verification command:

```sh
npm run typecheck
npm test
```

`npm test` includes MCP Unix-socket tests. In a restricted Codex sandbox those tests can fail
with `listen EPERM`; run the same command with local socket permission to verify the real
socket bridge.

## Removed Paths

- Direct Tide-owned API Agent runtime.
- API-agent runtime/readiness router.
- Fake OpenAI smoke server options.
- API-agent model/readiness UI rows.

The current smoke scripts are provider CLI only.
