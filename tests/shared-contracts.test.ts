import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CONTRACT_VERSION,
  createAgentSessionBlockUpsertedEvent,
  createCommandAcceptedEvent,
  createCommandCompletedEvent,
  createContractErrorPayload,
  validateBackendCommandEnvelope,
  validateBackendEventEnvelope,
  type AgentSessionBlockDto,
  type PromptChoiceDto,
} from "../src/shared/contracts/index.ts";

const issuedAt = "2026-05-27T00:00:00.000Z";
const emittedAt = "2026-05-27T00:00:01.000Z";

const commandEnvelope = {
  contractVersion: CONTRACT_VERSION,
  requestId: "req-shared-contracts-1",
  kind: "composer.sendInput",
  issuedAt,
  payload: {
    threadId: "thread-1",
    input: "continue",
  },
};

test("BackendCommandEnvelope accepts Contract Version 1 and rejects unsupported versions", () => {
  assert.equal(validateBackendCommandEnvelope(commandEnvelope).ok, true);

  const result = validateBackendCommandEnvelope({
    ...commandEnvelope,
    contractVersion: 2,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unsupported_contract_version");
});

test("BackendCommandEnvelope rejects missing RequestId before Backend services", () => {
  const { requestId: _requestId, ...withoutRequestId } = commandEnvelope;
  const result = validateBackendCommandEnvelope(withoutRequestId);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_command");
});

test("BackendEventEnvelope rejects events without eventId", () => {
  const eventEnvelope = {
    contractVersion: CONTRACT_VERSION,
    eventId: "evt-1",
    requestId: commandEnvelope.requestId,
    kind: "command.completed",
    emittedAt,
    payload: {},
  };

  assert.equal(validateBackendEventEnvelope(eventEnvelope).ok, true);

  const { eventId: _eventId, ...withoutEventId } = eventEnvelope;
  const result = validateBackendEventEnvelope(withoutEventId);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_event");
});

test("command-scoped events preserve RequestId", () => {
  const block: AgentSessionBlockDto = {
    blockId: "block-1",
    threadId: "thread-1",
    kind: "agent_text",
    status: "streaming",
    updatedAt: emittedAt,
    body: "working",
  };

  const accepted = createCommandAcceptedEvent(commandEnvelope, {
    eventId: "evt-accepted",
    emittedAt,
  });
  const stream = createAgentSessionBlockUpsertedEvent({
    eventId: "evt-stream",
    requestId: commandEnvelope.requestId,
    emittedAt,
    block,
  });
  const completed = createCommandCompletedEvent(commandEnvelope, {
    eventId: "evt-completed",
    emittedAt,
  });

  assert.deepEqual(
    [accepted.requestId, stream.requestId, completed.requestId],
    [
      commandEnvelope.requestId,
      commandEnvelope.requestId,
      commandEnvelope.requestId,
    ],
  );
});

test("Contract Error payloads round-trip through JSON without Error objects or stack traces", () => {
  const payload = createContractErrorPayload({
    code: "internal_error",
    message: "runtime failed",
    severity: "error",
    retryable: false,
    details: {
      safe: "kept",
      rawError: new Error("do not serialize"),
    },
  });

  const roundTripped = JSON.parse(JSON.stringify(payload));

  assert.deepEqual(roundTripped, {
    code: "internal_error",
    message: "runtime failed",
    severity: "error",
    retryable: false,
    details: {
      safe: "kept",
    },
  });
  assert.equal(JSON.stringify(roundTripped).includes("stack"), false);
});

test("Stream Updates target stable Agent Session Block ids", () => {
  const first = createAgentSessionBlockUpsertedEvent({
    eventId: "evt-block-1",
    requestId: commandEnvelope.requestId,
    emittedAt,
    block: {
      blockId: "block-1",
      threadId: "thread-1",
      kind: "agent_text",
      status: "streaming",
      updatedAt: emittedAt,
      body: "hel",
    },
  });
  const second = createAgentSessionBlockUpsertedEvent({
    eventId: "evt-block-2",
    requestId: commandEnvelope.requestId,
    emittedAt: "2026-05-27T00:00:02.000Z",
    block: {
      blockId: "block-1",
      threadId: "thread-1",
      kind: "agent_text",
      status: "complete",
      updatedAt: "2026-05-27T00:00:02.000Z",
      body: "hello",
    },
  });

  const records = new Map<string, AgentSessionBlockDto>();
  for (const event of [first, second]) {
    records.set(event.payload.block.blockId, event.payload.block);
  }

  assert.equal(records.size, 1);
  assert.equal(records.get("block-1")?.body, "hello");
  assert.equal(records.get("block-1")?.status, "complete");
});

test("Backend domain, services, and ports do not import Shared Contracts", () => {
  const roots = [
    "src/backend/domain",
    "src/backend/services",
    "src/backend/ports",
    "src/backend/application/domains",
    "src/backend/application/services",
    "src/backend/application/ports",
  ];

  assert.deepEqual(findSourceMentions(roots, /shared\/contracts/), []);
});

test("Desktop does not import Backend internals", () => {
  assert.deepEqual(
    findSourceMentions(
      ["src/desktop"],
      /from\s+["'][^"']*backend|import\(["'][^"']*backend/,
    ),
    [],
  );
});

test("Prompt choices preserve provider-native values", () => {
  const choice: PromptChoiceDto = {
    choiceId: "provider-choice-1",
    label: "Allow once",
    providerValue: "--dangerously-skip-permissions",
  };

  assert.equal(
    JSON.parse(JSON.stringify(choice)).providerValue,
    choice.providerValue,
  );
});

function findSourceMentions(relativeRoots: string[], pattern: RegExp): string[] {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const violations: string[] = [];

  for (const relativeRoot of relativeRoots) {
    const absoluteRoot = path.join(repoRoot, relativeRoot);
    if (!fs.existsSync(absoluteRoot)) {
      continue;
    }
    for (const filePath of sourceFiles(absoluteRoot)) {
      const source = fs.readFileSync(filePath, "utf8");
      if (pattern.test(source)) {
        violations.push(path.relative(repoRoot, filePath));
      }
    }
  }

  return violations.sort();
}

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(fullPath));
      continue;
    }
    if (/\.(cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}
