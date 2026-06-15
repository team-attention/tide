import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

// The "정석" (server API) path for opencode vendor auth — exactly what palot and the
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
}

export type OpencodeProviderAuthMap = Record<string, OpencodeProviderAuthMethod[]>;

export interface OpencodeAuthServer {
  // Provider → its auth methods (the real list, fetched live, no hang).
  listProviderAuth(): Promise<OpencodeProviderAuthMap>;
  // Set an API-key credential for a provider (PUT /auth/{id} { type:"api", key }).
  setApiKey(providerId: string, key: string): Promise<void>;
  stop(): void;
}

export interface CreateOpencodeAuthServerInput {
  resolveExecutable: (command: "opencode") => string | undefined;
  // Injected in tests to exercise the HTTP layer without a real server.
  fetchImpl?: typeof fetch;
  resolveBaseUrl?: () => Promise<string>;
}

const LISTEN_RE = /listening on\s+(https?:\/\/\S+)/i;
const SERVER_START_TIMEOUT_MS = 8_000;

export function createOpencodeAuthServer(input: CreateOpencodeAuthServerInput): OpencodeAuthServer {
  const fetchImpl = input.fetchImpl ?? fetch;
  let child: ChildProcess | undefined;
  let baseUrlPromise: Promise<string> | undefined;

  const spawnServer = (): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const executablePath = input.resolveExecutable("opencode");
      if (executablePath === undefined) {
        reject(new Error("opencode executable was not found."));
        return;
      }
      const proc = nodeSpawn(executablePath, ["serve", "--port", "0", "--hostname", "127.0.0.1"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      child = proc;
      const timer = setTimeout(() => {
        reject(new Error("opencode serve did not announce a URL in time."));
        proc.kill();
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
        child = undefined;
        baseUrlPromise = undefined;
        reject(new Error("opencode serve exited before announcing a URL."));
      });
    });

  const baseUrl = (): Promise<string> => {
    if (input.resolveBaseUrl !== undefined) {
      return input.resolveBaseUrl();
    }
    if (baseUrlPromise === undefined) {
      baseUrlPromise = spawnServer().catch((error) => {
        baseUrlPromise = undefined;
        throw error;
      });
    }
    return baseUrlPromise;
  };

  return {
    async listProviderAuth() {
      const base = await baseUrl();
      const response = await fetchImpl(`${base}/provider/auth`);
      if (!response.ok) {
        throw new Error(`GET /provider/auth failed: ${response.status}`);
      }
      return (await response.json()) as OpencodeProviderAuthMap;
    },
    async setApiKey(providerId: string, key: string) {
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
    },
    stop() {
      if (child !== undefined) {
        child.kill();
        child = undefined;
      }
      baseUrlPromise = undefined;
    },
  };
}
