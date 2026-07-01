import { app, ipcMain } from "electron";
import { readdirSync, readFileSync } from "node:fs";
import {
  discoverProviderCommands,
  type CommandFs,
} from "./provider-command-discovery.ts";

// Real provider slash-commands/skills for a cwd, read from the providers' files
// (no provider spawn). See docs_v2/specs/provider-command-discovery.md.
const commandDiscoveryFs: CommandFs = {
  listFiles: (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
    } catch {
      return [];
    }
  },
  listDirs: (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  },
  readText: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  },
};

// Instant, offline first paint for the composer command menu: the cwd's command
// + skill FILES (no provider spawn). The agent's REAL full command set replaces
// this when the backend's handshake probe returns (provider.discoverCommands ->
// agentRuntime.commandsChanged). See docs_v2/specs/live-provider-command-mirroring.md.
export function registerProviderCommandIpc(): void {
  ipcMain.handle("tide:list-commands", (_event, cwd: unknown, agentId: unknown) => {
    if (typeof cwd !== "string" || cwd.length === 0 || typeof agentId !== "string") {
      return [];
    }
    return discoverProviderCommands({
      cwd,
      homeDir: app.getPath("home"),
      agentId,
      fs: commandDiscoveryFs,
    });
  });
}
