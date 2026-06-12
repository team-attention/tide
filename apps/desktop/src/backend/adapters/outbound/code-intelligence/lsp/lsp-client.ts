// Minimal LSP client over child-process stdio (spec:
// workbench-editor-language-intelligence). One instance drives one language
// server for one workspace root: Content-Length framed JSON-RPC 2.0,
// initialize handshake, full-text document sync, and a latest-wins
// publishDiagnostics cache. Requests resolve null on timeout or server death
// instead of rejecting — a slow or dead server degrades to "no intelligence",
// never to a thrown failure that could take the query pipeline down.
import { spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";

const REQUEST_TIMEOUT_MS = 8_000;
const SHUTDOWN_GRACE_MS = 1_000;

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export interface LspClientInput {
  executable: string;
  args: string[];
  root: string;
  // Fired when the server dies outside dispose() — the owning engine flips to
  // a permanent unavailable state so we never spawn-retry per query.
  onUnexpectedExit?: () => void;
}

export class LspClient {
  private readonly input: LspClientInput;
  private readonly child: ChildProcess;
  private readonly ready: Promise<boolean>;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }
  >();
  // uri → synced document state; full-text sync (we declare no sync capability
  // and send whole-document didChange, which servers fall back to fine).
  private readonly documents = new Map<string, { version: number; text: string }>();
  private readonly diagnostics = new Map<string, { generation: number; items: unknown[] }>();
  private publishGeneration = 0;
  private nextRequestId = 1;
  private buffer = Buffer.alloc(0);
  private alive = true;
  private disposed = false;
  // Backend teardown must never leak rust-analyzer/gopls orphans (memory note
  // v2-agy-process-leak): kill synchronously when this process exits.
  private readonly killOnProcessExit = (): void => {
    try {
      this.child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  };

  constructor(input: LspClientInput) {
    this.input = input;
    this.child = spawn(input.executable, input.args, {
      cwd: input.root,
      stdio: ["pipe", "pipe", "ignore"],
    });
    process.on("exit", this.killOnProcessExit);
    this.child.on("error", () => this.markDead());
    this.child.on("exit", () => this.markDead());
    // A dying server can EPIPE buffered writes; the exit handler owns state.
    this.child.stdin?.on("error", () => {});
    this.child.stdout?.on("data", (chunk: Buffer) => this.ingest(chunk));
    this.ready = this.initialize();
  }

  private async initialize(): Promise<boolean> {
    const result = await this.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(this.input.root).href,
      capabilities: {
        textDocument: {
          hover: { contentFormat: ["plaintext", "markdown"] },
          completion: { completionItem: { snippetSupport: false } },
          definition: {},
          references: {},
          documentHighlight: {},
          signatureHelp: {},
          publishDiagnostics: {},
        },
      },
    });
    if (result === null || !this.alive) {
      return false;
    }
    this.notify("initialized", {});
    return true;
  }

  // Resolves once the initialize handshake settled; false means the server
  // never came up (spawn error, exit, or initialize timeout).
  whenReady(): Promise<boolean> {
    return this.ready;
  }

  isAlive(): boolean {
    return this.alive;
  }

  async request(
    method: string,
    params: unknown,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    if (!this.alive) {
      return null;
    }
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return await new Promise<unknown>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    if (!this.alive) {
      return;
    }
    const message: JsonRpcMessage = { jsonrpc: "2.0", method };
    if (params !== undefined) {
      message.params = params;
    }
    this.send(message);
  }

  // didOpen on first use, didChange (full text, bumped version) only when the
  // text actually changed. Returns true when a sync message was sent.
  syncDocument(uri: string, languageId: string, text: string): boolean {
    const existing = this.documents.get(uri);
    if (existing === undefined) {
      this.documents.set(uri, { version: 1, text });
      this.notify("textDocument/didOpen", {
        textDocument: { uri, languageId, version: 1, text },
      });
      return true;
    }
    if (existing.text === text) {
      return false;
    }
    existing.version += 1;
    existing.text = text;
    this.notify("textDocument/didChange", {
      textDocument: { uri, version: existing.version },
      contentChanges: [{ text }],
    });
    return true;
  }

  documentText(uri: string): string | undefined {
    return this.documents.get(uri)?.text;
  }

  getDiagnostics(uri: string): unknown[] | undefined {
    return this.diagnostics.get(uri)?.items;
  }

  // Monotonic per-publish counter so callers can tell a fresh push (after a
  // sync they just sent) from a stale cache entry.
  diagnosticsGeneration(uri: string): number {
    return this.diagnostics.get(uri)?.generation ?? 0;
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.alive) {
      // Polite shutdown with a short grace; a wedged server is killed anyway.
      await this.request("shutdown", null, SHUTDOWN_GRACE_MS);
      if (this.alive) {
        this.notify("exit");
      }
    }
    this.markDead();
    try {
      this.child.kill();
    } catch {
      // Already gone.
    }
  }

  private markDead(): void {
    if (!this.alive) {
      return;
    }
    this.alive = false;
    process.removeListener("exit", this.killOnProcessExit);
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve(null);
    }
    this.pending.clear();
    if (!this.disposed) {
      this.input.onUnexpectedExit?.();
    }
  }

  private ingest(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    // Frames can arrive split across chunks or merged into one; consume every
    // complete frame and keep the remainder buffered.
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }
      const header = this.buffer.subarray(0, headerEnd).toString("utf8");
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (lengthMatch === null) {
        // Unparseable header — drop it rather than wedge the stream.
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const contentLength = Number(lengthMatch[1]);
      const frameEnd = headerEnd + 4 + contentLength;
      if (this.buffer.length < frameEnd) {
        return;
      }
      const body = this.buffer.subarray(headerEnd + 4, frameEnd).toString("utf8");
      this.buffer = this.buffer.subarray(frameEnd);
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(body) as JsonRpcMessage;
      } catch {
        continue;
      }
      this.dispatch(message);
    }
  }

  private dispatch(message: JsonRpcMessage): void {
    if (message.method !== undefined && message.id !== undefined) {
      // Server-initiated request (client/registerCapability,
      // window/workDoneProgress/create, …): an empty success keeps servers
      // from stalling on client features we do not implement.
      this.send({ jsonrpc: "2.0", id: message.id, result: null });
      return;
    }
    if (message.method === "textDocument/publishDiagnostics") {
      const params = message.params as { uri?: unknown; diagnostics?: unknown } | undefined;
      if (typeof params?.uri === "string") {
        this.publishGeneration += 1;
        this.diagnostics.set(params.uri, {
          generation: this.publishGeneration,
          items: Array.isArray(params.diagnostics) ? params.diagnostics : [],
        });
      }
      return;
    }
    if (message.method !== undefined) {
      // Other notifications (logMessage, progress, …) are noise here.
      return;
    }
    if (typeof message.id !== "number") {
      return;
    }
    const pending = this.pending.get(message.id);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    pending.resolve(message.error !== undefined ? null : (message.result ?? null));
  }

  private send(message: JsonRpcMessage): void {
    const stdin = this.child.stdin;
    if (stdin === null || !stdin.writable) {
      return;
    }
    const body = Buffer.from(JSON.stringify(message), "utf8");
    try {
      stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
      stdin.write(body);
    } catch {
      // Dying server; the exit/error handler flips state.
    }
  }
}
