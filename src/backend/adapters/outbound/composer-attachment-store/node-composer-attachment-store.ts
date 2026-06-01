import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ComposerAttachmentInput,
  ComposerAttachmentStorePort,
} from "../../../application/ports/outbound/composer-attachment-store-port.ts";

const ATTACHMENT_DIR = ".tide/attachments";

const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/svg+xml": ".svg",
};

export function createNodeComposerAttachmentStorePort(): ComposerAttachmentStorePort {
  return {
    async materialize(input: {
      cwd: string;
      attachments: ComposerAttachmentInput[];
    }): Promise<string[]> {
      if (input.attachments.length === 0) {
        return [];
      }
      const dir = path.join(input.cwd, ATTACHMENT_DIR);
      await mkdir(dir, { recursive: true });

      const stamp = Date.now();
      const paths: string[] = [];
      for (let index = 0; index < input.attachments.length; index += 1) {
        const attachment = input.attachments[index];
        const fileName = `${stamp}-${index}-${safeName(attachment)}`;
        const filePath = path.join(dir, fileName);
        await writeFile(filePath, Buffer.from(attachment.dataBase64, "base64"));
        paths.push(filePath);
      }
      return paths;
    },
  };
}

function safeName(attachment: ComposerAttachmentInput): string {
  const base = (attachment.name ?? "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base.length > 0 && /\.[a-zA-Z0-9]+$/.test(base)) {
    return base;
  }
  const ext = EXTENSION_BY_MEDIA_TYPE[attachment.mediaType] ?? ".png";
  return `${base.length > 0 ? base : "image"}${ext}`;
}
