// Spec: docs_v2/specs/workbench-filetree-file-operations.md

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createFileInWorkspace,
  createFolderInWorkspace,
  isInvalidMove,
  moveInWorkspace,
  resolveInsideRoot,
  trashInWorkspace,
} from "../src/desktop/infrastructure/electron/main/workspace-fs.ts";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tide-fsops-"));
}

test("resolveInsideRoot accepts in-root paths and rejects escapes", () => {
  const root = tempRoot();
  assert.equal(resolveInsideRoot(root, "src/app.ts").ok, true);

  const escape = resolveInsideRoot(root, "../outside.txt");
  assert.equal(escape.ok, false);
  assert.equal(escape.ok === false && escape.code, "path_outside_root");

  const absElsewhere = resolveInsideRoot(root, "/etc/hosts");
  assert.equal(absElsewhere.ok, false);

  // A sibling dir sharing the prefix (`/root-x`) must NOT count as inside `/root`.
  const sibling = resolveInsideRoot(root, `${path.basename(root)}-x/file`);
  // Relative to root, this resolves to a sibling => outside.
  assert.equal(resolveInsideRoot(`${root}`, `..${path.sep}${path.basename(root)}-x`).ok, false);
  void sibling;
});

test("isInvalidMove rejects moving into self or descendant", () => {
  const a = path.resolve("/ws/a");
  assert.equal(isInvalidMove(a, a), true, "onto itself");
  assert.equal(isInvalidMove(a, path.resolve("/ws/a/b")), true, "into descendant");
  assert.equal(isInvalidMove(a, path.resolve("/ws/b")), false, "into sibling");
  assert.equal(isInvalidMove(a, path.resolve("/ws")), false, "into parent");
});

test("createFileInWorkspace writes content, makes parents, refuses clobber", async () => {
  const root = tempRoot();
  const created = await createFileInWorkspace(root, "nested/dir/new.ts", "export const x = 1;");
  assert.equal(created.ok, true);
  assert.equal(fs.readFileSync(path.join(root, "nested/dir/new.ts"), "utf8"), "export const x = 1;");

  const clobber = await createFileInWorkspace(root, "nested/dir/new.ts", "OVERWRITE");
  assert.equal(clobber.ok, false);
  assert.equal(clobber.ok === false && clobber.code, "file_exists");
  assert.equal(fs.readFileSync(path.join(root, "nested/dir/new.ts"), "utf8"), "export const x = 1;");

  const outside = await createFileInWorkspace(root, "../evil.ts", "x");
  assert.equal(outside.ok, false);
  assert.equal(outside.ok === false && outside.code, "path_outside_root");
});

test("createFolderInWorkspace creates a folder and refuses an existing path", async () => {
  const root = tempRoot();
  const made = await createFolderInWorkspace(root, "a/b");
  assert.equal(made.ok, true);
  assert.ok(fs.statSync(path.join(root, "a/b")).isDirectory());

  const again = await createFolderInWorkspace(root, "a/b");
  assert.equal(again.ok, false);
  assert.equal(again.ok === false && again.code, "folder_exists");
});

test("moveInWorkspace renames, refuses clobber and into-self", async () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/a.ts"), "a");
  fs.writeFileSync(path.join(root, "src/b.ts"), "b");

  const renamed = await moveInWorkspace(root, "src/a.ts", "src/renamed.ts");
  assert.equal(renamed.ok, true);
  assert.ok(fs.existsSync(path.join(root, "src/renamed.ts")));
  assert.ok(!fs.existsSync(path.join(root, "src/a.ts")));

  // Move into a new (auto-created) parent folder.
  const moved = await moveInWorkspace(root, "src/renamed.ts", "lib/deep/renamed.ts");
  assert.equal(moved.ok, true);
  assert.ok(fs.existsSync(path.join(root, "lib/deep/renamed.ts")));

  const clobber = await moveInWorkspace(root, "src/b.ts", "lib/deep/renamed.ts");
  assert.equal(clobber.ok, false);
  assert.equal(clobber.ok === false && clobber.code, "path_exists");

  const intoSelf = await moveInWorkspace(root, "lib", "lib/inner");
  assert.equal(intoSelf.ok, false);
  assert.equal(intoSelf.ok === false && intoSelf.code, "invalid_move");
});

test("trashInWorkspace uses the injected trash and validates the path", async () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, "doomed.txt"), "bye");
  const trashed: string[] = [];

  const ok = await trashInWorkspace(root, "doomed.txt", async (abs) => {
    trashed.push(abs);
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(trashed, [path.join(root, "doomed.txt")]);

  const missing = await trashInWorkspace(root, "ghost.txt", async () => undefined);
  assert.equal(missing.ok, false);
  assert.equal(missing.ok === false && missing.code, "not_found");

  const root2 = await trashInWorkspace(root, ".", async () => undefined);
  assert.equal(root2.ok, false);
  assert.equal(root2.ok === false && root2.code, "path_is_root");
});
