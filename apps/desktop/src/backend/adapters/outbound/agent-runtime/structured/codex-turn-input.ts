import type { ComposerAttachmentRef } from "../../../../application/domains/thread/thread.ts";

// Codex has no file-read tool, so attachments are native localImage items in
// addition to the transcript's text marker.
export function codexTurnInput(
  text: string,
  attachments?: ComposerAttachmentRef[],
): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [{ type: "text", text }];
  for (const attachment of attachments ?? []) {
    items.push({ type: "localImage", path: attachment.path });
  }
  return items;
}
