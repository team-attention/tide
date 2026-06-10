// Spec: docs_v2/specs/tui-scrape-native-menus.md (TUI scrape)
import assert from "node:assert/strict";
import test from "node:test";

import {
  codexApprovalPromptSignature,
  decodeCodexMenuNavigation,
  encodeCodexMenuNavigation,
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

test("encode/decodeCodexMenuNavigation round-trips signed step counts", () => {
  for (const steps of [0, 1, 2, -1, 3]) {
    assert.deepEqual(decodeCodexMenuNavigation(encodeCodexMenuNavigation(steps)), {
      steps,
    });
  }
});

test("decodeCodexMenuNavigation returns null for non-token answer values", () => {
  assert.equal(decodeCodexMenuNavigation("allow_once"), null);
  assert.equal(decodeCodexMenuNavigation(""), null);
  assert.equal(decodeCodexMenuNavigation("codex-menu:abc"), null);
});

test("codexApprovalPromptSignature is stable per box and distinct across boxes", () => {
  const parsed = parseCodexApprovalPrompt(CODEX_APPROVAL_PROMPT);
  assert.notEqual(parsed, null);
  // Re-parsing the same box yields the same signature (dedupe across PTY chunks).
  const reparsed = parseCodexApprovalPrompt(CODEX_APPROVAL_PROMPT);
  assert.equal(
    codexApprovalPromptSignature(parsed!),
    codexApprovalPromptSignature(reparsed!),
  );
  // A different question yields a different signature.
  const other = { ...parsed!, question: "Allow a different tool?" };
  assert.notEqual(
    codexApprovalPromptSignature(parsed!),
    codexApprovalPromptSignature(other),
  );
});

test("codex_approval_box_painted_with_cursor_positioning_parses", () => {
  // Captured from a LIVE codex 0.136 hidden PTY (ask-for-approval shell command):
  // the box is painted with absolute cursor moves (CSI row;colH), NOT newlines,
  // and the cursor row uses U+203A "›". A newline-naive strip collapses the box
  // into one line and the per-line option regex never matches — the approval
  // prompt then never surfaces and the turn hangs "Working" forever.
  const raw =
    "\x1b[?2026h" +
    "\x1b[24;2H\x1b[0m• Running\x1b[1mtouch /tmp/tide-perm-probe-codex.txt\x1b[0m" +
    "\x1b[26;2HWould you like to run the following command?" +
    "\x1b[27;2HReason: Do you want to allow creating /tmp/tide-perm-probe-codex.txt?" +
    "\x1b[28;2H$ touch /tmp/tide-perm-probe-codex.txt" +
    "\x1b[30;2H› 1. Yes, proceed (y)" +
    "\x1b[31;2H  2. Yes, and don't ask again for commands that start with `touch /tmp/tide-perm-probe-codex.txt` (p)" +
    "\x1b[32;2H  3. No, and tell Codex what to do differently (esc)" +
    "\x1b[34;2HPress enter to confirm or esc to cancel" +
    "\x1b[?2026l";
  const prompt = parseCodexApprovalPrompt(raw);
  assert.notEqual(prompt, null);
  assert.equal(prompt?.options.length, 3);
  assert.equal(prompt?.options[0]?.label, "Yes, proceed (y)");
  assert.equal(prompt?.defaultIndex, 0);
  assert.ok(prompt?.question.endsWith("?"));
});

test("claude_question_box_painted_without_option_spaces_parses", () => {
  // Captured from a LIVE Claude Code hidden PTY (AskUserQuestion): cell painting
  // drops the space after the option number and puts each description on its own
  // line; the cursor row is "❯1.OPTION_ALPHA".
  const raw =
    "\x1b[30;2H ☐ Option" +
    "\x1b[31;2HWhich option do you prefer?" +
    "\x1b[32;2H❯1.OPTION_ALPHA" +
    "\x1b[33;2HChoose OPTION_ALPHA." +
    "\x1b[34;2H2.OPTION_BETA" +
    "\x1b[35;2HChoose OPTION_BETA." +
    "\x1b[36;2H3. Type something." +
    "\x1b[38;2HEnter to select · ↑/↓ to navigate · Esc to cancel";
  const prompt = parseCodexApprovalPrompt(raw);
  assert.notEqual(prompt, null);
  assert.equal(prompt?.question, "Which option do you prefer?");
  assert.equal(prompt?.options[0]?.label, "OPTION_ALPHA");
  assert.equal(prompt?.options[1]?.label, "OPTION_BETA");
  assert.equal(prompt?.defaultIndex, 0);
});

test("claude_word_gap_idioms_cha_and_cursor_forward_become_spaces", () => {
  // Captured live from claude's hidden PTY: words are painted with cursor-to-
  // column jumps between them, NOT space characters. Stripping those fused the
  // question into "Doyouwanttoproceed?", which broke both the user-facing
  // message and the \b-based approval classification.
  const raw =
    "\x1b[38;2;153;153;153mClaude wants to search the web for: Figma short interest\r\x1b[1C\x1b[2B" +
    "\x1b[39mDo\x1b[5Gyou\x1b[9Gwant\x1b[14Gto\x1b[17Gproceed?\r\x1b[1C\x1b[1B" +
    "\x1b[38;2;177;185;249m❯\x1b[4G\x1b[38;2;153;153;153m1. Yes\r\x1b[1C\x1b[1B" +
    "\x1b[4G2. No, and tell Claude what to do differently (esc)\r\x1b[1C\x1b[1B" +
    "Enter to confirm · Esc to cancel";
  const prompt = parseCodexApprovalPrompt(raw);
  assert.notEqual(prompt, null);
  assert.equal(prompt?.question, "Do you want to proceed?");
  assert.equal(prompt?.options[0]?.label, "Yes");
  assert.equal(prompt?.options.length, 2);
});

test("two_boxes_in_one_buffer_parses_the_last_active_box", () => {
  // The rolling PTY buffer can hold an already-answered box still painted on
  // screen PLUS the newly-rendered one. The active prompt is the LAST box; the
  // parser must return it (returning the stale first box re-surfaced an answered
  // prompt and suppressed the new one — claude WebSearch→WebFetch hang).
  const box = (q, opt1) =>
    `${q}\r\x1b[1C\x1b[2B` +
    `\x1b[39m❯\x1b[4G1. ${opt1}\r\x1b[1C\x1b[1B` +
    `\x1b[4G2. No, and tell Claude what to do differently (esc)\r\x1b[1C\x1b[1B` +
    `Enter to confirm · Esc to cancel\r\x1b[2B`;
  const raw = box("Do you want to proceed?", "Yes") +
    box("Do you want to allow Claude to fetch this content?", "Yes");
  const prompt = parseCodexApprovalPrompt(raw);
  assert.notEqual(prompt, null);
  // The SECOND (active) box, not the stale first one.
  assert.equal(prompt?.question, "Do you want to allow Claude to fetch this content?");
});
