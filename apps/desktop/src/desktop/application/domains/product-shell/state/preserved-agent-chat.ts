import type { AgentChatShellState } from "../../agent-chat/agent-chat.ts";

// A background entry seeded only by a data event is a stub with no hydrated thread.
// Restoring it as a real chat flashes an empty transcript before hydrate catches up.
export function restorablePreservedChat(
  entry: AgentChatShellState | undefined,
): AgentChatShellState | undefined {
  if (entry?.thread == null) {
    return undefined;
  }
  const threadId = entry.thread.threadId;
  return {
    ...entry,
    blocks: entry.blocks.filter((block) => block?.threadId === threadId),
  };
}
