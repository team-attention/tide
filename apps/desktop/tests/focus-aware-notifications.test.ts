// Spec: focus-aware-notifications. Proves the two pure rules behind native notifications:
//   - shouldEmitNotification: suppress ONLY the thread the user is actively viewing
//     (app focused + active thread); notify in every other case (background app, or a
//     different thread). The previously-broken case is "app in the background, active
//     thread finishes" — it must now notify.
//   - selectCompletedThreads: a thread that went running→idle and is not now waiting
//     surfaces a completion regardless of which thread is active (the focus gate moved
//     to the main process, so this selector no longer excludes activeThreadId).
import assert from "node:assert/strict";
import test from "node:test";

import {
  isNotificationRequest,
  shouldEmitNotification,
} from "../src/desktop/infrastructure/electron/main/notification-policy.ts";
import type { ProductShellThread } from "../src/desktop/application/domains/product-shell/product-shell.ts";
import {
  selectCompletedThreads,
  reconcileAttentionNotifications,
  initialAttentionNotificationState,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";

const thread = (over: Partial<ProductShellThread> & { threadId: string }): ProductShellThread =>
  ({
    threadId: over.threadId,
    title: over.title ?? over.threadId,
    agentId: "codex",
    time: "now",
    scope: { kind: "scratch", scratchCwd: "Scratch" },
    workbenchPanes: [],
    ...over,
  }) as ProductShellThread;

test("shouldEmitNotification suppresses only the thread the user is actively viewing", () => {
  // App focused AND it is the on-screen thread → the user is looking at it; suppress.
  assert.equal(shouldEmitNotification({ appFocused: true, isActiveThread: true }), false);
  // App focused but a DIFFERENT thread finished → notify.
  assert.equal(shouldEmitNotification({ appFocused: true, isActiveThread: false }), true);
  // App in the background, even for the active thread → notify (the key fixed gap).
  assert.equal(shouldEmitNotification({ appFocused: false, isActiveThread: true }), true);
  // App in the background, different thread → notify.
  assert.equal(shouldEmitNotification({ appFocused: false, isActiveThread: false }), true);
});

test("isNotificationRequest accepts well-formed requests and rejects malformed ones", () => {
  assert.equal(
    isNotificationRequest({ kind: "agent_finished", threadId: "t1", title: "x", body: "y", isActiveThread: false }),
    true,
  );
  // An update notice has no specific thread to open.
  assert.equal(
    isNotificationRequest({ kind: "agent_update", threadId: null, title: "x", body: "y", isActiveThread: false }),
    true,
  );
  assert.equal(isNotificationRequest(null), false);
  assert.equal(isNotificationRequest("nope"), false);
  assert.equal(isNotificationRequest({ title: 1, body: "y", threadId: null }), false);
  assert.equal(isNotificationRequest({ title: "x", body: "y", threadId: 5 }), false);
  // Missing / non-boolean isActiveThread → rejected.
  assert.equal(
    isNotificationRequest({ kind: "agent_finished", threadId: "t1", title: "x", body: "y" }),
    false,
  );
  assert.equal(
    isNotificationRequest({ kind: "agent_finished", threadId: "t1", title: "x", body: "y", isActiveThread: "no" }),
    false,
  );
  // Unknown kind → rejected.
  assert.equal(
    isNotificationRequest({ kind: "bogus", threadId: "t1", title: "x", body: "y", isActiveThread: true }),
    false,
  );
});

test("reconcileAttentionNotifications never notifies for state restored at boot", () => {
  // First observation of a loaded list with two already-waiting threads (restored from the
  // previous session). Nothing happened live → no notifications, just record the known set.
  const { notifications, next } = reconcileAttentionNotifications(initialAttentionNotificationState, {
    threads: [
      thread({ threadId: "a", attention: true }),
      thread({ threadId: "b", attention: true }),
      thread({ threadId: "c" }),
    ],
    activeThreadId: null,
  });
  assert.deepEqual(notifications, []);
  assert.deepEqual([...next.knownThreadIds].sort(), ["a", "b", "c"]);
  assert.deepEqual([...next.attentionThreadIds].sort(), ["a", "b"]);
});

test("reconcileAttentionNotifications notifies when a known thread newly enters attention", () => {
  const seeded = { knownThreadIds: new Set(["a", "b"]), attentionThreadIds: new Set(["a"]) };
  const { notifications } = reconcileAttentionNotifications(seeded, {
    threads: [
      thread({ threadId: "a", attention: true }), // already waiting → no re-notify
      thread({ threadId: "b", attention: true, title: "Build" }), // known, newly waiting → notify
    ],
    activeThreadId: "b",
  });
  assert.deepEqual(notifications, [{ threadId: "b", title: "Build", isActiveThread: true }]);
});

test("reconcileAttentionNotifications absorbs a thread that first appears already in attention", () => {
  // A thread that surfaces for the FIRST time already waiting — boot restore, or the post-boot
  // adopted-session discovery push — reflects past state, not a live event, so it must not notify.
  const first = reconcileAttentionNotifications(
    { knownThreadIds: new Set(["x"]), attentionThreadIds: new Set() },
    { threads: [thread({ threadId: "x" }), thread({ threadId: "y", attention: true })], activeThreadId: null },
  );
  assert.deepEqual(first.notifications, []); // y is new → absorbed, not announced
  assert.deepEqual([...first.next.knownThreadIds].sort(), ["x", "y"]);

  // ...but a later genuine transition of an already-known thread does notify.
  const later = reconcileAttentionNotifications(first.next, {
    threads: [thread({ threadId: "x", attention: true }), thread({ threadId: "y", attention: true })],
    activeThreadId: null,
  });
  assert.deepEqual(later.notifications.map((n) => n.threadId), ["x"]);
});

test("selectCompletedThreads surfaces running→idle threads regardless of which is active", () => {
  const previousRunning = new Set(["a", "b", "c", "d"]);
  const threads = [
    thread({ threadId: "a", running: false }), // was running, now idle, not waiting → completed
    thread({ threadId: "b", running: true }), // still running → not completed
    thread({ threadId: "c", running: false, attention: true }), // waiting for input → attention path
    thread({ threadId: "d", running: false }), // also completed — would be the ACTIVE on-screen thread
    thread({ threadId: "e", running: false }), // was NOT previously running → not a completion
  ];
  const completed = selectCompletedThreads(previousRunning, threads).map((entry) => entry.threadId);
  // "d" (the active thread) is included: the selector is focus-agnostic now.
  assert.deepEqual(completed, ["a", "d"]);
});
