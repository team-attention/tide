// Spec: version-management.md (Lane 1). App self-update is a single icon button
// in chrome, not a floating text pill over the user's work.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { act } from "react";

import { AppUpdateButton } from "../src/desktop/adapters/inbound/react-renderer/product-shell/support/app-update-pill.tsx";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type AppUpdateStatus =
  | { phase: "idle" }
  | { phase: "available"; version: string }
  | { phase: "downloading"; version: string; percent: number }
  | { phase: "ready"; version: string; notes?: string }
  | { phase: "error"; message: string };

test("app update renders as one icon-only button and keeps actions user driven", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const g = globalThis as unknown as {
    window?: unknown;
    document?: unknown;
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const original = { window: g.window, document: g.document, actEnv: g.IS_REACT_ACT_ENVIRONMENT };
  g.window = dom.window;
  g.document = dom.window.document;
  g.IS_REACT_ACT_ENVIRONMENT = true;

  const listeners: Array<(status: AppUpdateStatus) => void> = [];
  const calls: string[] = [];
  (dom.window as unknown as { tide: Record<string, unknown> }).tide = {
    onAppUpdateChanged(listener: (status: AppUpdateStatus) => void) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    downloadAppUpdate: () => calls.push("download"),
    checkForAppUpdate: () => calls.push("check"),
    applyAppUpdate: () => calls.push("apply"),
  };

  try {
    const { createRoot } = await import("react-dom/client");
    const container = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AppUpdateButton />);
    });
    assert.equal(container.querySelector("[data-app-update-control]"), null);

    await act(async () => {
      listeners[0]?.({ phase: "available", version: "0.2.0" });
    });
    const download = container.querySelector('[data-app-update-control][data-phase="available"]') as HTMLButtonElement | null;
    assert.ok(download);
    assert.equal(download.textContent, "");
    assert.match(download.getAttribute("aria-label") ?? "", /Download Tide 0\.2\.0 update/);

    await act(async () => {
      download.click();
    });
    assert.deepEqual(calls, ["download"]);
    const requested = container.querySelector('[data-app-update-control][data-phase="downloading"]') as HTMLButtonElement | null;
    assert.ok(requested, "clicking Download should immediately show a download-in-progress state");
    assert.equal(requested.disabled, true);
    assert.match(requested.getAttribute("aria-label") ?? "", /Downloading Tide 0\.2\.0: 0%/);
    assert.equal(requested.style.getPropertyValue("--app-update-progress"), "0%");

    await act(async () => {
      listeners[0]?.({ phase: "error", message: "network" });
    });
    const retry = container.querySelector('[data-app-update-control][data-phase="error"]') as HTMLButtonElement | null;
    assert.ok(retry);
    await act(async () => {
      retry.click();
    });
    assert.deepEqual(calls, ["download", "check"]);

    await act(async () => {
      listeners[0]?.({ phase: "ready", version: "0.2.0" });
    });
    const apply = container.querySelector('[data-app-update-control][data-phase="ready"]') as HTMLButtonElement | null;
    assert.ok(apply);
    await act(async () => {
      apply.click();
    });
    assert.deepEqual(calls, ["download", "check", "apply"]);

    await act(async () => {
      root.unmount();
    });
  } finally {
    g.window = original.window;
    g.document = original.document;
    g.IS_REACT_ACT_ENVIRONMENT = original.actEnv;
  }
});

test("app update button is owned by the left rail, not a floating root pill", () => {
  const leftRail = fs.readFileSync(
    path.join(repoRoot, "src/desktop/adapters/inbound/react-renderer/product-shell/left-rail/left-rail.tsx"),
    "utf8",
  );
  const rendererEntry = fs.readFileSync(
    path.join(repoRoot, "src/desktop/infrastructure/electron/renderer/renderer-entry.tsx"),
    "utf8",
  );
  const updateButtonSource = fs.readFileSync(
    path.join(repoRoot, "src/desktop/adapters/inbound/react-renderer/product-shell/support/app-update-pill.tsx"),
    "utf8",
  );

  assert.match(leftRail, /<AppUpdateButton \/>/);
  assert.doesNotMatch(rendererEntry, /AppUpdate(Pill|Button)/);
  assert.match(updateButtonSource, /const AppUpdateControl = styled\.button`[\s\S]*margin-left:\s*auto/);
  assert.doesNotMatch(updateButtonSource, /position:\s*fixed/);
  assert.doesNotMatch(updateButtonSource, /translateX\(-50%\)/);
});
