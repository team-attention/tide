#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const codex = args.codex ?? "codex";
if (!args.out) {
  fail("usage: capture-codex-app-server.mjs --codex <codex> --out <dir>");
}

const version = run(codex, ["--version"]);
const help = run(codex, ["app-server", "--help"]);
mkdirSync(args.out, { recursive: true });
writeFileSync(join(args.out, "runtime-help.txt"), help.stdout);
writeFileSync(join(args.out, "provider.json"), JSON.stringify({
  provider: "codex",
  executable: "codex",
  version: firstLine(version.stdout),
  surfaces: ["app-server"],
  helpSha256: sha256(help.stdout),
  capturedAt: new Date().toISOString(),
  redaction: "help_only",
}, null, 2));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--codex" || arg === "--out") {
      out[arg.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8" });
  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(" ")} failed: ${result.stderr || result.error?.message || result.status}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

function firstLine(value) {
  return value.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
