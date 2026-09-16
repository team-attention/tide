# Spec: Live Model Catalog and Mistral Vibe

## Scope
Query installed provider CLIs for selectable models and add Mistral Vibe as a Provider CLI Agent.

## Evidence
- Codex detection already queries `codex debug models`; OpenCode queries its CLI.
- Local Claude control `initialize` returns `models` with native values, display names and supported effort levels without a user prompt.
- Installed Vibe exposes `vibe-acp`; ACP session/new returns model/mode/thinking config options. It implements session/load and session/set_config_option.
- Existing ACP runtime already handles conversation, tools, permission requests, cancellation and session references.

## Decisions
- Use provider-reported models, with existing last-successful catalog persistence. Never substitute a curated model list after failure.
- Before discovery, offer only provider default; preserve existing custom model selections.
- Claude discovery uses a bounded, prompt-free stream-json initialization and terminates its process after the response.
- Vibe discovery uses bounded ACP initialization and session/new without a prompt. Preserve native model aliases.
- Vibe runs through the shared ACP runtime, including Tide MCP. Native session refs support resume.
- Vibe model rows include the ACP thinking choices. Permission choices use native ask/plan/accept-edits/auto-approve values; Tide Default preserves the provider setting without a mode write.
- Native standalone review commands and external session import remain unsupported for Vibe; regular review prompts work through Agent Chat.
- Keep discovery asynchronous and collapse concurrent identical requests. Failure remains retryable.

## Out Of Scope
Importing old external Vibe sessions and interpreting Vibe transcript files.

## Domain Model
Mistral Vibe is a Provider CLI Agent with id `vibe`, a provider-native session reference and ACP transport.

## Contracts
Extend provider ids with `vibe`. Reuse ProviderCatalogSnapshot and ACP runtime events.

## Flow
Provider inventory → asynchronous catalog query → Composer model options → launch ACP → apply native config → prompt.

## Invariants
Discovery never sends a prompt or approves a tool request. Processes have bounded output and lifetime. Model ids are never invented.
ACP startup applies selected config options before reporting readiness or sending the first prompt; rejected config prevents that prompt.

## Tests
- Claude model parsing retains native ids and per-model efforts; malformed/empty responses fail.
- Probe processes terminate on response, timeout, early exit and malformed protocol output.
- Vibe start/resume plans use ACP and retain MCP/session configuration.
- Inventory and catalog routing include Vibe; failures have no static model rows.
- Vibe bindings round-trip through contract validation and Composer selection. Claude and Vibe model menus render injected catalogs without a built-in model list.
- A delayed ACP model config acknowledgement must precede the first prompt; ACP runtime catalogs retain reported thinking choices.
- Existing last-known catalog tests and shared ACP behavior tests remain valid.

## Implementation Notes
Keep catalog transport/discovery in backend infrastructure and provider launch behavior in its integration adapter.

## Verification (2026-09-15)
- Desktop typecheck and production build passed. Full test suite: 1,479 passed, 2 skipped, 0 failed.
- Real Claude initialization and Vibe ACP model discovery succeeded without prompts.
- Real Tide Vibe smoke: one visible answer, idle on completion. Approval-deny smoke: one prompt, no duplicate, idle on completion.
- Model probes use the Backend owned-process registry and terminate on success/error/timeout.
- New discovery module owns catalog probing/parsing; Vibe integration owns launch/readiness/config plans; shared ACP client owns configuration ordering.

### Catalog transport regression
Catalog events must omit undefined optional fields recursively, including absent project scope and request id. Both startup pushes and requested refreshes use the same event builder. Tests validate the event through the Electron boundary validator before applying it to a shell with a stale saved catalog; a discovered Astra row must replace that catalog.

Provider-native effort values (including Astra ultra and future values) must render without requiring a local label entry and remain selectable without rewriting their value.

### Cross-provider verification
All four provider catalog events must pass the actual strict JSON event validator with absent scope and request id. Codex, Claude and Vibe menus must render and select an unfamiliar model/effort without a local enum update. The selected native values must survive start plans and supported live updates; provider-side rejection must not be replaced with silent omission. OpenCode model-specific effort discovery and selection follow the native metadata path described below.

### OpenCode native effort follow-up
OpenCode discovery uses `models --verbose` in the requested project cwd. Its model metadata `variants` keys are the effort values; preserve them per model, including empty lists, without synthesizing low/max. Display only the selected model's reported options and preserve unfamiliar values through ACP `effort`. ACP model-only updates must preserve existing per-model metadata; an explicit ACP effort list applies only to its current model. Codex catalog reads also use the requested cwd. Concurrent discovery is coalesced per cwd, never across projects. Tests cover verbose parsing, missing metadata, per-model menus, native selection and project isolation. Compare the live CLI output with Tide's catalog values.

### Vibe initial permission regression (2026-09-16)
Installed Vibe ACP advertises `ask`, `plan`, `accept-edits`, and `auto-approve`;
its current mode is `accept-edits`. `default` is a Tide sentinel, not a native
mode. Start/resume and live config must omit the mode write for that sentinel,
preserving provider configuration. Offer Ask explicitly and remove unsupported
Chat. Explicit native modes remain unchanged. Configuration failures must include
the rejected value and provider error rather than hide the diagnostic.
Tests cover default start/resume/live config omission, explicit mode preservation,
and startup failure preventing prompts with the native error retained. Verify
actual installed ACP initialization with the default Composer launch options.

Verification: 1,492 desktop tests passed, 2 skipped; typecheck and production build
passed. Installed Vibe accepted all four explicit modes and Tide Default through
the actual ACP runtime. A Default-mode prompt returned `VIBE_OK` and `end_turn`.
The integration owns sentinel translation; the shared descriptor owns labels;
ACP error handling retains native diagnostics. No runtime protocol or build
workflow changes were needed.
