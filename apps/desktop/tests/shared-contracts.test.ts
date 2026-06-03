import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CONTRACT_VERSION,
  createAgentSessionBlockCompletedEvent,
  createAgentSessionBlockUpsertedEvent,
  createCommandAcceptedEvent,
  createCommandCompletedEvent,
  createContractErrorEvent,
  createContractErrorPayload,
  validateBackendCommandEnvelope,
  validateBackendEventEnvelope,
  type AgentBindingDto,
  type AgentSessionBlockDto,
  type BrowserPaneRefDto,
  type WorkbenchPaneRefDto,
  type PromptChoiceDto,
  type ProviderReadinessDto,
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

test("thread_list_contracts_round_trip_thread_summaries", () => {
  const command = {
    contractVersion: CONTRACT_VERSION,
    requestId: "req-thread-list",
    kind: "thread.list",
    issuedAt,
    payload: { includeArchived: false },
  };
  const eventEnvelope = {
    contractVersion: CONTRACT_VERSION,
    eventId: "evt-thread-listed",
    requestId: command.requestId,
    kind: "thread.listed",
    emittedAt,
    payload: {
      threads: [
        {
          threadId: "thread-listed",
          title: "Listed Thread",
          agentBinding: {
            agentId: "codex",
            runtimeSource: { kind: "provider_cli", integrationId: "codex" },
          },
          scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
          launchOptions: {
            model: "Antigravity default",
            permission: "default",
          },
          createdAt: issuedAt,
          updatedAt: emittedAt,
          pinned: false,
          archived: false,
          lastKnownState: "idle",
        },
      ],
    },
  };

  assert.equal(validateBackendCommandEnvelope(command).ok, true);
  assert.equal(validateBackendEventEnvelope(eventEnvelope).ok, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(eventEnvelope)).payload.threads[0].scope,
    { kind: "project", projectId: "tide", cwd: "/repo/tide" },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(eventEnvelope)).payload.threads[0].launchOptions,
    { model: "Antigravity default", permission: "default" },
  );
});

test("workbench_editor_pane_contract_carries_editable_body_text", () => {
  // Spec: docs_v2/specs/workbench-editor-pane-editing.md
  const pane: WorkbenchPaneRefDto = {
    paneId: "pane-editor",
    kind: "editor",
    title: "README.md",
    visible: true,
    revision: "rev-1",
    updatedAt: emittedAt,
    filePath: "/repo/README.md",
    relativePath: "README.md",
    bodyText: "# Tide\n\nEditable body\n",
    bodyTextPreview: "# Tide\n\nEditable body\n",
    byteLength: 22,
    truncated: false,
  };

  assert.deepEqual(JSON.parse(JSON.stringify(pane)), pane);
});

test("workbench_editor_pane_contract_carries_navigation_target", () => {
  // Spec: docs_v2/specs/workbench-editor-code-navigation.md
  const pane: WorkbenchPaneRefDto = {
    paneId: "pane-editor",
    kind: "editor",
    title: "answer.ts",
    visible: true,
    revision: "rev-2",
    updatedAt: emittedAt,
    filePath: "/repo/src/answer.ts",
    relativePath: "src/answer.ts",
    bodyText: "export const answer = 42;\n",
    bodyTextPreview: "export const answer = 42;\n",
    byteLength: 26,
    truncated: false,
    navigationTarget: {
      line: 0,
      character: 13,
      length: 6,
      label: "answer",
      sourcePaneId: "pane-source",
    },
  };

  assert.deepEqual(JSON.parse(JSON.stringify(pane)), pane);
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

test("pushed events omit absent RequestId instead of serializing undefined", () => {
  const block: AgentSessionBlockDto = {
    blockId: "block-push",
    threadId: "thread-1",
    kind: "agent_message",
    role: "agent",
    status: "complete",
    body: "done",
    updatedAt: emittedAt,
  };

  const upserted = createAgentSessionBlockUpsertedEvent({
    eventId: "evt-pushed-upsert",
    emittedAt,
    block,
  });
  const completed = createAgentSessionBlockCompletedEvent({
    eventId: "evt-pushed-complete",
    emittedAt,
    blockId: block.blockId,
    threadId: block.threadId,
    status: "complete",
    completedAt: emittedAt,
  });
  const error = createContractErrorEvent({
    eventId: "evt-pushed-error",
    emittedAt,
    error: createContractErrorPayload({
      code: "internal_error",
      message: "failed",
      severity: "error",
      retryable: false,
    }),
  });

  for (const event of [upserted, completed, error]) {
    assert.equal(Object.hasOwn(event, "requestId"), false);
    assert.equal(validateBackendEventEnvelope(event).ok, true);
  }
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

test("Shared Contracts do not import Backend or Desktop internals", () => {
  assert.deepEqual(
    findSourceMentions(
      ["src/shared/contracts"],
      /from\s+["'][^"']*(?:backend|desktop)\//,
    ),
    [],
  );
});

test("Shared Contracts public index remains an export surface", () => {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const source = fs.readFileSync(
    path.join(repoRoot, "src/shared/contracts/index.ts"),
    "utf8",
  );

  assert.equal(
    /export\s+(?:const|interface|function|type)\b/.test(source),
    false,
  );
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

test("Agent Binding preserves source-aware Provider CLI and Tide API runtime sources", () => {
  const codexBinding: AgentBindingDto = {
    agentId: "codex",
    runtimeSource: { kind: "provider_cli", integrationId: "codex" },
  };
  const openAiBinding: AgentBindingDto = {
    agentId: "openai_api",
    runtimeSource: { kind: "tide_api", provider: "openai", accountId: "acct-1" },
  };

  assert.deepEqual(JSON.parse(JSON.stringify(codexBinding)), codexBinding);
  assert.deepEqual(JSON.parse(JSON.stringify(openAiBinding)), openAiBinding);
});

test("thread_start_rejects_fake_vendor_api_runtime_branch", () => {
  const result = validateBackendCommandEnvelope({
    contractVersion: CONTRACT_VERSION,
    requestId: "req-invalid-agent-source",
    kind: "thread.start",
    issuedAt,
    payload: {
      initialMessage: "hello",
      agentBinding: {
        agentId: "codex",
        runtimeSource: { kind: "vendor_api_key", provider: "openai" },
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_command");
});

test("thread_start_accepts_openai_api_only_with_tide_api_runtime_source", () => {
  const accepted = validateBackendCommandEnvelope({
    contractVersion: CONTRACT_VERSION,
    requestId: "req-openai-source",
    kind: "thread.start",
    issuedAt,
    payload: {
      initialMessage: "hello",
      agentBinding: {
        agentId: "openai_api",
        runtimeSource: { kind: "tide_api", provider: "openai" },
      },
    },
  });
  const rejected = validateBackendCommandEnvelope({
    contractVersion: CONTRACT_VERSION,
    requestId: "req-openai-source-missing",
    kind: "thread.start",
    issuedAt,
    payload: {
      initialMessage: "hello",
      agentBinding: { agentId: "openai_api" },
    },
  });

  assert.equal(accepted.ok, true);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "invalid_command");
});

test("Provider Readiness setup actions can carry provider setup env", () => {
  const readiness: ProviderReadinessDto = {
    agentId: "codex",
    ready: false,
    blockers: [
      {
        kind: "directory_trust_required",
        scope: "execution_context",
        message: "Codex Directory Trust is required.",
        action: "open_terminal",
        setup: {
          command: "codex",
          args: ["--no-alt-screen"],
          env: { CODEX_HOME: "/tmp/tide-codex-home" },
          cwd: "/repo",
          expectedCompletion: "retry_preflight",
        },
      },
    ],
  };

  const roundTripped = JSON.parse(JSON.stringify(readiness));

  assert.deepEqual(roundTripped.blockers[0].setup, {
    command: "codex",
    args: ["--no-alt-screen"],
    env: { CODEX_HOME: "/tmp/tide-codex-home" },
    cwd: "/repo",
    expectedCompletion: "retry_preflight",
  });
});

test("Browser Pane refs preserve revision and browser metadata", () => {
  const pane: BrowserPaneRefDto = {
    paneId: "pane-browser-1",
    kind: "browser",
    title: "Local preview",
    visible: true,
    revision: "rev-1",
    updatedAt: emittedAt,
    url: "http://localhost:3000",
    pageTitle: "Local preview",
    bodyTextPreview: "Loaded local app",
    loading: false,
    pendingAction: {
      actionId: "action-1",
      kind: "click",
      selector: "button.primary",
      requestedAt: issuedAt,
    },
    lastAction: {
      actionId: "action-0",
      kind: "type_text",
      selector: "input[name=q]",
      text: "tide",
      requestedAt: issuedAt,
      status: "completed",
      message: "Typed input[name=q]",
      completedAt: emittedAt,
    },
  };

  const roundTripped = JSON.parse(JSON.stringify(pane));

  assert.equal(roundTripped.revision, "rev-1");
  assert.equal(roundTripped.url, "http://localhost:3000");
  assert.equal(roundTripped.pageTitle, "Local preview");
  assert.equal(roundTripped.bodyTextPreview, "Loaded local app");
  assert.equal(roundTripped.loading, false);
  assert.equal(roundTripped.pendingAction.actionId, "action-1");
  assert.equal(roundTripped.pendingAction.kind, "click");
  assert.equal(roundTripped.lastAction.status, "completed");
  assert.equal(roundTripped.lastAction.text, "tide");
});

test("Terminal Workbench Pane refs preserve Provider Setup Surface metadata", () => {
  const pane: WorkbenchPaneRefDto = {
    paneId: "pane-provider-setup",
    kind: "terminal",
    title: "Provider setup: codex",
    visible: true,
    revision: "rev-setup",
    updatedAt: issuedAt,
    command: "/usr/local/bin/codex",
    args: [],
    env: { CODEX_HOME: "/tmp/tide-codex-home" },
    cwd: "/repo",
    status: "ready",
    expectedCompletion: "retry_preflight",
  };

  const roundTripped = JSON.parse(JSON.stringify(pane));

  assert.equal(roundTripped.kind, "terminal");
  assert.equal(roundTripped.command, "/usr/local/bin/codex");
  assert.deepEqual(roundTripped.env, { CODEX_HOME: "/tmp/tide-codex-home" });
  assert.equal(roundTripped.cwd, "/repo");
  assert.equal(roundTripped.status, "ready");
});

test("workbench_launcher_pane_contract_round_trips", () => {
  // Spec: docs_v2/specs/workbench-launcher-pane.md
  const pane: WorkbenchPaneRefDto = {
    paneId: "pane-launcher",
    kind: "launcher",
    title: "Workbench launcher",
    visible: true,
    revision: "rev-launcher",
    updatedAt: emittedAt,
    actions: [
      {
        actionId: "open_browser",
        label: "Browser",
        description: "Open a Browser Pane",
        enabled: true,
      },
      {
        actionId: "open_file_tree",
        label: "FileTree",
        description: "Show the Thread FileTree",
        enabled: true,
      },
    ],
  };

  const roundTripped = JSON.parse(JSON.stringify(pane));

  assert.equal(roundTripped.kind, "launcher");
  assert.equal(roundTripped.actions[0].actionId, "open_browser");
  assert.equal(roundTripped.actions[1].label, "FileTree");
});

test("Workbench FileTree View refs preserve root label entries and truncation", () => {
  // Spec: docs_v2/specs/workbench-filetree-view.md
  const eventEnvelope = {
    contractVersion: CONTRACT_VERSION,
    eventId: "evt-file-tree",
    kind: "workbench.changed",
    emittedAt,
    payload: {
      threadId: "thread-file-tree",
      panes: [],
      fileTree: {
        root: "/repo/tide",
        cwdLabel: "tide",
        revision: "tree-rev-1",
        updatedAt: emittedAt,
        truncated: false,
        entries: [
          {
            id: "src",
            name: "src",
            relativePath: "src",
            depth: 0,
            kind: "folder",
          },
          {
            id: "package.json",
            name: "package.json",
            relativePath: "package.json",
            depth: 0,
            kind: "file",
          },
        ],
      },
    },
  };

  assert.equal(validateBackendEventEnvelope(eventEnvelope).ok, true);

  const roundTripped = JSON.parse(JSON.stringify(eventEnvelope)).payload.fileTree;
  assert.equal(roundTripped.root, "/repo/tide");
  assert.equal(roundTripped.cwdLabel, "tide");
  assert.equal(roundTripped.entries[0].relativePath, "src");
  assert.equal(roundTripped.truncated, false);
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
