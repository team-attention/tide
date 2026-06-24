import assert from "node:assert/strict";
import test from "node:test";

import { createProviderDetection } from "../src/backend/infrastructure/node/provider/provider-detection.ts";

// Spec: docs_v2/specs/provider-hub-dynamic-status.md

test("providerCatalog builds a provider-wide dynamic status snapshot", async () => {
  const detection = createProviderDetection({
    hasIntegration: () => true,
    resolveExecutable: () => "/usr/bin/true",
    readAuthenticated: (agentId) => {
      if (agentId === "codex") {
        return true;
      }
      if (agentId === "claude") {
        return false;
      }
      return true;
    },
  });

  assert.deepEqual(detection.detectAvailableAgents(), ["codex", "claude", "opencode"]);

  const catalog = await detection.providerCatalog();
  const codex = catalog.providers.find((provider) => provider.agentId === "codex");
  assert.equal(codex?.installed, true);
  assert.equal(codex?.authenticated, true);
  assert.equal(codex?.source, "static");
  assert.ok((codex?.models.length ?? 0) > 1);

  const claude = catalog.providers.find((provider) => provider.agentId === "claude");
  assert.equal(claude?.authenticated, false);
  assert.equal(claude?.source, "static");
  assert.ok((claude?.models.length ?? 0) > 1);

  const opencode = catalog.providers.find((provider) => provider.agentId === "opencode");
  assert.equal(opencode?.installed, true);
  assert.equal(opencode?.authenticated, true);
  assert.equal(opencode?.source, "dynamic");
  assert.equal(opencode?.connectedVendors, 0);
  assert.ok((opencode?.totalVendors ?? 0) > 0);
  assert.deepEqual(catalog.opencodeModels, []);
  assert.equal(catalog.opencodeVendors.length, opencode?.totalVendors);
});
