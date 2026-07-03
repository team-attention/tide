// Live verification for the main-process BrowserRuntime host.
// It drives the real built Electron app, opens a Browser Pane through the real
// workbench command path, then verifies the main-owned WebContentsView can:
// 1. render into the visible Workbench pane,
// 2. produce a fresh screenshot while detached from the visible pane, and
// 3. execute a hidden click action with a terminal result.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");
const threadId = "thread-seed-filetree";
let failures = 0;

function check(label, condition, detail = "") {
  const ok = Boolean(condition);
  console.log(`${ok ? "PASS" : "FAIL"} - ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function pageUrl(input) {
  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${input.title}</title>
        <style>
          html, body {
            margin: 0;
            min-height: 100vh;
            background: rgb(${input.color.join(",")});
            color: white;
            font: 24px system-ui, sans-serif;
          }
          main {
            padding: 32px;
          }
          button {
            margin-top: 24px;
            padding: 14px 18px;
            font: inherit;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>${input.marker}</h1>
          <p id="status">ready-${input.marker}</p>
          <button
            id="go"
            onpointerdown="document.getElementById('status').textContent='pointer-${input.marker}'"
            onclick="document.getElementById('status').textContent+=' clicked-${input.marker}'"
          >Click ${input.marker}</button>
        </main>
      </body>
    </html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function sendBackendCommand(page, kind, payload) {
  return page.evaluate(
    async ({ kind, payload }) => {
      return window.tide.sendBackendCommand({
        contractVersion: 1,
        requestId: `pw-browser-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind,
        issuedAt: new Date().toISOString(),
        payload,
      });
    },
    { kind, payload },
  );
}

async function runtimeRequest(app, operation, payload) {
  return app.evaluate(
    async (_electron, { operation, payload }) => {
      const host = globalThis.__tideBrowserRuntimeHost;
      if (host === undefined) {
        return {
          kind: "browserRuntime.response",
          requestId: "missing-test-hook",
          ok: false,
          error: { code: "missing_test_hook", message: "BrowserRuntime test hook is unavailable." },
        };
      }
      return host.handleRequest({
        kind: "browserRuntime.request",
        requestId: `pw-browser-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        operation,
        payload,
      });
    },
    { operation, payload },
  );
}

async function setRuntimeStage(app, stage) {
  await app.evaluate(
    async ({ BrowserWindow }, stage) => {
      const host = globalThis.__tideBrowserRuntimeHost;
      const windows = BrowserWindow.getAllWindows();
      const window = windows.find((candidate) => candidate.isVisible()) ?? windows[0];
      if (host === undefined || window === undefined) {
        return false;
      }
      host.setStage(window, stage);
      return true;
    },
    stage,
  );
}

async function runtimeDebug(app, paneId) {
  return app.evaluate(
    async ({ BrowserWindow }, { threadId, paneId }) => {
      const host = globalThis.__tideBrowserRuntimeHost;
      const windows = BrowserWindow.getAllWindows();
      const window = windows.find((candidate) => candidate.isVisible()) ?? windows[0];
      const runtime = host?.runtimes?.get(`${threadId}:${paneId}`);
      const bounds = runtime?.view?.getBounds?.();
      const overlayBounds = runtime?.overlayView?.getBounds?.();
      return {
        windowId: window?.id ?? null,
        attachedWindowId: runtime?.attachedWindowId ?? null,
        overlayAttachedWindowId: runtime?.overlayAttachedWindowId ?? null,
        bounds: bounds ?? null,
        overlayBounds: overlayBounds ?? null,
      };
    },
    { threadId, paneId },
  );
}

async function clickOverlayTakeControl(app, paneId) {
  return app.evaluate(
    async (_electron, { threadId, paneId }) => {
      const host = globalThis.__tideBrowserRuntimeHost;
      const runtime = host?.runtimes?.get(`${threadId}:${paneId}`);
      if (runtime?.overlayView === undefined) {
        return false;
      }
      await runtime.overlayView.webContents.executeJavaScript(
        "document.querySelector('.button')?.click()",
        true,
      );
      return true;
    },
    { threadId, paneId },
  );
}

async function waitForRuntimeText(app, paneId, marker) {
  const deadline = Date.now() + 10_000;
  let last = null;
  while (Date.now() < deadline) {
    const response = await runtimeRequest(app, "observe", {
      threadId,
      paneId,
      mode: "text",
    });
    last = response;
    const text = response.payload?.observation?.bodyTextPreview ?? "";
    if (response.ok && text.includes(marker)) {
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return last;
}

async function samplePng(page, data, x, y) {
  return page.evaluate(
    async ({ data, x, y }) => {
      try {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (ctx === null) {
          return null;
        }
        ctx.drawImage(img, 0, 0);
        return Array.from(ctx.getImageData(x, y, 1, 1).data);
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          dataLength: typeof data === "string" ? data.length : 0,
        };
      }
    },
    { data, x, y },
  );
}

function nearRgb(pixel, expected, tolerance = 42) {
  return (
    Array.isArray(pixel) &&
    Math.abs(pixel[0] - expected[0]) <= tolerance &&
    Math.abs(pixel[1] - expected[1]) <= tolerance &&
    Math.abs(pixel[2] - expected[2]) <= tolerance
  );
}

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pw-browser-runtime-"));
  const seed = spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot], {
    cwd: repo,
    stdio: "inherit",
  });
  if (seed.status !== 0) {
    throw new Error("seed failed");
  }

  const alpha = {
    title: "Runtime Alpha",
    marker: "runtime-alpha-visible",
    color: [18, 128, 70],
  };
  const beta = {
    title: "Runtime Beta",
    marker: "runtime-beta-hidden",
    color: [30, 87, 173],
  };

  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: {
      ...process.env,
      TIDE_APP_DATA_ROOT: dataRoot,
      TIDE_ENABLE_BROWSER_RUNTIME_TEST_HOOKS: "1",
    },
  });

  const page = await app.firstWindow();
  await page.waitForSelector("[data-product-shell]", { timeout: 20_000 });
  await page.waitForFunction(
    () => (document.body.innerText || "").includes("Seeded file tree thread"),
    { timeout: 15_000 },
  );
  await page.locator("[data-thread-row-main]").first().click();
  await page.waitForTimeout(700);

  const openWorkbench = page.locator('[aria-label="Open Workbench"]');
  if (await openWorkbench.count()) {
    await openWorkbench.first().click();
  }
  await page.waitForTimeout(700);

  const events = await sendBackendCommand(page, "workbench.command", {
    threadId,
    command: "open_browser",
    data: {
      url: pageUrl(alpha),
      title: alpha.title,
      disposition: "reuse_active_browser",
    },
  });
  const changed = events.find((event) => event.kind === "workbench.changed");
  const pane = changed?.payload?.panes?.find((candidate) => candidate.kind === "browser");
  const paneId = pane?.paneId;
  check("workbench.command opened a browser pane", typeof paneId === "string");
  if (typeof paneId !== "string") {
    await app.close();
    process.exit(1);
  }

  const stage = page.locator('[data-browser-runtime-stage][data-native-runtime="true"] [data-browser-native-stage]').first();
  await stage.waitFor({ timeout: 10_000 });
  const box = await stage.boundingBox();
  check("native BrowserRuntime stage has visible bounds", box && box.width > 200 && box.height > 160);

  const visibleText = await waitForRuntimeText(app, paneId, alpha.marker);
  check(
    "visible runtime DOM settled",
    visibleText?.ok && visibleText.payload?.observation?.bodyTextPreview?.includes(alpha.marker),
  );

  await page.waitForTimeout(500);
  const debug = await runtimeDebug(app, paneId);
  check(
    "visible WebContentsView is attached to the main window",
    debug.attachedWindowId === debug.windowId &&
      debug.bounds !== null &&
      debug.bounds.width > 200 &&
      debug.bounds.height > 160,
    `debug=${JSON.stringify(debug)}`,
  );

  if (box !== null) {
    const windowShot = await page.screenshot({
      clip: {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.max(1, Math.round(box.width)),
      height: Math.max(1, Math.round(box.height)),
      },
    });
    const visiblePixel = await samplePng(page, windowShot.toString("base64"), 20, 20);
    console.log(
      `INFO - renderer screenshot pixel over native stage: ${JSON.stringify(visiblePixel)} ` +
        "(Playwright screenshots do not reliably include Electron native child views)",
    );
  }

  const visibleBoth = await runtimeRequest(app, "observe", {
    threadId,
    paneId,
    mode: "both",
  });
  const visibleScreenshot = visibleBoth.payload?.observation?.screenshot;
  const visibleShotPixel = visibleScreenshot === undefined
    ? null
    : await samplePng(page, visibleScreenshot.data, 20, 20);
  check(
    "visible observe(mode=both) returns current pixels",
    visibleBoth.ok && visibleScreenshot !== undefined && nearRgb(visibleShotPixel, alpha.color),
    `pixel=${JSON.stringify(visibleShotPixel)}`,
  );

  if (box !== null) {
    await setRuntimeStage(app, {
      threadId,
      paneId,
      visible: true,
      bounds: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      },
      url: pageUrl(alpha),
      title: alpha.title,
      overlay: {
        agentDriving: true,
        cursor: { x: 44, y: 52 },
      },
    });
    await page.waitForTimeout(300);
    const overlayDebug = await runtimeDebug(app, paneId);
    check(
      "native agent overlay is layered above the BrowserRuntime view",
      overlayDebug.overlayAttachedWindowId === overlayDebug.windowId &&
        overlayDebug.overlayBounds !== null &&
        overlayDebug.overlayBounds.width === overlayDebug.bounds?.width &&
        overlayDebug.overlayBounds.height === overlayDebug.bounds?.height,
      `debug=${JSON.stringify(overlayDebug)}`,
    );
    const releaseEvent = page.evaluate(() => new Promise((resolve) => {
      const off = window.tide.onBrowserRuntimeReleaseControl((threadId, paneId) => {
        off();
        resolve({ threadId, paneId });
      });
    }));
    const clickedOverlay = await clickOverlayTakeControl(app, paneId);
    const releasePayload = await releaseEvent;
    check("native overlay Take control emits renderer release event", clickedOverlay);
    check(
      "native overlay release event targets the current browser pane",
      releasePayload?.threadId === threadId && releasePayload?.paneId === paneId,
      `payload=${JSON.stringify(releasePayload)}`,
    );
    await setRuntimeStage(app, {
      threadId,
      paneId,
      visible: true,
      bounds: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      },
      url: pageUrl(alpha),
      title: alpha.title,
      overlay: { agentDriving: false },
    });
  }

  await setRuntimeStage(app, {
    threadId,
    paneId,
    visible: false,
    bounds: null,
    url: pageUrl(beta),
    title: beta.title,
  });
  const hiddenEnsure = await runtimeRequest(app, "ensure", {
    threadId,
    paneId,
    url: pageUrl(beta),
    title: beta.title,
  });
  check("hidden runtime navigated through capture surface", hiddenEnsure.ok);

  const hiddenText = await waitForRuntimeText(app, paneId, beta.marker);
  check(
    "hidden runtime DOM settled",
    hiddenText?.ok && hiddenText.payload?.observation?.bodyTextPreview?.includes(beta.marker),
  );

  const hiddenBoth = await runtimeRequest(app, "observe", {
    threadId,
    paneId,
    mode: "both",
  });
  const hiddenScreenshot = hiddenBoth.payload?.observation?.screenshot;
  const hiddenShotPixel = hiddenScreenshot === undefined
    ? null
    : await samplePng(page, hiddenScreenshot.data, 20, 20);
  check(
    "hidden observe(mode=both) returns fresh detached pixels",
    hiddenBoth.ok &&
      hiddenScreenshot !== undefined &&
      nearRgb(hiddenShotPixel, beta.color) &&
      hiddenScreenshot.data !== visibleScreenshot?.data,
    `pixel=${JSON.stringify(hiddenShotPixel)}`,
  );

  const button = hiddenBoth.payload?.observation?.interactiveElements?.find(
    (candidate) => candidate.text?.includes(beta.marker) || candidate.text?.includes("Click"),
  );
  const action = await runtimeRequest(app, "act", {
    threadId,
    paneId,
    action: {
      actionId: "pw-hidden-click",
      kind: "click_element",
      elementIndex: button?.index ?? 0,
      requestedAt: new Date().toISOString(),
    },
  });
  check("hidden action completes synchronously", action.ok && action.payload?.status === "completed");
  check(
    "hidden action updated page state",
    action.payload?.observation?.bodyTextPreview?.includes(`pointer-${beta.marker}`) &&
      action.payload?.observation?.bodyTextPreview?.includes(`clicked-${beta.marker}`),
  );

  await runtimeRequest(app, "close", {
    threadId,
    paneId,
    reason: "pane_closed",
  });
  await app.close();
  console.log(failures === 0 ? "ALL CHECKS PASS" : `FAILURES: ${failures}`);
  console.log("DONE dataRoot=", dataRoot);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error("PW ERROR", error);
  process.exit(1);
});
