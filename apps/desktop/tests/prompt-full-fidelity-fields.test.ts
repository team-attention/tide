import test from "node:test";
import assert from "node:assert/strict";

import { buildPermissionDetail } from "../src/backend/adapters/outbound/agent-runtime/structured/claude-permission-prompt.ts";
import { acpOptionKind, buildAcpPermissionDetail } from "../src/backend/adapters/outbound/agent-runtime/structured/acp-permission.ts";

// Spec: docs_v2/specs/prompt-full-fidelity-fields.md — every provider's prompt now carries
// the full native fidelity (option description/preview, question header, approval detail,
// option kind) instead of being flattened to a single message + bare label. These unit
// tests pin the per-provider mappers that build the approval `detail` and option `kind`.

// --- claude permission detail (from the can_use_tool input) ---

test("claude buildPermissionDetail: a Bash command becomes a text detail", () => {
  assert.deepEqual(buildPermissionDetail({ command: "ls -la" }), {
    format: "text",
    body: "ls -la",
  });
});

test("claude buildPermissionDetail: an Edit's old/new strings become a +/- diff with the path", () => {
  assert.deepEqual(buildPermissionDetail({ file_path: "a.ts", old_string: "x", new_string: "y" }), {
    format: "diff",
    body: "- x\n+ y",
    locations: ["a.ts"],
  });
});

test("claude buildPermissionDetail: a Write's content becomes a text detail with the path", () => {
  assert.deepEqual(buildPermissionDetail({ path: "b.ts", content: "hello" }), {
    format: "text",
    body: "hello",
    locations: ["b.ts"],
  });
});

test("claude buildPermissionDetail: a tool with nothing previewable yields no detail", () => {
  assert.equal(buildPermissionDetail({ query: "needle" }), undefined);
  assert.equal(buildPermissionDetail({}), undefined);
});

// --- ACP option kind + permission detail (gemini / opencode) ---

test("acpOptionKind: native allow/reject kinds pass through; anything else is undefined", () => {
  assert.equal(acpOptionKind({ kind: "allow_once" }), "allow_once");
  assert.equal(acpOptionKind({ kind: "reject_always" }), "reject_always");
  assert.equal(acpOptionKind({ kind: "made_up" }), undefined);
  assert.equal(acpOptionKind({}), undefined);
});

test("acp buildAcpPermissionDetail: a diff content item becomes a +/- diff with the path (deduped)", () => {
  assert.deepEqual(
    buildAcpPermissionDetail({
      locations: [{ path: "a.ts" }],
      content: [{ type: "diff", path: "a.ts", oldText: "x", newText: "y" }],
    }),
    { format: "diff", body: "# a.ts\n- x\n+ y", locations: ["a.ts"] },
  );
});

test("acp buildAcpPermissionDetail: a text content item becomes a text detail", () => {
  assert.deepEqual(
    buildAcpPermissionDetail({ content: [{ type: "content", content: { type: "text", text: "run ls" } }] }),
    { format: "text", body: "run ls" },
  );
});

test("acp buildAcpPermissionDetail: locations alone still surface as a detail", () => {
  assert.deepEqual(buildAcpPermissionDetail({ locations: [{ path: "a.ts" }] }), {
    format: "text",
    body: "a.ts",
    locations: ["a.ts"],
  });
});

test("acp buildAcpPermissionDetail: an empty toolCall yields no detail", () => {
  assert.equal(buildAcpPermissionDetail({}), undefined);
});

// Gemini review regressions: a pure addition (newText only) must not inject a spurious empty
// "- " line, and duplicate locations must be deduped (unique React keys for the chips).
test("acp buildAcpPermissionDetail: a pure addition emits only + lines (no empty - line)", () => {
  assert.deepEqual(
    buildAcpPermissionDetail({ content: [{ type: "diff", path: "new.ts", newText: "added line" }] }),
    { format: "diff", body: "# new.ts\n+ added line", locations: ["new.ts"] },
  );
});

test("acp buildAcpPermissionDetail: duplicate toolCall.locations are deduped", () => {
  assert.deepEqual(buildAcpPermissionDetail({ locations: [{ path: "a.ts" }, { path: "a.ts" }] }), {
    format: "text",
    body: "a.ts",
    locations: ["a.ts"],
  });
});
