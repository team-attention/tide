import type {
  OpencodeProviderAuthMethodDto,
  OpencodeProviderOptionDto,
} from "../../../../shared/contracts/index.ts";
import {
  createStandaloneOwnedProcessSpawner,
  type BackendOwnedProcessSpawner,
  type BackendOwnedProcessStopReason,
  type ManagedBackendOwnedProcess,
} from "../process/backend-owned-process.ts";

// The canonical (server-API) path for opencode vendor auth — exactly what palot and the
// other opencode GUI clients use, instead of the interactive `auth login` TUI (which
// hangs for some providers when driven non-interactively). We run opencode's own
// headless HTTP server (`opencode serve`) on a localhost-only port and call:
//   GET  /provider/auth        → { providerID: [{ type:"oauth"|"api", label }] }
//   PUT  /auth/{providerID}    ← { type:"api", key }   (set an API-key credential)
// Credentials land in opencode's machine-global auth.json — the same store the CLI
// uses, so the result is identical to `opencode auth login`, just non-interactive and
// hang-free. The server is one lazy per-process singleton, bound to 127.0.0.1, killed
// on stop(). It is NOT the per-thread agent runtime (that stays ACP over stdio).

export interface OpencodeProviderAuthMethod {
  type: "oauth" | "api";
  label: string;
  prompts?: unknown[];
  promptCount?: number;
}

export type OpencodeProviderAuthMap = Record<string, OpencodeProviderAuthMethod[]>;

export interface OpencodeAuthServer {
  // Searchable provider catalog from opencode `GET /provider` plus auth methods
  // from `GET /provider/auth`.
  listProviderOptions(): Promise<OpencodeProviderOptionDto[]>;
  // Provider → its auth methods (the real list, fetched live, no hang).
  listProviderAuth(): Promise<OpencodeProviderAuthMap>;
  // Set an API-key credential for a provider (PUT /auth/{id} { type:"api", key }).
  setApiKey(providerId: string, key: string): Promise<void>;
  stop(): Promise<void>;
}

export interface CreateOpencodeAuthServerInput {
  resolveExecutable: (command: "opencode") => string | undefined;
  // Injected in tests to exercise the HTTP layer without a real server.
  fetchImpl?: typeof fetch;
  resolveBaseUrl?: () => Promise<string>;
  processSpawner?: BackendOwnedProcessSpawner;
  idleMs?: number;
}

const LISTEN_RE = /listening on\s+(https?:\/\/\S+)/i;
const SERVER_START_TIMEOUT_MS = 8_000;
export const OPENCODE_AUTH_SERVER_IDLE_MS = 30_000;
const OPENCODE_PROVIDER_SOURCES = new Set(["env", "config", "custom", "api"]);

export function createOpencodeAuthServer(input: CreateOpencodeAuthServerInput): OpencodeAuthServer {
  const fetchImpl = input.fetchImpl ?? fetch;
  const processSpawner = input.processSpawner ?? createStandaloneOwnedProcessSpawner();
  let managedProcess: ManagedBackendOwnedProcess | undefined;
  let baseUrlPromise: Promise<string> | undefined;
  let generation = 0;
  let activeLeases = 0;
  let idleGeneration = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let stoppingPromise: Promise<void> | undefined;
  let shuttingDown = false;

  const spawnServer = (): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const executablePath = input.resolveExecutable("opencode");
      if (executablePath === undefined) {
        reject(new Error("opencode executable was not found."));
        return;
      }
      generation += 1;
      const owned = processSpawner.spawn({
        resourceId: `provider_helper:opencode-auth:${generation}`,
        kind: "provider_helper",
        scope: { kind: "backend" },
        command: executablePath,
        args: ["serve", "--port", "0", "--hostname", "127.0.0.1"],
        options: { stdio: ["ignore", "pipe", "pipe"] },
      });
      const proc = owned.child;
      managedProcess = owned;
      const timer = setTimeout(() => {
        reject(new Error("opencode serve did not announce a URL in time."));
        void owned.stop("readiness_failed");
      }, SERVER_START_TIMEOUT_MS);

      const onData = (chunk: Buffer) => {
        const match = chunk.toString("utf8").match(LISTEN_RE);
        if (match) {
          clearTimeout(timer);
          proc.stdout?.off("data", onData);
          proc.stderr?.off("data", onData);
          resolve(match[1].replace(/\/+$/, ""));
        }
      };
      // opencode prints the "listening on …" line to stdout, but tolerate stderr too.
      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", onData);
      proc.on("exit", () => {
        clearTimeout(timer);
        baseUrlPromise = undefined;
        if (managedProcess === owned) managedProcess = undefined;
        reject(new Error("opencode serve exited before announcing a URL."));
      });
      // A spawn failure (ENOENT / permission) emits "error"; with no listener Node
      // throws an unhandled exception that would crash the backend.
      proc.on("error", (error) => {
        clearTimeout(timer);
        baseUrlPromise = undefined;
        if (managedProcess === owned) managedProcess = undefined;
        reject(error);
      });
    });

  const baseUrl = async (): Promise<string> => {
    if (input.resolveBaseUrl !== undefined) {
      return input.resolveBaseUrl();
    }
    if (stoppingPromise !== undefined) {
      await stoppingPromise;
    }
    if (baseUrlPromise === undefined) {
      baseUrlPromise = spawnServer().catch((error) => {
        baseUrlPromise = undefined;
        throw error;
      });
    }
    return baseUrlPromise;
  };

  const stopCurrent = (reason: BackendOwnedProcessStopReason = "idle_expired"): Promise<void> => {
    if (stoppingPromise !== undefined) return stoppingPromise;
    const owned = managedProcess;
    managedProcess = undefined;
    baseUrlPromise = undefined;
    if (owned === undefined) return Promise.resolve();
    stoppingPromise = owned.stop(reason)
      .then(() => undefined)
      .finally(() => {
        stoppingPromise = undefined;
      });
    return stoppingPromise;
  };

  const scheduleIdleStop = (): void => {
    if (shuttingDown || activeLeases > 0 || managedProcess === undefined) return;
    const scheduledGeneration = ++idleGeneration;
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      if (activeLeases === 0 && idleGeneration === scheduledGeneration && !shuttingDown) {
        void stopCurrent();
      }
    }, input.idleMs ?? OPENCODE_AUTH_SERVER_IDLE_MS);
    idleTimer.unref?.();
  };

  const withLease = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (shuttingDown) throw new Error("opencode auth server is shutting down.");
    activeLeases += 1;
    idleGeneration += 1;
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
    try {
      return await operation();
    } finally {
      activeLeases -= 1;
      scheduleIdleStop();
    }
  };

  return {
    async listProviderOptions() {
      return withLease(async () => {
        const base = await baseUrl();
        const [providerResponse, auth] = await Promise.all([
          fetchImpl(`${base}/provider`),
          fetchProviderAuth(fetchImpl, base).catch(() => ({})),
        ]);
        if (!providerResponse.ok) {
          throw new Error(`GET /provider failed: ${providerResponse.status}`);
        }
        return parseOpencodeProviderOptions(await providerResponse.json(), auth);
      });
    },
    async listProviderAuth() {
      return withLease(async () => fetchProviderAuth(fetchImpl, await baseUrl()));
    },
    async setApiKey(providerId: string, key: string) {
      return withLease(async () => {
        const base = await baseUrl();
        const response = await fetchImpl(`${base}/auth/${encodeURIComponent(providerId)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "api", key }),
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(`PUT /auth/${providerId} failed: ${response.status} ${detail}`.trim());
        }
      });
    },
    async stop() {
      shuttingDown = true;
      idleGeneration += 1;
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
      await stopCurrent("backend_shutdown");
    },
  };
}

async function fetchProviderAuth(fetchImpl: typeof fetch, base: string): Promise<OpencodeProviderAuthMap> {
  const response = await fetchImpl(`${base}/provider/auth`);
  if (!response.ok) {
    throw new Error(`GET /provider/auth failed: ${response.status}`);
  }
  return parseOpencodeProviderAuthMap(await response.json());
}

export function parseOpencodeProviderOptions(
  payload: unknown,
  authMap: OpencodeProviderAuthMap = {},
): OpencodeProviderOptionDto[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const raw = payload as { all?: unknown; connected?: unknown };
  const connected = new Set(
    Array.isArray(raw.connected)
      ? raw.connected.filter((providerId): providerId is string => typeof providerId === "string")
      : [],
  );
  if (!Array.isArray(raw.all)) {
    return [];
  }
  return raw.all
    .map((entry): OpencodeProviderOptionDto | null => {
      if (typeof entry !== "object" || entry === null) {
        return null;
      }
      const provider = entry as {
        id?: unknown;
        name?: unknown;
        source?: unknown;
        env?: unknown;
        models?: unknown;
      };
      if (typeof provider.id !== "string" || typeof provider.name !== "string") {
        return null;
      }
      const authMethods = providerAuthMethods(authMap[provider.id]);
      return {
        id: provider.id,
        label: provider.name,
        source:
          typeof provider.source === "string" && OPENCODE_PROVIDER_SOURCES.has(provider.source)
            ? provider.source as OpencodeProviderOptionDto["source"]
            : undefined,
        env: Array.isArray(provider.env)
          ? provider.env.filter((name): name is string => typeof name === "string")
          : undefined,
        modelCount:
          typeof provider.models === "object" && provider.models !== null
            ? Object.keys(provider.models).length
            : 0,
        connected: connected.has(provider.id),
        ...(authMethods.length > 0 ? { authMethods } : {}),
      };
    })
    .filter((entry): entry is OpencodeProviderOptionDto => entry !== null)
    .sort((a, b) => a.label.localeCompare(b.label));
}

function parseOpencodeProviderAuthMap(payload: unknown): OpencodeProviderAuthMap {
  if (typeof payload !== "object" || payload === null) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>).flatMap(([providerId, methods]) => {
      const parsed = providerAuthMethods(methods);
      return parsed.length > 0 ? [[providerId, parsed]] : [];
    }),
  );
}

function providerAuthMethods(methods: unknown): OpencodeProviderAuthMethodDto[] {
  if (!Array.isArray(methods)) {
    return [];
  }
  return methods
    .map((method): OpencodeProviderAuthMethodDto | null => {
      if (typeof method !== "object" || method === null) {
        return null;
      }
      const raw = method as { type?: unknown; label?: unknown; prompts?: unknown; promptCount?: unknown };
      if ((raw.type !== "oauth" && raw.type !== "api") || typeof raw.label !== "string") {
        return null;
      }
      const promptCount = Array.isArray(raw.prompts)
        ? raw.prompts.length
        : typeof raw.promptCount === "number" && raw.promptCount > 0
          ? raw.promptCount
          : 0;
      return {
        type: raw.type,
        label: raw.label,
        ...(promptCount > 0 ? { promptCount } : {}),
      };
    })
    .filter((method): method is OpencodeProviderAuthMethodDto => method !== null);
}
