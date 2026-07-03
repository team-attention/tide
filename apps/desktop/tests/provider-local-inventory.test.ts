import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { providerCapabilityCatalogFromLocalInventory } from "../src/backend/adapters/outbound/agent-integrations/provider-capability-catalog.ts";
import { readLocalProviderInventoryFromHome } from "../src/backend/infrastructure/node/provider/provider-local-inventory.ts";

test("local provider inventory reads Codex skills, plugins, and MCP servers", () => {
  const home = mkdtempSync(join(tmpdir(), "tide-provider-inventory-"));
  try {
    writeFile(
      join(home, ".codex", "plugins", "codex-apps", "plugin.json"),
      JSON.stringify({ name: "codex-apps" }),
    );
    writeFile(
      join(home, ".codex", "skills", "impeccable", "SKILL.md"),
      "---\nname: impeccable\ndescription: Polish UI\n---\n",
    );
    writeFile(
      join(home, ".codex", "config.toml"),
      '[mcp_servers.paper]\nurl = "http://127.0.0.1:29979/mcp"\n',
    );

    const inventory = readLocalProviderInventoryFromHome({ homeDir: home });
    const codexCapabilities = providerCapabilityCatalogFromLocalInventory("codex", inventory);

    assert.deepEqual(
      inventory
        .filter((item) => item.agentId === "codex")
        .map((item) => `${item.kind}:${item.label}`)
        .sort(),
      ["mcp:paper", "plugin:codex-apps", "skill:impeccable"],
    );
    assert.deepEqual(
      codexCapabilities.map((capability) => ({
        id: capability.capabilityId,
        source: capability.source,
        group: capability.group,
        label: capability.label,
        invoke: capability.invoke.kind,
      })),
      [
        {
          id: "codex:local:mcp:paper",
          source: "tide_local",
          group: "mcp",
          label: "MCP: paper",
          invoke: "unsupported",
        },
        {
          id: "codex:local:plugin:codex-apps",
          source: "tide_local",
          group: "setup",
          label: "Plugin: codex-apps",
          invoke: "unsupported",
        },
        {
          id: "codex:local:skill:impeccable",
          source: "tide_local",
          group: "setup",
          label: "Skill: impeccable",
          invoke: "unsupported",
        },
      ],
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("local provider inventory reads Claude installed plugins and opencode plugin config", () => {
  const home = mkdtempSync(join(tmpdir(), "tide-provider-inventory-"));
  try {
    writeFile(
      join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "rust-analyzer-lsp@claude-plugins-official": [
            {
              installPath: join(home, ".claude", "plugins", "cache", "rust-analyzer-lsp"),
              version: "1.0.0",
            },
          ],
        },
      }),
    );
    writeFile(
      join(home, ".config", "opencode", "plugin", "tokentracker.js"),
      "export default {}\n",
    );
    writeFile(
      join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({ mcp: { pencil: { enabled: true, type: "local" } } }),
    );

    const inventory = readLocalProviderInventoryFromHome({ homeDir: home });
    const claudeCapabilities = providerCapabilityCatalogFromLocalInventory("claude", inventory);
    const opencodeCapabilities = providerCapabilityCatalogFromLocalInventory("opencode", inventory);

    assert.equal(claudeCapabilities[0]?.capabilityId, "claude:local:plugin:rust-analyzer-lsp@claude-plugins-official:0");
    assert.equal(claudeCapabilities[0]?.source, "tide_local");
    assert.match(claudeCapabilities[0]?.description ?? "", /version 1\.0\.0/);
    assert.deepEqual(
      opencodeCapabilities.map((capability) => ({
        id: capability.capabilityId,
        group: capability.group,
        label: capability.label,
      })),
      [
        { id: "opencode:local:mcp:pencil", group: "mcp", label: "MCP: pencil" },
        { id: "opencode:local:plugin:tokentracker", group: "setup", label: "Plugin: tokentracker" },
      ],
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

function writeFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}
