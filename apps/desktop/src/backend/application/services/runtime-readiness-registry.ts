// Per-runtime "tool surface ready" latch. A provider CLI's first turn must not be
// delivered until that runtime's Tide MCP server has completed its tool-surface
// handshake (it has sent tools/list), otherwise the agent can start the turn before
// its MCP tools are registered for dispatch and the turn hangs with no tool result
// (codex#19425/#20771). The signal is latched: marking ready before a waiter exists
// still resolves a later wait. See docs_v2/specs/agent-turn-handoff-readiness.md.

export interface AwaitToolSurfaceOptions {
  // Extra settle after the tools/list signal to absorb a provider's post-discovery
  // tool-registration lag (the registration step that runs after tools/list).
  settleMs?: number;
  // Hard cap: deliver anyway if the signal never arrives (an agent that never lists
  // tools must not hang the turn forever).
  timeoutMs?: number;
}

export interface RuntimeReadinessRegistry {
  markToolSurfaceReady(runtimeId: string): void;
  awaitToolSurface(runtimeId: string, options?: AwaitToolSurfaceOptions): Promise<void>;
  forget(runtimeId: string): void;
}

interface RuntimeReadinessDeps {
  // Injectable for tests; defaults to real timers.
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

const DEFAULT_SETTLE_MS = 400;
const DEFAULT_TIMEOUT_MS = 8000;

export function createRuntimeReadinessRegistry(
  deps: RuntimeReadinessDeps = {},
): RuntimeReadinessRegistry {
  const setTimeoutFn = deps.setTimeout ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimeoutFn = deps.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  // Latched readiness per runtime, plus pending waiters to resolve on the signal.
  const ready = new Set<string>();
  const waiters = new Map<string, Array<() => void>>();

  return {
    markToolSurfaceReady(runtimeId) {
      ready.add(runtimeId);
      const pending = waiters.get(runtimeId);
      if (pending !== undefined) {
        waiters.delete(runtimeId);
        for (const resolve of pending) {
          resolve();
        }
      }
    },

    awaitToolSurface(runtimeId, options) {
      const settleMs = options?.settleMs ?? DEFAULT_SETTLE_MS;
      const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      const afterSignal = (): Promise<void> =>
        settleMs > 0
          ? new Promise((resolve) => setTimeoutFn(() => resolve(), settleMs))
          : Promise.resolve();

      if (ready.has(runtimeId)) {
        return afterSignal();
      }

      return new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeoutFn(timeoutHandle);
          resolve();
        };
        const timeoutHandle = setTimeoutFn(finish, timeoutMs);
        const onSignal = () => {
          void afterSignal().then(finish);
        };
        const pending = waiters.get(runtimeId) ?? [];
        pending.push(onSignal);
        waiters.set(runtimeId, pending);
      });
    },

    forget(runtimeId) {
      ready.delete(runtimeId);
      waiters.delete(runtimeId);
    },
  };
}
