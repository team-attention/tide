import { join } from "node:path";

import type { ClaudeProviderState } from "../../adapters/outbound/agent-integrations/claude/claude-agent-integration.ts";
import type { GeminiProviderState } from "../../adapters/outbound/agent-integrations/gemini/gemini-agent-integration.ts";
import type { CodexProviderState } from "../../adapters/outbound/agent-integrations/codex/codex-agent-integration.ts";
import {
  isClaudeBootstrapReady,
  isCodexBootstrapReady,
  providerBootstrapArtifactsForHome,
} from "./provider-bootstrap-artifacts.ts";
import { readJsonFile, readTextFile } from "./live-backend-fs.ts";
import { arrayOfStrings, recordField, stringField } from "./live-backend-json.ts";

// Reads provider-owned readiness state (auth, onboarding, directory trust, hook/
// plugin bootstrap) from the user's home directory for each provider CLI.
// Provider-owned facts read from disk, not Tide state. Extracted from
// live-backend.ts.

export function readCodexProviderStateFromHome(
  homeDir: string,
  cwd: string,
): CodexProviderState {
  const realCodexHome = join(homeDir, ".codex");
  const bootstrapArtifacts = providerBootstrapArtifactsForHome({ homeDir });
  const auth = readJsonFile(join(realCodexHome, "auth.json"));
  const configPath = join(realCodexHome, "config.toml");
  const config = readTextFile(configPath);

  return {
    authenticated: hasCodexAuth(auth),
    onboardingComplete: config !== undefined,
    trustedCwds: config === undefined ? [] : codexTrustedCwds(config),
    hookBootstrapReady: isCodexBootstrapReady(bootstrapArtifacts),
    codexHome: bootstrapArtifacts.codexHome,
  };
}

export function readClaudeProviderStateFromHome(
  homeDir: string,
  cwd: string,
): ClaudeProviderState {
  const state = readJsonFile(join(homeDir, ".claude.json"));
  const projects = recordField(state, "projects");
  const project = recordField(projects, cwd);

  return {
    authenticated: Boolean(recordField(state, "oauthAccount") ?? stringField(state, "userID")),
    onboardingComplete: state?.hasCompletedOnboarding === true,
    trustedCwds: project?.hasTrustDialogAccepted === true ? [cwd] : [],
    hookBootstrapReady: isClaudeBootstrapReady(
      providerBootstrapArtifactsForHome({ homeDir }),
    ),
  };
}

export function readGeminiProviderStateFromHome(
  homeDir: string,
  _cwd: string,
): GeminiProviderState {
  // Gemini signs in via OAuth; the credential lives at ~/.gemini/oauth_creds.json
  // (works when spawned, unlike antigravity's Keychain-bound auth).
  const oauth = readJsonFile(join(homeDir, ".gemini", "oauth_creds.json"));
  const accounts = readJsonFile(join(homeDir, ".gemini", "google_accounts.json"));
  return {
    authenticated: oauth !== undefined || accounts !== undefined,
  };
}

function hasCodexAuth(value: Record<string, unknown> | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  return (
    typeof value.auth_mode === "string" ||
    typeof value.OPENAI_API_KEY === "string" ||
    recordField(value, "tokens") !== undefined
  );
}

function codexTrustedCwds(config: string): string[] {
  const trusted: string[] = [];
  const projectHeader = /^\[projects\."([^"]+)"\]$/;
  let activeProject: string | undefined;

  for (const line of config.split(/\r?\n/)) {
    const header = line.match(projectHeader);
    if (header !== null) {
      activeProject = header[1];
      continue;
    }
    if (activeProject !== undefined && line.trim() === 'trust_level = "trusted"') {
      trusted.push(activeProject);
    }
  }

  return trusted;
}
