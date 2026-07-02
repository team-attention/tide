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
  assert.match(text, /Session context\s*64k \/ 256k tokens\s*75% left/);
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
          { usedPercent: 99, windowMinutes: 300, resetsAt: 1781973894 },
        ],
      },
    },
  });
  const withAccountUsage = applyProductShellBackendEvent(withUsage, {
    kind: "providerUsage.changed",
    payload: {
      usages: [
        {
          agentId: "codex",
          usage: {
            model: "gpt-5.5",
            rateLimits: [
              { usedPercent: 58, windowMinutes: 300, resetsAt: 1781973894 },
              { usedPercent: 68, windowMinutes: 10080, resetsAt: 1782378364 },
            ],
          },
          observedAt: "2026-06-11T00:02:00.000Z",
        },
      ],
    },
  });
  const settingsOpen = setProductShellSettingsOpen(withAccountUsage, true);
  const html = renderToStaticMarkup(<TideProductShell initialState={settingsOpen} />);
  const settingsStart = html.indexOf('aria-label="Settings"');
  const settingsHtml = settingsStart >= 0 ? html.slice(settingsStart) : html;
  const usageStart = settingsHtml.indexOf('aria-label="Usage remaining"');
  const usageHtml = usageStart >= 0 ? settingsHtml.slice(usageStart) : settingsHtml;
  const composerHtml = html.slice(0, settingsStart >= 0 ? settingsStart : html.length);
  const settingsText = visibleText(usageHtml);
  const composerText = visibleText(composerHtml);

  assert.match(settingsText, /Codex/);
  assert.match(settingsText, /GPT-5\.5/);
  assert.match(settingsText, /5h\s*58%/);
  assert.match(settingsText, /Weekly\s*68%/);
  assert.doesNotMatch(settingsText, /99%/);
  assert.doesNotMatch(settingsText, /Session context/);
  assert.doesNotMatch(settingsText, /64k \/ 256k tokens/);
  assert.doesNotMatch(settingsText, /window|Resets/);

  assert.match(composerHtml, /class="agent-usage"/);
  assert.match(composerText, /Session context\s*64k \/ 256k tokens\s*75% left/);
  assert.doesNotMatch(composerText, /5h window|1 week window/);
});

test("settings_ignores_thread_session_context_without_account_usage", () => {
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
  const usageStart = settingsHtml.indexOf('aria-label="Usage remaining"');
  const usageHtml = usageStart >= 0 ? settingsHtml.slice(usageStart) : settingsHtml;
  const settingsText = visibleText(usageHtml);

  assert.match(settingsText, /No usage reported yet/);
  assert.doesNotMatch(settingsText, /Claude Code/);
  assert.doesNotMatch(settingsText, /sonnet-4\.6/);
  assert.doesNotMatch(settingsText, /Session context/);
  assert.doesNotMatch(settingsText, /64k \/ 256k tokens/);
});

test("settings_shows_account_usage_on_new_thread_without_thread_list", () => {
  const withAccountUsage = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    {
      kind: "providerUsage.changed",
      payload: {
        usages: [
          {
            agentId: "claude",
            usage: {
              model: "sonnet-4.6",
              rateLimits: [
                { label: "5h", usedPercent: 40, resetsAt: 1781973894 },
                { label: "weekly", usedPercent: 65, resetsAt: 1782378364 },
              ],
            },
          },
        ],
      },
    },
  );
  const html = renderToStaticMarkup(
    <TideProductShell initialState={setProductShellSettingsOpen(withAccountUsage, true)} />,
  );
  const settingsStart = html.indexOf('aria-label="Settings"');
  const settingsHtml = settingsStart >= 0 ? html.slice(settingsStart) : html;
  const usageStart = settingsHtml.indexOf('aria-label="Usage remaining"');
  const usageHtml = usageStart >= 0 ? settingsHtml.slice(usageStart) : settingsHtml;
  const settingsText = visibleText(usageHtml);

  assert.doesNotMatch(settingsText, /No usage reported yet/);
  assert.match(settingsText, /Claude Code/);
  assert.match(settingsText, /sonnet-4\.6/);
  assert.match(settingsText, /5h\s*40%/);
  assert.match(settingsText, /Weekly\s*65%/);
});

test("settings_preserves_account_usage_when_provider_usage_update_is_empty_or_malformed", () => {
  const withAccountUsage = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    {
      kind: "providerUsage.changed",
      payload: {
        usages: [
          {
            agentId: "claude",
            usage: {
              model: "sonnet-4.6",
              rateLimits: [{ label: "weekly", usedPercent: 65, resetsAt: 1782378364 }],
            },
          },
        ],
      },
    },
  );
  const afterEmptyUpdate = applyProductShellBackendEvent(withAccountUsage, {
    kind: "providerUsage.changed",
    payload: { usages: [] },
  });
  const afterMalformedUpdate = applyProductShellBackendEvent(afterEmptyUpdate, {
    kind: "providerUsage.changed",
    payload: { usages: [null, "bad", 3, {}] },
  });
  const html = renderToStaticMarkup(
    <TideProductShell initialState={setProductShellSettingsOpen(afterMalformedUpdate, true)} />,
  );
  const settingsStart = html.indexOf('aria-label="Settings"');
  const settingsHtml = settingsStart >= 0 ? html.slice(settingsStart) : html;
  const usageStart = settingsHtml.indexOf('aria-label="Usage remaining"');
  const usageHtml = usageStart >= 0 ? settingsHtml.slice(usageStart) : settingsHtml;
  const settingsText = visibleText(usageHtml);

  assert.doesNotMatch(settingsText, /No usage reported yet/);
  assert.match(settingsText, /Claude Code/);
  assert.match(settingsText, /sonnet-4\.6/);
  assert.match(settingsText, /Weekly\s*65%/);
});

function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
