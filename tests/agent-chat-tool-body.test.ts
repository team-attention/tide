// Spec: docs_v2/specs/agent-session-block-rendering-path.md (tool body rendering)
import assert from "node:assert/strict";
import test from "node:test";

import { toolBodyText } from "../src/desktop/adapters/inbound/react-renderer/agent-chat-shell.ts";

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
