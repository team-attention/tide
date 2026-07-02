import type { BrowserRuntimePort } from "../../ports/outbound/browser-runtime-port.ts";

export function createUnavailableBrowserRuntimePort(): BrowserRuntimePort {
  const unavailable = {
    ok: false as const,
    error: {
      code: "browser_runtime_unavailable",
      message: "BrowserRuntime is unavailable in this backend process.",
    },
  };
  return {
    async ensure() {
      return unavailable;
    },
    async observe() {
      return unavailable;
    },
    async act() {
      return unavailable;
    },
    async close() {
      return unavailable;
    },
  };
}
