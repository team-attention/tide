import assert from "node:assert/strict";
import { test } from "node:test";

import { createRuntimeReadinessRegistry } from "../src/backend/application/services/provider/runtime-readiness-registry.ts";

test("awaitToolSurface resolves after the runtime is marked ready", async () => {
  const registry = createRuntimeReadinessRegistry();
  let resolved = false;
  const waiting = registry
    .awaitToolSurface("runtime-1", { settleMs: 0, timeoutMs: 1000 })
    .then(() => {
      resolved = true;
    });

  await Promise.resolve();
  assert.equal(resolved, false, "must not resolve before the tool surface is ready");

  registry.markToolSurfaceReady("runtime-1");
  await waiting;
  assert.equal(resolved, true);
});

test("mark before await still resolves (latched signal)", async () => {
  const registry = createRuntimeReadinessRegistry();
  registry.markToolSurfaceReady("runtime-2");
  await registry.awaitToolSurface("runtime-2", { settleMs: 0, timeoutMs: 1000 });
});

test("awaitToolSurface resolves on timeout when the signal never arrives", async () => {
  const registry = createRuntimeReadinessRegistry();
  // Never marked ready — must still resolve so a turn is never hung forever.
  await registry.awaitToolSurface("runtime-3", { settleMs: 0, timeoutMs: 20 });
});

test("a later settle delays delivery past the bare signal", async () => {
  const registry = createRuntimeReadinessRegistry();
  const start = Date.now();
  registry.markToolSurfaceReady("runtime-4");
  await registry.awaitToolSurface("runtime-4", { settleMs: 30, timeoutMs: 1000 });
  assert.ok(Date.now() - start >= 25, "settle window should elapse after the signal");
});

test("forget clears latched readiness", async () => {
  const registry = createRuntimeReadinessRegistry();
  registry.markToolSurfaceReady("runtime-5");
  registry.forget("runtime-5");
  // After forget, readiness is no longer latched, so it falls back to the timeout.
  const start = Date.now();
  await registry.awaitToolSurface("runtime-5", { settleMs: 0, timeoutMs: 20 });
  assert.ok(Date.now() - start >= 15);
});
