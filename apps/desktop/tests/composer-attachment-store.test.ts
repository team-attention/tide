import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createNodeComposerAttachmentStorePort } from "../src/backend/adapters/outbound/composer-attachment-store/node-composer-attachment-store.ts";

// A 1x1 PNG.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

test("attachments materialize inside the workspace, gitignored so they don't pollute the repo", async () => {
  // Agents refuse to read files outside their trusted workspace, so attachments
  // must stay under the thread cwd — but a self-contained .tide/.gitignore keeps
  // them out of the user's git and Tide's (gitignore-honoring) file tree.
  const cwd = mkdtempSync(join(tmpdir(), "tide-att-"));
  try {
    const store = createNodeComposerAttachmentStorePort();
    const paths = await store.materialize({
      cwd,
      attachments: [{ name: "shot.png", mediaType: "image/png", dataBase64: PNG_B64 }],
    });
    assert.equal(paths.length, 1);
    assert.ok(paths[0].startsWith(join(cwd, ".tide", "attachments")), paths[0]);
    assert.ok(existsSync(paths[0]));

    const gitignore = join(cwd, ".tide", ".gitignore");
    assert.ok(existsSync(gitignore), ".tide/.gitignore should be created");
    assert.equal(readFileSync(gitignore, "utf8"), "*\n");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a user's existing .tide/.gitignore is never clobbered", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "tide-att2-"));
  try {
    mkdirSync(join(cwd, ".tide"), { recursive: true });
    writeFileSync(join(cwd, ".tide", ".gitignore"), "# mine\nkeep-me\n");
    const store = createNodeComposerAttachmentStorePort();
    await store.materialize({
      cwd,
      attachments: [{ name: "a.png", mediaType: "image/png", dataBase64: PNG_B64 }],
    });
    assert.equal(readFileSync(join(cwd, ".tide", ".gitignore"), "utf8"), "# mine\nkeep-me\n");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
