// Spec: docs_v2/specs/build-and-package.md

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

  assert.equal(packageJson.scripts["test:smoke:providers"], "node scripts/v2-provider-smoke.mjs");
  assert.doesNotMatch(packageJson.scripts.test, /smoke/);
});

test("electron_vite_config_maps_main_preload_renderer_and_backend_paths", () => {
  const config = fs.readFileSync(path.join(repoRoot, "electron.vite.config.mjs"), "utf8");
  const main = fs.readFileSync(path.join(repoRoot, "src/desktop/main/electron-main.ts"), "utf8");

  assert.match(config, /src\/desktop\/main\/electron-main\.ts/);
  assert.match(config, /src\/desktop\/preload\/index\.ts/);
  assert.match(config, /src\/desktop\/renderer/);
  assert.match(main, /src\/backend\/infrastructure\/node\/backend-entrypoint\.ts/);
});

test("npm_run_typecheck_runs_scaffold_check", () => {
  const result = runNpmScript("typecheck");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /v2 typecheck scaffold verified/);
});

test("npm_run_build_writes_v2_build_manifest", () => {
  const manifestPath = path.join(repoRoot, "dist/v2-build-manifest.json");
  fs.rmSync(manifestPath, { force: true });

  const result = runNpmScript("build");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    tool: string;
    command: string;
  };

  assert.equal(result.status, 0, result.stderr);
  assert.equal(manifest.tool, "electron-vite");
  assert.equal(manifest.command, "electron-vite build");
});

test("package_mac_script_targets_electron_builder_mac_package", () => {
  const manifestPath = path.join(repoRoot, "dist/v2-package-mac-manifest.json");
  fs.rmSync(manifestPath, { force: true });

  const result = runNpmScript("package:mac");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    tool: string;
    target: string;
  };

  assert.equal(result.status, 0, result.stderr);
  assert.equal(manifest.tool, "electron-builder");
  assert.equal(manifest.target, "mac");
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
