// Spec: docs_v2/specs/worktree-start-experience.md
import assert from "node:assert/strict";
import test from "node:test";

import {
  slugFromMessage,
  resolveWorktreeName,
  disambiguateWorktreeName,
} from "../src/shared/worktree/name.ts";

// --- D2: ASCII slug ---

test("slug_from_message_builds_ascii_kebab_from_english", () => {
  // UC-1: an English first message becomes a lowercase kebab slug.
  assert.equal(slugFromMessage("Fix the login redirect bug"), "fix-the-login-redirect-bug");
  assert.equal(slugFromMessage("Add OAuth support!"), "add-oauth-support");
});

test("slug_from_message_is_empty_for_non_ascii_only_message", () => {
  // UC-2: an all-Korean message has no usable ASCII -> empty slug -> hash later.
  assert.equal(slugFromMessage("로그인 버그 고쳐줘"), "");
  assert.equal(slugFromMessage("버그 수정"), "");
});

test("slug_from_message_keeps_only_ascii_tokens", () => {
  // D2: a mixed message keeps only its ASCII tokens; non-ASCII is dropped.
  assert.equal(slugFromMessage("fix login 로그인"), "fix-login");
  assert.equal(slugFromMessage("로그인 fix 버그 bug"), "fix-bug");
});

test("slug_from_message_caps_length_and_token_count", () => {
  // D2: long messages are capped at 6 tokens / 40 chars, no trailing dash.
  const slug = slugFromMessage("one two three four five six seven eight nine ten");
  assert.equal(slug, "one-two-three-four-five-six");
  const long = slugFromMessage("supercalifragilisticexpialidocious antidisestablishmentarianism");
  assert.ok(long.length <= 40, `expected <= 40 chars, got ${long.length}`);
  assert.ok(!long.endsWith("-"), "no trailing dash");
});

// --- D1: name priority resolution ---

test("resolve_worktree_name_prefers_typed_then_slug_then_hash", () => {
  // UC-3: a typed name wins over the message.
  assert.equal(
    resolveWorktreeName({ typedName: "spike", firstMessage: "do the thing", makeHash: () => "wt-deadbe" }),
    "tide/spike",
  );
  // UC-1: no typed name -> slug of the message.
  assert.equal(
    resolveWorktreeName({ firstMessage: "Fix the login bug", makeHash: () => "wt-deadbe" }),
    "tide/fix-the-login-bug",
  );
});

test("resolve_worktree_name_uses_typed_name_over_message", () => {
  // A typed name is ASCII-slugged but otherwise respected verbatim.
  assert.equal(
    resolveWorktreeName({ typedName: "My Feature!", firstMessage: "anything", makeHash: () => "wt-x" }),
    "tide/my-feature",
  );
  assert.equal(
    resolveWorktreeName({ typedName: "tide/spike", firstMessage: "anything", makeHash: () => "wt-x" }),
    "tide/spike",
  );
  assert.equal(
    resolveWorktreeName({ typedName: "TIDE/Spike", firstMessage: "anything", makeHash: () => "wt-x" }),
    "tide/spike",
  );
});

test("resolve_worktree_name_falls_back_to_hash_for_non_ascii_message", () => {
  // UC-2: blank name + Korean message -> hash (the terminal, always-valid fallback).
  assert.equal(
    resolveWorktreeName({ firstMessage: "로그인 버그 고쳐줘", makeHash: () => "wt-a3f9c2" }),
    "tide/wt-a3f9c2",
  );
  // A too-short auto slug (< 3 chars) also falls back to the hash.
  assert.equal(
    resolveWorktreeName({ firstMessage: "ok", makeHash: () => "wt-a3f9c2" }),
    "tide/wt-a3f9c2",
  );
  // A typed non-ASCII name has no usable slug -> falls through to the message/hash.
  assert.equal(
    resolveWorktreeName({ typedName: "스파이크", firstMessage: "로그인", makeHash: () => "wt-a3f9c2" }),
    "tide/wt-a3f9c2",
  );
});

// --- D6: collision suffix ---

test("resolve_worktree_name_appends_hash_suffix_on_collision", () => {
  // A name that already exists gets a `-<suffix>` so creation never fails.
  let n = 0;
  const suffixes = ["a3f9", "b7c1"];
  const existing = new Set(["fix-login-bug", "fix-login-bug-a3f9"]);
  const out = disambiguateWorktreeName(
    "fix-login-bug",
    (candidate) => existing.has(candidate),
    () => suffixes[n++ % suffixes.length],
  );
  assert.equal(out, "fix-login-bug-b7c1");
  // A free name is returned unchanged.
  assert.equal(
    disambiguateWorktreeName("spike", () => false, () => "zzzz"),
    "spike",
  );
});
