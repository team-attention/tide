import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  generateGitCommitMessage,
  getGitPushTarget,
  pushGitTarget,
} from "../src/desktop/infrastructure/electron/main/git-handoff-actions.ts";

test("generateGitCommitMessage uses staged changes before working-tree changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-git-handoff-message-"));
  try {
    initRepo(dir);
    writeFileSync(join(dir, "app.txt"), "old\n", "utf8");
    git(dir, ["add", "app.txt"]);
    git(dir, ["commit", "-m", "initial"]);

    writeFileSync(join(dir, "app.txt"), "new\n", "utf8");
    writeFileSync(join(dir, "notes.txt"), "draft\n", "utf8");
    git(dir, ["add", "app.txt"]);

    const result = await generateGitCommitMessage(dir);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.source, "staged");
      assert.equal(result.message, "Update app.txt");
      assert.deepEqual(result.files, ["app.txt"]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getGitPushTarget and pushGitTarget use an explicit remote branch", async () => {
  const base = mkdtempSync(join(tmpdir(), "tide-git-handoff-push-"));
  const repo = join(base, "repo");
  const remote = join(base, "remote.git");
  try {
    mkdirSync(repo);
    mkdirSync(remote);
    initRepo(repo);
    git(remote, ["init", "--bare"]);
    writeFileSync(join(repo, "app.txt"), "hello\n", "utf8");
    git(repo, ["add", "app.txt"]);
    git(repo, ["commit", "-m", "initial"]);
    git(repo, ["remote", "add", "origin", remote]);

    const target = await getGitPushTarget(repo);

    assert.deepEqual(target, {
      ok: true,
      currentBranch: "main",
      remote: "origin",
      branch: "main",
      upstream: null,
      label: "origin/main",
    });

    const push = await pushGitTarget({ cwd: repo, remote: "origin", branch: "main" });
    assert.equal(push.ok, true);
    assert.equal(git(remote, ["rev-parse", "--verify", "refs/heads/main"]).trim().length > 0, true);

    const targetWithUpstream = await getGitPushTarget(repo);
    assert.deepEqual(targetWithUpstream, {
      ok: true,
      currentBranch: "main",
      remote: "origin",
      branch: "main",
      upstream: "origin/main",
      label: "origin/main",
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

function initRepo(cwd: string): void {
  git(cwd, ["init", "-b", "main"]);
  git(cwd, ["config", "user.email", "tide@example.test"]);
  git(cwd, ["config", "user.name", "Tide Test"]);
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}
