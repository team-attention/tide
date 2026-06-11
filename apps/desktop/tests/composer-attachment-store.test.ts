import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createNodeComposerAttachmentStorePort } from "../src/backend/adapters/outbound/composer-attachment-store/node-composer-attachment-store.ts";

// A 1x1 PNG.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

test("attachments materialize under Tide's app-data dir (keyed by threadId), NOT the user's repo", async () => {
  // The bytes are read back into inline base64 for the provider + as the
  // transcript thumbnail — never the user's repo, so no .gitignore is needed.
  const baseDir = mkdtempSync(join(tmpdir(), "tide-att-base-"));
  try {
    const store = createNodeComposerAttachmentStorePort(baseDir);
    const paths = await store.materialize({
      threadId: "thread-xyz",
      attachments: [{ name: "shot.png", mediaType: "image/png", dataBase64: PNG_B64 }],
    });
    assert.equal(paths.length, 1);
    // Lives under <baseDir>/<threadId>/, never inside any repo working tree.
    assert.ok(paths[0].startsWith(join(baseDir, "thread-xyz")), paths[0]);
    assert.ok(existsSync(paths[0]));
    assert.ok(paths[0].endsWith("shot.png"));
    // The bytes round-trip.
    assert.equal(readFileSync(paths[0]).toString("base64"), PNG_B64);
    // No .gitignore — the old repo-pollution mitigation is gone entirely.
    assert.equal(existsSync(join(baseDir, ".gitignore")), false);
    assert.equal(existsSync(join(baseDir, "thread-xyz", ".gitignore")), false);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("empty attachments materialize nothing", async () => {
  const baseDir = mkdtempSync(join(tmpdir(), "tide-att-empty-"));
  try {
    const store = createNodeComposerAttachmentStorePort(baseDir);
    assert.deepEqual(await store.materialize({ threadId: "t", attachments: [] }), []);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});
