# Spec: Version Management (Two Lanes)

## Scope

Two coordinated update experiences under one epic:

- **Lane 1 — App self-update.** A packaged Tide build notices a newer released
  Tide, downloads it in the background, and shows a non-blocking "vX.Y.Z is
  ready — Update & Restart" affordance. The restart happens only when the user
  clicks. No silent forced restart.
- **Lane 2 — Agent CLI update.** For each installed Provider CLI (claude / codex
  / gemini / opencode), detect the installed version vs the latest published npm
  version and surface a non-blocking inline nudge ("Update <Agent> — vX → vY")
  that runs the same Provider Setup Surface terminal handoff used for install.

Both lanes share one mental model — *current vs latest → click to apply* — but
own different plumbing because the apply mechanisms and process owners differ.

## Evidence

- `electron-builder.json` builds a macOS `dmg` only. It has **no** `publish`
  block and produces no `latest-mac.yml` / `zip`, so no update feed exists.
- `package.json` devDependencies have **no** `electron-updater`; `package-lock.json`
  confirms it is absent.
- `src/desktop/infrastructure/electron/main/electron-main.ts` has no `autoUpdater`
  usage. `app.whenReady().then(...)` (~line 615) is the lifecycle hook; the file
  is a thin IPC handler host (`ipcMain.handle("tide:…")`).
- `src/desktop/infrastructure/electron/main/move-to-applications.ts` already
  nudges a packaged build into `/Applications` (required for reliable updates)
  and is gated to `process.platform === "darwin" && app.isPackaged`.
- `src/desktop/infrastructure/electron/main/notifications.ts` is the reference
  Main→renderer pattern: a thin Main bridge over a pure policy module
  (`notification-policy.ts`), pushing via `window.webContents.send("tide:…")`.
- `src/desktop/infrastructure/electron/preload/index.ts` exposes `window.tide`
  with the `onXxx(listener) => unsubscribe` push pattern and `invoke` calls.
  It already declares a `TideNotificationRequest.kind` of `"agent_update"`.
- `.github/workflows/desktop-release.yml` triggers on `tide-v*` tags →
  build/sign/notarize the dmg → `gh release create`. Signing + notarization +
  Developer ID are already in place (auto-update precondition satisfied).
- Provider readiness today (`src/backend/.../agent-integrations/*/...-agent-integration.ts`,
  `provider-cli-commands.ts`) resolves the executable via `which`; if missing it
  emits a `not_installed` blocker carrying `npmInstallSetupAction` (`npm install
  -g <pkg>`, `expectedCompletion: "retry_preflight"`). The npm package per agent
  is known: `@openai/codex`, `@anthropic-ai/claude-code`, `@google/gemini-cli`,
  `opencode-ai`. **Nothing reads the installed version or the latest version.**
- `ProviderReadinessBlockerKind` (contract `provider-readiness.ts` + domain
  `provider-readiness.ts`) has no `outdated`/`update_available` member. Blockers
  set `ready: false`; there is no non-blocking advisory channel.
- `src/shared/contracts/events.ts` `agentRuntime.noticePosted` already *passively*
  relays a CLI-printed "update available" banner as an OS notification — it does
  not check versions or offer an action.
- git remote `origin` = `https://github.com/team-attention/tide.git` (the publish
  target for the GitHub update feed).

## Decisions

- **D1. App update = electron-updater, notify + user-click apply.** `autoDownload
  = true` so the build is ready; the visible affordance's button calls
  `autoUpdater.quitAndInstall()`. No silent restart. (User refined the earlier
  "fully automatic" answer to "notify, click to update".)
- **D2. Agent update = non-blocking chip** in the composer toolbar (a quiet pill
  beside the Permission/Model chips, present from the start composer on), not a
  full readiness card, not a Settings hub, and never a gate. An
  outdated-but-working CLI keeps `ready: true`. A single click runs the same
  Setup Surface terminal update handoff (no extra confirm step).
- **D3. One epic, sliced.** Lane 2 (backend-local, reuses Setup Surface) ships
  first; Lane 1 (Main process + CI/publish) second. Designed together here.
- **D4. Detection.** Agent installed version via `<cli> --version` (local, cheap,
  may run in preflight). Latest via `npm view <pkg> version` (network) cached and
  run **off the critical path** (background, like opencode's out-of-band catalog).
  Apply reuses `npm install -g <pkg>@latest` + `retry_preflight`.
- **D5. Ownership.** App self-update lives in **Electron Main** (app lifecycle,
  `autoUpdater`, `quitAndInstall`) and reaches the renderer over `window.tide`
  IPC. Agent update lives in **Backend** readiness and reaches the renderer over
  the existing `providerReadiness.changed` backend event. macOS only for now.
- **D6. Outdated never blocks.** The update advisory rides alongside readiness
  without flipping `ready`.

## Out Of Scope

- Windows / Linux packaging and their update channels.
- Non-npm agent installs (Homebrew, curl). If the installed version is readable
  but Tide did not install via npm, show the version but the nudge still offers
  the npm `@latest` path (best-effort) — no bespoke per-installer updater.
- Silent/auto agent updates, version pinning UI, rollback.
- Changing the existing passive `agentRuntime.noticePosted` relay (kept; de-dup
  with active detection is a follow-up note, not this slice).
- Triggering an actual release / pushing a `tide-v*` tag.

## Domain Model

### Lane 2 (Backend)

- `ProviderUpdateAdvisory` (domain) / `ProviderUpdateAdvisoryDto` (contract):
  `{ currentVersion: string; latestVersion: string; setup: ProviderSetupSurfaceAction }`.
- Added optional field `update?` on `ProviderReadinessResult` (domain) and
  `ProviderReadinessDto` (contract). Present ⇔ a newer npm version is known AND
  `currentVersion < latestVersion`. **Independent of `ready` and `blockers`.**
- `AgentLatestVersionCache`: backend-held `{ [pkg]: { latest: string; fetchedAt:
  number } }`, populated by a background probe.

### Lane 1 (Main, process-local — NOT shared contracts)

- `AppUpdateStatus` discriminated union (mirrored in preload, kept process-local
  per the preload convention):
  - `{ phase: "idle" }`
  - `{ phase: "checking" }`
  - `{ phase: "downloading"; version: string; percent: number }`
  - `{ phase: "ready"; version: string; notes?: string }`
  - `{ phase: "upToDate"; currentVersion: string }`
  - `{ phase: "error"; message: string }`

## Contracts

### Shared contracts (Lane 2)

```ts
// provider-readiness.ts (contract) + domain mirror
export interface ProviderUpdateAdvisoryDto {
  currentVersion: string;
  latestVersion: string;
  setup: ProviderSetupSurfaceActionDto; // npm install -g <pkg>@latest, retry_preflight
}
export interface ProviderReadinessDto {
  agentId: AgentId;
  ready: boolean;
  blockers: ProviderReadinessBlockerDto[];
  update?: ProviderUpdateAdvisoryDto; // non-blocking; does not affect `ready`
}
```

No new backend event kind: the advisory rides on the existing
`providerReadiness.changed` payload. The background latest-version probe triggers
a readiness re-emit for an agent when it first learns a newer version exists.

### Main ↔ renderer IPC (Lane 1, via preload `window.tide`)

- Push `tide:app-update-changed` → `AppUpdateStatus`. Preload:
  `onAppUpdateChanged(listener: (s: AppUpdateStatus) => void): () => void`.
- Invoke `tide:app-update-apply` → `applyAppUpdate(): void` (calls `quitAndInstall`).
- Invoke `tide:app-update-check` → `checkForAppUpdate(): void` (manual re-check).
- Invoke `tide:app-version` → `getAppVersion(): Promise<string>` (`app.getVersion()`).

### Build / publish (Lane 1)

- `electron-builder.json`: add `"zip"` to `mac.target` (electron-updater requires
  the zip + generated `latest-mac.yml`), `mac.notarize.teamId`, and a `publish`
  block pointing at a **dedicated, Tide-desktop-only releases repo**:
  `{ "provider": "github", "owner": "eatnug", "repo": "tide-desktop-releases",
  "releaseType": "release" }`. See "Release channel separation" below for why a
  dedicated repo (not the monorepo).
- `desktop-release.yml`: `electron-builder --mac --publish always` with
  `GH_TOKEN: secrets.DESKTOP_RELEASES_TOKEN` (a PAT with `contents:write` on the
  releases repo — the default `GITHUB_TOKEN` is scoped to the monorepo only).
  electron-builder signs + notarizes (dmg + the zip's app) and creates the
  `v${version}` release in the dedicated repo. **Outward-facing — user creates the
  repo + token and triggers the first real release.**

## Flow

### Lane 1 — App self-update

1. On `app.whenReady`, if `shouldRunAutoUpdater({ isPackaged, isDev })` (packaged,
   not `--tide-dev-app`, not test harness): configure `autoUpdater` (autoDownload
   on), wire its events, `checkForUpdatesAndNotify`-style check after a short
   delay, then re-check every N hours.
2. `autoUpdater` events → `mapAutoUpdaterEvent(...)` (pure) → `AppUpdateStatus` →
   `webContents.send("tide:app-update-changed", status)`.
3. Renderer subscribes via `onAppUpdateChanged` at the product-shell bootstrap
   (beside `onBackendEvent`) and stores the status. App Chrome renders a compact,
   non-blocking pill when `phase === "ready"`: "Tide vX.Y.Z is ready — Update &
   Restart". `downloading` may show a subtle indicator; other phases show nothing.
4. Click → `applyAppUpdate()` → Main `quitAndInstall()` → relaunch on the new
   version.

### Lane 2 — Agent CLI update

1. Background probe (startup + every N hours), for each agent whose executable
   resolves: `npm view <pkg> version` → fill `AgentLatestVersionCache`.
2. During readiness preflight, after confirming the executable resolves, read the
   installed version (`<cli> --version`, parsed). If the cache has a `latest` and
   `semverLess(installed, latest)`, attach `update` to the readiness result.
   `ready`/`blockers` are computed exactly as today.
3. The advisory surfaces on the next readiness check (agent select / thread open /
   send / setup retry — all frequent), and the periodic refresh keeps the cache
   fresh. (Implemented this way rather than a proactive push: readiness is already
   re-checked constantly during use, so a dedicated re-emit was unnecessary for v1.
   A proactive `providerReadiness.changed` after a probe is a noted follow-up.)
4. Renderer composer toolbar: when the view model exposes `update`, render a
   compact `↑ Update <Agent>` chip beside the Permission/Model chips (NOT a
   separate choice-surface card). The version detail (`vX → vY`) lives in the
   chip's tooltip. A single click runs the same Setup Surface handoff as install
   (`npm install -g <pkg>@latest` in the visible terminal, then `retry_preflight`)
   via the `update_available:setup` row. The chip renders even when `blockers` is
   empty and `ready` is true, and shows from the start composer (the toolbar is
   not gated on an active thread). Absent `update`, no chip renders.

## Invariants

- An outdated agent CLI never blocks starting a Thread (`update` present ⇒ `ready`
  unchanged).
- App auto-update never restarts without an explicit user click.
- Auto-updater is inert outside a packaged, non-dev build (dev `electron .
  --tide-dev-app`, unpackaged, and the playwright/_electron harness never check,
  download, or install).
- The latest-version network probe never sits on the readiness critical path; an
  unknown/un-fetched latest simply yields no advisory.
- Version comparison is semver-aware; a non-semver `--version` output yields no
  advisory rather than a false one.
- Lane 1 stays in Main (app lifecycle); Lane 2 stays in Backend (readiness). The
  renderer learns of each only through its existing channel (`window.tide` vs
  `providerReadiness.changed`).

## Tests

- **Contract.** `ProviderReadinessDto.update` is optional; architecture boundary
  tests unchanged (contract stays Desktop/Backend-neutral).
- **Semver compare util.** `semverLess`: `1.2.3 < 1.2.10`, `1.2.3` not `< 1.2.3`,
  `2.0.0` not `< 1.9.9`; pre-release (`1.2.3-beta.1 < 1.2.3`); non-semver input ⇒
  `false` (no advisory).
- **Readiness advisory (backend, fake version reader + fake latest cache).**
  installed `<` latest ⇒ `update` attached with the `@latest` setup action;
  installed `===` latest ⇒ no `update`; latest unknown ⇒ no `update`; in all cases
  `ready` and `blockers` equal the no-advisory baseline.
- **Renderer chip.** View model with `update` renders an `↑ Update <Agent>` chip
  in the composer toolbar even when `blockers` is empty / `ready` true, and with
  no active thread (start composer); the chip is NOT a choice-surface card;
  clicking it dispatches the `update_available:setup` Setup Surface handoff;
  absent `update` renders no chip.
- **App-update status mapping (pure).** `mapAutoUpdaterEvent` maps
  checking/available/download-progress/downloaded/error/not-available to the right
  `AppUpdateStatus`.
- **Auto-updater guard (pure).** `shouldRunAutoUpdater` true only for packaged &&
  not dev && not test; false otherwise.
- **Build/package.** `tests/build-and-package.test.ts` asserts `electron-builder.json`
  has the `publish` github block and a `zip` mac target.

## Implementation Notes

Slice order (one epic, incremental):

1. **Lane 2 contract + pure utils.** Add `ProviderUpdateAdvisoryDto` + optional
   `update` to contract & domain; add `semver-compare.ts`; tests first.
2. **Lane 2 backend detection.** `providerVersionForExecutable` (`<cli> --version`
   parse) beside `provider-cli-commands.ts`; `installPackageForAgent` →
   `@latest` setup action (reuse `npmInstallSetupAction`); background latest probe
   with cache + `providerReadiness.changed` re-emit. Attach `update` in each
   integration's preflight after the resolve-executable success path.
3. **Lane 2 renderer.** Non-blocking update nudge in `readiness.ts` + view model
   field; selecting runs the existing Setup Surface dispatch.
4. **Lane 1 Main.** Add `electron-updater`. New `auto-update.ts` (thin bridge) +
   `auto-update-status.ts` (pure `mapAutoUpdaterEvent` / `shouldRunAutoUpdater`),
   mirroring `notifications.ts` / `notification-policy.ts`. Wire into
   `app.whenReady`. Add preload surface (`onAppUpdateChanged`, `applyAppUpdate`,
   `checkForAppUpdate`, `getAppVersion`) + IPC handlers in `electron-main.ts`.
5. **Lane 1 renderer.** App Chrome update pill subscribed at the product-shell
   bootstrap; click → `applyAppUpdate()`.
6. **Lane 1 build/CI.** `electron-builder.json` `publish` + `zip`; update
   `desktop-release.yml` to publish the update feed. Land config + the
   build/package test; the **first real tagged release is user-driven** (release
   is outward-facing).

Optional follow-ups (not this slice): a "Check for Updates…" app-menu item;
de-dup the passive `agentRuntime.noticePosted` update banner once active
detection ships; a Settings "Providers" version list if a central view is later
wanted.

## Resolved During Implementation

- **Release channel separation (decided: dedicated releases repo).** The monorepo
  ships TWO products — the v1 Rust terminal (`v*` tags/releases) and v2 Tide
  desktop (`tide-v*`). electron-updater's stock GitHub provider has **no
  tag-prefix/product filter**: it just picks the repo's latest release by version
  number, so it would mis-pick a v1 release (whose `0.51.x` > v2's `0.1.x`) and
  find no `latest-mac.yml`. Workarounds (a custom in-app provider that filters
  `tide-v*` via the GitHub API; a generic provider + GitHub Pages feed) were
  considered and rejected as fragile/infra-heavy. Chosen: publish v2 to a
  **dedicated Tide-desktop-only repo** (`eatnug/tide-desktop-releases`), so the
  stock GitHub provider is unambiguous — zero in-app custom code, zero Pages, zero
  rate-limit hacks. The `tide-v*` tag on the monorepo stays the build trigger /
  code source of truth; the release artifacts mirror to the dedicated repo.
- **Notarization moved into electron-builder** (`mac.notarize.teamId`) so the
  zip's app — not just the dmg — is notarized; an auto-updated app must pass
  Gatekeeper. This replaced the manual post-build `codesign`/`notarytool` steps.

## Open Questions / Residual Risk

- **One-time release setup (user-owned).** Before the first release: create the
  empty public repo `eatnug/tide-desktop-releases`, and add a PAT with
  `contents:write` on it as the monorepo secret `DESKTOP_RELEASES_TOKEN`.
- **First-release validation (the one untested-here piece).** Auto-update can
  only be exercised by a real signed+notarized release; CI YAML is inert until a
  `tide-v*` tag is pushed (user-driven). Validate on first release: the
  `v${version}` release (dmg + zip + `latest-mac.yml`) lands in
  `eatnug/tide-desktop-releases`, and a prior installed build's updater detects
  it, downloads, and applies on the "Update & Restart" click.
- Check cadence default (app on launch + every 6h; agent latest probe on startup
  + every 6h). Tunable; no behavior fork.
