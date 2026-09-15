import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ProviderModelDto } from "../../../../shared/contracts/index.ts";

const execFileAsync = promisify(execFile);

// Read model IDs and per-model variants from the installed CLI in the requested workspace.
// No --refresh: freshness follows OpenCode’s own local catalog/configuration.

const OPENCODE_MODELS_TIMEOUT_MS = 5_000;

interface OpencodeModelCatalog {
  get: (cwd?: string) => Promise<ProviderModelDto[]>;
  // Kept for callers that refresh after vendor auth. There is no completed-result
  // cache; invalidate only clears an in-flight read.
  invalidate: () => void;
}

type OpencodeCommandRunner = (executablePath: string, args: string[], cwd?: string) => Promise<string>;

async function runOpencodeModelsCommand(executablePath: string, args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync(executablePath, args, {
    encoding: "utf8",
    cwd,
    // `opencode models` is usually a fast local cache lookup, but cold starts can
    // cross one second. This runs off the event loop and is delivered out of band,
    // so allow enough room for the first spawn while still bounding a hung CLI.
    timeout: OPENCODE_MODELS_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

export function parseOpencodeModels(stdout: string): ProviderModelDto[] {
  const models: ProviderModelDto[] = [];
  const lines = stdout.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!/^[^\s/]+\/[^\s]+$/.test(line)) continue;
    const slash = line.indexOf("/");
    const model: ProviderModelDto = { value: line, label: line.slice(slash + 1), vendor: line.slice(0, slash) };
    if (lines[index + 1]?.trim() === "{") {
      const metadataLines = [lines[++index]];
      while (++index < lines.length) {
        metadataLines.push(lines[index]);
        if (lines[index] === "}") break;
      }
      const metadata = JSON.parse(metadataLines.join("\n")) as { variants?: Record<string, unknown> };
      if (metadata.variants && typeof metadata.variants === "object" && !Array.isArray(metadata.variants)) {
        model.effortOptions = Object.keys(metadata.variants);
      }
    }
    models.push(model);
  }
  return models;
}

export function createOpencodeModelCatalog(
  resolveExecutable: (command: "opencode") => string | undefined,
  runCommand: OpencodeCommandRunner = runOpencodeModelsCommand,
): OpencodeModelCatalog {
  // Share one in-flight refresh so concurrent get() callers don't each spawn opencode.
  const pending = new Map<string, Promise<ProviderModelDto[]>>();

  const refresh = async (cwd: string): Promise<ProviderModelDto[]> => {
    const executablePath = resolveExecutable("opencode");
    if (executablePath === undefined) {
      return [];
    }
    return parseOpencodeModels(await runCommand(executablePath, ["models", "--verbose"], cwd));
  };

  return {
    get: async (cwd = process.cwd()) => {
      const existing = pending.get(cwd);
      if (existing) return existing;
      const request = refresh(cwd);
      pending.set(cwd, request);
      const clear = () => { if (pending.get(cwd) === request) pending.delete(cwd); };
      void request.then(clear, clear);
      return request;
    },
    invalidate: () => { pending.clear(); },
  };
}
