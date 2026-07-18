// Spec: docs_v2/specs/opencode-export-recovery.md

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { AgentSessionBlock } from "../src/backend/application/domains/agent-session/agent-session-block.ts";
import { reconcileReopenedThreadBlocks } from "../src/backend/infrastructure/node/live/live-backend-restore.ts";
import {
  opencodeImportDiagnosticBlock,
} from "../src/backend/infrastructure/node/provider/provider-conversation-rebuilders.ts";
import {
  runFileBackedStdoutCommand,
} from "../src/backend/infrastructure/node/provider/opencode-export-command.ts";

test("file-backed stdout capture preserves output larger than the pipe flush boundary", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-export-recovery-test-"));
  try {
    const expectedBytes = 256 * 1024;
    const output = runFileBackedStdoutCommand({
      executablePath: process.execPath,
      args: ["-e", `process.stdout.write("x".repeat(${expectedBytes})); process.exit(0)`],
      timeoutMs: 2_000,
      maxOutputBytes: expectedBytes + 1,
      tempRoot,
    });

    assert.equal(Buffer.byteLength(output ?? ""), expectedBytes);
    assert.deepEqual(fs.readdirSync(tempRoot), []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("file-backed stdout capture rejects failed and oversized commands without leaking temp files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-export-recovery-test-"));
  try {
    const failed = runFileBackedStdoutCommand({
      executablePath: process.execPath,
      args: ["-e", "process.exit(7)"],
      timeoutMs: 2_000,
      maxOutputBytes: 1024,
      tempRoot,
    });
    const oversized = runFileBackedStdoutCommand({
      executablePath: process.execPath,
      args: ["-e", 'process.stdout.write("x".repeat(2048)); process.exit(0)'],
      timeoutMs: 2_000,
      maxOutputBytes: 1024,
      tempRoot,
    });
    const timedOut = runFileBackedStdoutCommand({
      executablePath: process.execPath,
      args: ["-e", "setTimeout(() => {}, 5_000)"],
      timeoutMs: 50,
      maxOutputBytes: 1024,
      tempRoot,
    });

    assert.equal(failed, undefined);
    assert.equal(oversized, undefined);
    assert.equal(timedOut, undefined);
    assert.deepEqual(fs.readdirSync(tempRoot), []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("reopen reconciliation prefers valid provider history over derived cache", () => {
  const provider = sessionBlock("provider", "fresh provider history");
  const cached = sessionBlock("cached", "stale cached history");

  assert.deepEqual(reconcileReopenedThreadBlocks([provider], [cached]), [provider]);
});

test("reopen reconciliation joins optimistic user blocks by delivery ID, never text", () => {
  const provider = sessionBlock("provider", "same text");
  provider.kind = "user_message";
  provider.role = "user";
  provider.localProvenance = { deliveryId: "delivery-a", providerMessageId: "message-a" };
  const matched = sessionBlock("matched", "same text");
  matched.kind = "user_message";
  matched.role = "user";
  matched.localProvenance = { deliveryId: "delivery-a", deliveryState: "working_unconfirmed" };
  const sameTextButDifferentId = sessionBlock("unmatched", "same text");
  sameTextButDifferentId.kind = "user_message";
  sameTextButDifferentId.role = "user";
  sameTextButDifferentId.localProvenance = { deliveryId: "delivery-b", deliveryState: "working_unconfirmed" };

  const reconciled = reconcileReopenedThreadBlocks(
    [provider],
    [matched, sameTextButDifferentId],
  );
  assert.equal(reconciled.length, 2);
  assert.equal(reconciled[0].blockId, "provider");
  assert.equal(reconciled[0].localProvenance?.deliveryId, "delivery-a");
  assert.equal(reconciled[0].localProvenance?.deliveryState, "acknowledged");
  assert.equal(reconciled[1].blockId, "unmatched");
  assert.equal(reconciled[1].localProvenance?.deliveryId, "delivery-b");
  assert.equal(reconciled[1].localProvenance?.deliveryState, "indeterminate");
  assert.equal(
    reconciled[1].localProvenance?.recoveryReason,
    "restart_without_provider_delivery_evidence",
  );
});

test("reopen reconciliation preserves cached history when opencode import fails", () => {
  const cached = sessionBlock("cached", "locally cached history");
  const diagnostic = opencodeImportDiagnosticBlock(
    "thread-1",
    "opencode",
    "session-1",
    "opencode export did not return parseable session JSON.",
  );

  assert.deepEqual(
    reconcileReopenedThreadBlocks([diagnostic], [cached]),
    [cached, diagnostic],
  );
  assert.deepEqual(reconcileReopenedThreadBlocks([diagnostic], []), [diagnostic]);
});

test("reopen without provider evidence marks an accepted optimistic delivery indeterminate", () => {
  const cached = sessionBlock("cached-user", "possibly accepted");
  cached.kind = "user_message";
  cached.role = "user";
  cached.localProvenance = {
    kind: "composer_input",
    deliveryId: "delivery-1",
    deliveryState: "acknowledged",
  };

  const [reconciled] = reconcileReopenedThreadBlocks([], [cached]);
  assert.equal(reconciled.localProvenance?.deliveryState, "indeterminate");
  assert.equal(
    reconciled.localProvenance?.recoveryReason,
    "restart_without_provider_delivery_evidence",
  );
});

function sessionBlock(blockId: string, body: string): AgentSessionBlock {
  return {
    blockId,
    threadId: "thread-1",
    agentId: "opencode",
    kind: "agent_message",
    role: "agent",
    sourceFrameIds: [],
    status: "complete",
    body,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
}
