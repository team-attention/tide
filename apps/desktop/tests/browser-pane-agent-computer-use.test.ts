// Spec: docs_v2/specs/browser-pane-agent-computer-use.md
// Slice 1a — backend coordinate action contract + backend-authoritative agentDriving /
// agentCursor + user takeover. The selector path stays the unchanged reliability
// fallback; the coordinate path is the "human" computer-use path that starts driving.
import assert from "node:assert/strict";
import test from "node:test";

import type { ThreadRecord } from "../src/backend/application/domains/thread/thread.ts";
import type { BrowserPaneState } from "../src/backend/application/domains/workbench/workbench.ts";
import {
  actBrowserOutput,
  clearAgentBrowserDriving,
  releaseAgentBrowserControl,
} from "../src/backend/application/services/workbench/workbench-browser-operations.ts";

const now = "2026-06-14T00:00:00.000Z";

// actBrowserOutput / releaseAgentBrowserControl are pure over the thread's pane list,
// so a minimal hand-built thread (only the fields they touch) is enough — mirroring the
// lightweight casting in browser-pane-action-liveness.test.ts.
function browserThread(overrides: Partial<BrowserPaneState> = {}): ThreadRecord {
  const pane: BrowserPaneState = {
    paneId: "p1",
    kind: "browser",
    title: "Example",
    url: "https://example.test",
    loading: false,
    revision: "rev-1",
    updatedAt: now,
    ...overrides,
  };
  return {
    threadId: "t1",
    updatedAt: now,
    workbench: { panes: [pane], focusOwner: "composer", layoutMode: "stacked" },
  } as unknown as ThreadRecord;
}

function browserPaneOf(thread: ThreadRecord): BrowserPaneState {
  const pane = thread.workbench.panes[0];
  assert.equal(pane.kind, "browser");
  return pane as BrowserPaneState;
}

let seq = 0;
const idGen = () => `gen-${++seq}`;
const clock = () => now;

// --- UC: Coordinate computer-use action starts agent driving ---

test("click_at schedules a pending click_at and starts agent driving with a cursor", () => {
  // BR: coordinate actions set agentDriving + agentCursor (screenshot-pixel space).
  const thread = browserThread();
  const result = actBrowserOutput(
    thread,
    { paneId: "p1", revision: "rev-1", action: "click_at", x: 120, y: 240, button: "left" },
    idGen,
    clock,
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.action.kind, "click_at");
  assert.equal(result.ok && result.value.status, "pending");
  const pane = browserPaneOf(thread);
  assert.equal(pane.pendingAction?.kind, "click_at");
  assert.equal(pane.pendingAction?.x, 120);
  assert.equal(pane.pendingAction?.y, 240);
  assert.equal(pane.pendingAction?.button, "left");
  assert.equal(pane.agentDriving, true);
  assert.deepEqual(pane.agentCursor, { x: 120, y: 240 });
});

test("move_to / scroll / key / type are accepted coordinate actions that start driving", () => {
  const cases: Record<string, unknown>[] = [
    { action: "move_to", x: 10, y: 20 },
    { action: "scroll", x: 5, y: 6, deltaX: 0, deltaY: -120 },
    { action: "key", keys: "Enter" },
    { action: "type", text: "hello" },
  ];
  for (const input of cases) {
    const thread = browserThread();
    const result = actBrowserOutput(
      thread,
      { paneId: "p1", revision: "rev-1", ...input },
      idGen,
      clock,
    );
    assert.equal(result.ok, true, `${String(input.action)} should be accepted`);
    assert.equal(browserPaneOf(thread).agentDriving, true);
  }
});

test("scroll carries the wheel deltas onto the pending action", () => {
  const thread = browserThread();
  const result = actBrowserOutput(
    thread,
    { paneId: "p1", revision: "rev-1", action: "scroll", x: 5, y: 6, deltaX: 0, deltaY: -120 },
    idGen,
    clock,
  );
  assert.equal(result.ok, true);
  const pane = browserPaneOf(thread);
  assert.equal(pane.pendingAction?.deltaX, 0);
  assert.equal(pane.pendingAction?.deltaY, -120);
});

test("click_at requires numeric x and y", () => {
  const thread = browserThread();
  const result = actBrowserOutput(
    thread,
    { paneId: "p1", revision: "rev-1", action: "click_at" },
    idGen,
    clock,
  );
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "invalid_workbench_command");
  assert.equal(browserPaneOf(thread).pendingAction, undefined);
  assert.notEqual(browserPaneOf(thread).agentDriving, true);
});

// --- UC: Selector path is the unchanged reliability fallback ---

test("selector click is unchanged and does NOT start agent driving", () => {
  // Invariant: the selector click / type_text path is unchanged (reliability fallback).
  const thread = browserThread();
  const result = actBrowserOutput(
    thread,
    { paneId: "p1", revision: "rev-1", action: "click", selector: "button.primary" },
    idGen,
    clock,
  );
  assert.equal(result.ok, true);
  const pane = browserPaneOf(thread);
  assert.equal(pane.pendingAction?.kind, "click");
  assert.equal(pane.pendingAction?.selector, "button.primary");
  assert.notEqual(pane.agentDriving, true);
  assert.equal(pane.agentCursor, undefined);
});

test("type_text without text still returns a structured error", () => {
  const thread = browserThread();
  const result = actBrowserOutput(
    thread,
    { paneId: "p1", revision: "rev-1", action: "type_text", selector: "input[name=q]" },
    idGen,
    clock,
  );
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "invalid_workbench_command");
});

test("a coordinate action with a stale revision is rejected", () => {
  const thread = browserThread();
  const result = actBrowserOutput(
    thread,
    { paneId: "p1", revision: "stale", action: "click_at", x: 1, y: 2 },
    idGen,
    clock,
  );
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "workbench_stale_reference");
});

// --- UC: User takeover releases agent control (D5) ---

test("release_agent_browser_control clears driving, cursor, and the pending action", () => {
  const thread = browserThread({
    agentDriving: true,
    agentCursor: { x: 50, y: 60 },
    pendingAction: { actionId: "a1", kind: "click_at", x: 50, y: 60, requestedAt: now },
  });
  const result = releaseAgentBrowserControl(thread, "p1", idGen, clock);
  assert.equal(result.ok, true);
  const pane = browserPaneOf(thread);
  assert.equal(pane.agentDriving, false);
  assert.equal(pane.agentCursor, undefined);
  assert.equal(pane.pendingAction, undefined);
});

test("release_agent_browser_control on a missing pane returns a structured error", () => {
  const thread = browserThread();
  const result = releaseAgentBrowserControl(thread, "nope", idGen, clock);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "workbench_target_not_found");
});

// --- UC: Turn end auto-dismisses the driving theater (1b-ii-B) ---

test("clearAgentBrowserDriving drops driving + cursor but leaves any pending action", () => {
  const thread = browserThread({
    agentDriving: true,
    agentCursor: { x: 1, y: 2 },
    pendingAction: { actionId: "a1", kind: "click_at", x: 1, y: 2, requestedAt: now },
  });
  const changed = clearAgentBrowserDriving(thread);
  assert.equal(changed, true);
  const pane = browserPaneOf(thread);
  assert.equal(pane.agentDriving, false);
  assert.equal(pane.agentCursor, undefined);
  // An in-flight action still settles via its own result path.
  assert.equal(pane.pendingAction?.actionId, "a1");
});

test("clearAgentBrowserDriving is a no-op when nothing is driving", () => {
  const thread = browserThread();
  assert.equal(clearAgentBrowserDriving(thread), false);
});

// --- UC: User takeover yields the pane + softly refuses re-driving (spec: composer-prompt-browser-fixes) ---

test("after user takeover the pane is userControlled and the agent's act is softly refused", () => {
  const thread = browserThread({ agentDriving: true, agentCursor: { x: 1, y: 2 } });
  assert.equal(releaseAgentBrowserControl(thread, "p1", idGen, clock).ok, true);
  assert.equal(browserPaneOf(thread).userControlled, true);
  // A drive attempt is refused with the clear user-control code (it takes priority over the
  // bumped revision), so the agent yields + continues rather than re-driving or erroring cryptically.
  const act = actBrowserOutput(
    thread,
    { paneId: "p1", revision: "rev-1", action: "click_at", x: 10, y: 20 },
    idGen,
    clock,
  );
  assert.equal(act.ok, false);
  assert.equal(!act.ok && act.error.code, "workbench_user_controlled");
});

test("clearAgentBrowserDriving (turn end) clears the userControlled gate so a new turn may drive", () => {
  const thread = browserThread({ userControlled: true });
  assert.equal(clearAgentBrowserDriving(thread), true);
  assert.equal(browserPaneOf(thread).userControlled, undefined);
});
