#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assertNodeVersion } from "./assert-node-version.mjs";

const [, , toolName, ...toolArgs] = process.argv;
const repoRoot = process.cwd();

assertNodeVersion();

if (!toolName) {
  console.error("usage: v2-tooling-command <tool> [...args]");
  process.exit(2);
}

const localToolPath = path.join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? `${toolName}.cmd` : toolName,
);

if (fs.existsSync(localToolPath)) {
  const result = spawnSync(localToolPath, toolArgs, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

const fallback = runScaffoldFallback(toolName, toolArgs);
if (!fallback.ok) {
  console.error(fallback.message);
  process.exit(1);
}

console.log(fallback.message);

function runScaffoldFallback(tool, args) {
  const command = [tool, ...args].join(" ");
  if (tool === "electron-vite" && args[0] === "build") {
    assertPath("electron.vite.config.mjs");
    assertPath("src/desktop/main/electron-main.ts");
    assertPath("src/desktop/preload/index.ts");
    assertPath("src/desktop/renderer/index.html");
    assertPath("src/backend/infrastructure/node/backend-entrypoint.ts");
    writeManifest("dist/v2-build-manifest.json", {
      tool: "electron-vite",
      command,
      mode: "scaffold-fallback",
      outputs: {
        main: "src/desktop/main/electron-main.ts",
        preload: "src/desktop/preload/index.ts",
        renderer: "src/desktop/renderer/index.html",
        backend: "src/backend/infrastructure/node/backend-entrypoint.ts",
      },
    });
    return { ok: true, message: "v2 build scaffold verified." };
  }

  if (tool === "electron-vite" && args[0] === "dev") {
    assertPath("electron.vite.config.mjs");
    return { ok: true, message: "v2 dev scaffold verified." };
  }

  if (tool === "electron-builder" && args.includes("--mac")) {
    assertPath("electron-builder.json");
    writeManifest("dist/v2-package-mac-manifest.json", {
      tool: "electron-builder",
      command,
      mode: "scaffold-fallback",
      target: "mac",
    });
    return { ok: true, message: "v2 mac package scaffold verified." };
  }

  if (tool === "tsc" && args.includes("--noEmit")) {
    assertPath("tsconfig.json");
    assertPath("src/backend");
    assertPath("src/desktop");
    assertPath("src/shared/contracts");
    return { ok: true, message: "v2 typecheck scaffold verified." };
  }

  return {
    ok: false,
    message: `Missing local tool ${toolName}; no scaffold fallback for ${command}.`,
  };
}

function assertPath(relativePath) {
  if (!fs.existsSync(path.join(repoRoot, relativePath))) {
    throw new Error(`Missing required v2 scaffold path: ${relativePath}`);
  }
}

function writeManifest(relativePath, value) {
  const manifestPath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(value, null, 2)}\n`);
}
