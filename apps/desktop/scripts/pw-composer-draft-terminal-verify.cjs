// LIVE verification (spec: composer-draft-thread): on the New Thread composer, opening a
// Terminal must spawn a REAL, TYPEABLE terminal (backed by the Composer's Draft Thread =
// the active thread), the chat must STAY the start composer, no thread appears in the rail,
// and Send must start the draft in place (terminal persists, chat → transcript).
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");
let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pw-draft-"));
  const seed = spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot], {
    cwd: repo,
    stdio: "inherit",
  });
  if (seed.status !== 0) throw new Error("seed failed");

  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(800);

  await page.evaluate(async (cwd) => { await window.tide.registerProject(cwd); }, repo);
  await page.waitForTimeout(400);

  // Fresh New Thread composer, scoped to the registered repo project.
  await page.locator("button", { hasText: /New thread/i }).first().click();
  await page.waitForTimeout(300);
  const scopeChip = page.locator("button", { hasText: "Scratch" }).first();
  if (await scopeChip.count()) {
    await scopeChip.click();
    await page.waitForTimeout(300);
    const projectRow = page.locator("button", { hasText: /tide/ }).last();
    if (await projectRow.count()) await projectRow.click();
    await page.waitForTimeout(400);
  }

  // The chat is the START composer (placeholder "Do anything").
  const composerInput = page.locator('textarea[placeholder="Do anything"]');
  check("composer shows the start composer before opening a pane", (await composerInput.count()) > 0);

  const railThreadsBefore = await page.locator(".thread-row, [data-thread-id]").count();

  // Open the Workbench (shows the Launcher in the composer), then pick Terminal.
  const openWb = page.locator('[aria-label="Open Workbench"]').first();
  if (await openWb.count()) {
    await openWb.click();
    await page.waitForTimeout(600);
  }
  const termAction = page.locator('[data-launcher-action="open_terminal"]').first();
  check("Terminal launcher action is present + enabled", (await termAction.count()) > 0 && (await termAction.isEnabled()));
  await termAction.click();
  await page.waitForTimeout(2500); // PTY spawn + shell prompt

  const termPane = page.locator('[data-pane-kind="terminal"]');
  check("a Terminal pane opens in the Composer workbench", (await termPane.count()) > 0);
  check("the terminal xterm rendered (PTY surface)", (await page.locator('[data-pane-kind="terminal"] .xterm').count()) > 0);
  await page.screenshot({ path: "/tmp/pw-draft-1-terminal-opened.png" });

  // The chat MUST still be the start composer (it did NOT flip to a transcript).
  check("chat stays the start composer after opening the terminal", (await page.locator('textarea[placeholder="Do anything"]').count()) > 0);
  // The Draft Thread is NOT listed in the rail until sent.
  const railThreadsAfter = await page.locator(".thread-row, [data-thread-id]").count();
  check("the Draft Thread is not added to the rail", railThreadsAfter === railThreadsBefore, `${railThreadsBefore} -> ${railThreadsAfter}`);

  // TYPE into the terminal — proves input routes to the draft's PTY. xterm is WebGL
  // (canvas), so we verify VISUALLY: type a marker + a command, screenshot, and the echoed
  // text + output must appear on the terminal surface.
  await page.locator('[data-pane-kind="terminal"] .xterm').first().click();
  await page.waitForTimeout(300);
  await page.keyboard.type("echo TIDE_DRAFT_OK_777", { delay: 30 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/tmp/pw-draft-2-after-typing.png" });
  console.log("note: eyeball /tmp/pw-draft-2-after-typing.png — must show 'TIDE_DRAFT_OK_777' typed AND echoed by the shell");

  // SEND: start the Draft Thread in place. The terminal must persist and the chat must
  // become a transcript (placeholder → follow-up).
  const sendInput = page.locator('textarea[placeholder="Do anything"]').first();
  await sendInput.click();
  await page.keyboard.type("hello from draft", { delay: 10 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "/tmp/pw-draft-3-after-send.png" });
  check("terminal pane persists after Send (started in place)", (await page.locator('[data-pane-kind="terminal"]').count()) > 0);
  check("chat became a transcript after Send", (await page.locator('textarea[placeholder="Do anything"]').count()) === 0);
  const railThreadsSent = await page.locator(".thread-row, [data-thread-id]").count();
  check("the started thread now appears in the rail", railThreadsSent > railThreadsBefore, `${railThreadsBefore} -> ${railThreadsSent}`);

  await app.close();
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error("verify failed:", error);
  process.exit(1);
});
