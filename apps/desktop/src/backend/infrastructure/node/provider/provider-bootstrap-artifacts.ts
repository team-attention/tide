import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Tide's per-machine bootstrap for the provider CLIs. Since the agents run on
// their structured protocols (claude stream-json / codex app-server / opencode
// ACP), the ONLY thing Tide must inject is its MCP Tool Surface — there are no
// more hooks, signal spool, or config overlays. See
// docs_v2/specs/structured-agent-runtime.md.
//
// - tide-mcp-stdio: a tiny wrapper that runs `<tide> backend-entrypoint mcp`
//   under ELECTRON_RUN_AS_NODE. claude attaches it via --mcp-config; codex
//   attaches it via `-c mcp_servers.tide.*` argv (so codex needs no generated
//   config overlay and keeps provider-native Codex home behavior).
// - claude mcp.json + settings.json (settings only pre-allows the tide MCP
//   server; no hooks).

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
  // Default Codex home path. The runtime does not inject CODEX_HOME; if the
  // user's shell sets it, the shell environment snapshot wins.
  codexHome: string;
  claudeMcpConfigPath: string;
  claudeSettingsPath: string;
}

export function providerBootstrapArtifactsForHome(
  input: ProviderBootstrapArtifactsInput,
): ProviderBootstrapArtifacts {
  const rootDir = input.rootDir ?? join(input.homeDir, ".tide", "agent-bootstrap");
  const tideCommand = input.tideCommand ?? process.env.TIDE_BIN ?? process.execPath;
  const tideMcpEntrypoint =
    input.tideMcpEntrypoint ?? process.env.TIDE_MCP_ENTRYPOINT ?? "backend-entrypoint.js";

  return {
    rootDir,
    tideCommand,
    tideMcpCommandPath: join(rootDir, "tide-mcp-stdio"),
    tideMcpEntrypoint,
    codexHome: join(input.homeDir, ".codex"),
    claudeMcpConfigPath: join(rootDir, "claude", "mcp.json"),
    claudeSettingsPath: join(rootDir, "claude", "settings.json"),
  };
}

export function ensureProviderBootstrapArtifacts(
  input: ProviderBootstrapArtifactsInput,
): ProviderBootstrapArtifacts {
  const artifacts = providerBootstrapArtifactsForHome(input);
  mkdirSync(artifacts.rootDir, { recursive: true });
  writeFileSync(artifacts.tideMcpCommandPath, tideMcpCommandScript(artifacts), {
    encoding: "utf8",
    mode: 0o755,
  });
  ensureClaudeArtifacts(input, artifacts);
  return artifacts;
}

// The Tide MCP bridge is the one bootstrap an agent needs before it can start.
export function isMcpBootstrapReady(artifacts: ProviderBootstrapArtifacts): boolean {
  return existsSync(artifacts.tideMcpCommandPath);
}

export function isClaudeBootstrapReady(artifacts: ProviderBootstrapArtifacts): boolean {
  return existsSync(artifacts.claudeMcpConfigPath) && existsSync(artifacts.claudeSettingsPath);
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
    // Tide's own MCP tools are first-party and trusted (we inject this server), so
    // pre-allow the whole `tide` server — no per-tool permission prompt. Other tools
    // keep claude's native permission flow.
    permissions: {
      allow: ["mcp__tide"],
    },
  });
}

function tideMcpCommandScript(artifacts: ProviderBootstrapArtifacts): string {
  return `#!/usr/bin/env sh
ELECTRON_RUN_AS_NODE=1 exec ${shellWord(artifacts.tideCommand)} ${shellWord(artifacts.tideMcpEntrypoint)} mcp "$@"
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
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function shellWord(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
