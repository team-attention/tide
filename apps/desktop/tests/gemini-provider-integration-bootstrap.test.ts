import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { createGeminiAgentIntegration } from "../src/backend/adapters/outbound/agent-integrations/gemini/gemini-agent-integration.ts";
import {
  createGeminiHistoryConnector,
  geminiSessionRefFromHookPayload,
  readGeminiHistoryFrames,
} from "../src/backend/adapters/outbound/agent-integrations/gemini/gemini-history-connector.ts";
import { geminiTurnOutcomeFromSession } from "../src/backend/adapters/outbound/agent-integrations/gemini/gemini-session-turn-detection.ts";
import { locateGeminiSessionFile } from "../src/backend/infrastructure/node/live-backend.ts";
import {
  ensureProviderBootstrapArtifacts,
  providerBootstrapArtifactsForHome,
} from "../src/backend/infrastructure/node/provider-bootstrap-artifacts.ts";

// Spec: docs_v2/specs/provider-history-connector.md + gemini-agent-integration.md

const SESSION_ID = "11111111-2222-4333-8444-555566667777";

function geminiIntegration(overrides?: {
  executable?: string | undefined;
  authenticated?: boolean;
  hookSettingsPath?: string;
  locateSessionFile?: (sessionId: string) => string | undefined;
}) {
  return createGeminiAgentIntegration({
    resolveExecutable: () =>
      overrides !== undefined && "executable" in overrides
        ? overrides.executable
        : "/usr/local/bin/gemini",
    readProviderState: () => ({ authenticated: overrides?.authenticated ?? true }),
    defaultCwd: "/repo",
    hookSettingsPath: overrides?.hookSettingsPath,
    locateSessionFile: overrides?.locateSessionFile,
    mintSessionId: () => SESSION_ID,
  });
}

test("gemini_preflight_reports_not_installed_and_not_authenticated", async () => {
  const missing = await geminiIntegration({ executable: undefined }).preflight({
    agentId: "gemini",
  });
  assert.equal(missing.ready, false);
  assert.equal(missing.blockers[0]?.kind, "not_installed");

  const signedOut = await geminiIntegration({ authenticated: false }).preflight({
    agentId: "gemini",
  });
  assert.equal(signedOut.ready, false);
  assert.equal(signedOut.blockers[0]?.kind, "not_authenticated");
});

test("gemini_start_plan_mints_session_id_and_returns_deterministic_ref", async () => {
  const plan = await geminiIntegration().buildStartPlan({
    agentId: "gemini",
    initialPrompt: "hello",
  });
  const sessionIdFlag = plan.args.indexOf("--session-id");
  assert.notEqual(sessionIdFlag, -1);
  assert.equal(plan.args[sessionIdFlag + 1], SESSION_ID);
  assert.deepEqual(plan.providerSessionRef, {
    agentId: "gemini",
    kind: "gemini_session",
    value: SESSION_ID,
  });
  const promptFlag = plan.args.indexOf("--prompt-interactive");
  assert.equal(plan.args[promptFlag + 1], "hello");
});

test("gemini_start_plan_defaults_to_prompting_approval_mode_not_yolo", async () => {
  const plan = await geminiIntegration().buildStartPlan({ agentId: "gemini" });
  assert.equal(plan.args.includes("--yolo"), false);
  const approvalFlag = plan.args.indexOf("--approval-mode");
  assert.equal(plan.args[approvalFlag + 1], "default");

  const bypass = await geminiIntegration().buildStartPlan({
    agentId: "gemini",
    launchOptions: { permission: "bypass" },
  });
  assert.equal(bypass.args.includes("--yolo"), true);

  const planMode = await geminiIntegration().buildStartPlan({
    agentId: "gemini",
    launchOptions: { permission: "plan" },
  });
  const planFlag = planMode.args.indexOf("--approval-mode");
  assert.equal(planMode.args[planFlag + 1], "plan");
});

test("gemini_launch_env_carries_tide_hook_settings_layer", async () => {
  const plan = await geminiIntegration({
    hookSettingsPath: "/tide/gemini/settings.json",
  }).buildStartPlan({ agentId: "gemini" });
  assert.equal(plan.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH, "/tide/gemini/settings.json");
});

test("gemini_resume_plan_resumes_by_session_id", async () => {
  const plan = await geminiIntegration().buildResumePlan({
    agentId: "gemini",
    providerSessionRef: {
      kind: "gemini_session",
      value: SESSION_ID,
      transcriptPath: "/sessions/session-x.jsonl",
    },
  });
  const resumeFlag = plan.args.indexOf("--resume");
  assert.equal(plan.args[resumeFlag + 1], SESSION_ID);
});

test("gemini_turn_end_hook_is_after_agent_settle_only", () => {
  const integration = geminiIntegration();
  assert.deepEqual(
    integration.turnEndFromHook("agent-idle", {
      hook_event_name: "AfterAgent",
      session_id: SESSION_ID,
      prompt_response: "the answer text",
    }),
    {},
  );
  assert.equal(integration.turnEndFromHook("agent-running", {}), null);
  assert.equal(
    integration.turnEndFromHook("agent-idle", { hook_event_name: "Notification" }),
    null,
  );
});

test("gemini_notification_tool_permission_surfaces_approval_prompt", () => {
  const integration = geminiIntegration();
  const prompt = integration.detectPromptState({
    threadId: "thread-1",
    source: "provider_hook",
    eventName: "agent-needs-input",
    payload: {
      hook_event_name: "Notification",
      notification_type: "ToolPermission",
      message: "Tool run_shell_command requires approval",
      details: { tool_name: "run_shell_command" },
    },
  });
  assert.notEqual(prompt, null);
  assert.equal(prompt?.kind, "approval");
  assert.equal(prompt?.agentId, "gemini");
  assert.equal(prompt?.choices?.length, 2);
  assert.equal(prompt?.defaultChoiceId, "gemini-perm-allow");

  // Non-permission notifications and PTY text do not surface prompts.
  assert.equal(
    integration.detectPromptState({
      threadId: "thread-1",
      source: "provider_hook",
      eventName: "agent-needs-input",
      payload: { hook_event_name: "Notification", notification_type: "Other" },
    }),
    null,
  );
});

test("gemini_hook_payload_binds_session_ref", () => {
  assert.deepEqual(
    geminiSessionRefFromHookPayload({
      session_id: SESSION_ID,
      transcript_path: "/Users/you/.gemini/tmp/repo/chats/session-2026-06-10T03-32-11111111.jsonl",
    }),
    {
      agentId: "gemini",
      kind: "gemini_session",
      value: SESSION_ID,
      transcriptPath:
        "/Users/you/.gemini/tmp/repo/chats/session-2026-06-10T03-32-11111111.jsonl",
    },
  );
  assert.equal(geminiSessionRefFromHookPayload({}), undefined);
});

test("gemini_history_connector_resolves_path_by_assigned_session_id", () => {
  const connector = createGeminiHistoryConnector({
    locateSessionFile: (sessionId) =>
      sessionId === SESSION_ID ? "/chats/session-found.jsonl" : undefined,
  });
  const resolved = connector.resolveSessionRef?.({
    agentId: "gemini",
    kind: "gemini_session",
    value: SESSION_ID,
  });
  assert.equal(resolved?.transcriptPath, "/chats/session-found.jsonl");

  // Already-resolved refs pass through; unknown ids stay unresolved.
  const passThrough = connector.resolveSessionRef?.({
    agentId: "gemini",
    kind: "gemini_session",
    value: SESSION_ID,
    transcriptPath: "/chats/already.jsonl",
  });
  assert.equal(passThrough?.transcriptPath, "/chats/already.jsonl");
});

const SESSION_FIXTURE = [
  JSON.stringify({ sessionId: SESSION_ID, projectHash: "h", startTime: "t" }),
  JSON.stringify({ $set: { messages: [] } }),
  JSON.stringify({ id: "u0", type: "user", content: [{ text: "previous turn" }] }),
  JSON.stringify({ id: "g0", type: "gemini", content: "old answer", thoughts: [] }),
  JSON.stringify({ id: "u1", type: "user", content: [{ text: "current prompt" }] }),
  JSON.stringify({
    id: "g1",
    type: "gemini",
    content: "",
    thoughts: [{ subject: "Plan", description: "I will inspect the file." }],
    toolCalls: [
      {
        id: "call-1",
        name: "read_file",
        args: { path: "a.ts" },
        result: [{ functionResponse: { id: "call-1", name: "read_file", response: { output: "file body" } } }],
      },
    ],
  }),
  JSON.stringify({ id: "g2", type: "gemini", content: "final answer", thoughts: [] }),
].join("\n");

test("gemini_history_reader_projects_current_turn_frames", () => {
  const seenKeys = new Set<string>();
  const frames = readGeminiHistoryFrames({
    threadId: "thread-1",
    runtimeId: "runtime-1",
    sessionRef: {
      agentId: "gemini",
      kind: "gemini_session",
      value: SESSION_ID,
      transcriptPath: "/chats/session.jsonl",
    },
    tailText: SESSION_FIXTURE,
    seenKeys,
    expectedUserMessage: "current prompt",
  });

  const kinds = frames.map((frame) => frame.payload.type);
  assert.deepEqual(kinds, ["reasoning", "tool_call", "tool_result", "message"]);
  assert.equal(frames[3]?.body, "final answer");
  // Prior-turn content must not leak in.
  assert.equal(frames.some((frame) => frame.body.includes("old answer")), false);

  // Re-reading the same tail is incremental (seenKeys dedupe).
  const again = readGeminiHistoryFrames({
    threadId: "thread-1",
    runtimeId: "runtime-1",
    sessionRef: {
      agentId: "gemini",
      kind: "gemini_session",
      value: SESSION_ID,
      transcriptPath: "/chats/session.jsonl",
    },
    tailText: SESSION_FIXTURE,
    seenKeys,
    expectedUserMessage: "current prompt",
  });
  assert.equal(again.length, 0);
});

test("gemini_history_turn_end_is_settle_only_and_ignores_mid_turn_steps", () => {
  // Mid-turn model step (toolCalls) — turn still running.
  const midTurn = [
    JSON.stringify({ id: "u1", type: "user", content: [{ text: "current prompt" }] }),
    JSON.stringify({ id: "g1", type: "gemini", content: "thinking…", toolCalls: [{ id: "c", name: "t" }] }),
  ].join("\n");
  assert.equal(geminiTurnOutcomeFromSession(midTurn, "current prompt"), null);

  // Final-answer-shaped record settles WITHOUT carrying content (reader owns it).
  assert.deepEqual(geminiTurnOutcomeFromSession(SESSION_FIXTURE, "current prompt"), {});

  // A prior turn's answer cannot settle the current turn.
  const unanswered = [
    JSON.stringify({ id: "g0", type: "gemini", content: "old answer" }),
    JSON.stringify({ id: "u1", type: "user", content: [{ text: "current prompt" }] }),
  ].join("\n");
  assert.equal(geminiTurnOutcomeFromSession(unanswered, "current prompt"), null);
});

test("locate_gemini_session_file_matches_assigned_id_only", () => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-gemini-locate-"));
  const chats = path.join(home, ".gemini", "tmp", "repo", "chats");
  fs.mkdirSync(chats, { recursive: true });
  const ownPath = path.join(chats, "session-2026-06-10T03-32-11111111.jsonl");
  fs.writeFileSync(
    ownPath,
    `${JSON.stringify({ sessionId: SESSION_ID, projectHash: "h" })}\n`,
    "utf8",
  );
  // A decoy whose filename fragment matches but whose header does not.
  fs.writeFileSync(
    path.join(chats, "session-2026-06-10T03-33-11111111.jsonl"),
    `${JSON.stringify({ sessionId: "99999999-0000-4000-8000-000000000000" })}\n`,
    "utf8",
  );

  assert.equal(locateGeminiSessionFile(home, SESSION_ID), ownPath);
  assert.equal(
    locateGeminiSessionFile(home, "22222222-0000-4000-8000-000000000000"),
    undefined,
  );
});

test("provider_bootstrap_writes_tide_owned_gemini_hook_settings", () => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-gemini-bootstrap-"));
  const artifacts = ensureProviderBootstrapArtifacts({ homeDir: home });
  assert.equal(
    artifacts.geminiSettingsPath,
    providerBootstrapArtifactsForHome({ homeDir: home }).geminiSettingsPath,
  );
  const settings = JSON.parse(fs.readFileSync(artifacts.geminiSettingsPath, "utf8"));
  for (const event of ["SessionStart", "BeforeAgent", "Notification", "AfterAgent"]) {
    const groups = settings.hooks[event];
    assert.ok(Array.isArray(groups) && groups.length === 1, `hook ${event} registered`);
    const command = groups[0].hooks[0].command as string;
    assert.ok(command.includes("--agent gemini"), `${event} signals as gemini`);
  }
  assert.ok(
    (settings.hooks.AfterAgent[0].hooks[0].command as string).includes(
      "--event agent-idle",
    ),
  );
  assert.ok(
    (settings.hooks.Notification[0].hooks[0].command as string).includes(
      "--event agent-needs-input",
    ),
  );
});

test("gemini_reappended_record_upserts_one_block_not_duplicates", () => {
  // Gemini RE-APPENDS the same record id as content accumulates while streaming
  // (verified live: thoughts-only copy first, then a copy with toolCalls). The
  // reader must key by record id so the duplicate copy UPSERTS the same blockId
  // — line-index keying rendered the same Thinking block twice.
  const tail = [
    JSON.stringify({ id: "u1", type: "user", content: [{ text: "current prompt" }] }),
    JSON.stringify({
      id: "g1",
      type: "gemini",
      content: "",
      thoughts: [{ subject: "Investigating", description: "Looking at data." }],
    }),
    JSON.stringify({ $set: { lastUpdated: "t" } }),
    JSON.stringify({
      id: "g1",
      type: "gemini",
      content: "",
      thoughts: [{ subject: "Investigating", description: "Looking at data." }],
      toolCalls: [{ id: "call-1", name: "read_file", args: { path: "a" } }],
    }),
  ].join("\n");
  const seenKeys = new Set<string>();
  const frames = readGeminiHistoryFrames({
    threadId: "thread-1",
    runtimeId: "runtime-1",
    sessionRef: {
      agentId: "gemini",
      kind: "gemini_session",
      value: SESSION_ID,
      transcriptPath: "/chats/session.jsonl",
    },
    tailText: tail,
    seenKeys,
    expectedUserMessage: "current prompt",
  });
  const reasoningFrames = frames.filter((f) => f.payload.type === "reasoning");
  // Identical thought text re-appended → ONE reasoning frame (same seen key),
  // and any future grown copy reuses the SAME blockId (upsert, not duplicate).
  assert.equal(reasoningFrames.length, 1);
  assert.equal(
    reasoningFrames[0]?.payload.blockId,
    `reasoning:thread-1:${SESSION_ID}:g1`,
  );
  const callFrames = frames.filter((f) => f.payload.type === "tool_call");
  assert.equal(callFrames.length, 1);
});
