// Spec: docs_v2/specs/provider-command-discovery.md
import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverProviderCommands,
  parseAntigravityCommand,
  parseClaudeCommand,
  parseCodexSkill,
  type CommandFs,
} from "../src/desktop/main/provider-command-discovery.ts";

test("claude_command_md_parses_name_and_description", () => {
  const md = "---\ndescription: Check repository evidence.\nargument-hint: \"[seed]\"\n---\n# body";
  assert.deepEqual(parseClaudeCommand("check.md", md), {
    name: "check",
    description: "Check repository evidence.",
  });
});

test("codex_skill_md_parses_name_and_description", () => {
  const md = "---\nname: battleship-ui-ux\ndescription: Board-first UI/UX guidance.\n---\n# Battleship";
  assert.deepEqual(parseCodexSkill("battleship-ui-ux", md), {
    name: "battleship-ui-ux",
    description: "Board-first UI/UX guidance.",
  });
});

test("antigravity_toml_parses_name_and_description", () => {
  const toml = '# Managed by krow init\n\ndescription = "Run actionable engineering work."\n\nprompt = """x"""';
  assert.deepEqual(parseAntigravityCommand("work.toml", toml), {
    name: "work",
    description: "Run actionable engineering work.",
  });
});

function fakeFs(files: Record<string, string>, dirs: Record<string, string[]>): CommandFs {
  return {
    listFiles: (dir) => Object.keys(files).filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes("/")).map((p) => p.slice(dir.length + 1)),
    listDirs: (dir) => dirs[dir] ?? [],
    readText: (path) => files[path],
  };
}

test("discovery_merges_project_over_user_and_dedupes", () => {
  const fs = fakeFs(
    {
      "/proj/.claude/commands/work.md": "---\ndescription: project work\n---",
      "/home/.claude/commands/work.md": "---\ndescription: user work\n---",
      "/home/.claude/commands/extra.md": "---\ndescription: only user\n---",
    },
    {},
  );
  const out = discoverProviderCommands({ cwd: "/proj", homeDir: "/home", agentId: "claude", fs });
  const work = out.filter((c) => c.name === "work");
  assert.equal(work.length, 1, "deduped by name");
  assert.equal(work[0].description, "project work", "project wins over user");
  assert.ok(out.some((c) => c.name === "extra" && c.source === "user"));
});

test("discovery_tags_trigger_slash_for_commands_and_dollar_for_skills", () => {
  const claudeFs = fakeFs({ "/p/.claude/commands/a.md": "---\ndescription: d\n---" }, {});
  const claude = discoverProviderCommands({ cwd: "/p", homeDir: "/h", agentId: "claude", fs: claudeFs });
  assert.equal(claude[0].trigger, "/");

  const codexFs = fakeFs(
    { "/p/.codex/skills/s/SKILL.md": "---\nname: s\ndescription: d\n---" },
    { "/p/.codex/skills": ["s"] },
  );
  const codex = discoverProviderCommands({ cwd: "/p", homeDir: "/h", agentId: "codex", fs: codexFs });
  assert.equal(codex[0].trigger, "$");
  assert.equal(codex[0].name, "s");
});
