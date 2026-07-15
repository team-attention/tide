import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  OpencodeEnvironmentDto,
  ProviderModelDto,
} from "../../../../shared/contracts/index.ts";
import { providerVersionForExecutable } from "../../../adapters/outbound/agent-integrations/shared/provider-cli-commands.ts";

const execFileAsync = promisify(execFile);
const CODEX_MODELS_TIMEOUT_MS = 5_000;

interface CodexModelCatalogSnapshot {
  models: ProviderModelDto[];
  defaultModel: string;
  environment: OpencodeEnvironmentDto;
}

interface CodexDebugModel {
  slug?: unknown;
  display_name?: unknown;
  visibility?: unknown;
  supported_reasoning_levels?: unknown;
}

interface CodexModelCatalog {
  get: () => Promise<CodexModelCatalogSnapshot>;
  invalidate: () => void;
}

type CodexCommandRunner = (executablePath: string, args: string[]) => Promise<string>;
type CodexVersionReader = (executablePath: string) => Promise<string | undefined>;

async function runCodexDebugModelsCommand(executablePath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(executablePath, args, {
    encoding: "utf8",
    timeout: CODEX_MODELS_TIMEOUT_MS,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

export function parseCodexDebugModels(stdout: string): ProviderModelDto[] {
  const parsed = JSON.parse(stdout) as { models?: unknown };
  if (!Array.isArray(parsed.models)) {
    throw new Error("Codex debug models output did not include a models array.");
  }
  return parsed.models
    .map((entry): ProviderModelDto | null => {
      if (typeof entry !== "object" || entry === null) {
        return null;
      }
      const model = entry as CodexDebugModel;
      if (typeof model.slug !== "string" || typeof model.display_name !== "string") {
        return null;
      }
      if (model.visibility !== "list") {
        return null;
      }
      const effortOptions = codexEffortOptions(model.supported_reasoning_levels);
      return {
        value: model.slug,
        label: model.display_name,
        ...(effortOptions.length > 0 ? { effortOptions } : {}),
      };
    })
    .filter((entry): entry is ProviderModelDto => entry !== null);
}

export function createCodexModelCatalog(
  resolveExecutable: (command: "codex") => string | undefined,
  runCommand: CodexCommandRunner = runCodexDebugModelsCommand,
  readVersion: CodexVersionReader = providerVersionForExecutable,
): CodexModelCatalog {
  let inflight: Promise<CodexModelCatalogSnapshot> | null = null;

  const refresh = async (): Promise<CodexModelCatalogSnapshot> => {
    const executablePath = resolveExecutable("codex");
    if (executablePath === undefined) {
      throw new Error("codex executable was not found.");
    }
    const [stdout, version] = await Promise.all([
      runCommand(executablePath, ["debug", "models"]),
      readVersion(executablePath),
    ]);
    const models = parseCodexDebugModels(stdout);
    const defaultModel = models[0]?.value;
    if (defaultModel === undefined) {
      throw new Error("Codex debug models did not include a selectable model.");
    }
    return {
      models,
      defaultModel,
      environment: {
        executablePath,
        ...(version !== undefined ? { version } : {}),
      },
    };
  };

  return {
    get: async () => {
      if (inflight === null) {
        const promise = refresh();
        inflight = promise;
        void promise.then(
          () => {
            if (inflight === promise) {
              inflight = null;
            }
          },
          () => {
            if (inflight === promise) {
              inflight = null;
            }
          },
        );
      }
      return inflight;
    },
    invalidate: () => {
      inflight = null;
    },
  };
}

function codexEffortOptions(payload: unknown): string[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .map((entry): string | null => {
      if (typeof entry !== "object" || entry === null) {
        return null;
      }
      const effort = (entry as { effort?: unknown }).effort;
      return typeof effort === "string" ? effort : null;
    })
    .filter((entry): entry is string => entry !== null);
}
