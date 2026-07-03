import assert from "node:assert/strict";
import test from "node:test";

import { invokeCodexProviderCapability } from "../src/backend/adapters/outbound/agent-runtime/structured/codex-provider-methods.ts";

test("codex review/start defaults to inline uncommitted review params", async () => {
  const request = requestRecorder();

  await invokeCodexProviderCapability({
    capability: {
      capabilityId: "codex:review",
      invoke: { kind: "provider_method", method: "review/start" },
    },
    codexThreadId: "codex-thread-1",
    request,
  });

  assert.deepEqual(request.calls, [
    {
      method: "review/start",
      params: {
        threadId: "codex-thread-1",
        target: { type: "uncommittedChanges" },
      },
    },
  ]);
});

test("codex review/start maps Tide review targets to app-server schema", async () => {
  const request = requestRecorder();
  const targets = [
    [{ kind: "base_branch", baseBranch: "main" }, { type: "baseBranch", branch: "main" }],
    [{ kind: "commit", sha: "abc123", title: "Fix bug" }, { type: "commit", sha: "abc123", title: "Fix bug" }],
    [{ kind: "custom", instructions: "Focus on tests.", diff: "+ignored" }, { type: "custom", instructions: "Focus on tests." }],
  ] as const;

  for (const [target, expected] of targets) {
    await invokeCodexProviderCapability({
      capability: {
        capabilityId: "codex:review",
        invoke: { kind: "provider_method", method: "review/start" },
        params: { target, delivery: "detached" },
      },
      codexThreadId: "codex-thread-1",
      request,
    });
    assert.deepEqual(request.calls.at(-1), {
      method: "review/start",
      params: {
        threadId: "codex-thread-1",
        target: expected,
        delivery: "detached",
      },
    });
  }
});

test("codex review/start preserves already-native review targets", async () => {
  const request = requestRecorder();

  await invokeCodexProviderCapability({
    capability: {
      capabilityId: "codex:review",
      invoke: {
        kind: "provider_method",
        method: "review/start",
        params: { target: { type: "baseBranch", branch: "develop" }, delivery: "inline" },
      },
    },
    codexThreadId: "codex-thread-1",
    request,
  });

  assert.deepEqual(request.calls[0], {
    method: "review/start",
    params: {
      threadId: "codex-thread-1",
      target: { type: "baseBranch", branch: "develop" },
      delivery: "inline",
    },
  });
});

function requestRecorder(): {
  calls: Array<{ method: string; params: Record<string, unknown> }>;
  (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
} {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const request = async (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
    calls.push({ method, params });
    return { ok: true };
  };
  return Object.assign(request, { calls });
}
