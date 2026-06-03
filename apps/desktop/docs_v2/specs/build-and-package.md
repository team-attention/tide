# Spec: Build and Package

## Scope

This spec defines the first Tide v2 Electron + Node build and test scaffold.

It covers:

- package manager.
- Electron + TypeScript scaffold.
- React renderer.
- Backend bundle.
- Shared Contracts source path.
- dev command.
- typecheck command.
- test command.
- package command.
- architecture boundary tests.
- fake provider harness.
- fake PTY harness.
- minimal CI gates.
- opt-in Electron runtime smoke.

It does not implement the scaffold, install dependencies, publish releases, or define production update channels.

## Evidence

- `docs_v2/implementation/electron-node-architecture-decisions.md` says Tide v2 is a new Electron + Node application and existing Rust/WGPU remains archive/reference.
- `docs_v2/implementation/electron-node-architecture-decisions.md` defines the initial source shape: `src/backend`, `src/desktop`, and `src/shared/contracts`.
- `docs_v2/implementation/electron-node-architecture-decisions.md` says the build should use a conventional Electron + TypeScript toolchain first.
- `docs_v2/implementation/concrete-design-backlog.md` selects simple Electron + TypeScript scaffold with electron-vite, React, Vitest, electron-builder, and boundary tests.
- `docs_v2/implementation/concrete-design-backlog.md` rejects custom build plumbing, monorepo packages from day one, and existing Rust workspace integration as the first scaffold.
- `docs_v2/specs/shared-contracts.md` requires Shared Contracts under `src/shared/contracts` and architecture tests that keep Desktop and Backend internals separate.
- `docs_v2/specs/backend-thread-agent-runtime-lifecycle.md` requires fake AgentRuntimePort, fake ProviderReadinessPort, and fake ProviderSignalPort before real provider integration.

## Decisions

### D1. Use npm first

The first scaffold uses npm.

Another package manager is not introduced until dependency or workspace needs justify it.

### D2. Use electron-vite

The first scaffold uses electron-vite for Electron main/preload/renderer development and bundling.

Custom Vite/tsup plumbing is not the first path.

### D3. Use React renderer

Desktop Renderer uses React and TypeScript.

Agent Chat and Composer shell are implemented in React.

### D4. Use Vitest

Vitest runs unit, service, reducer, contract, and architecture boundary tests.

Provider smoke tests are separate and opt-in after fake tests pass.

### D5. Use electron-builder for macOS package

The first package target is macOS app packaging with electron-builder.

Windows/Linux packaging is not blocked conceptually but is outside the first package slice.

### D6. Keep one app source tree

Use one app source tree:

```text
src/
  backend/
  desktop/
  shared/
```

Do not split into npm workspace packages from day one.

### D7. Boundary tests are required

Architecture boundary tests enforce:

- Desktop may import Shared Contracts.
- Desktop may not import Backend internals.
- Backend domain/services/ports may not import Shared Contracts.
- Backend adapters may import Shared Contracts.
- Shared Contracts may not import Desktop or Backend.

### D8. Fake provider and fake PTY come before real provider smoke

The scaffold includes fake provider and fake PTY harnesses so lifecycle, contract, and rendering tests do not require Codex, Claude, or Antigravity during normal test runs.

Real provider smoke tests are opt-in and documented separately.

The opt-in smoke command must run the same Product Shell `thread.start` path used
by the Renderer, then verify the live Backend creates or hydrates a real Agent
Session for the selected provider. It must not remain a placeholder once live
provider integrations exist.

### D9. Electron runtime smoke proves the app transport path

The provider smoke proves Product Shell state and the live Backend adapter
without launching Electron. A second opt-in Electron smoke must launch the built
Electron Main, use the preload-exposed `window.tide` surface from the Renderer,
send the Product Shell-generated `thread.start` command through Main IPC, and
verify the same selected Agent Binding and Launch Options survive into a
hydrated Thread.

The smoke result printed to stdout must be a compact structured summary. It
must not print full BackendEvent arrays, because real Provider CLI raw PTY
frames can be very large and can make the smoke output impossible to parse
reliably. Diagnostic event data stays at event-kind/count granularity unless a
human reruns the provider with tracing.

Like the provider smoke, Electron smoke can be run in an expected
Provider Readiness blocked mode. In that mode, `providerReadiness.changed` is a
successful result, and the smoke may open the Provider Setup Surface through the
same `workbench.command` path without sending the pending Composer input to the
provider-native setup process.

This smoke is not a default CI gate because it opens Electron and can start real
provider CLIs.

### D10. Preload bundle is CommonJS

Electron Main loads the preload script through `webPreferences.preload`. The
preload bundle therefore uses a CommonJS `.cjs` artifact while the app package
can remain ESM. This keeps `contextIsolation` enabled and avoids relying on an
ESM preload artifact that fails to expose `window.tide` in the built app.

### D11. Backend bundle externalizes runtime node dependencies

The Backend bundle (`backend-entrypoint`) must not inline heavy third-party Node
packages. The code-intelligence port imports the TypeScript compiler
(`import * as ts from "typescript"`). Bundling the TypeScript compiler into the
Backend ESM artifact breaks Electron `utilityProcess` startup with
`ERR_AMBIGUOUS_MODULE_SYNTAX`, because the bundled compiler mixes `__filename`
with top-level await and the loader cannot pick a module format. When this
happens the Backend never completes its handshake, `thread.start` returns
`contract.error`, and no Agent Runtime starts in the built app.

The main and preload builds therefore use electron-vite `externalizeDepsPlugin`
so package `dependencies` are required from `node_modules` at runtime instead of
inlined. App `.ts` source (relative imports) stays bundled. Any third-party Node
package the Backend needs at runtime — `typescript` for code intelligence first —
is a runtime `dependency`, not a dev-only tool, so electron-builder packages it.

## Out Of Scope

- Dependency installation.
- CI provider selection.
- Code signing.
- Auto-update.
- Windows/Linux package details.
- Production crash reporting.
- Rust workspace integration.
- Monorepo package split.

## Source Layout

```text
src/
  backend/
    domain/
    services/
    ports/
      inbound/
      outbound/
    adapters/
      inbound/
      outbound/
    infrastructure/
    testing/

  desktop/
    main/
    preload/
    renderer/
      app/
      components/
      state/
      testing/

  shared/
    contracts/
      index.ts
      validators.ts

tests/
  architecture/
  contract/
  backend/
  desktop/
  integration/
```

## Scripts

Initial package scripts:

```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:architecture": "vitest run tests/architecture",
    "test:smoke:providers": "vitest run tests/integration/provider-smoke --runInBand",
    "package:mac": "electron-builder --mac"
  }
}
```

`test:smoke:providers` is opt-in and may require local provider CLIs and authentication.

`test:smoke:electron` is opt-in and may require a local GUI session, provider CLIs,
and authentication. It runs against built `out/` artifacts, so `npm run build`
must succeed first.

## Test Harnesses

### Fake Provider

Fake Provider simulates:

- provider ready.
- provider not installed.
- onboarding required.
- Directory Trust required.
- hook bootstrap required.
- prompt/question.
- approval/permission.
- stop/idle.
- provider session reference discovery.

### Fake PTY

Fake PTY simulates:

- launch.
- resume.
- terminal input writes.
- stdout/stderr frames.
- ANSI text frames.
- partial streaming output.
- provider exit.
- failed runtime.

Fake PTY must support terminal input byte assertions so tests do not regress into plain `text + "\r"` assumptions.

### Contract Fixtures

Contract fixtures cover:

- BackendCommand envelopes.
- BackendEvent envelopes.
- Contract Error.
- Stream Update.
- Agent Session Block update.
- Workbench command result.

## Minimal CI Gates

First CI gate:

```text
npm run typecheck
npm test
npm run test:architecture
npm run build
```

Provider smoke is not part of normal CI because it depends on local provider installation/authentication.

Electron smoke is also not part of normal CI because it launches the Electron app
and exercises the real preload/Main/Backend transport.

## Flow

### UC-1: Developer runs app

1. Developer runs `npm run dev`.
2. electron-vite starts Electron Main, preload, Renderer, and Backend bundle path.
3. App opens with fake or no provider depending on dev fixture config.

### UC-2: Developer runs tests

1. Developer runs `npm test`.
2. Vitest runs contract, backend, desktop, and fake runtime tests.
3. No real provider CLI is required.

### UC-3: Developer runs architecture tests

1. Developer runs `npm run test:architecture`.
2. Tests scan imports.
3. Boundary violations fail the run.

### UC-4: Developer packages macOS app

1. Developer runs `npm run build`.
2. Developer runs `npm run package:mac`.
3. electron-builder packages the Electron app and Backend bundle.

### UC-5: Developer smokes the Electron runtime path

1. Developer runs `npm run build`.
2. Developer runs `npm run test:smoke:electron -- --agent antigravity`.
3. The smoke launches the built Electron Main.
4. The Renderer uses `window.tide.sendBackendCommand`.
5. Main IPC brokers the command to the Backend utilityProcess.
6. Backend starts the selected Agent Runtime and hydrates the Thread.
7. The smoke may extend the Main command timeout because real provider CLI
   startup can exceed a short IPC request timeout.

## Invariants

1. Electron + Node scaffold is the v2 product scaffold.
2. Existing Rust/WGPU app remains archive/reference.
3. Source tree uses `src/backend`, `src/desktop`, and `src/shared/contracts`.
4. Desktop does not import Backend internals.
5. Backend domain/services/ports do not import Shared Contracts.
6. Shared Contracts do not import Desktop or Backend.
7. Normal tests use fake provider and fake PTY.
8. Provider smoke is opt-in.
9. Build scaffold stays one app source tree at first.
10. Package path uses electron-builder for macOS first.
11. Electron smoke is opt-in and uses the product preload/Main transport.
12. Built preload exposes `window.tide` from a CommonJS preload artifact.
13. Built `backend-entrypoint` does not inline the TypeScript compiler; runtime node dependencies are externalized and packaged.

## Tests

| Rule | Test expectation |
|------|------------------|
| Shared Contracts export cleanly | `build_scaffold_keeps_shared_contracts_as_public_export_surface` imports `src/shared/contracts/index.ts`. |
| Desktop boundary holds | `build_scaffold_declares_architecture_test_script` keeps an explicit architecture test script. |
| Backend domain boundary holds | `build_scaffold_declares_architecture_test_script` keeps Backend boundary tests in the normal architecture gate. |
| Shared boundary holds | `build_scaffold_declares_architecture_test_script` keeps Shared Contract boundary tests in the normal architecture gate. |
| Fake provider supports readiness | Existing provider integration tests remain part of `test:v2`; package scripts keep provider smoke opt-in. |
| Provider smoke exercises the real Product Shell path | `provider_smoke_script_is_opt_in` verifies the smoke script is still outside default tests but calls the live Backend adapter and accepts a selected Agent argument. |
| Electron smoke exercises the app transport path | `electron_runtime_smoke_script_is_opt_in` verifies the Electron smoke script is outside default tests, runs built Electron, passes a Product Shell-generated command through `window.tide`, and accepts a selected Agent argument. |
| Electron Main exposes a smoke-only product path | `electron_main_has_opt_in_runtime_smoke_hook` verifies the smoke hook is guarded by `TIDE_ELECTRON_SMOKE_COMMAND`, uses Renderer `window.tide.sendBackendCommand`, and logs structured smoke results. |
| Electron smoke prints compact runtime evidence | `electron_main_smoke_result_is_compact_enough_for_raw_pty_output` verifies the smoke result keeps event kind/count diagnostics instead of serializing full BackendEvent arrays. |
| Electron smoke can verify setup Pane path | `electron_runtime_smoke_can_expect_provider_not_ready_and_open_setup_surface` verifies Electron smoke can treat Provider Readiness blockers as expected and open the Provider Setup Surface. |
| Fake PTY supports terminal input | Existing runtime tests remain part of `test:v2`. |
| Contract fixtures serialize | Existing Shared Contract tests remain part of `test:v2`. |
| Developer app opens a window | `electron_main_creates_a_browser_window_and_loads_the_renderer` verifies Electron Main creates a BrowserWindow and loads dev or packaged Renderer. |
| Renderer mounts React app | `renderer_entry_mounts_the_react_app_into_the_root_element` verifies Renderer mounts the initial React element into `#root`. |
| Build command works | `npm_run_build_writes_v2_build_manifest` runs `npm run build` and verifies either a fallback build manifest or real electron-vite `out/` artifacts. |
| Package command exists | `package_mac_script_targets_electron_builder_mac_package` verifies `package:mac` targets electron-builder mac packaging and includes real build output. |
| Backend bundle externalizes node deps | `backend_bundle_externalizes_runtime_node_dependencies` verifies `electron.vite.config` uses `externalizeDepsPlugin` for main/preload and `typescript` is a runtime dependency. |
| Built Backend does not inline the compiler | `npm_run_build_writes_v2_build_manifest` also verifies the built `backend-entrypoint` does not inline TypeScript compiler internals. |

## Implementation Notes

- Do not create npm workspace packages until a concrete boundary problem appears.
- Keep dependency list small and obvious.
- Put provider smoke behind explicit script and documentation.
- Keep tests deterministic by default.
- Keep Backend process entry testable without launching full Electron where possible.
- Add scripts before implementation specs start depending on them.
- When real electron-vite is installed, renderer input must point at `src/desktop/renderer/index.html` because Tide v2 keeps Desktop source under `src/desktop`, not electron-vite's default `src/renderer`.
