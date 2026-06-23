// Spec: live-turn-activity-visibility.md (Slice B′). Codex app-server reports
// update_plan as a function_call in live rollout logs; the structured client turns
// that into live_activity so the Working indicator can show "X/Y steps".

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCodexAppServerClient } from "../src/backend/adapters/outbound/agent-runtime/structured/codex-app-server-client.ts";
import type { StructuredProviderEvent } from "../src/backend/adapters/outbound/agent-runtime/structured/structured-runtime-events.ts";
import type { ProviderLaunchPlan } from "../src/backend/application/ports/outbound/agent-integration-port.ts";

function fakePlanUpdateServer(): ProviderLaunchPlan {
  const item = {
    type: "function_call",
    name: "update_plan",
    arguments: JSON.stringify({
      plan: [
        { step: "one", status: "completed" },
        { step: "two", status: "in_progress" },
        { step: "three", status: "pending" },
        { step: "four", status: "pending" },
      ],
    }),
    call_id: "call_plan",
  };
  const notification = JSON.stringify({ method: "item/completed", params: { item } });
  return {
    command: process.execPath,
    args: ["-e", `console.log(${JSON.stringify(notification)}); setTimeout(() => {}, 10000);`],
    env: {},
    cwd: mkdtempSync(join(tmpdir(), "tide-codex-plan-")),
    transport: "codex_app_server",
  };
}

async function waitFor<T>(probe: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const value = probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for event");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("codex update_plan function_call emits live plan activity", async () => {
  const events: StructuredProviderEvent[] = [];
  const client = createCodexAppServerClient({
    plan: fakePlanUpdateServer(),
    threadId: "thread-1",
    runtimeId: "runtime-1",
    onEvent: (event) => events.push(event),
  });
  try {
    const event = await waitFor(() => events.find((entry) => entry.kind === "live_activity"));
    assert.deepEqual(event, {
      kind: "live_activity",
      planTotal: 4,
      planCompleted: 1,
    });
  } finally {
    await client.stop();
  }
});
