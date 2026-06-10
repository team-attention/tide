import test from "node:test";
import assert from "node:assert/strict";

import {
  detectAgentUpdateNotice,
  createUpdateNoticeScanner,
} from "../src/backend/adapters/outbound/agent-runtime/structured/agent-update-notice.ts";

test("detects common provider/CLI update banners on stderr", () => {
  assert.ok(detectAgentUpdateNotice("A new release of codex is available: 0.136.0 -> 0.140.0"));
  assert.ok(detectAgentUpdateNotice("Update available! Run npm i -g @anthropic-ai/claude-code to update."));
  assert.ok(detectAgentUpdateNotice("npm notice New minor version of npm available! 10.1.0 -> 10.4.0"));
  assert.ok(detectAgentUpdateNotice("gemini-cli is out of date; please update"));
});

test("ignores ordinary stderr noise (no false positives)", () => {
  assert.equal(detectAgentUpdateNotice("Loading model gpt-5.5..."), null);
  assert.equal(detectAgentUpdateNotice("warning: deprecated flag --foo"), null);
  assert.equal(detectAgentUpdateNotice("Already up to date."), null);
  assert.equal(detectAgentUpdateNotice(""), null);
});

test("strips ANSI color codes and returns the matched line from a multi-line chunk", () => {
  const chunk = ["starting...", "[33mUpdate available: v2 to v3[0m", "ready."].join("\n");
  const notice = detectAgentUpdateNotice(chunk);
  assert.equal(notice, "Update available: v2 to v3");
});

test("scanner fires onNotice exactly once per runtime", () => {
  const seen: string[] = [];
  const scan = createUpdateNoticeScanner((m) => seen.push(m));
  scan("nothing here");
  scan("Update available: run upgrade");
  scan("Update available: run upgrade"); // a later chunk must not refire
  assert.equal(seen.length, 1);
  assert.match(seen[0], /Update available/);
});
