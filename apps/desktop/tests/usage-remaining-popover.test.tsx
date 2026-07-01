// Spec: docs_v2/specs/usage-remaining-popover.md

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SessionContextMeter } from "../src/desktop/adapters/inbound/react-renderer/agent-chat/composer/usage-meter.tsx";
import { TideProductShell } from "../src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.tsx";
import {
  applyProductShellBackendEvent,
  createProductShellState,
  openProductShellThread,
  setProductShellSettingsOpen,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import type { AgentChatUsageView } from "../src/desktop/application/domains/agent-chat/agent-chat.ts";
import type { AgentChatThreadSummary } from "../src/desktop/application/domains/agent-chat/agent-chat.ts";

const usage: AgentChatUsageView = {
  contextPercentLabel: "25%",
  contextUsedPercent: 25,
  contextRemainingPercent: 75,
  contextRemainingLabel: "75%",
  contextDetailLabel: "64k / 256k tokens",
  tokensLabel: "64k tokens",
  rateLimits: [
    {
      label: "5h",
      usedPercent: 58,
      usedLabel: "58%",
      remainingPercent: 42,
      remainingLabel: "42%",
      resetLabel: "8:31 PM",
    },
    {
      label: "Weekly",
      usedPercent: 68,
      usedLabel: "68%",
      remainingPercent: 32,
      remainingLabel: "32%",
      resetLabel: "Jun 28",
    },
  ],
};

test("session_context_meter_shows_only_current_session_context", () => {
  const html = renderToStaticMarkup(<SessionContextMeter usage={usage} />);
  const text = visibleText(html);

  assert.match(html, /class="agent-usage"/);
  assert.match(text, /Session context\s*75% left\s*64k \/ 256k tokens/);
  assert.doesNotMatch(text, /5h/);
  assert.doesNotMatch(text, /1 week|Weekly/);
});

test("settings_shows_provider_window_usage_and_reset_while_composer_shows_context", () => {
  const thread: AgentChatThreadSummary = {
    threadId: "thread-usage",
    title: "Usage source",
    agentBinding: {
      agentId: "codex",
      runtimeSource: { kind: "provider_cli", integrationId: "codex" },
    },
    scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
    launchOptions: { model: "gpt-5.5" },
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:01:00.000Z",
    pinned: false,
    archived: false,
    lastKnownState: "idle",
  };
  const listed = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    { kind: "thread.listed", payload: { threads: [thread] } },
  );
  const opened = openProductShellThread(listed, "thread-usage");
  const hydrated = applyProductShellBackendEvent(opened, {
    kind: "thread.hydrated",
    payload: { thread, blocks: [], runtimeState: "idle" },
  });
  const withUsage = applyProductShellBackendEvent(hydrated, {
    kind: "agentRuntime.usageChanged",
    payload: {
      threadId: "thread-usage",
      usage: {
        totalTokens: 64000,
        contextWindow: 256000,
        contextUsedPercent: 25,
        model: "gpt-5.5",
        rateLimits: [
          { usedPercent: 58, windowMinutes: 300, resetsAt: 1781973894 },
          { usedPercent: 68, windowMinutes: 10080, resetsAt: 1782378364 },
        ],
      },
    },
  });
  const settingsOpen = setProductShellSettingsOpen(withUsage, true);
  const html = renderToStaticMarkup(<TideProductShell initialState={settingsOpen} />);
  const settingsStart = html.indexOf('aria-label="Settings"');
  const settingsHtml = settingsStart >= 0 ? html.slice(settingsStart) : html;
  const usageStart = settingsHtml.indexOf('aria-label="Provider window usage"');
  const usageHtml = usageStart >= 0 ? settingsHtml.slice(usageStart) : settingsHtml;
  const composerHtml = html.slice(0, settingsStart >= 0 ? settingsStart : html.length);
  const settingsText = visibleText(usageHtml);
  const composerText = visibleText(composerHtml);

  assert.match(settingsText, /Codex/);
  assert.match(settingsText, /GPT-5\.5/);
  assert.match(settingsText, /5h window\s*58%/);
  assert.match(settingsText, /1 week window\s*68%/);
  assert.match(settingsText, /Resets/);
  assert.doesNotMatch(settingsText, /Session context/);
  assert.doesNotMatch(settingsText, /64k \/ 256k tokens/);

  assert.match(composerHtml, /class="agent-usage"/);
  assert.match(composerText, /Session context\s*75% left\s*64k \/ 256k tokens/);
  assert.doesNotMatch(composerText, /5h window|1 week window/);
});

test("settings_omits_context_only_usage_rows", () => {
  const thread: AgentChatThreadSummary = {
    threadId: "thread-context-only",
    title: "Context only",
    agentBinding: {
      agentId: "claude",
      runtimeSource: { kind: "provider_cli", integrationId: "claude" },
    },
    scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
    launchOptions: { model: "sonnet-4.6" },
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:01:00.000Z",
    pinned: false,
    archived: false,
    lastKnownState: "idle",
  };
  const listed = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    { kind: "thread.listed", payload: { threads: [thread] } },
  );
  const hydrated = applyProductShellBackendEvent(listed, {
    kind: "thread.hydrated",
    payload: { thread, blocks: [], runtimeState: "idle" },
  });
  const withUsage = applyProductShellBackendEvent(hydrated, {
    kind: "agentRuntime.usageChanged",
    payload: {
      threadId: "thread-context-only",
      usage: {
        totalTokens: 64000,
        contextWindow: 256000,
        contextUsedPercent: 25,
        model: "sonnet-4.6",
      },
    },
  });
  const html = renderToStaticMarkup(
    <TideProductShell initialState={setProductShellSettingsOpen(withUsage, true)} />,
  );
  const settingsStart = html.indexOf('aria-label="Settings"');
  const settingsHtml = settingsStart >= 0 ? html.slice(settingsStart) : html;
  const usageStart = settingsHtml.indexOf('aria-label="Provider window usage"');
  const usageHtml = usageStart >= 0 ? settingsHtml.slice(usageStart) : settingsHtml;
  const settingsText = visibleText(usageHtml);

  assert.match(settingsText, /No provider window usage reported yet/);
  assert.doesNotMatch(settingsText, /Claude Code/);
  assert.doesNotMatch(settingsText, /64k \/ 256k tokens/);
});

function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
