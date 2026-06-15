// Pure policy for native notifications — kept free of electron imports so it is
// unit-testable (the electron delivery + click routing live in notifications.ts).
// See specs/focus-aware-notifications.md.

// One notify request from the renderer. The renderer owns "what happened" (a thread
// finished / needs input / an update notice) and whether that thread is the one on
// screen; main owns "is the user actually here" (window focus) + OS delivery + click.
export interface TideNotificationRequest {
  kind: "agent_finished" | "needs_attention" | "agent_update";
  // The thread to activate when the notification is clicked; null when there is no
  // specific thread to open (an update-available notice).
  threadId: string | null;
  title: string;
  body: string;
  // Was this thread the active (on-screen) thread when the event fired?
  isActiveThread: boolean;
}

// Suppress a notification only when the user is plainly looking at that exact thread:
// the app window is focused AND it is the active (on-screen) thread. Every other case —
// app in the background, or a different thread than the one shown — notifies. Window
// focus is authoritative here; the renderer's document.hasFocus() reports false when a
// Browser Pane / terminal <webview> holds focus even though the window is frontmost.
export function shouldEmitNotification(input: {
  appFocused: boolean;
  isActiveThread: boolean;
}): boolean {
  return !(input.appFocused && input.isActiveThread);
}

export function isNotificationRequest(value: unknown): value is TideNotificationRequest {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const request = value as Record<string, unknown>;
  return (
    typeof request.title === "string" &&
    typeof request.body === "string" &&
    (request.threadId === null || typeof request.threadId === "string")
  );
}
