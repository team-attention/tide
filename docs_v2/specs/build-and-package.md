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

## Tests

| Rule | Test expectation |
|------|------------------|
| Shared Contracts export cleanly | `build_scaffold_keeps_shared_contracts_as_public_export_surface` imports `src/shared/contracts/index.ts`. |
| Desktop boundary holds | `build_scaffold_declares_architecture_test_script` keeps an explicit architecture test script. |
| Backend domain boundary holds | `build_scaffold_declares_architecture_test_script` keeps Backend boundary tests in the normal architecture gate. |
| Shared boundary holds | `build_scaffold_declares_architecture_test_script` keeps Shared Contract boundary tests in the normal architecture gate. |
| Fake provider supports readiness | Existing provider integration tests remain part of `test:v2`; package scripts keep provider smoke opt-in. |
| Fake PTY supports terminal input | Existing runtime tests remain part of `test:v2`. |
| Contract fixtures serialize | Existing Shared Contract tests remain part of `test:v2`. |
| Build command works | `npm_run_build_writes_v2_build_manifest` runs `npm run build` and produces a v2 scaffold build manifest. |
| Package command exists | `package_mac_script_targets_electron_builder_mac_package` verifies `package:mac` targets electron-builder mac packaging through the scaffold wrapper. |

## Implementation Notes

- Do not create npm workspace packages until a concrete boundary problem appears.
- Keep dependency list small and obvious.
- Put provider smoke behind explicit script and documentation.
- Keep tests deterministic by default.
- Keep Backend process entry testable without launching full Electron where possible.
- Add scripts before implementation specs start depending on them.
