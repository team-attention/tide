# Spec: opencode Composer Model And Provider Flow

## Scope

Make the opencode Model Chip a composer-attached control surface for the whole
opencode model/provider task while keeping Tide's existing Composer chip
grammar: a compact anchored popover, one row list at a time, with drilldown for
provider -> model -> connect/auth details.

This is a follow-up to `opencode-model-vendor-selection.md`,
`cross-provider-model-catalog-and-hub.md`, and `opencode-vendor-onramp.md`.
Those specs established the catalog, auth, and Settings hub foundations. This
spec fixes the working-surface UX: the user should be able to handle the common
opencode model/vendor decisions from the Composer, not only from Settings and
not through a flat row menu and not through a Settings-sized panel.

## Evidence

- `docs_v2/glossary.md` defines the Model Chip as a Composer chip backed by the
  selected provider CLI Agent Integration. Before launch it sets a Launch
  Option; after launch it can mirror the provider-native model command when
  supported.
- `docs_v2/master-plan.md` keeps the Composer anchored to Agent Chat and says
  opencode model choices come from opencode's provider/vendor catalog.
- `opencode-model-vendor-selection.md` already decides that opencode needs a
  searchable, vendor-filterable model browser, and that opencode model, effort,
  and mode changes apply live through ACP `session/set_config_option`.
- `opencode-vendor-onramp.md` already decides that vendor auth is opencode-owned,
  that API-key entry can be handled through opencode's own local server path,
  and that Tide stores no vendor keys.
- Current code splits the opencode task across two surfaces:
  - `view-model.ts` opens `opencode_connect` only when `!isOpencodeUsable()`;
    otherwise the Model Chip opens `model_menu`.
  - `choice-surfaces.ts` renders opencode's usable model menu as a flat
    vendor-grouped row list plus an "Add a vendor..." row.
  - `opencode-connect-panel.tsx` renders a rich vendor grid and method sheet,
    but only for the connect surface. It does not host the full model browser.
  - `choice-surface.tsx` is a compact generic row list with no search box,
    vendor filter, or step state.
- `DESIGN.md` for Tide Desktop Workbench prefers contextual, scoped surfaces and
  dense row systems. It also says feature surfaces should teach by structure,
  not explanatory text blocks. A large Settings-only workflow is too far from
  the point of intent; a tiny flat menu is too weak for opencode's catalog.
- Existing Composer chip surfaces are compact anchored popovers:
  - `context-chips.tsx` positions a chip popover from the clicked chip and caps
    its left edge against a 396px budget.
  - `choice-surface.css` keeps the default surface `max-width: min(380px, 100%)`
    with 34px rows and a small uppercase header.
  - Agent, Permission, Project, Worktree, Branch, and standard Model menus are
    all one row list at a time.
  - `opencode-connect-panel.css` is already the exception at 384px, but it is a
    temporary connect on-ramp, not the normal model-picker shape.

## Decisions

1. **The Model Chip is the entry point.** For opencode, the Model Chip always
   opens one opencode-specific composer-attached surface, regardless of whether
   opencode is already usable. The surface chooses the right step internally.
2. **Follow the existing chip-popover size and row grammar.** opencode may have
   a custom renderer only where the generic row surface cannot host local state
   such as API-key entry, but the normal state must fit the same 380-384px
   anchored popover budget and 34px row rhythm.
3. **Use drilldown, not a wide two-column panel.** Root shows provider rows.
   Selecting a connected provider replaces the popover contents with that
   provider's model rows plus a Back row. Selecting an unconnected or
   reconnect-needed provider replaces the popover contents with that provider's
   auth method rows.
4. **Provider is the first visible choice.** If opencode has concrete models,
   the root opens on providers: current provider, OpenCode Zen, connected
   vendors, and reconnect-needed vendors. The model list appears only after
   selecting a provider.
5. **The first step is connect when opencode is not usable.** If there are no
   concrete models and no usable connected vendor, the root still follows row
   grammar: OpenCode Zen, popular provider rows, and API-key or browser sign-in
   drilldown.
6. **Connecting a vendor stays inside the composer flow until a terminal is
   truly needed.** API-key entry remains in local React component state and
   calls the existing opencode server command path. Browser/OAuth opens the
   existing provider-readiness Terminal Pane, then returns through
   `retry_preflight` and catalog/vendor refresh.
7. **Settings remains a management home, not the only usable path.** The
   Providers & Models hub keeps its existing management UI and shares the same
   catalog/vendor source of truth, while the everyday path is Composer -> Model
   Chip -> opencode surface.
8. **Permission stays the Permission Chip.** The opencode model/provider surface
   may display the current Build/Plan mode as context, but mode changes continue
   through the existing Permission Chip unless a later spec merges them.
9. **No new runtime or auth source.** Runtime stays `opencode acp`; model,
   effort, and mode changes still apply through `session/set_config_option`;
   vendor auth still uses opencode's own credential store.

## Out Of Scope

- Replacing the Settings Providers & Models hub.
- A first-run wizard or global onboarding sequence.
- Tide-owned provider credentials or a Tide API-agent runtime.
- Reworking Codex or Claude model menus.
- Cost, context-window, or benchmark columns in the composer surface.
- A numeric `budget_tokens` reasoning slider.

## Completion Definition

This slice is complete only when the opencode Model Chip is end-to-end wired to
real Tide/opencode state and the old opencode flat `model_menu` path is no
longer reachable from the Composer.

The implementation must include:

- the `opencode_model_provider` surface kind and Desktop state;
- provider root, connected-provider model drilldown, connection update row,
  unconnected/reconnect method drilldown, API-key entry, and browser-auth
  terminal handoff;
- model and effort selection through existing Launch Options and live opencode
  ACP config updates where an active session supports them;
- vendor auth completion refresh so newly connected vendors and models appear
  without app restart;
- regression coverage proving Codex and Claude keep their existing compact
  model menus.

This slice is not complete if opencode falls back to the old flat model menu,
shows only a sentinel/default model when opencode catalog data should be
available, opens Settings as the primary path, or implements only the mock UI
without command wiring and tests.

## Domain Model

Desktop-only view state:

```ts
type OpencodeModelProviderStep =
  | "provider_list"
  | "model_list"
  | "connect_vendor"
  | "vendor_method"
  | "api_key";

interface OpencodeModelProviderView {
  step: OpencodeModelProviderStep;
  selectedProvider?: string;
  currentModel?: string;
  currentEffort?: string;
  models: ProviderModelDto[];
  vendors: AgentChatOpencodeConnectVendorView[];
  zenFreeCount: number;
  version?: string;
}
```

Existing data sources:

- `ProviderModelCatalogDto` for models, vendor grouping, current model, and
  effort options.
- `OpencodeVendorDto` / current `AgentChatOpencodeConnectVendorView` for vendor
  connected and reconnect state.
- `OpencodeEnvironmentDto` for version and executable path.
- Existing Launch Options for selected model and effort.

The surface view is Desktop application state, not a new shared Backend domain.

## Contracts

- Add a Desktop surface kind: `opencode_model_provider`.
- Add structured view data to `AgentChatChoiceSurfaceView`, for example
  `opencodeModelProvider?: OpencodeModelProviderView`.
- Keep the existing row-list gating pattern for actions that leave the panel:
  `provider:<id>`, `model:<id>`, `effort:<value>`, `connect-vendor:<id>`,
  `use-free-model`, `back`, and `open-connect-step`.
- No new Shared Contract is required for model/vendor data. Existing
  `thread.listed` catalog/vendor fields and `provider.opencodeConnectApiKey`
  remain the backend boundary.
- No new Backend command is required for model selection. Continue using
  `thread.setLaunchOptions`.

## Flow

1. User clicks the opencode Model Chip.
2. Desktop opens `opencode_model_provider`.
3. If opencode has concrete models, the surface starts in `provider_list`:
   - Current provider is selected/checked.
   - Provider rows include OpenCode Zen, connected vendors, reconnect-needed
     vendors, and unconnected popular vendors.
   - Selecting a connected provider opens `model_list` in the same popover.
   - Selecting an unconnected or reconnect-needed provider opens
     `vendor_method` in the same popover.
4. In `model_list`:
   - Header/source label shows the selected provider.
   - A Back row returns to `provider_list`.
   - Connected non-Zen providers show one compact secondary connection row
     that displays auth status and opens the same provider update/reconnect
     method drilldown.
   - Rows show only the selected provider's models.
   - Selecting a model emits `thread.setLaunchOptions` with `model`.
   - Selecting an effort emits `thread.setLaunchOptions` with `reasoning`.
5. If opencode is not usable, the surface starts in `connect_vendor`:
   - OpenCode Zen can choose the opencode default/free path.
   - Vendor tile opens `vendor_method`.
   - Reconnect tile uses the same method step.
6. In `vendor_method`:
   - Browser sign-in opens provider-readiness Terminal Pane with
     `opencode auth login -p <vendor>`.
   - Paste API key switches to `api_key`.
7. In `api_key`:
   - Key is held only in component state.
   - Submit calls the existing API-key command.
   - On completion, Desktop refreshes opencode vendors and models.
   - If new models exist, return to `provider_list` with the new provider
     selected.
8. On active threads, selected model/effort changes apply live through the
   existing opencode ACP config path. In-flight turns are not interrupted.

## Invariants

- The opencode Model Chip never opens a flat long model list.
- The normal opencode surface stays within the existing chip-popover budget and
  row rhythm; it does not become a two-column settings-like panel.
- Provider is always the first visible choice before model rows; users do not
  have to infer provider from model ids alone.
- The user can reach vendor connect/reconnect from the Model Chip even when
  opencode is already usable, by selecting that provider row.
- The composer root does not include generic "More" or "Add provider" rows.
  Provider rows themselves are the connect/reconnect affordance.
- The connected-provider update affordance is secondary to model choice: it is
  a compact row inside `model_list`, not another provider-management panel.
- Back from `vendor_method` returns to the surface step that opened it:
  `provider_list`, `model_list`, or `connect_vendor`.
- A connected vendor and the model catalog always reflect opencode's reported
  state. Tide never fabricates a model, vendor, or credential.
- API keys never enter global Desktop state, Thread state, logs, or shared
  contracts.
- Browser/OAuth auth is always opencode-owned and runs through the existing
  provider-readiness Terminal Pane.
- The same model catalog drives the composer surface and Settings hub.

## Tests

- View-model: opencode Model Chip surface is `opencode_model_provider` whether
  opencode is usable or not.
- View-model: usable opencode starts the surface in `provider_list`; unusable
  opencode starts in `connect_vendor`.
- Model browser: root renders provider rows first, with the current model's
  provider selected by default.
- Model browser: choosing a provider replaces the popover with that provider's
  model rows and a Back row.
- Model browser: after returning from a provider drilldown, the provider root
  does not render a Back row.
- Model browser: a connected provider's model list renders a compact connection
  status/update row.
- Model browser: selecting the connection status/update row opens
  `vendor_method`, and Back returns to that provider's `model_list`.
- Model browser: selecting an unconnected provider row opens the provider method
  drilldown, not a generic add-provider panel.
- Model browser: selecting Back from an unconnected provider method drilldown
  returns to `provider_list`, not `connect_vendor`.
- Selection: choosing `model:<id>` emits the same launch-option update as the
  old row menu.
- Effort: effort rows render in the provider model drilldown; selecting one
  updates `reasoning`.
- Connect flow: browser sign-in emits provider-readiness terminal data with
  `["auth", "login", "-p", vendorId]`.
- API-key flow: key draft is local component state and `onConnectApiKey` receives
  only the submitted value.
- Refresh flow: after API-key success or terminal `retry_preflight`, refreshed
  vendors/catalog are reflected without app restart.
- Regression: Codex and Claude keep the existing compact model menus.

## Implementation Notes

- Prefer extending the choice-surface model with drilldown state over adding a
  broad panel. A custom component is acceptable only if it visually matches the
  existing chip popover: narrow, row-first, no permanent two-column browser.
- Reuse styling vocabulary from `choice-surface.css` first. Use
  `opencode-connect-panel.tsx` only for the vendor method/API-key subflow.
- Keep step state in the React component unless a step must survive surface
  close/reopen. Catalog, vendor, and launch-option state already live in the
  Desktop application model.
- Keep action rows in the surface view so `selectAgentChatChoiceSurfaceRow`
  remains the single dispatcher for launch options and terminal handoff.
- If the backend lacks catalog/vendor fields needed by this surface, implement
  that producer/wiring in this slice. Do not ship a silent sentinel/default
  fallback as the completed opencode experience.
