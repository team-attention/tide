// Spec: docs_v2/specs/tui-scrape-native-menus.md (TUI scrape)
import assert from "node:assert/strict";
import test from "node:test";

import {
  parseClaudeModelPicker,
  stripTerminalSequences,
} from "../src/backend/application/services/provider-tui-parsers.ts";

// Captured from a real `claude` session `/model` picker (ANSI included), as the
// hidden PTY would deliver it.
const CLAUDE_MODEL_PICKER = [
  "\x1b[2J\x1b[H\x1b[38;5;245mSelect model\x1b[0m",
  "Switch between Claude models. Your pick becomes the default for new",
  "sessions. For other/previous model names, specify with --model.",
  "  1. Default \x1b[2m(recommended)\x1b[0m  Sonnet 4.6 · Best for everyday tasks",
  "\x1b[36m❯ 2. Opus ✔\x1b[0m  Opus 4.8 · Most capable for complex work · ~2×",
  "     usage vs Sonnet",
  "  3. Haiku  Haiku 4.5 · Fastest for quick answers",
  "\x1b[2m● High effort (default) ←/→ to adjust\x1b[0m",
  "Enter to set as default · s to use this session only · Esc to cancel",
].join("\r\n");

test("stripTerminalSequences removes ANSI/CSI and keeps visible text", () => {
  assert.equal(stripTerminalSequences("\x1b[2J\x1b[38;5;245mhi\x1b[0m"), "hi");
});

test("parseClaudeModelPicker extracts real models with the current one marked", () => {
  const models = parseClaudeModelPicker(CLAUDE_MODEL_PICKER);
  assert.deepEqual(
    models.map((m) => m.label),
    ["Default", "Opus", "Haiku"],
  );
  // The ✔ marks Opus as current (not the ❯ cursor, which is incidental).
  assert.equal(models.find((m) => m.label === "Opus")?.current, true);
  assert.equal(models.find((m) => m.label === "Default")?.current, false);
  // No fabricated/placeholder rows leak in.
  assert.ok(!models.some((m) => /provider model list/i.test(m.label)));
});

test("parseClaudeModelPicker returns nothing when no picker is present", () => {
  assert.deepEqual(parseClaudeModelPicker("just some agent output, no picker"), []);
});
