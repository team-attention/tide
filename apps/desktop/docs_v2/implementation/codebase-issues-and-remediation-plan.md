# Codebase Issues and Remediation Plan

## Status

Archived and superseded on 2026-06-20.

The previous remediation plan included a direct API-agent smoke/runtime path. That path is
removed. Current remediation work should use these constraints:

- Keep the product Thread-first.
- Keep the visible Workbench Thread-owned.
- Keep Agent Runtime hidden by default.
- Keep selectable Agents to Codex, Claude, Gemini, and opencode provider CLIs.
- Keep opencode vendor auth provider-owned.
- Reject removed direct API-agent contract shapes at the boundary.

Use the focused specs under `docs_v2/specs/` for current implementation guidance.
