// Spec: docs_v2/specs/local-provider-session-discovery.md
import assert from "node:assert/strict";
import test from "node:test";

import {
  adoptedThreadId,
  adoptedThreadSeedsFromSessions,
  claudeSessionTitle,
  codexSessionDescriptor,
  discoverLocalSessions,
  opencodeFirstUserTextFromExport,
  parseOpencodeExportText,
  parseOpencodeSessionListText,
  type DiscoveryFs,
} from "../src/backend/application/services/provider/provider-session-discovery.ts";

const CWD = "/Users/you/Workspace/tide";

const CODEX_ROLLOUT = [
  JSON.stringify({ type: "session_meta", payload: { cwd: CWD, id: "sess" } }),
  JSON.stringify({ type: "event_msg", payload: { type: "task_started" } }),
  JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Refactor the layout module" } }),
  JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "On it." } }),
].join("\n");

const CLAUDE_TRANSCRIPT = [
  JSON.stringify({ type: "mode", sessionId: "x" }),
  JSON.stringify({ type: "file-history-snapshot", messageId: "m" }),
  JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "Fix the section header UI" }] } }),
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Done." }] } }),
].join("\n");

function fakeFs(overrides: Partial<DiscoveryFs> = {}): DiscoveryFs {
  return {
    listClaudeTranscripts: () => [],
    listCodexRollouts: () => [],
    listOpencodeSessions: () => [],
    exportOpencodeSession: () => undefined,
    readText: () => undefined,
    ...overrides,
  };
}

// --- UC-1: Descriptor parsing ---

// UC-1 BR-1: codex session_meta carries cwd and the first user_message is the title.
test("codex_session_descriptor_extracts_cwd_and_first_user_message", () => {
  const descriptor = codexSessionDescriptor(CODEX_ROLLOUT);
  assert.equal(descriptor.cwd, CWD);
  assert.equal(descriptor.title, "Refactor the layout module");
});

// UC-1 BR-2: claude title is the first human user message, skipping meta envelopes.
test("claude_session_descriptor_extracts_first_user_message", () => {
  assert.equal(claudeSessionTitle(CLAUDE_TRANSCRIPT), "Fix the section header UI");
});

// --- UC-2: Discovery → adopted seeds ---

// UC-2 BR-3: discovered sessions become adopted seeds scoped to the project cwd.
test("discovery_maps_sessions_to_adopted_seeds_scoped_to_the_project", () => {
  const fs = fakeFs({
    listClaudeTranscripts: (cwd) =>
      cwd === CWD ? [{ path: `${CWD}/.claude/a.jsonl`, sessionId: "claude-1", mtimeMs: 1_000 }] : [],
    listCodexRollouts: () => [{ path: "/codex/rollout-x-codex-1.jsonl", mtimeMs: 2_000 }],
    readText: (path) => (path.includes("codex") ? CODEX_ROLLOUT : CLAUDE_TRANSCRIPT),
  });
  const sessions = discoverLocalSessions({ cwds: [CWD], fs });
  const seeds = adoptedThreadSeedsFromSessions({
    sessions,
    projectIdForCwd: () => "tide",
    existingRefValues: new Set(),
    existingThreadIds: new Set(),
  });

  assert.equal(seeds.length, 2);
  for (const seed of seeds) {
    assert.equal(seed.scope?.kind, "project");
    assert.equal(seed.scope?.kind === "project" && seed.scope.cwd, CWD);
    assert.equal(seed.lifecycleState, "open");
    assert.equal(seed.runtimeState, "not_started");
    assert.ok(seed.agentBinding.providerSessionRef?.transcriptPath);
  }
  const claudeSeed = seeds.find((s) => s.agentBinding.agentId === "claude");
  assert.equal(claudeSeed?.title, "Fix the section header UI");
});

// UC-2 BR-4: a session already owned by a Tide thread is not adopted again.
test("discovery_dedups_sessions_already_owned_by_a_tide_thread", () => {
  const fs = fakeFs({
    listClaudeTranscripts: () => [{ path: "/c/claude-1.jsonl", sessionId: "claude-1", mtimeMs: 1 }],
    readText: () => CLAUDE_TRANSCRIPT,
  });
  const sessions = discoverLocalSessions({ cwds: [CWD], fs });
  const seeds = adoptedThreadSeedsFromSessions({
    sessions,
    projectIdForCwd: () => "tide",
    existingRefValues: new Set(["claude-1"]),
    existingThreadIds: new Set(),
  });
  assert.equal(seeds.length, 0);
});

// UC-2 BR-5: the adopted threadId is deterministic from the session id.
test("discovery_threadId_is_deterministic_for_idempotent_restart", () => {
  assert.equal(adoptedThreadId("claude-1"), "adopted-claude-1");
  const fs = fakeFs({
    listClaudeTranscripts: () => [{ path: "/c/claude-1.jsonl", sessionId: "claude-1", mtimeMs: 1 }],
    readText: () => CLAUDE_TRANSCRIPT,
  });
  const sessions = discoverLocalSessions({ cwds: [CWD], fs });
  // Re-running with the prior threadId marked present yields no duplicate.
  const seeds = adoptedThreadSeedsFromSessions({
    sessions,
    projectIdForCwd: () => "tide",
    existingRefValues: new Set(),
    existingThreadIds: new Set(["adopted-claude-1"]),
  });
  assert.equal(seeds.length, 0);
});

// UC-2 BR-6: a session with no user text gets a dated fallback title.
test("discovery_falls_back_to_a_dated_title_when_no_user_message", () => {
  const fs = fakeFs({
    listClaudeTranscripts: () => [{ path: "/c/empty.jsonl", sessionId: "claude-empty", mtimeMs: Date.parse("2026-05-31T00:00:00Z") }],
    readText: () => JSON.stringify({ type: "assistant", message: { role: "assistant", content: [] } }),
  });
  const sessions = discoverLocalSessions({ cwds: [CWD], fs });
  assert.equal(sessions[0].title, "Claude session 2026-05-31");
});

// UC-3: internal/auto-review sub-sessions are not adopted.
test("discovery_skips_auto_review_internal_sessions", () => {
  const reviewTranscript = JSON.stringify({
    type: "user",
    message: { role: "user", content: "The following is the Codex agent history whose request action you must assess." },
  });
  const fs = fakeFs({
    listClaudeTranscripts: () => [{ path: "/c/review.jsonl", sessionId: "review-1", mtimeMs: 1 }],
    readText: () => reviewTranscript,
  });
  const sessions = discoverLocalSessions({ cwds: [CWD], fs });
  assert.equal(sessions.length, 0, "auto-review session is filtered out");
});

test("opencode_session_list_parser_maps_json_records_and_ignores_malformed_entries", () => {
  const entries = parseOpencodeSessionListText(JSON.stringify([
    {
      id: "ses-1",
      title: "Fix composer",
      created: 1_000,
      updated: 2_000,
      projectId: "p1",
      directory: CWD,
    },
    { id: "bad-no-directory" },
  ]));
  assert.deepEqual(entries, [
    {
      id: "ses-1",
      title: "Fix composer",
      created: 1_000,
      updated: 2_000,
      projectId: "p1",
      directory: CWD,
    },
  ]);
});

test("opencode_export_parser_strips_leading_status_line", () => {
  const exported = parseOpencodeExportText(
    `Exporting session: ses-1\n${JSON.stringify({
      info: { id: "ses-1" },
      messages: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "Adopt this opencode session" }],
        },
      ],
    })}`,
  );
  assert.equal(exported?.info.id, "ses-1");
  assert.equal(opencodeFirstUserTextFromExport(`noise\n${JSON.stringify(exported)}`), "Adopt this opencode session");
});

test("discovery_adopts_opencode_sessions_by_directory_without_transcript_path", () => {
  const fs = fakeFs({
    listOpencodeSessions: () => [
      {
        id: "opencode-1",
        title: "New session",
        created: 1_000,
        updated: 2_000,
        directory: CWD,
      },
      {
        id: "wrong-cwd",
        title: "Wrong",
        created: 1,
        updated: 1,
        directory: "/other",
      },
    ],
    exportOpencodeSession: () => JSON.stringify({
      info: { id: "opencode-1" },
      messages: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "Continue the opencode flow" }],
        },
      ],
    }),
  });

  const sessions = discoverLocalSessions({ cwds: [CWD], fs });
  const seeds = adoptedThreadSeedsFromSessions({
    sessions,
    projectIdForCwd: () => "tide",
    existingRefValues: new Set(),
    existingThreadIds: new Set(),
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].agentId, "opencode");
  assert.equal(sessions[0].title, "Continue the opencode flow");
  assert.equal(seeds[0].agentBinding.providerSessionRef?.kind, "opencode_session");
  assert.equal(seeds[0].agentBinding.providerSessionRef?.value, "opencode-1");
  assert.equal(seeds[0].agentBinding.providerSessionRef?.transcriptPath, undefined);
});

test("discovery_uses_opencode_export_only_when_the_list_title_is_not_meaningful", () => {
  let exportCalls = 0;
  const fs = fakeFs({
    listOpencodeSessions: () => [
      {
        id: "meaningful",
        title: "Implement the composer provider picker",
        created: 1_000,
        updated: 2_000,
        directory: CWD,
      },
      {
        id: "generic",
        title: "New session",
        created: 3_000,
        updated: 4_000,
        directory: CWD,
      },
    ],
    exportOpencodeSession: (sessionId) => {
      exportCalls += 1;
      return JSON.stringify({
        info: { id: sessionId },
        messages: [
          {
            info: { role: "user" },
            parts: [{ type: "text", text: `Export title for ${sessionId}` }],
          },
        ],
      });
    },
  });

  const sessions = discoverLocalSessions({ cwds: [CWD], fs });

  assert.equal(exportCalls, 1);
  assert.deepEqual(
    sessions.map((session) => session.title),
    ["Implement the composer provider picker", "Export title for generic"],
  );
});
