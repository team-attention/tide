import { dirname, join } from "node:path";

import type { ClaudeProviderState } from "../../../adapters/outbound/agent-integrations/claude/claude-agent-integration.ts";
import type { CodexProviderState } from "../../../adapters/outbound/agent-integrations/codex/codex-agent-integration.ts";
import type { QwenProviderState } from "../../../adapters/outbound/agent-integrations/qwen/qwen-agent-integration.ts";
import {
  isClaudeBootstrapReady,
  isMcpBootstrapReady,
  providerBootstrapArtifactsForHome,
} from "./provider-bootstrap-artifacts.ts";
import { readJsonFile, readTextFile } from "../live/live-backend-fs.ts";
import { recordField, stringField, unknownRecord } from "../live/live-backend-json.ts";

// Reads provider-owned readiness state (auth, onboarding, directory trust, hook/
// plugin bootstrap) from the user's home directory for each provider CLI.
// Provider-owned facts read from disk, not Tide state. Extracted from
// live-backend.ts.

export function readCodexProviderStateFromHome(
  homeDir: string,
  cwd: string,
  codexHome?: string,
): CodexProviderState {
  const realCodexHome = codexHome ?? join(homeDir, ".codex");
  const bootstrapArtifacts = providerBootstrapArtifactsForHome({ homeDir });
  const auth = readJsonFile(join(realCodexHome, "auth.json"));
  const configPath = join(realCodexHome, "config.toml");
  const config = readTextFile(configPath);

  return {
    authenticated: hasCodexAuth(auth),
    onboardingComplete: config !== undefined,
    trustedCwds: config === undefined ? [] : codexTrustedCwds(config),
    hookBootstrapReady: isMcpBootstrapReady(bootstrapArtifacts),
    codexHome: realCodexHome,
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

export function readOpencodeProviderStateFromHome(
  homeDir: string,
  _cwd: string,
): { authenticated: boolean } {
  // opencode stores provider credentials at ~/.local/share/opencode/auth.json;
  // authenticated == at least one credential present.
  const auth = readJsonFile(join(homeDir, ".local", "share", "opencode", "auth.json"));
  return { authenticated: auth !== undefined && Object.keys(auth).length > 0 };
}

export function readQwenProviderStateFromHome(
  homeDir: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): QwenProviderState {
  const settings = readJsonFile(join(homeDir, ".qwen", "settings.json"));
  const settingsEnv = recordField(settings, "env");
  const credentialEnvKeys = qwenCredentialEnvKeys(settings);
  return {
    authenticated:
      hasQwenCredential(env, credentialEnvKeys) ||
      hasQwenCredential(settingsEnv, credentialEnvKeys) ||
      hasQwenDotEnvCredential(cwd, homeDir, credentialEnvKeys),
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

const DEFAULT_QWEN_CREDENTIAL_ENV_KEYS = [
  "BAILIAN_CODING_PLAN_API_KEY",
  "DASHSCOPE_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "REQUESTY_API_KEY",
  "MODELSCOPE_API_TOKEN",
  "DEEPSEEK_API_KEY",
  "MINIMAX_API_KEY",
  "ZAI_API_KEY",
];

function qwenCredentialEnvKeys(settings: Record<string, unknown> | undefined): Set<string> {
  const keys = new Set(DEFAULT_QWEN_CREDENTIAL_ENV_KEYS);
  const providers = recordField(settings, "modelProviders");
  if (providers !== undefined) {
    for (const provider of Object.values(providers)) {
      const models = unknownRecord(provider)?.models;
      if (!Array.isArray(models)) {
        continue;
      }
      for (const model of models) {
        const envKey = stringField(unknownRecord(model), "envKey");
        if (envKey !== undefined) {
          keys.add(envKey);
        }
      }
    }
  }
  const settingsEnv = recordField(settings, "env");
  if (settingsEnv !== undefined) {
    for (const key of Object.keys(settingsEnv)) {
      if (/(API_KEY|TOKEN)$/i.test(key)) {
        keys.add(key);
      }
    }
  }
  return keys;
}

function hasQwenCredential(
  value: Record<string, unknown> | undefined,
  envKeys: ReadonlySet<string>,
): boolean {
  if (value === undefined) {
    return false;
  }
  const normalizedKeys = new Set([...envKeys].map((key) => key.toUpperCase()));
  return Object.entries(value).some(([key, raw]) => {
    if (!normalizedKeys.has(key.toUpperCase()) || typeof raw !== "string") {
      return false;
    }
    const credential = raw.trim();
    return credential.length > 0 && !/^(YOUR_|sk-?x+$|x+$)/i.test(credential);
  });
}

function hasQwenDotEnvCredential(
  cwd: string,
  homeDir: string,
  envKeys: ReadonlySet<string>,
): boolean {
  const projectDotEnv = firstReadableDotEnv(qwenProjectDotEnvPaths(cwd), envKeys);
  if (projectDotEnv !== undefined) {
    return projectDotEnv;
  }
  return firstReadableDotEnv([
    join(homeDir, ".qwen", ".env"),
    join(homeDir, ".env"),
  ], envKeys) ?? false;
}

function firstReadableDotEnv(
  filePaths: string[],
  envKeys: ReadonlySet<string>,
): boolean | undefined {
  for (const filePath of filePaths) {
    const text = readTextFile(filePath);
    if (text !== undefined) {
      return hasQwenCredential(parseDotEnv(text), envKeys);
    }
  }
  return undefined;
}

function qwenProjectDotEnvPaths(cwd: string): string[] {
  const paths: string[] = [];
  let current = cwd;
  while (current.length > 0) {
    paths.push(join(current, ".qwen", ".env"), join(current, ".env"));
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return [...new Set(paths)];
}

function parseDotEnv(text: string | undefined): Record<string, string> | undefined {
  if (text === undefined) {
    return undefined;
  }
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match === null) {
      continue;
    }
    const [, key, rawValue] = match;
    if (key === undefined || rawValue === undefined) {
      continue;
    }
    env[key] = stripEnvQuotes(rawValue);
  }
  return env;
}

function stripEnvQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
