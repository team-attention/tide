// Spec: docs_v2/specs/tui-scrape-native-menus.md (TUI scrape)
import assert from "node:assert/strict";
import test from "node:test";

import {
  parseClaudeModelPicker,
  parseCodexApprovalPrompt,
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

// Spec: docs_v2/specs/agent-prompt-surfacing.md
// codex's boxed MCP/command approval menu as the hidden PTY delivers it (ANSI in).
const CODEX_APPROVAL_PROMPT = [
  "\x1b[2J\x1b[H\x1b[1mField 1/1\x1b[0m",
  '\x1b[38;5;252mAllow the tide MCP server to run tool "tide_open_browser"?\x1b[0m',
  "detail: compact",
  "pane_id: 13",
  "",
  "\x1b[36m> 1. Allow\x1b[0m                  Run the tool and continue.",
  "  2. Allow for this session   Run the tool and remember this choice for this session.",
  "  3. Always allow             Run the tool and remember this choice for future tool calls.",
  "  4. Cancel                   Cancel this tool call",
  "",
  "\x1b[2menter to submit | esc to cancel\x1b[0m",
].join("\n");

test("parseCodexApprovalPrompt extracts the question, ordered options, and default", () => {
  const parsed = parseCodexApprovalPrompt(CODEX_APPROVAL_PROMPT);
  assert.notEqual(parsed, null);
  assert.equal(parsed?.question, 'Allow the tide MCP server to run tool "tide_open_browser"?');
  assert.equal(parsed?.defaultIndex, 0);
  assert.deepEqual(
    parsed?.options.map((option) => ({ index: option.index, label: option.label })),
    [
      { index: 1, label: "Allow" },
      { index: 2, label: "Allow for this session" },
      { index: 3, label: "Always allow" },
      { index: 4, label: "Cancel" },
    ],
  );
  assert.equal(parsed?.options[0].detail, "Run the tool and continue.");
});

test("parseCodexApprovalPrompt returns null for ordinary numbered output (no prompt footer)", () => {
  const prose = [
    "Here is my plan?",
    "1. First do this",
    "2. Then do that",
  ].join("\n");
  assert.equal(parseCodexApprovalPrompt(prose), null);
});
