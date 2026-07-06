import { existsSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import type { LocalProviderInventoryItem } from "../../../application/domains/native-agent/provider-local-inventory.ts";
import { readJsonFile, readTextFile } from "../live/live-backend-fs.ts";
import { recordField, stringField } from "../live/live-backend-json.ts";

export function readLocalProviderInventoryFromHome(input: {
  homeDir: string;
  codexHome?: string;
}): LocalProviderInventoryItem[] {
  return [
    ...readCodexLocalInventory(input.homeDir, input.codexHome),
    ...readClaudeLocalInventory(input.homeDir),
    ...readOpencodeLocalInventory(input.homeDir),
  ];
}

function readCodexLocalInventory(homeDir: string, codexHome?: string): LocalProviderInventoryItem[] {
  const root = codexHome ?? join(homeDir, ".codex");
  return [
    ...readDirectoryInventory({
      agentId: "codex",
      kind: "plugin",
      root: join(root, "plugins"),
      manifestName: "plugin.json",
    }),
    ...readCodexSkills(join(root, "skills")),
    ...readMcpServersFromToml("codex", join(root, "config.toml")),
  ];
}

function readClaudeLocalInventory(homeDir: string): LocalProviderInventoryItem[] {
  const pluginsRoot = join(homeDir, ".claude", "plugins");
  return [
    ...readClaudeInstalledPlugins(join(pluginsRoot, "installed_plugins.json")),
    ...readDirectoryInventory({
      agentId: "claude",
      kind: "plugin",
      root: join(pluginsRoot, "data"),
    }),
    ...readMcpServersFromJson("claude", join(homeDir, ".claude", "settings.json")),
    ...readMcpServersFromJson("claude", join(homeDir, ".claude.json")),
  ];
}

function readOpencodeLocalInventory(homeDir: string): LocalProviderInventoryItem[] {
  const configRoot = join(homeDir, ".config", "opencode");
  return [
    ...readOpencodePluginDirectory(join(configRoot, "plugin")),
    ...readMcpServersFromJson("opencode", join(configRoot, "opencode.json")),
  ];
}

function readDirectoryInventory(input: {
  agentId: LocalProviderInventoryItem["agentId"];
  kind: LocalProviderInventoryItem["kind"];
  root: string;
  manifestName?: string;
}): LocalProviderInventoryItem[] {
  if (!isDirectory(input.root)) {
    return [];
  }
  return safeReaddir(input.root)
    .filter((entry) => !entry.startsWith("."))
    .map((entry): LocalProviderInventoryItem | null => {
      const path = join(input.root, entry);
      if (!isDirectory(path)) {
        return null;
      }
      if (input.manifestName !== undefined && !existsSync(join(path, input.manifestName))) {
        return null;
      }
      return {
        agentId: input.agentId,
        kind: input.kind,
        id: entry,
        label: entry,
        source: "local_file",
        path,
      };
    })
    .filter((item): item is LocalProviderInventoryItem => item !== null);
}

function readCodexSkills(root: string): LocalProviderInventoryItem[] {
  if (!isDirectory(root)) {
    return [];
  }
  return safeReaddir(root)
    .filter((entry) => !entry.startsWith("."))
    .map((entry): LocalProviderInventoryItem | null => {
      const path = join(root, entry, "SKILL.md");
      const contents = readTextFile(path);
      if (contents === undefined) {
        return null;
      }
      const frontmatter = parseSkillFrontmatter(contents);
      return {
        agentId: "codex",
        kind: "skill",
        id: entry,
        label: frontmatter.name ?? entry,
        source: "local_file",
        path,
        ...(frontmatter.description !== undefined ? { description: frontmatter.description } : {}),
      };
    })
    .filter((item): item is LocalProviderInventoryItem => item !== null);
}

function parseSkillFrontmatter(contents: string): { name?: string; description?: string } {
  if (!contents.startsWith("---")) {
    return {};
  }
  const end = contents.indexOf("\n---", 3);
  if (end === -1) {
    return {};
  }
  const frontmatter = contents.slice(3, end);
  const result: { name?: string; description?: string } = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }
    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();
    if (value.startsWith("\"") && value.endsWith("\"")) {
      value = value.slice(1, -1);
    }
    if (key === "name") {
      result.name = value;
    } else if (key === "description") {
      result.description = value;
    }
  }
  return result;
}

function readClaudeInstalledPlugins(path: string): LocalProviderInventoryItem[] {
  const manifest = readJsonFile(path);
  const plugins = recordField(manifest, "plugins");
  if (plugins === undefined) {
    return [];
  }
  return Object.entries(plugins).flatMap(([id, entries]) => {
    if (!Array.isArray(entries)) {
      return [];
    }
    return entries
      .map((entry, index): LocalProviderInventoryItem | null => {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          return null;
        }
        const record = entry as Record<string, unknown>;
        return {
          agentId: "claude",
          kind: "plugin",
          id: `${id}:${index}`,
          label: id,
          source: "local_file",
          path: stringField(record, "installPath") ?? path,
          version: stringField(record, "version"),
          nativePayload: record,
        };
      })
      .filter((item): item is LocalProviderInventoryItem => item !== null);
  });
}

function readOpencodePluginDirectory(root: string): LocalProviderInventoryItem[] {
  if (!isDirectory(root)) {
    return [];
  }
  return safeReaddir(root)
    .filter((entry) => !entry.startsWith("."))
    .map((entry): LocalProviderInventoryItem => ({
      agentId: "opencode",
      kind: "plugin",
      id: entry.replace(extname(entry), ""),
      label: entry.replace(extname(entry), ""),
      source: "local_file",
      path: join(root, entry),
    }));
}

function readMcpServersFromToml(
  agentId: LocalProviderInventoryItem["agentId"],
  path: string,
): LocalProviderInventoryItem[] {
  const contents = readTextFile(path);
  if (contents === undefined) {
    return [];
  }
  const names = new Set<string>();
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*\[mcp_servers\.([A-Za-z0-9_.-]+)\]\s*$/.exec(line);
    if (match?.[1] !== undefined) {
      names.add(match[1]);
    }
  }
  return [...names].map((name) => mcpInventoryItem(agentId, name, path));
}

function readMcpServersFromJson(
  agentId: LocalProviderInventoryItem["agentId"],
  path: string,
): LocalProviderInventoryItem[] {
  const config = readJsonFile(path);
  const mcp = recordField(config, "mcp") ?? recordField(config, "mcpServers");
  if (mcp === undefined) {
    return [];
  }
  return Object.keys(mcp).map((name) => {
    const payload = recordField(mcp, name);
    return mcpInventoryItem(agentId, name, path, payload);
  });
}

function mcpInventoryItem(
  agentId: LocalProviderInventoryItem["agentId"],
  name: string,
  path: string,
  nativePayload?: unknown,
): LocalProviderInventoryItem {
  const enabled = typeof nativePayload === "object" && nativePayload !== null && !Array.isArray(nativePayload)
    ? (nativePayload as { enabled?: unknown }).enabled
    : undefined;
  return {
    agentId,
    kind: "mcp",
    id: name,
    label: name,
    source: "local_file",
    path,
    ...(typeof enabled === "boolean" ? { enabled } : {}),
    ...(nativePayload !== undefined ? { nativePayload } : {}),
  };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path).sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}
