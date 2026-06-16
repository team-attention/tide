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

// In-memory localStorage shim — the Node test env has no DOM. The settings
// helpers read `localStorage` at call time, so installing it on globalThis is
// enough; they no-op when it is absent.
class MemoryStorage {
  private readonly store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

(globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage() as unknown as Storage;

test("an opencode Start Composer preference round-trips through storage", () => {
  localStorage.clear();
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
  localStorage.clear();
  persistPreferredStartComposer({ agentId: "gemini", model: "gemini-3-pro-preview", permission: "default" });
  const loaded = loadPreferredStartComposer();
  assert.equal(loaded?.agentId, "gemini");
  assert.equal(loaded?.model, "gemini-3-pro-preview");
});

test("an unknown persisted agent loads as null (no preference)", () => {
  localStorage.clear();
  persistPreferredStartComposer({ agentId: "opencode", model: "openai/gpt-5.5" });
  // Corrupt the stored record to an unknown agent on whatever key was written.
  const key = (globalThis.localStorage as unknown as MemoryStorage).key(0);
  assert.notEqual(key, null);
  localStorage.setItem(key as string, JSON.stringify({ agentId: "bogus", model: "x" }));
  assert.equal(loadPreferredStartComposer(), null);
});

test("isProductShellAgentIdentity accepts the five agents, rejects undefined/unknown", () => {
  for (const id of ["codex", "claude", "gemini", "opencode", "openai_api"]) {
    assert.equal(isProductShellAgentIdentity(id), true, `expected ${id} to be a valid agent`);
  }
  assert.equal(isProductShellAgentIdentity(undefined), false);
  assert.equal(isProductShellAgentIdentity("bogus"), false);
});
