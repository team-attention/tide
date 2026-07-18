import { readFileSync } from "node:fs";
import type { ComposerAttachmentRef } from "../../../../application/domains/thread/thread.ts";

const ATTACHED_IMAGE_LINE_RE = /\n*\[Attached image:[^\]]*\]/g;

export function claudeUserContent(
  text: string,
  attachments?: ComposerAttachmentRef[],
): Array<Record<string, unknown>> {
  if (attachments === undefined || attachments.length === 0) return [{ type: "text", text }];
  const cleaned = text.replace(ATTACHED_IMAGE_LINE_RE, "").trim();
  const content: Array<Record<string, unknown>> = [];
  if (cleaned.length > 0) content.push({ type: "text", text: cleaned });
  for (const attachment of attachments) {
    try {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: attachment.mediaType,
          data: readFileSync(attachment.path).toString("base64"),
        },
      });
    } catch {
      // Unreadable attachment does not fail the text delivery.
    }
  }
  return content.length > 0 ? content : [{ type: "text", text }];
}
