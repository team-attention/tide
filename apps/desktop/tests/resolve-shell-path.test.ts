import assert from "node:assert/strict";
import test from "node:test";

import { resolveAugmentedPath } from "../src/backend/infrastructure/node/live/resolve-shell-path.ts";

// Why: a Finder-launched packaged app only gets the minimal launchd PATH, so the
// Agent Runtime's `which <cli>` cannot find provider CLIs in ~/.local/bin etc.
// resolveAugmentedPath restores the login-shell PATH plus common fallbacks.

test("login_shell_path_is_prepended_to_the_minimal_launchd_path", () => {
  const result = resolveAugmentedPath({
    platform: "darwin",
    currentPath: "/usr/bin:/bin:/usr/sbin:/sbin",
    homeDir: "/Users/me",
    runShell: () => "/Users/me/.local/bin:/opt/homebrew/bin:/usr/bin:/bin",
  });

  const parts = result.split(":");
  assert.ok(parts.includes("/Users/me/.local/bin"), "shell PATH bins must be present");
  assert.ok(parts.includes("/opt/homebrew/bin"));
  // Shell PATH wins ordering over the minimal launchd PATH.
  assert.ok(
    parts.indexOf("/Users/me/.local/bin") < parts.indexOf("/usr/sbin"),
    "shell entries should come before the minimal launchd-only entries",
  );
  // No duplicates.
  assert.equal(new Set(parts).size, parts.length);
});

test("drops_the_v1_tide_terminal_wrapper_bin_so_v2_runs_the_real_cli", () => {
  const wrapperDir =
    "/Applications/Tide Terminal.app/Contents/Resources/crates/tide-app/resources/bin";
  const result = resolveAugmentedPath({
    platform: "darwin",
    currentPath: "/usr/bin:/bin",
    homeDir: "/Users/me",
    // The v1 wrapper dir is on the login-shell PATH when both products are installed.
    runShell: () => `${wrapperDir}:/Users/me/.local/bin:/usr/bin`,
  });

  const parts = result.split(":");
  assert.ok(
    !parts.includes(wrapperDir),
    "v2 must not resolve agents to the v1 Tide Terminal wrappers",
  );
  // The real CLI location is still present.
  assert.ok(parts.includes("/Users/me/.local/bin"));
});

test("falls_back_to_common_bins_when_the_login_shell_cannot_be_read", () => {
  const result = resolveAugmentedPath({
    platform: "darwin",
    currentPath: "/usr/bin:/bin:/usr/sbin:/sbin",
    homeDir: "/Users/me",
    runShell: () => {
      throw new Error("shell unavailable");
    },
  });

  const parts = result.split(":");
  assert.ok(parts.includes("/Users/me/.local/bin"));
  assert.ok(parts.includes("/opt/homebrew/bin"));
  assert.ok(parts.includes("/usr/local/bin"));
  // Original entries are preserved.
  assert.ok(parts.includes("/usr/bin"));
});

test("windows_path_is_left_unchanged", () => {
  const current = "C:\\Windows\\System32;C:\\Users\\me\\bin";
  const result = resolveAugmentedPath({
    platform: "win32",
    currentPath: current,
    runShell: () => "should-not-be-used",
  });
  assert.equal(result, current);
});
