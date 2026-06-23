// Spec: docs_v2/specs/thread-list-first-paint-snapshot.md
// The first-paint snapshot reads threads/index.json in Main OUTSIDE any try/catch around
// the mapping, so a malformed record must be rejected by validation (→ null → skeleton),
// never reach the mapper and throw. These cover the parse/validate contract directly.
import assert from "node:assert/strict";
import test from "node:test";

import { snapshotFromIndexJson } from "../src/desktop/infrastructure/electron/main/thread-list-snapshot-parse.ts";

function record(overrides = {}) {
  return {
    storageVersion: 1,
    threadId: "t1",
    title: "T1",
    pinned: false,
    archived: false,
    createdAt: "2026-06-23T00:00:00.000Z",
    updatedAt: "2026-06-23T00:00:01.000Z",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "p", cwd: "/repo" },
    executionContext: { cwd: "/repo" },
    lastKnownState: "idle",
    ...overrides,
  };
}

function index(...records: object[]) {
  return { storageVersion: 1, threads: records.map((r) => ({ record: r })) };
}

test("maps a valid enriched index to a thread summary", () => {
  const snapshot = snapshotFromIndexJson(index(record()));
  assert.equal(snapshot?.threads.length, 1);
  assert.equal(snapshot?.threads[0]?.threadId, "t1");
  assert.equal(snapshot?.threads[0]?.agentBinding.agentId, "codex");
  // runtimeSource is defaulted from the agentId when the record omits it.
  assert.deepEqual(snapshot?.threads[0]?.agentBinding.runtimeSource, {
    kind: "provider_cli",
    integrationId: "codex",
  });
  assert.equal(snapshot?.threads[0]?.agentBinding.providerSessionRef, undefined);
});

test("maps a well-formed providerSessionRef through", () => {
  const snapshot = snapshotFromIndexJson(
    index(record({ agentBinding: { agentId: "codex", providerSessionRef: { kind: "rollout", value: "abc" } } })),
  );
  assert.deepEqual(snapshot?.threads[0]?.agentBinding.providerSessionRef, { kind: "rollout", value: "abc" });
});

test("rejects a record whose nested providerSessionRef is null (no throw, skeleton fallback)", () => {
  // Regression: a null ref previously reached agentBindingFromRecord and threw on `.kind`,
  // crashing Main outside the JSON.parse try/catch.
  assert.equal(
    snapshotFromIndexJson(index(record({ agentBinding: { agentId: "codex", providerSessionRef: null } }))),
    null,
  );
});

test("rejects a record whose root providerSessionRef is null", () => {
  assert.equal(snapshotFromIndexJson(index(record({ providerSessionRef: null }))), null);
});

test("rejects a malformed providerSessionRef (missing value)", () => {
  assert.equal(
    snapshotFromIndexJson(index(record({ agentBinding: { agentId: "codex", providerSessionRef: { kind: "rollout" } } }))),
    null,
  );
});

test("rejects a legacy entry that has no embedded record", () => {
  assert.equal(snapshotFromIndexJson({ storageVersion: 1, threads: [{ threadId: "t1", title: "T1" }] }), null);
});

test("rejects a non-object, wrong storageVersion, or non-array threads", () => {
  assert.equal(snapshotFromIndexJson(null), null);
  assert.equal(snapshotFromIndexJson("nope"), null);
  assert.equal(snapshotFromIndexJson({ storageVersion: 2, threads: [] }), null);
  assert.equal(snapshotFromIndexJson({ storageVersion: 1, threads: "nope" }), null);
});

test("sorts threads by updatedAt descending", () => {
  const older = record({ threadId: "older", updatedAt: "2026-06-23T00:00:00.000Z" });
  const newer = record({ threadId: "newer", updatedAt: "2026-06-23T09:00:00.000Z" });
  const snapshot = snapshotFromIndexJson(index(older, newer));
  assert.deepEqual(snapshot?.threads.map((t) => t.threadId), ["newer", "older"]);
});
