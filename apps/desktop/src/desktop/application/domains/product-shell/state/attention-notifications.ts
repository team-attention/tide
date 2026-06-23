// The pure "needs attention" notification policy, factored out of the renderer so the
// boot-suppression rule is unit-testable (the renderer effect in product-shell.tsx is a thin
// wrapper). Sits beside selectCompletedThreads (thread-list.ts), the completion counterpart.
import type { ProductShellThread } from "./types.ts";

// State the renderer carries between renders to decide notifications. knownThreadIds is every
// thread id observed so far; attentionThreadIds is the subset currently waiting on the user.
export interface AttentionNotificationState {
  knownThreadIds: ReadonlySet<string>;
  attentionThreadIds: ReadonlySet<string>;
}

export const initialAttentionNotificationState: AttentionNotificationState = {
  knownThreadIds: new Set(),
  attentionThreadIds: new Set(),
};

export interface AttentionNotification {
  threadId: string;
  title: string;
  isActiveThread: boolean;
}

// Decide which threads should fire a native "a thread needs your input" notification, given
// the previous observation. A notification fires ONLY for a LIVE transition: a thread we were
// already tracking moves into attention. A thread's FIRST appearance is absorbed silently —
// boot-restored threads, the async backend thread.listed, and the post-boot adopted-session
// discovery all surface threads whose waiting state reflects the PAST, not a live event, so
// announcing them would be the "notification on launch" bug. This mirrors selectCompletedThreads,
// which is boot-safe for free because it keys off a "was running" membership that is empty at
// boot; here the "was known" membership plays the same role (and a thread that leaves attention
// and returns is a genuine transition, so it notifies again). See specs/focus-aware-notifications.md.
export function reconcileAttentionNotifications(
  previous: AttentionNotificationState,
  input: { threads: ProductShellThread[]; activeThreadId: string | null },
): { notifications: AttentionNotification[]; next: AttentionNotificationState } {
  const waiting = input.threads.filter((thread) => thread.attention === true);
  const attentionThreadIds = new Set(waiting.map((thread) => thread.threadId));
  const notifications = waiting
    .filter(
      (thread) =>
        previous.knownThreadIds.has(thread.threadId) &&
        !previous.attentionThreadIds.has(thread.threadId),
    )
    .map((thread) => ({
      threadId: thread.threadId,
      title: thread.title,
      isActiveThread: thread.threadId === input.activeThreadId,
    }));
  const knownThreadIds = new Set(previous.knownThreadIds);
  for (const thread of input.threads) {
    knownThreadIds.add(thread.threadId);
  }
  return { notifications, next: { knownThreadIds, attentionThreadIds } };
}
