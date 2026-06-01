// Per-filetype icon mapping.
import assert from "node:assert/strict";
import test from "node:test";
import { FileCode, FileJson, FileText, File } from "lucide-react";
import { fileIconFor } from "../src/desktop/adapters/inbound/react-renderer/file-icons.ts";

test("maps source extensions to a code icon", () => {
  assert.equal(fileIconFor("main.ts"), FileCode);
  assert.equal(fileIconFor("App.tsx"), FileCode);
  assert.equal(fileIconFor("lib.rs"), FileCode);
});

test("maps json/markdown to their icons", () => {
  assert.equal(fileIconFor("package.json"), FileJson);
  assert.equal(fileIconFor("README.md"), FileText);
});

test("matches by full name and falls back to a generic file", () => {
  assert.equal(fileIconFor(".gitignore") !== File, true); // mapped (FileCog)
  assert.equal(fileIconFor("noext"), File);
  assert.equal(fileIconFor("weird.qqq"), File);
});
