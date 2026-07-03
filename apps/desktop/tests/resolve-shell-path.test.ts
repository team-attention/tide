import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultWorkbenchTerminalCommand,
  resolveAugmentedEnvironment,
  resolveAugmentedPath,
  resolveWorkbenchTerminalEnvironment,
} from "../src/backend/infrastructure/node/live/resolve-shell-path.ts";

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

test("default_workbench_terminal_uses_platform_shell_fallbacks", () => {
  assert.equal(
    defaultWorkbenchTerminalCommand({
      platform: "darwin",
      env: { SHELL: "/bin/zsh" },
    }),
    "/bin/zsh",
  );
  assert.equal(
    defaultWorkbenchTerminalCommand({
      platform: "win32",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    }),
    "C:\\Windows\\System32\\cmd.exe",
  );
  assert.equal(
    defaultWorkbenchTerminalCommand({
      platform: "win32",
      env: {},
    }),
    "cmd.exe",
  );
});

test("login_shell_auth_environment_is_imported_for_provider_runtimes", () => {
  const result = resolveAugmentedEnvironment({
    platform: "darwin",
    currentEnv: {
      HOME: "/Users/me",
      PATH: "/usr/bin:/bin",
      TIDE_APP_DATA_ROOT: "/tmp/tide-app",
      ELECTRON_RUN_AS_NODE: "1",
    },
    runShellEnv: () => ({
      PATH: "/Users/me/.local/bin:/opt/homebrew/bin:/usr/bin",
      GH_TOKEN: "shell-gh-token",
      GITHUB_TOKEN: "shell-github-token",
      SSH_AUTH_SOCK: "/private/tmp/ssh-agent.sock",
      XDG_CONFIG_HOME: "/Users/me/.config",
      AWS_PROFILE: "work",
      KUBECONFIG: "/Users/me/.kube/config",
      PNPM_HOME: "/Users/me/Library/pnpm",
      CUSTOM_PROJECT_ENV: "from-shell",
      PWD: "/wrong-cwd",
      TIDE_APP_DATA_ROOT: "/wrong",
      ELECTRON_RUN_AS_NODE: "0",
    }),
  });

  assert.equal(result.GH_TOKEN, "shell-gh-token");
  assert.equal(result.GITHUB_TOKEN, "shell-github-token");
  assert.equal(result.SSH_AUTH_SOCK, "/private/tmp/ssh-agent.sock");
  assert.equal(result.XDG_CONFIG_HOME, "/Users/me/.config");
  assert.equal(result.AWS_PROFILE, "work");
  assert.equal(result.KUBECONFIG, "/Users/me/.kube/config");
  assert.equal(result.PNPM_HOME, "/Users/me/Library/pnpm");
  assert.equal(result.CUSTOM_PROJECT_ENV, "from-shell");
  assert.equal(result.PWD, undefined);
  assert.equal(result.TIDE_APP_DATA_ROOT, "/tmp/tide-app");
  assert.equal(result.ELECTRON_RUN_AS_NODE, "1");
  assert.ok(result.PATH?.split(":").includes("/Users/me/.local/bin"));
});

test("interactive_login_shell_environment_is_preferred_for_provider_runtimes", () => {
  const modes: string[] = [];
  const result = resolveAugmentedEnvironment({
    platform: "darwin",
    currentEnv: {
      HOME: "/Users/me",
      PATH: "/usr/bin:/bin",
    },
    runShellEnv: (_shell, mode) => {
      modes.push(mode);
      if (mode === "interactive_login") {
        return {
          PATH: "/Users/me/.local/bin:/interactive/bin:/usr/bin",
          GH_TOKEN: "interactive-token",
          CODEX_HOME: "/Users/me/.codex",
        };
      }
      return {
        PATH: "/login/bin:/usr/bin",
        GH_TOKEN: "login-token",
        CODEX_HOME: "/Users/me/.codex-login",
      };
    },
  });

  assert.deepEqual(modes, ["interactive_login"]);
  assert.equal(result.GH_TOKEN, "interactive-token");
  assert.equal(result.CODEX_HOME, "/Users/me/.codex");
  assert.ok(result.PATH?.split(":").includes("/interactive/bin"));
});

test("augmented_environment_reads_shell_environment_from_the_launch_cwd", () => {
  const cwds: Array<string | undefined> = [];
  const inheritedPaths: Array<string | undefined> = [];
  const result = resolveAugmentedEnvironment({
    platform: "darwin",
    currentEnv: {
      HOME: "/Users/me",
      PATH: "/usr/bin:/bin",
    },
    cwd: "/Users/me/project",
    runShellEnv: (_shell, _mode, cwd, env) => {
      cwds.push(cwd);
      inheritedPaths.push(env.PATH);
      return {
        PATH: "/Users/me/project/.direnv/bin:/usr/bin",
        PROJECT_ENV: "from-direnv",
      };
    },
  });

  assert.deepEqual(cwds, ["/Users/me/project"]);
  assert.deepEqual(inheritedPaths, ["/usr/bin:/bin"]);
  assert.equal(result.PROJECT_ENV, "from-direnv");
  assert.ok(result.PATH?.split(":").includes("/Users/me/project/.direnv/bin"));
});

test("augmented_environment_falls_back_to_login_shell_when_interactive_shell_fails", () => {
  const modes: string[] = [];
  const result = resolveAugmentedEnvironment({
    platform: "darwin",
    currentEnv: {
      HOME: "/Users/me",
      PATH: "/usr/bin:/bin",
    },
    runShellEnv: (_shell, mode) => {
      modes.push(mode);
      if (mode === "interactive_login") {
        throw new Error("interactive shell startup timed out");
      }
      return {
        PATH: "/Users/me/.local/bin:/login/bin:/usr/bin",
        GH_TOKEN: "login-token",
      };
    },
  });

  assert.deepEqual(modes, ["interactive_login", "login"]);
  assert.equal(result.GH_TOKEN, "login-token");
  assert.ok(result.PATH?.split(":").includes("/login/bin"));
});

test("augmented_environment_falls_back_to_current_env_when_shell_env_fails", () => {
  const result = resolveAugmentedEnvironment({
    platform: "darwin",
    currentEnv: {
      HOME: "/Users/me",
      PATH: "/usr/bin:/bin",
      GH_TOKEN: "current-token",
    },
    runShellEnv: () => {
      throw new Error("shell unavailable");
    },
  });

  assert.equal(result.GH_TOKEN, "current-token");
  assert.ok(result.PATH?.split(":").includes("/opt/homebrew/bin"));
});

test("workbench_terminal_environment_uses_current_env_without_shell_snapshot", () => {
  const result = resolveWorkbenchTerminalEnvironment({
    platform: "darwin",
    currentEnv: {
      HOME: "/Users/me",
      PATH: "/usr/bin:/bin",
      GH_TOKEN: "already-imported",
    },
  });

  assert.equal(result.GH_TOKEN, "already-imported");
  assert.ok(result.PATH?.split(":").includes("/Users/me/.local/bin"));
  assert.ok(result.PATH?.split(":").includes("/opt/homebrew/bin"));
});
