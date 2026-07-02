// Spec: docs_v2/specs/thread-row-quick-actions.md
import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { TideProductShell } from "../src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.tsx";
import {
  applyProductShellBackendEvent,
  createProductShellState,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import type { AgentChatThreadSummary } from "../src/desktop/application/domains/agent-chat/agent-chat.ts";

function threadSummary(
  threadId: string,
  pinned: boolean,
  cwd = "/Users/you/repo",
  overrides: Partial<AgentChatThreadSummary> = {},
): AgentChatThreadSummary {
  return {
    threadId,
    title: `Thread ${threadId}`,
    agentBinding: {
      agentId: "claude",
      runtimeSource: { kind: "provider_cli", integrationId: "claude" },
    },
    scope: { kind: "project", projectId: "p1", cwd },
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:01:00.000Z",
    pinned,
    archived: false,
    lastKnownState: "idle",
    ...overrides,
  };
}

// Render the whole shell with a single thread — NO context menu open — so we can
// assert the row's DIRECT (hover) quick-actions, not the right-click menu.
function renderRow(
  pinned: boolean,
  cwd = "/Users/you/repo",
  overrides: Partial<AgentChatThreadSummary> = {},
): string {
  const seeded = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    { kind: "thread.listed", payload: { threads: [threadSummary("t1", pinned, cwd, overrides)] } },
  );
  return renderToStaticMarkup(<TideProductShell initialState={seeded} />);
}

test("thread_row_exposes_direct_pin_archive_actions_plus_menu", () => {
  const markup = renderRow(false);
  assert.match(markup, /aria-label="Pin"/);
  assert.match(markup, /aria-label="Archive"/);
  assert.match(markup, /aria-label="Thread menu"/);
  assert.doesNotMatch(markup, /aria-label="Unpin"/);
  assert.doesNotMatch(markup, /aria-label="Delete worktree"/);
  assert.doesNotMatch(markup, /thread-row__leading/);
});

test("pinned_thread_row_exposes_direct_unpin_without_leading_marker", () => {
  const markup = renderRow(true);
  assert.match(markup, /aria-label="Unpin"/);
  assert.match(markup, /aria-label="Archive"/);
  assert.match(markup, /aria-label="Thread menu"/);
  assert.doesNotMatch(markup, /thread-row__leading/);
});

test("thread_row_leading_status_is_only_for_running_or_attention", () => {
  const running = renderRow(true, "/Users/you/repo", { lastKnownState: "running" });
  assert.match(running, /thread-row__leading--running/);

  const attention = renderRow(true, "/Users/you/repo", { lastKnownState: "waiting_for_input" });
  assert.match(attention, /thread-row__leading--attention/);

  const live = renderRow(true, "/Users/you/repo", { live: true });
  assert.doesNotMatch(live, /thread-row__leading/);
});

test("worktree_thread_row_exposes_project_and_worktree_in_hover_context", () => {
  const markup = renderRow(true, "/Users/you/repo.worktree/feature-x");
  assert.match(markup, /id="thread-row-context-t1"/);
  assert.match(markup, /aria-describedby="thread-row-context-t1"/);
  assert.match(markup, /class="thread-row__context-popover"[^>]*hidden/);
  assert.match(markup, /(?:tabIndex|tabindex)="-1"/);
  assert.match(markup, />Project</);
  assert.match(markup, />repo</);
  assert.match(markup, />Worktree</);
  assert.match(markup, />feature-x</);
  assert.match(markup, /title="\/Users\/you\/repo\.worktree\/feature-x"/);
  assert.doesNotMatch(markup, /repo \/ feature-x/);
});

test("thread_row_scope_context_handles_windows_paths", () => {
  const markup = renderRow(true, "C:\\Users\\you\\repo");
  assert.match(markup, /aria-label="Thread menu"/);
  assert.match(markup, /p1 \/ repo/);
  assert.doesNotMatch(markup, /p1 \/ C:\\Users\\you\\repo/);
});

test("delete_worktree_is_direct_only_for_worktree_rows", () => {
  assert.doesNotMatch(renderRow(false), /aria-label="Delete worktree"/);
  assert.match(renderRow(false, "/Users/you/repo.worktree/feature-x"), /aria-label="Delete worktree"/);
});
