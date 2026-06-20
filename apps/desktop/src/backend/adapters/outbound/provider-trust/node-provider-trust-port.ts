import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { ProviderTrustPort } from "../../../application/ports/outbound/provider-trust-port.ts";

// Writes each provider's own trust store so the CLI treats the cwd as trusted on
// next launch. Mirrors the readers in live-backend.ts (claude .claude.json,
// codex config.toml).
//
// codexOverlayHome is Tide's overlaid CODEX_HOME (the one codex actually launches
// against). Its config.toml is a bootstrap-time SNAPSHOT of the real config's trust,
// so a trust written only to the real ~/.codex/config.toml is invisible to the running
// codex. So codex trust is written to BOTH the real
// config (readiness reads it; persists for the next bootstrap) and the overlay config
// (the running session reads it). See docs_v2/specs/scratch-execution-context.md.
export function createNodeProviderTrustPort(
  homeDir?: string,
  codexOverlayHome?: string,
): ProviderTrustPort {
  const home = homeDir ?? homedir();
  return {
    async trust(input: { agentId: string; cwd: string }): Promise<void> {
      // A provider's trust check is a case/symlink-SENSITIVE string match against
      // the cwd its process resolves via getcwd() — the canonical on-disk path.
      // Tide may hold a different spelling (macOS /var -> /private/var, case-
      // insensitive FS casing), so trust BOTH spellings or the provider can still
      // block on a trust dialog/setup gate. realpathSync.native returns the true
      // kernel path (plain realpathSync does not fix casing on macOS).
      for (const cwd of cwdSpellings(input.cwd)) {
        switch (input.agentId) {
          case "claude":
            trustClaude(home, cwd);
            break;
          case "codex":
            trustCodex(home, cwd, codexOverlayHome);
            break;
          default:
            return;
        }
      }
    },
  };
}

function cwdSpellings(cwd: string): string[] {
  try {
    const canonical = realpathSync.native(cwd);
    return canonical === cwd ? [cwd] : [cwd, canonical];
  } catch {
    return [cwd];
  }
}

function trustClaude(home: string, cwd: string): void {
  const path = join(home, ".claude.json");
  const state = readJson(path) ?? {};
  const projects = isRecord(state.projects) ? state.projects : {};
  const project = isRecord(projects[cwd]) ? projects[cwd] : {};
  project.hasTrustDialogAccepted = true;
  projects[cwd] = project;
  state.projects = projects;
  writeJson(path, state);
}


function trustCodex(home: string, cwd: string, overlayHome?: string): void {
  // Real config: readiness reads it, and it persists across bootstraps.
  writeCodexTrust(join(home, ".codex", "config.toml"), cwd);
  // Overlay config (CODEX_HOME the running codex uses): without this the live session
  // doesn't see the trust.
  if (overlayHome !== undefined) {
    writeCodexTrust(join(overlayHome, "config.toml"), cwd);
  }
}

function writeCodexTrust(path: string, cwd: string): void {
  const existing = (existsSync(path) ? readText(path) : "") ?? "";
  if (codexCwdAlreadyTrusted(existing, cwd)) {
    return;
  }
  const block = `\n[projects."${cwd}"]\ntrust_level = "trusted"\n`;
  const next = existing.length === 0 ? block.trimStart() : `${existing.replace(/\n*$/, "\n")}${block}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next, "utf8");
}

function codexCwdAlreadyTrusted(config: string, cwd: string): boolean {
  const header = `[projects."${cwd}"]`;
  const lines = config.split(/\r?\n/);
  let active = false;
  for (const line of lines) {
    if (line.trim() === header) {
      active = true;
      continue;
    }
    if (active) {
      if (line.startsWith("[")) {
        active = false;
        continue;
      }
      if (line.trim() === 'trust_level = "trusted"') {
        return true;
      }
    }
  }
  return false;
}

function readJson(path: string): Record<string, unknown> | undefined {
  const text = readText(path);
  if (text === undefined) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function writeJson(path: string, value: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
