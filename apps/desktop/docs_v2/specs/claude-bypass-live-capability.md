# Spec: claude Bypass-Permissions live-switch capability

## Scope

Make a **mid-thread switch to "Bypass permissions"** on a claude Thread actually take
effect, like every other permission mode already does. Today the chip flips and Tide
reports "applied", but the agent keeps asking — switching to `bypassPermissions` is the
**one** permission value that does not apply, and Tide silently swallows the refusal.

This is a follow-up/correction to `mid-thread-launch-option-changes.md` +
`mid-thread-launch-option-feedback.md` (which verified `acceptEdits`, never `bypass`).

## Evidence (claude 2.1.179, direct stdin control-protocol probes)

Same transport flags Tide spawns with (`--print --input-format stream-json
--output-format stream-json --verbose --include-partial-messages
--permission-prompt-tool stdio`):

- A live `set_permission_mode` is **accepted for every mode except bypass** from a
  normally-launched session:
  `default / acceptEdits / plan / auto / dontAsk` → `control_response success` (live);
  `set_model <id>` → success (live). **Only** `bypassPermissions` →
  `control_response error: "Cannot set permission mode to bypassPermissions because the
  session was not launched with --dangerously-skip-permissions"`.
- `bypassPermissions` is gated on the session being **bypass-CAPABLE at launch**. Two
  CLI flags grant capability:
  - `--dangerously-skip-permissions` — grants capability **and FORCES** the start mode
    to `bypassPermissions` (binary `dispatchDefaults: permissionMode =
    dangerouslySkipPermissions ? "bypassPermissions" : permissionMode`). Not what we
    want (we don't want to force bypass at start).
  - `--allow-dangerously-skip-permissions` — grants capability **without** forcing the
    mode. **Proven**: launched `--permission-mode acceptEdits
    --allow-dangerously-skip-permissions` → init `permissionMode: "acceptEdits"` AND a
    live switch to `bypassPermissions` → `success`. Same for `default`.
- This is the CLI projection of the SDK `query()` option `allowDangerouslySkipPermissions`
  (binary: a var DISTINCT from `dangerouslySkipPermissions`, default `false`; setting
  `permissionMode === "bypassPermissions"` auto-sets it true). The interactive app's
  ⇧⌘M → Bypass works because it enables this capability (consent via
  `BypassPermissionsModeDialog` → persisted `bypassPermissionsModeAccepted`); org policy
  `disableBypassPermissionsMode` can still forbid it ("disabled by settings or
  configuration"). Tide drives the headless harness, whose only consent channel is the
  launch flag — Tide simply was not passing it.
- Tide compounding bug: `claude-stream-json-client.handleMessage` has **no
  `control_response` case** (falls through, ignored ~line 380), so the refusal is
  invisible. `applySessionConfig` returns "applied"/live, `pendingRuntimeRestart` stays
  false, and interrupt+resend reuses the same flag-less process — silently stuck.

## Design

**1 — Capability flag (core, delivers the feature).** Add
`--allow-dangerously-skip-permissions` to `claudeLaunchPlan` args (claude-agent-integration.ts).
Every claude spawn becomes bypass-CAPABLE while still **starting in the user's chosen
`--permission-mode`** and staying there until the user explicitly picks Bypass (no
auto-escalation; policy still wins). The existing `buildSessionConfigUpdate` already
returns `{kind:"live", permissionMode}` for permission, so the live `set_permission_mode
bypassPermissions` path now succeeds with **no other change** — instant, mid-turn, like
the app.

Transition note: a claude process spawned by a *pre-fix* build is flag-less, but shipping
the fix relaunches Tide, which kills those subprocesses; the next message resumes a fresh
spawn that carries the flag. So the flag alone covers real scenarios.

**2 — Refusal → transparent restart fallback (hardening, defense-in-depth).** Parse the
`control_response` for `cfg-*` requests in `claude-stream-json-client`. On an error
response to a config change, signal the runtime/service to set `pendingRuntimeRestart`
so the next turn respawns via `--resume` (with the flag + the new `--permission-mode`,
which starts directly in the target mode) and to flip the chip feedback from "applied"
to "next message". This closes the **general** silent-swallow gap (any future gated
transition), not just bypass. Never surfaces a "please restart" — it's hidden under the
turn spinner.

UX: capable session → instant live; flag-less session → one transparent restart, then
live. The user never sees a manual restart prompt.

## Verification

- Probe (no display needed): re-run the stdin probes above asserting the live-switch
  matrix and that `--allow-dangerously-skip-permissions` preserves the start mode while
  permitting the bypass switch.
- Live app: start a claude Thread in default/acceptEdits → give it a task that needs
  permission → it prompts → switch chip to **Bypass permissions** → next message's tool
  runs with **no prompt** (and `TIDE_DEBUG_STRUCTURED=1` shows `set_permission_mode
  bypassPermissions` → `control_response success`, no error).
