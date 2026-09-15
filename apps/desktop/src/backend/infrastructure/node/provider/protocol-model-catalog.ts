import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createStandaloneOwnedProcessSpawner, type BackendOwnedProcessSpawner } from "../process/backend-owned-process.ts";
import type { ProviderModelDto } from "../../../../shared/contracts/index.ts";
import { isRecord, parseAcpModelCatalog } from "../../../adapters/outbound/agent-runtime/structured/acp-client-shared.ts";

type ProtocolProvider = "claude" | "vibe";
type Probe = (provider: ProtocolProvider, executable: string, cwd: string) => Promise<Record<string, unknown>>;

export function parseClaudeModels(result: Record<string, unknown>): ProviderModelDto[] {
  const models = (Array.isArray(result.models) ? result.models : []).filter(isRecord)
    .filter((row) => typeof row.value === "string" && row.value.length > 0)
    .map((row): ProviderModelDto => ({
      value: row.value as string,
      label: typeof row.displayName === "string" ? row.displayName : row.value as string,
      ...(typeof row.description === "string" ? { detail: row.description } : {}),
      ...(Array.isArray(row.supportedEffortLevels) ? {
        effortOptions: row.supportedEffortLevels.filter((value): value is string => typeof value === "string"),
      } : {}),
    }));
  if (models.length === 0) throw new Error("Claude initialization did not report selectable models.");
  return models;
}

export function createProtocolModelCatalog(
  provider: ProtocolProvider,
  resolveExecutable: (command: string) => string | undefined,
  probe?: Probe,
  processSpawner?: BackendOwnedProcessSpawner,
) {
  const pending = new Map<string, Promise<{ models: ProviderModelDto[]; defaultModel: string }>>();
  return {
    get(cwd: string) {
      const existing = pending.get(cwd);
      if (existing) return existing;
      const request = (async () => {
        const executable = resolveExecutable(provider === "vibe" ? "vibe-acp" : "claude");
        if (!executable) throw new Error(`${provider} executable was not found.`);
        const result = await (probe ?? ((p, e, c) => probeModelProtocol(p, e, c, processSpawner)))(provider, executable, cwd);
        if (provider === "claude") {
          const models = parseClaudeModels(result);
          return { models, defaultModel: models.find((model) => model.value === "default")?.value ?? models[0].value };
        }
        const catalog = parseAcpModelCatalog(result);
        if (!catalog?.models.length) throw new Error("Vibe did not report selectable models.");
        return { models: catalog.models, defaultModel: catalog.currentModel ?? catalog.models[0].value };
      })();
      pending.set(cwd, request);
      void request.then(() => pending.delete(cwd), () => pending.delete(cwd));
      return request;
    },
  };
}

// A discovery process sends initialization only, never a prompt or a tool approval.
export function probeModelProtocol(provider: ProtocolProvider, executable: string, cwd: string, processSpawner?: BackendOwnedProcessSpawner, timeoutMs = 15_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const managed = (processSpawner ?? createStandaloneOwnedProcessSpawner()).spawn({
      resourceId: `model-catalog:${randomUUID()}`, kind: "command_probe", scope: { kind: "workspace", cwd }, command: executable,
      args: provider === "claude" ? ["--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--no-session-persistence"] : [],
      options: { cwd, stdio: ["pipe", "pipe", "pipe"] },
    });
    const child = managed.child as ChildProcessWithoutNullStreams;
    let done = false;
    let buffer = "";
    let bytes = 0;
    const timer = setTimeout(() => finish(new Error(`${provider} model discovery timed out.`)), timeoutMs);
    function finish(error?: Error, result?: Record<string, unknown>) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdin.end();
      void managed.stop("runtime_stop");
      if (error) reject(error); else resolve(result!);
    }
    const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`);
    child.on("error", (error) => finish(error));
    child.stdin.on("error", (error) => finish(error));
    child.on("exit", () => finish(new Error(`${provider} exited before reporting models.`)));
    child.stderr.on("data", () => {});
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 4 * 1024 * 1024) return finish(new Error("Model discovery output exceeded its limit."));
      buffer += chunk;
      let newline: number;
      while (!done && (newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let message: Record<string, unknown>;
        try { const value: unknown = JSON.parse(line); if (!isRecord(value)) throw new Error(); message = value; }
        catch { return finish(new Error("Invalid model discovery protocol response.")); }
        if (provider === "claude" && message.type === "control_response" && isRecord(message.response) && message.response.request_id === "catalog") {
          const response = message.response;
          if (response.subtype !== "success" || !isRecord(response.response)) return finish(new Error("Claude model discovery failed."));
          finish(undefined, response.response);
        } else if (provider === "vibe" && (message.id === 1 || message.id === 2) && !message.method) {
          if (message.error || !isRecord(message.result)) return finish(new Error("Vibe model discovery failed; check Vibe sign-in and configuration."));
          if (message.id === 1) send({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd, mcpServers: [] } });
          else finish(undefined, message.result);
        } else if (message.method && message.id !== undefined) {
          send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Discovery does not execute client requests" } });
        }
      }
    });
    send(provider === "claude"
      ? { type: "control_request", request_id: "catalog", request: { subtype: "initialize" } }
      : { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "tide-model-catalog", version: "1" } } });
  });
}
