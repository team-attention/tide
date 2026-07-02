#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixture = process.argv[2];
if (!fixture) {
  process.stderr.write("usage: replay-native-fixture.mjs <fixture.jsonl>\n");
  process.exit(2);
}

if (process.env.TIDE_NATIVE_FIXTURE_REPLAY_CHILD !== "1") {
  const scriptPath = fileURLToPath(import.meta.url);
  const desktopRoot = resolve(dirname(scriptPath), "../..");
  const result = spawnSync(process.execPath, ["--import", "tsx", scriptPath, fixture], {
    cwd: desktopRoot,
    env: { ...process.env, TIDE_NATIVE_FIXTURE_REPLAY_CHILD: "1" },
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

const moduleUrl = new URL(
  "../../src/backend/adapters/outbound/agent-runtime/evidence/native-fixture-replay.ts",
  import.meta.url,
);
const { replayNativeFixtureText } = await import(moduleUrl.href);
const summary = replayNativeFixtureText(readFileSync(fixture, "utf8"));

process.stdout.write(JSON.stringify({
  fixture,
  ...summary,
}, null, 2));
process.stdout.write("\n");
