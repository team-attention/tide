// Spec: docs_v2/specs/provider-authoritative-conversation-lifecycle.md

import assert from "node:assert/strict";
import test from "node:test";

import { createLocalUserMessageBlock } from "../src/backend/application/domains/agent-session/agent-session-block.ts";
import {
  normalizeProviderTerminalStatus,
  type StructuredProviderEvent,
} from "../src/backend/adapters/outbound/agent-runtime/structured/structured-runtime-events.ts";
import { nativeIdsFromStructuredProviderEvent } from "../src/backend/adapters/outbound/agent-runtime/clients/structured-to-native-runtime-event.ts";

test("provider terminal normalization preserves distinct native outcomes", () => {
  assert.deepEqual(normalizeProviderTerminalStatus("codex", "completed"), {
    status: "completed",
    nativeStatus: "completed",
  });
  assert.deepEqual(normalizeProviderTerminalStatus("codex", "interrupted"), {
    status: "interrupted",
    nativeStatus: "interrupted",
  });
  assert.deepEqual(normalizeProviderTerminalStatus("claude", "aborted_streaming"), {
    status: "interrupted",
    nativeStatus: "aborted_streaming",
  });
  assert.deepEqual(normalizeProviderTerminalStatus("opencode", "max_tokens"), {
    status: "max_tokens",
    nativeStatus: "max_tokens",
  });
  assert.deepEqual(normalizeProviderTerminalStatus("opencode", "refusal"), {
    status: "refusal",
    nativeStatus: "refusal",
  });
  assert.deepEqual(normalizeProviderTerminalStatus("opencode", "cancelled"), {
    status: "cancelled",
    nativeStatus: "cancelled",
  });
});

test("delivery and turn identity survive structured native evidence", () => {
  const acknowledged: StructuredProviderEvent = {
    kind: "delivery_acknowledged",
    deliveryId: "delivery-1",
    providerMessageId: "provider-message-1",
    providerTurnId: "turn-1",
  };
  assert.deepEqual(nativeIdsFromStructuredProviderEvent(acknowledged), {
    deliveryId: "delivery-1",
    messageId: "provider-message-1",
    turnId: "turn-1",
  });

  const completed: StructuredProviderEvent = {
    kind: "turn_completed",
    status: "interrupted",
    nativeStatus: "aborted_streaming",
    deliveryId: "delivery-1",
    turnId: "turn-1",
  };
  assert.deepEqual(nativeIdsFromStructuredProviderEvent(completed), {
    deliveryId: "delivery-1",
    turnId: "turn-1",
  });
});

test("optimistic user blocks use the delivery UUID as reconciliation provenance", () => {
  const block = createLocalUserMessageBlock({
    threadId: "thread-1",
    agentId: "codex",
    input: "hello",
    submittedAt: "2026-07-19T00:00:00.000Z",
    localId: "legacy-local-id",
    deliveryId: "delivery-1",
    deliveryState: "acknowledged",
  });

  assert.equal(block.localProvenance?.deliveryId, "delivery-1");
  assert.equal(block.localProvenance?.deliveryState, "acknowledged");
});
