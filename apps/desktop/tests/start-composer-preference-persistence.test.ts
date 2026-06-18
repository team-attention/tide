import assert from "node:assert/strict";
import test from "node:test";

import { isProductShellAgentIdentity } from "../src/desktop/application/domains/product-shell/product-shell.ts";
import {
  loadPreferredStartComposer,
  persistPreferredStartComposer,
} from "../src/desktop/adapters/inbound/react-renderer/product-shell/settings/settings.tsx";

// Spec: docs_v2/specs/opencode-model-vendor-selection.md — the Start Composer
// remembers the last-picked agent + model for EVERY offered agent (regression:
// the persistence allowlist was hardcoded to codex/claude/openai_api, silently
// dropping opencode + gemini, so their model choice was never remembered).

// Prefs no longer live in localStorage — they are owned by Main and injected into the
// renderer as window.tide.uiPrefs (the boot localStorage access stalled ~3.8s; see
// ui-prefs.ts / ui-prefs-store.ts). Shim window.tide with an in-memory snapshot whose
// saveUiPref writes back into the same snapshot the loaders read — i.e. simulate the
// file→inject round-trip a relaunch would do.
const uiPrefs: Record<string, string> = {};
(globalThis as { window?: unknown }).window = {
  tide: {
    uiPrefs,
    saveUiPref(key: string, value: string): void {
      uiPrefs[key] = value;
    },
  },
};

function clearPrefs(): void {
  for (const key of Object.keys(uiPrefs)) {
    delete uiPrefs[key];
  }
}

const START_COMPOSER_KEY = "tide.startComposerDefaults";

test("an opencode Start Composer preference round-trips through storage", () => {
  clearPrefs();
  persistPreferredStartComposer({
    agentId: "opencode",
    model: "openai/gpt-5.5",
    permission: "build",
    reasoning: "high",
  });
  assert.deepEqual(loadPreferredStartComposer(), {
    agentId: "opencode",
    model: "openai/gpt-5.5",
    permission: "build",
    reasoning: "high",
  });
});

test("a gemini Start Composer preference round-trips through storage", () => {
  clearPrefs();
  persistPreferredStartComposer({ agentId: "gemini", model: "gemini-3-pro-preview", permission: "default" });
  const loaded = loadPreferredStartComposer();
  assert.equal(loaded?.agentId, "gemini");
  assert.equal(loaded?.model, "gemini-3-pro-preview");
});

test("an unknown persisted agent loads as null (no preference)", () => {
  clearPrefs();
  // A stored record for an agent the build no longer knows must load as null.
  uiPrefs[START_COMPOSER_KEY] = JSON.stringify({ agentId: "bogus", model: "x" });
  assert.equal(loadPreferredStartComposer(), null);
});

test("isProductShellAgentIdentity accepts the five agents, rejects undefined/unknown", () => {
  for (const id of ["codex", "claude", "gemini", "opencode", "openai_api"]) {
    assert.equal(isProductShellAgentIdentity(id), true, `expected ${id} to be a valid agent`);
  }
  assert.equal(isProductShellAgentIdentity(undefined), false);
  assert.equal(isProductShellAgentIdentity("bogus"), false);
});
