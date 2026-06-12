// Spec: docs_v2/specs/build-and-package.md

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The Electron main process is electron-main.ts plus its sibling main/ modules
// (spec: navigable-source-structure); spec assertions read the whole unit.
function readMainProcessSource(): string {
  const dir = path.join(repoRoot, "src/desktop/infrastructure/electron/main");
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
    .join("\n");
}

test("build_scaffold_keeps_shared_contracts_as_public_export_surface", async () => {
  const contracts = await import("../src/shared/contracts/index.ts");

  assert.equal(contracts.CONTRACT_VERSION, 1);
  assert.equal(typeof contracts.validateBackendCommandEnvelope, "function");
});

test("build_scaffold_declares_architecture_test_script", () => {
  const packageJson = readPackageJson();

  assert.match(packageJson.scripts["test:architecture"], /tests\/shared-contracts\.test\.ts/);
  assert.match(packageJson.scripts["test:architecture"], /tests\/backend-thread-agent-runtime-lifecycle\.test\.ts/);
  assert.match(packageJson.scripts["test:architecture"], /tests\/desktop-agent-chat-composer-shell\.test\.ts/);
});

test("package_scripts_declare_v2_electron_tooling", () => {
  const packageJson = readPackageJson();

  assert.equal(packageJson.scripts.dev, "node scripts/v2-tooling-command.mjs electron-vite dev");
  assert.equal(packageJson.scripts.build, "node scripts/v2-tooling-command.mjs electron-vite build");
  assert.equal(packageJson.scripts.typecheck, "node scripts/v2-tooling-command.mjs tsc --noEmit");
  assert.equal(packageJson.scripts["package:mac"], "node scripts/v2-tooling-command.mjs electron-builder --mac");
  assert.equal(packageJson.scripts.test, "npm run test:v2");
});

test("provider_smoke_script_is_opt_in", () => {
  const packageJson = readPackageJson();
  const smokeScript = fs.readFileSync(path.join(repoRoot, "scripts/v2-provider-smoke.mjs"), "utf8");

  assert.equal(
    packageJson.scripts["test:smoke:providers"],
    "node --experimental-strip-types scripts/v2-provider-smoke.mjs",
  );
  assert.doesNotMatch(packageJson.scripts.test, /smoke/);
  assert.match(smokeScript, /createLiveBackendContractMessageAdapter/);
  assert.match(smokeScript, /--agent/);
  assert.match(smokeScript, /agentOutputContainsToken/);
  assert.match(smokeScript, /block\?\.role !== "agent"/);
  assert.doesNotMatch(smokeScript, /Provider smoke tests are opt-in; configure local provider CLIs/);
});

test("provider_smoke_supports_fake_openai_output_verification", () => {
  const smokeScript = fs.readFileSync(path.join(repoRoot, "scripts/v2-provider-smoke.mjs"), "utf8");

  assert.match(smokeScript, /--fake-openai/);
  assert.match(smokeScript, /startFakeOpenAiServer/);
  assert.match(smokeScript, /OPENAI_BASE_URL/);
  assert.match(smokeScript, /options\.agent === "openai_api"/);
  assert.match(smokeScript, /Hydrated Agent Session did not include the live token/);
});

test("provider_smoke_can_expect_provider_not_ready_and_open_setup_surface", () => {
  const smokeScript = fs.readFileSync(path.join(repoRoot, "scripts/v2-provider-smoke.mjs"), "utf8");

  assert.match(smokeScript, /--expect-provider-not-ready/);
  assert.match(smokeScript, /--open-setup-surface/);
  assert.match(smokeScript, /openProviderSetupSurfaceSmoke/);
  assert.match(smokeScript, /workbench\.command/);
  assert.match(smokeScript, /open_provider_setup_surface/);
  assert.match(smokeScript, /close_pane/);
});

test("electron_runtime_smoke_script_is_opt_in", () => {
  const packageJson = readPackageJson();
  const smokeScript = fs.readFileSync(
    path.join(repoRoot, "scripts/v2-electron-runtime-smoke.mjs"),
    "utf8",
  );

  assert.equal(
    packageJson.scripts["test:smoke:electron"],
    "node --experimental-strip-types scripts/v2-electron-runtime-smoke.mjs",
  );
  assert.doesNotMatch(packageJson.scripts.test, /smoke/);
  assert.match(smokeScript, /createProductShellState/);
  assert.match(smokeScript, /submitProductShellComposerDraft/);
  assert.match(smokeScript, /TIDE_ELECTRON_SMOKE_COMMAND/);
  assert.match(smokeScript, /TIDE_BACKEND_COMMAND_TIMEOUT_MS/);
  assert.match(smokeScript, /electron-main\.js/);
  assert.match(smokeScript, /--agent/);
});

test("electron_runtime_smoke_supports_fake_openai_output_verification", () => {
  const smokeScript = fs.readFileSync(
    path.join(repoRoot, "scripts/v2-electron-runtime-smoke.mjs"),
    "utf8",
  );

  assert.match(smokeScript, /--fake-openai/);
  assert.match(smokeScript, /startFakeOpenAiServer/);
  assert.match(smokeScript, /OPENAI_BASE_URL/);
  assert.match(smokeScript, /TIDE_ELECTRON_SMOKE_FAKE_OPENAI/);
  assert.match(smokeScript, /pushedAgentOutputFound/);
  assert.match(smokeScript, /Electron smoke did not receive the token through a pushed Agent output block/);
});

test("electron_runtime_smoke_can_expect_provider_not_ready_and_open_setup_surface", () => {
  const smokeScript = fs.readFileSync(
    path.join(repoRoot, "scripts/v2-electron-runtime-smoke.mjs"),
    "utf8",
  );
  const main = readMainProcessSource();

  assert.match(smokeScript, /--expect-provider-not-ready/);
  assert.match(smokeScript, /--open-setup-surface/);
  assert.match(smokeScript, /electron-smoke-provider-not-ready/);
  assert.match(main, /TIDE_ELECTRON_SMOKE_OPEN_SETUP_SURFACE/);
  assert.match(main, /open_provider_setup_surface/);
  assert.match(main, /setupSurface/);
});

test("electron_vite_config_maps_main_preload_renderer_and_backend_paths", () => {
  const config = fs.readFileSync(path.join(repoRoot, "electron.vite.config.mjs"), "utf8");
  const main = readMainProcessSource();

  assert.match(config, /src\/desktop\/infrastructure\/electron\/main\/electron-main\.ts/);
  assert.match(config, /src\/backend\/infrastructure\/node\/backend-entrypoint\.ts/);
  assert.match(config, /src\/desktop\/infrastructure\/electron\/preload\/index\.ts/);
  assert.match(config, /entryFileNames:\s*"index\.cjs"/);
  assert.match(config, /format:\s*"cjs"/);
  assert.match(config, /src\/desktop\/infrastructure\/electron\/renderer/);
  assert.match(config, /src\/desktop\/infrastructure\/electron\/renderer\/index\.html/);
  assert.match(main, /src\/backend\/infrastructure\/node\/backend-entrypoint\.ts/);
  assert.match(main, /backend-entrypoint\.js/);
  assert.match(main, /index\.cjs/);
  assert.match(main, /utilityProcess\.fork/);
  assert.doesNotMatch(main, /Backend process bridge is not connected/);
});

test("electron_main_creates_a_browser_window_and_loads_the_renderer", () => {
  const main = readMainProcessSource();

  assert.match(main, /BrowserWindow/);
  assert.match(main, /app\.whenReady\(\)/);
  assert.match(main, /ELECTRON_RENDERER_URL/);
  assert.match(main, /loadURL/);
  assert.match(main, /loadFile/);
});

test("electron_main_enables_webview_tag_for_workbench_browser_panes", () => {
  // Spec: docs_v2/specs/workbench-browser-webview-pane.md
  const main = readMainProcessSource();

  assert.match(main, /webviewTag:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
});

test("electron_main_has_opt_in_runtime_smoke_hook", () => {
  const main = readMainProcessSource();

  assert.match(main, /TIDE_ELECTRON_SMOKE_COMMAND/);
  assert.match(main, /runElectronRuntimeSmoke/);
  assert.match(main, /window\.tide\.sendBackendCommand/);
  assert.match(main, /window\.tide\.onBackendEvent/);
  assert.match(main, /TIDE_ELECTRON_SMOKE_RESULT/);
  assert.match(main, /TIDE_ELECTRON_SMOKE_ERROR/);
  assert.match(main, /TIDE_ELECTRON_SMOKE_EXPECT_PUSHED_AGENT_OUTPUT/);
  assert.match(main, /pushedAgentOutputFound/);
  assert.match(main, /TIDE_BACKEND_COMMAND_TIMEOUT_MS/);
  assert.match(main, /process\.env\.TIDE_APP_DATA_ROOT \?\? app\.getPath\("userData"\)/);
});

test("electron_main_smoke_result_is_compact_enough_for_raw_pty_output", () => {
  const main = readMainProcessSource();

  assert.match(main, /startEventKinds: eventKinds\(startEvents\)/);
  assert.match(main, /pushedEventKinds: eventKinds\(pushedEvents\)/);
  assert.match(main, /hydrateEventKinds: eventKinds\(hydrateEvents\)/);
  assert.doesNotMatch(main, /\n\s*startEvents,\n\s*pushedEvents,\n\s*hydrateEvents,/);
});

test("renderer_entry_mounts_the_react_app_into_the_root_element", () => {
  const renderer = fs.readFileSync(path.join(repoRoot, "src/desktop/infrastructure/electron/renderer/renderer-entry.ts"), "utf8");

  assert.match(renderer, /createRoot/);
  assert.match(renderer, /document\.getElementById\("root"\)/);
  assert.match(renderer, /createInitialRendererElement\(\)/);
});

test("npm_run_typecheck_runs_scaffold_check", () => {
  const result = runNpmScript("typecheck");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /typecheck/);
});

test("backend_bundle_externalizes_runtime_node_dependencies", () => {
  const viteConfig = fs.readFileSync(path.join(repoRoot, "electron.vite.config.mjs"), "utf8");
  // D11: main/preload builds externalize package dependencies so the Backend
  // bundle does not inline the TypeScript compiler (which breaks Electron
  // utilityProcess startup with ERR_AMBIGUOUS_MODULE_SYNTAX).
  assert.match(viteConfig, /externalizeDepsPlugin/);

  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.ok(
    packageJson.dependencies?.typescript,
    "typescript must be a runtime dependency so it is externalized and packaged.",
  );
});

test("npm_run_build_writes_v2_build_manifest", () => {
  const manifestPath = path.join(repoRoot, "dist/v2-build-manifest.json");
  fs.rmSync(manifestPath, { force: true });
  fs.rmSync(path.join(repoRoot, "out"), { recursive: true, force: true });

  const result = runNpmScript("build");

  assert.equal(result.status, 0, result.stderr);
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      tool: string;
      command: string;
    };
    assert.equal(manifest.tool, "electron-vite");
    assert.equal(manifest.command, "electron-vite build");
    return;
  }

  assert.ok(fs.existsSync(path.join(repoRoot, "out/main/electron-main.js")));
  assert.ok(fs.existsSync(path.join(repoRoot, "out/main/backend-entrypoint.js")));
  assert.ok(fs.existsSync(path.join(repoRoot, "out/preload/index.cjs")));
  assert.ok(fs.existsSync(path.join(repoRoot, "out/renderer/index.html")));

  // D11 / Invariant 13: the Backend bundle must not inline the TypeScript
  // compiler. Its presence crashed Electron utilityProcess startup.
  const backendBundle = fs.readFileSync(
    path.join(repoRoot, "out/main/backend-entrypoint.js"),
    "utf8",
  );
  assert.doesNotMatch(
    backendBundle,
    /function createTypeChecker\b/,
    "Backend bundle must externalize the TypeScript compiler, not inline it.",
  );
});

test("package_mac_script_targets_electron_builder_mac_package", () => {
  const packageJson = readPackageJson();
  const electronBuilderConfig = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "electron-builder.json"), "utf8"),
  ) as {
    mac: { target: string[] };
    files: string[];
  };

  assert.equal(packageJson.scripts["package:mac"], "node scripts/v2-tooling-command.mjs electron-builder --mac");
  assert.deepEqual(electronBuilderConfig.mac.target, ["dmg"]);
  assert.ok(electronBuilderConfig.files.includes("out/**"));
});

function readPackageJson(): {
  scripts: Record<string, string>;
} {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
}

function runNpmScript(script: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync("npm", ["run", script], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
