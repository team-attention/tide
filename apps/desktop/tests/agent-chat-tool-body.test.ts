// Spec: docs_v2/specs/agent-session-block-rendering-path.md (tool body rendering)
import assert from "node:assert/strict";
import test from "node:test";

import { editDiffLines, toolBodyText } from "../src/desktop/adapters/inbound/react-renderer/agent-chat-shell.ts";

// A Bash/run tool's JSON args render as the raw command with real newlines, not
// the escaped {"command":"…\n…"} blob.
test("tool_body_renders_shell_command_without_json_escaping", () => {
  const body = JSON.stringify({ command: "cd /repo\npkill -f electron", description: "restart" });
  const text = toolBodyText("Bash", body);
  assert.equal(text, "cd /repo\npkill -f electron");
  assert.ok(!text.includes("\\n"));
  assert.ok(!text.includes('{"command"'));
});

// Codex shell tools pass the command as an argv array; it joins to one line.
test("tool_body_joins_array_command", () => {
  const text = toolBodyText("shell", JSON.stringify({ command: ["bash", "-lc", "ls -a"] }));
  assert.equal(text, "bash -lc ls -a");
});

// Edit/write tools show the file content with real newlines (path header), not
// an escaped JSON blob.
test("tool_body_renders_edit_content_with_real_newlines", () => {
  const text = toolBodyText("Edit", JSON.stringify({ file_path: "/a/b.ts", new_string: "line1\nline2" }));
  assert.equal(text, "/a/b.ts\n\nline1\nline2");
  assert.ok(!text.includes("\\n"));
  assert.ok(!text.includes('"new_string"'));
});

// Other object args render as key: value lines (raw values, no escape noise).
test("tool_body_renders_object_args_as_key_value_lines", () => {
  const text = toolBodyText("Read", JSON.stringify({ file_path: "/a/b.ts", offset: 85, limit: 35 }));
  assert.match(text, /file_path: \/a\/b\.ts/);
  assert.match(text, /offset: 85/);
  assert.ok(!text.includes('\\"'));
});

// Truncated/non-JSON bodies pass through unchanged.
test("tool_body_passes_through_plain_text", () => {
  assert.equal(toolBodyText("Bash", "plain output, not json"), "plain output, not json");
});

// --- Edit diff rendering ---

// A claude Edit (old_string/new_string) becomes a +/- line diff with context.
test("edit_diff_builds_add_del_context_from_old_and_new", () => {
  const diff = editDiffLines("Edit", JSON.stringify({ file_path: "/a.ts", old_string: "a\nb\nc", new_string: "a\nB\nc" }));
  assert.ok(diff);
  assert.deepEqual(diff, [
    { kind: "ctx", text: "a" },
    { kind: "del", text: "b" },
    { kind: "add", text: "B" },
    { kind: "ctx", text: "c" },
  ]);
});

// A Write (content only) is all additions.
test("edit_diff_treats_write_content_as_all_additions", () => {
  const diff = editDiffLines("Write", JSON.stringify({ file_path: "/a.ts", content: "x\ny" }));
  assert.deepEqual(diff, [
    { kind: "add", text: "x" },
    { kind: "add", text: "y" },
  ]);
});

// A codex/unified patch parses +/- lines, dropping headers.
test("edit_diff_parses_a_patch_string", () => {
  const diff = editDiffLines("apply_patch", "*** Update File: a.ts\n@@\n ctx\n-old\n+new");
  assert.deepEqual(diff, [
    { kind: "ctx", text: "ctx" },
    { kind: "del", text: "old" },
    { kind: "add", text: "new" },
  ]);
});

// Non-edit tools (e.g. Bash) produce no diff.
test("edit_diff_returns_null_for_non_edit_tools", () => {
  assert.equal(editDiffLines("Bash", JSON.stringify({ command: "ls" })), null);
});
