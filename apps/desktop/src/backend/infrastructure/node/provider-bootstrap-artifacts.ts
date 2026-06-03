import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export interface ProviderBootstrapArtifactsInput {
  homeDir: string;
  rootDir?: string;
  tideCommand?: string;
  tideMcpEntrypoint?: string;
  tideSocket?: string;
  tidePane?: string;
  tideWindow?: string;
}

export interface ProviderBootstrapArtifacts {
  rootDir: string;
  tideCommand: string;
  tideMcpCommandPath: string;
  tideMcpEntrypoint: string;
  providerSignalRunnerPath: string;
  codexHome: string;
  codexHooksPath: string;
  codexSkillPath: string;
  claudeMcpConfigPath: string;
  claudeSettingsPath: string;
  antigravityPluginSourcePath: string;
  antigravityInstalledPluginPath: string;
  providerSignalHookPath: string;
  providerSignalSpoolDir: string;
}

export function providerBootstrapArtifactsForHome(
  input: ProviderBootstrapArtifactsInput,
): ProviderBootstrapArtifacts {
  const rootDir = input.rootDir ?? join(input.homeDir, ".tide", "agent-bootstrap");
  const tideCommand = input.tideCommand ?? process.env.TIDE_BIN ?? process.execPath;
  const tideMcpEntrypoint =
    input.tideMcpEntrypoint ?? process.env.TIDE_MCP_ENTRYPOINT ?? "backend-entrypoint.js";
  const codexHome = join(rootDir, "codex", "home");
  const antigravityPluginSourcePath = join(
    rootDir,
    "antigravity",
    "tide-bootstrap",
  );

  return {
    rootDir,
    tideCommand,
    tideMcpCommandPath: join(rootDir, "tide-mcp-stdio"),
    tideMcpEntrypoint,
    providerSignalRunnerPath: join(rootDir, "provider-signal-runner"),
    codexHome,
    codexHooksPath: join(codexHome, "hooks.json"),
    codexSkillPath: join(codexHome, "skills", "tide", "SKILL.md"),
    claudeMcpConfigPath: join(rootDir, "claude", "mcp.json"),
    claudeSettingsPath: join(rootDir, "claude", "settings.json"),
    antigravityPluginSourcePath,
    antigravityInstalledPluginPath: join(
      input.homeDir,
      ".gemini",
      "config",
      "plugins",
      "tide",
    ),
    providerSignalHookPath: join(rootDir, "provider-signal-hook.mjs"),
    providerSignalSpoolDir: join(rootDir, "provider-signals"),
  };
}

export function ensureProviderBootstrapArtifacts(
  input: ProviderBootstrapArtifactsInput,
): ProviderBootstrapArtifacts {
  const artifacts = providerBootstrapArtifactsForHome(input);
  mkdirSync(artifacts.rootDir, { recursive: true });
  mkdirSync(artifacts.providerSignalSpoolDir, { recursive: true });
  writeFileSync(artifacts.tideMcpCommandPath, tideMcpCommandScript(artifacts), {
    encoding: "utf8",
    mode: 0o755,
  });
  writeFileSync(
    artifacts.providerSignalRunnerPath,
    providerSignalRunnerScript(artifacts),
    {
      encoding: "utf8",
      mode: 0o755,
    },
  );
  writeFileSync(artifacts.providerSignalHookPath, providerSignalHookScript(), {
    encoding: "utf8",
    mode: 0o755,
  });
  ensureCodexOverlay(input.homeDir, artifacts);
  ensureClaudeArtifacts(input, artifacts);
  ensureAntigravityPluginSource(input, artifacts);
  return artifacts;
}

export function isCodexBootstrapReady(
  artifacts: ProviderBootstrapArtifacts,
): boolean {
  return existsSync(artifacts.codexHooksPath) && existsSync(artifacts.codexSkillPath);
}

export function isClaudeBootstrapReady(
  artifacts: ProviderBootstrapArtifacts,
): boolean {
  return (
    existsSync(artifacts.claudeMcpConfigPath) &&
    existsSync(artifacts.claudeSettingsPath)
  );
}

export function isAntigravityPluginBootstrapReady(
  artifacts: ProviderBootstrapArtifacts,
): boolean {
  return (
    existsSync(join(artifacts.antigravityInstalledPluginPath, "plugin.json")) &&
    existsSync(join(artifacts.antigravityInstalledPluginPath, "hooks.json")) &&
    existsSync(join(artifacts.antigravityInstalledPluginPath, "mcp_config.json"))
  );
}

function ensureCodexOverlay(
  homeDir: string,
  artifacts: ProviderBootstrapArtifacts,
): void {
  const realCodexHome = join(homeDir, ".codex");
  mkdirSync(artifacts.codexHome, { recursive: true });
  // D17: Tide owns only these overlay entries; everything else in the user's real
  // ~/.codex is mirrored in by symlink so Codex sees its full home — including its
  // version-suffixed sqlite state DBs (state_*/goals_*/logs_*/memories_*.sqlite),
  // whose names change across releases. Mirror dynamically (like the v1 wrapper)
  // instead of a fixed allow-list, which goes stale and makes Codex refuse to
  // start with "its local database appears to be damaged".
  const tideOwnedCodexEntries = new Set(["config.toml", "hooks.json", "skills"]);
  removeUnlistedEntries(
    artifacts.codexHome,
    new Set([...tideOwnedCodexEntries, ...directoryEntryNames(realCodexHome)]),
  );
  linkUnownedDirectoryEntries(
    realCodexHome,
    artifacts.codexHome,
    tideOwnedCodexEntries,
  );
  const nextCodexHooks = codexHooksConfig(artifacts);
  const previousCodexHooksText = readOptionalText(artifacts.codexHooksPath);
  writeCodexConfigOverlay(
    realCodexHome,
    artifacts.codexHome,
    previousCodexHooksText === jsonFileText(nextCodexHooks),
  );

  const skillsDir = join(artifacts.codexHome, "skills");
  mkdirSync(skillsDir, { recursive: true });
  removeUnlistedEntries(skillsDir, new Set(["tide"]));
  mkdirSync(join(skillsDir, "tide"), { recursive: true });
  writeFileSync(artifacts.codexSkillPath, tideContextSkill(), "utf8");
  writeJsonFile(artifacts.codexHooksPath, nextCodexHooks);
}

function writeCodexConfigOverlay(
  realCodexHome: string,
  codexHome: string,
  preserveExistingHookTrust = true,
): void {
  const configPath = join(codexHome, "config.toml");
  const existingOverlay = readOptionalText(configPath);
  unlinkIfSymlink(configPath);
  writeFileSync(
    configPath,
    withPreservedCodexHookTrust(
      codexConfigOverlayText(join(realCodexHome, "config.toml")),
      preserveExistingHookTrust ? existingOverlay : undefined,
      join(codexHome, "hooks.json"),
    ),
    "utf8",
  );
}

function codexHooksConfig(artifacts: ProviderBootstrapArtifacts): unknown {
  return {
    hooks: {
      UserPromptSubmit: [
        commandHookGroup(providerNotifyCommand(artifacts, "codex", "agent-running")),
      ],
      PermissionRequest: [
        commandHookGroup(
          providerNotifyCommand(artifacts, "codex", "agent-needs-input"),
          "Bash",
        ),
      ],
      Stop: [
        commandHookGroup(providerNotifyCommand(artifacts, "codex", "codex-stop")),
      ],
    },
  };
}

function codexConfigOverlayText(realConfigPath: string): string {
  let source = "";
  try {
    source = readFileSync(realConfigPath, "utf8");
  } catch {
    return "";
  }

  const output: string[] = [];
  let includeSection = true;
  let inRoot = true;
  for (const line of source.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/)?.[1];
    if (section !== undefined) {
      inRoot = false;
      includeSection =
        section.startsWith("projects.") ||
        section === "tui.model_availability_nux";
    }

    if (section === undefined && inRoot) {
      if (
        line.startsWith("model = ") ||
        line.startsWith("model_reasoning_effort = ")
      ) {
        output.push(line);
      }
      continue;
    }

    if (includeSection) {
      output.push(line);
    }
  }

  return output.filter((line, index, lines) => {
    return line.length > 0 || lines[index - 1]?.length !== 0;
  }).join("\n").trimEnd() + "\n";
}

function withPreservedCodexHookTrust(
  baseConfig: string,
  existingOverlay: string | undefined,
  hooksPath: string,
): string {
  const hookTrust = codexHookTrustSections(existingOverlay, hooksPath);
  if (hookTrust.length === 0) {
    return baseConfig;
  }

  const trimmedBase = baseConfig.trimEnd();
  return `${trimmedBase}${trimmedBase.length > 0 ? "\n\n" : ""}${hookTrust.join("\n\n")}\n`;
}

function codexHookTrustSections(
  existingOverlay: string | undefined,
  hooksPath: string,
): string[] {
  if (existingOverlay === undefined) {
    return [];
  }

  const sections: string[] = [];
  let active: string[] | undefined;
  for (const line of existingOverlay.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/)?.[1];
    if (section !== undefined) {
      if (active !== undefined) {
        sections.push(active.join("\n").trimEnd());
      }
      active = section.startsWith(`hooks.state."${hooksPath}:`)
        ? [line]
        : undefined;
      continue;
    }

    active?.push(line);
  }

  if (active !== undefined) {
    sections.push(active.join("\n").trimEnd());
  }

  return sections.filter((section) => section.includes("trusted_hash"));
}

function readOptionalText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function unlinkIfSymlink(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      unlinkSync(path);
    }
  } catch {
    return;
  }
}

function ensureClaudeArtifacts(
  input: ProviderBootstrapArtifactsInput,
  artifacts: ProviderBootstrapArtifacts,
): void {
  mkdirSync(join(artifacts.rootDir, "claude"), { recursive: true });
  writeJsonFile(artifacts.claudeMcpConfigPath, {
    mcpServers: {
      tide: {
        type: "stdio",
        command: artifacts.tideMcpCommandPath,
        args: [],
        env: tideMcpEnv(input),
      },
    },
  });
  writeJsonFile(artifacts.claudeSettingsPath, {
    hooks: {
      UserPromptSubmit: [
        claudeHook(providerNotifyCommand(artifacts, "claude", "agent-running")),
      ],
      PermissionRequest: [
        claudeHook(providerNotifyCommand(artifacts, "claude", "agent-needs-input")),
      ],
      PreToolUse: [
        claudeHook(providerNotifyCommand(artifacts, "claude", "agent-needs-input")),
      ],
      Elicitation: [
        claudeHook(providerNotifyCommand(artifacts, "claude", "agent-needs-input")),
      ],
      Notification: [
        claudeHook(providerNotifyCommand(artifacts, "claude", "agent-needs-input")),
      ],
      Stop: [claudeHook(providerNotifyCommand(artifacts, "claude", "agent-idle"))],
    },
  });
}

function ensureAntigravityPluginSource(
  input: ProviderBootstrapArtifactsInput,
  artifacts: ProviderBootstrapArtifacts,
): void {
  mkdirSync(artifacts.antigravityPluginSourcePath, { recursive: true });
  writeJsonFile(join(artifacts.antigravityPluginSourcePath, "plugin.json"), {
    name: "tide",
    version: "0.1.0",
    description: "Tide Provider Signal and MCP bootstrap for Antigravity CLI.",
  });
  writeJsonFile(join(artifacts.antigravityPluginSourcePath, "mcp_config.json"), {
    mcpServers: {
      tide: {
        command: artifacts.tideMcpCommandPath,
        args: [],
        env: tideMcpEnv(input),
      },
    },
  });
  writeJsonFile(join(artifacts.antigravityPluginSourcePath, "hooks.json"), {
    hooks: {
      PreInvocation: [
        antigravityHook(providerNotifyCommand(artifacts, "antigravity", "agent-running")),
      ],
      PreToolUse: [
        antigravityHook(
          providerNotifyCommand(artifacts, "antigravity", "agent-needs-input"),
        ),
      ],
      PostToolUse: [
        antigravityHook(providerNotifyCommand(artifacts, "antigravity", "agent-running")),
      ],
      PostInvocation: [
        antigravityHook(providerNotifyCommand(artifacts, "antigravity", "agent-running")),
      ],
      Stop: [
        antigravityHook(providerNotifyCommand(artifacts, "antigravity", "agent-idle")),
      ],
    },
  });
}

function removeUnlistedEntries(
  directory: string,
  allowedNames: Set<string>,
): void {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (allowedNames.has(entry.name)) {
      continue;
    }
    const entryPath = join(directory, entry.name);
    try {
      rmSync(entryPath, { recursive: true, force: true });
    } catch {
      // Stale overlay cleanup is best-effort.
    }
  }
}

function directoryEntryNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function linkUnownedDirectoryEntries(
  sourceDir: string,
  destinationDir: string,
  ownedNames: Set<string>,
): void {
  let entries;
  try {
    entries = readdirSync(sourceDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (ownedNames.has(entry.name)) {
      continue;
    }
    ensureSymlink(join(sourceDir, entry.name), join(destinationDir, entry.name));
  }
}

function ensureSymlink(sourcePath: string, destinationPath: string): void {
  try {
    const existing = lstatSync(destinationPath);
    if (existing.isSymbolicLink() && readlinkSync(destinationPath) !== sourcePath) {
      unlinkSync(destinationPath);
      symlinkSync(sourcePath, destinationPath);
    }
    return;
  } catch {
    symlinkSync(sourcePath, destinationPath);
  }
}

function commandHookGroup(command: string, matcher?: string) {
  return {
    ...(matcher === undefined ? {} : { matcher }),
    hooks: [{ type: "command", command }],
  };
}

function claudeHook(command: string) {
  return {
    matcher: "",
    hooks: [{ type: "command", command }],
  };
}

function antigravityHook(command: string) {
  return {
    hooks: [{ type: "command", command }],
  };
}

function providerNotifyCommand(
  artifacts: ProviderBootstrapArtifacts,
  agent: "codex" | "claude" | "antigravity",
  event: string,
): string {
  return `${shellWord(artifacts.providerSignalRunnerPath)} --agent ${agent} --event ${event} >/dev/null 2>&1 || true`;
}

function tideMcpCommandScript(artifacts: ProviderBootstrapArtifacts): string {
  return `#!/usr/bin/env sh
ELECTRON_RUN_AS_NODE=1 exec ${shellWord(artifacts.tideCommand)} ${shellWord(artifacts.tideMcpEntrypoint)} mcp "$@"
`;
}

function providerSignalRunnerScript(artifacts: ProviderBootstrapArtifacts): string {
  return `#!/usr/bin/env sh
TIDE_PROVIDER_SIGNAL_DIR=${shellWord(artifacts.providerSignalSpoolDir)} ELECTRON_RUN_AS_NODE=1 exec ${shellWord(artifacts.tideCommand)} ${shellWord(artifacts.providerSignalHookPath)} "$@"
`;
}

function tideMcpEnv(input: ProviderBootstrapArtifactsInput): Record<string, string> {
  const env: Record<string, string> = {};
  if (input.tideSocket !== undefined) {
    env.TIDE_SOCKET = input.tideSocket;
  }
  if (input.tidePane !== undefined) {
    env.TIDE_PANE = input.tidePane;
  }
  if (input.tideWindow !== undefined) {
    env.TIDE_WINDOW = input.tideWindow;
  }
  return env;
}

function writeJsonFile(path: string, value: unknown): void {
  writeFileSync(path, jsonFileText(value), "utf8");
}

function jsonFileText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function shellWord(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function tideContextSkill(): string {
  return `---
name: tide
description: Use when Codex is running inside Tide and the user asks to open, show, view, browse, inspect, preview, navigate to, or display a file, URL, webpage, local server, Pane, or Tide surface.
---

# Tide

You are running inside Tide.

Prefer Tide MCP tools when they are available:

- Use tide_open_browser for URLs, webpages, local previews, and browser inspection inside a Tide Browser Pane.
- Use tide_observe_thread before you need Thread, Agent Chat, prompt, or Workbench-open state.
- Use tide_observe_workbench before you need current Workbench Pane identity or visible support context.
- Use tide_observe_browser before acting on a Browser Pane revision.
- Use tide_read_file and tide_open_file for text files inside the active Execution Context.
- Use tide_edit_file for exact replacements that should expose a visible Diff Pane.
- Use tide_go_to_definition when you have an Editor Pane id and need to navigate from a cursor position to a definition.
- Use tide_open_terminal when the user needs a visible interactive Terminal Pane.
- Use tide_run_terminal_command for bounded non-interactive commands that should expose visible Terminal Pane evidence.

Use the external OS opener only when the user explicitly asks for the default app or external browser.
`;
}

function providerSignalHookScript(): string {
  return `#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (key !== undefined && key.startsWith("--") && value !== undefined) {
    args.set(key.slice(2), value);
  }
}

const spoolDir = process.env.TIDE_PROVIDER_SIGNAL_DIR;
const runtimeId = process.env.TIDE_RUNTIME_ID;
if (spoolDir === undefined || runtimeId === undefined) {
  process.exit(0);
}

let payloadText = "";
try {
  payloadText = readFileSync(0, "utf8");
} catch {
  payloadText = "";
}

let payload;
try {
  payload = payloadText.trim().length === 0 ? {} : JSON.parse(payloadText);
} catch {
  payload = { text: payloadText };
}

const record = {
  receivedAt: new Date().toISOString(),
  agent: args.get("agent") ?? process.env.TIDE_AGENT_ID,
  event: args.get("event") ?? "unknown",
  threadId: process.env.TIDE_THREAD_ID,
  runtimeId,
  payload,
};

mkdirSync(spoolDir, { recursive: true });
appendFileSync(join(spoolDir, runtimeId + ".jsonl"), JSON.stringify(record) + "\\n", "utf8");
`;
}
