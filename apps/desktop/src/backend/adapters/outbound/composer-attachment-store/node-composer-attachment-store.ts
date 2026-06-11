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

      // Attachments MUST live inside the workspace — agents refuse to read files
      // outside their trusted directory (verified: claude returns "permission
      // wasn't granted to read that file" for an out-of-cwd path). To keep them
      // from polluting the user's git, drop a self-contained `.tide/.gitignore`
      // that ignores everything under .tide. Git then never reports it, and
      // Tide's own file tree (which honors .gitignore) hides it too. Written
      // once (wx) so a user's own customization is never clobbered.
      await writeFile(path.join(input.cwd, ".tide", ".gitignore"), "*\n", {
        flag: "wx",
      }).catch(() => undefined);

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
