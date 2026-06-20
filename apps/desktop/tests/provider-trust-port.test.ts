// Spec: docs_v2/specs/scratch-execution-context.md — codex launches against an
// overlaid CODEX_HOME whose config.toml is a bootstrap-time snapshot of the real
// trust. Granting trust must reach BOTH configs, or the running codex still prompts
// for directory trust from the config it actually reads.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createNodeProviderTrustPort } from "../src/backend/adapters/outbound/provider-trust/node-provider-trust-port.ts";

test("codex trust is written to both the real and the overlay config.toml", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tide-trust-home-"));
  const overlayHome = fs.mkdtempSync(path.join(os.tmpdir(), "tide-trust-overlay-"));
  const cwd = "/tmp/tide-scratch/thread-xyz";

  const port = createNodeProviderTrustPort(home, overlayHome);
  await port.trust({ agentId: "codex", cwd });

  const realConfig = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
  const overlayConfig = fs.readFileSync(path.join(overlayHome, "config.toml"), "utf8");
  const expected = `[projects."${cwd}"]`;
  assert.ok(realConfig.includes(expected), "real config must trust the cwd");
  assert.ok(realConfig.includes('trust_level = "trusted"'));
  assert.ok(overlayConfig.includes(expected), "overlay config must trust the cwd");
  assert.ok(overlayConfig.includes('trust_level = "trusted"'));
});

test("codex trust is idempotent and does not duplicate the project block", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tide-trust-home-"));
  const overlayHome = fs.mkdtempSync(path.join(os.tmpdir(), "tide-trust-overlay-"));
  const cwd = "/tmp/tide-scratch/thread-abc";

  const port = createNodeProviderTrustPort(home, overlayHome);
  await port.trust({ agentId: "codex", cwd });
  await port.trust({ agentId: "codex", cwd });

  const overlayConfig = fs.readFileSync(path.join(overlayHome, "config.toml"), "utf8");
  const occurrences = overlayConfig.split(`[projects."${cwd}"]`).length - 1;
  assert.equal(occurrences, 1);
});

test("codex trust still works with no overlay home (real config only)", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tide-trust-home-"));
  const cwd = "/tmp/tide-scratch/thread-noov";

  const port = createNodeProviderTrustPort(home);
  await port.trust({ agentId: "codex", cwd });

  const realConfig = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
  assert.ok(realConfig.includes(`[projects."${cwd}"]`));
});
