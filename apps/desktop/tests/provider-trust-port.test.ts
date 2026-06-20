// Spec: docs_v2/specs/scratch-execution-context.md — trust writes must land in the
// same provider-owned config path the spawned CLI will read.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createNodeProviderTrustPort } from "../src/backend/adapters/outbound/provider-trust/node-provider-trust-port.ts";

test("codex trust is written to the effective codex home", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tide-trust-home-"));
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "tide-trust-codex-home-"));
  const cwd = "/tmp/tide-scratch/thread-xyz";

  const port = createNodeProviderTrustPort(home, codexHome);
  await port.trust({ agentId: "codex", cwd });

  const config = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
  const expected = `[projects."${cwd}"]`;
  assert.ok(config.includes(expected), "effective codex home must trust the cwd");
  assert.ok(config.includes('trust_level = "trusted"'));
  assert.equal(fs.existsSync(path.join(home, ".codex", "config.toml")), false);
});

test("codex trust is idempotent and does not duplicate the project block", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tide-trust-home-"));
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "tide-trust-codex-home-"));
  const cwd = "/tmp/tide-scratch/thread-abc";

  const port = createNodeProviderTrustPort(home, codexHome);
  await port.trust({ agentId: "codex", cwd });
  await port.trust({ agentId: "codex", cwd });

  const config = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
  const occurrences = config.split(`[projects."${cwd}"]`).length - 1;
  assert.equal(occurrences, 1);
});

test("codex trust defaults to home dot codex when no codex home is provided", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tide-trust-home-"));
  const cwd = "/tmp/tide-scratch/thread-noov";

  const port = createNodeProviderTrustPort(home);
  await port.trust({ agentId: "codex", cwd });

  const realConfig = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
  assert.ok(realConfig.includes(`[projects."${cwd}"]`));
});
