// Live verification for ESC → interrupt (spec: esc-interrupts-run.md). Sends a real
// opencode turn (auth-safe), waits until it is running (Stop button shown), presses
// Escape, and asserts the run is interrupted (Stop button reverts to Send).
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
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pw-esc-"));
  spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot], { cwd: repo, stdio: "inherit" });
  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.evaluate(async (cwd) => { await window.tide.registerProject(cwd); }, repo);
  await page.waitForTimeout(400);
  const projectRow = page.locator(".project-row, [class*='project-row']").first();
  if (await projectRow.count()) await projectRow.hover().catch(() => {});
  await page.waitForTimeout(300);
  const newInProject = page.locator("[aria-label='New thread in project']").first();
  if (await newInProject.count()) await newInProject.click({ force: true });
  await page.waitForSelector(".agent-chat-shell--start textarea", { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(600);

  // opencode agent.
  await page.locator(".agent-chat-shell--start [data-context-kind='agent']").first().click().catch(() => {});
  await page.waitForTimeout(500);
  const ocRow = page.locator(".chip-popover__row, .choice-surface__row").filter({ hasText: /opencode/i }).first();
  if (await ocRow.count()) await ocRow.click({ force: true });
  await page.waitForTimeout(9500);

  // Pick a known-working OpenAI model (valid token), avoiding the expired default.
  await page.locator(".agent-chat-shell--start [aria-label='Model']").first().click().catch(() => {});
  await page.waitForTimeout(700);
  const gpt = page.locator(".chip-popover__row, .choice-surface__row, [role='option']").filter({ hasText: /gpt-5\.5-fast|gpt-5\.5|gpt-5\.4/i }).first();
  if (await gpt.count()) { await gpt.click({ force: true }); } else { await page.keyboard.press("Escape"); }
  await page.waitForTimeout(800);

  // Send a streaming prompt that runs long enough to interrupt.
  const composer = page.locator(".agent-chat-shell--start textarea, .agent-chat-shell textarea").first();
  await composer.click();
  await composer.fill("List every integer from 1 to 80, one number per line, with a short word after each.");
  await composer.press("Enter");

  // Wait for the run to be live: the composer Stop button appears.
  const stop = page.locator(".composer-shell__send--stop");
  let became = false;
  try { await stop.waitFor({ state: "visible", timeout: 25000 }); became = true; } catch {}
  check("turn reaches the running state (Stop button shown)", became);
  await page.screenshot({ path: "/tmp/pw-esc-1-running.png" });

  if (became) {
    // Press Escape — must interrupt like the Stop button.
    await page.keyboard.press("Escape");
    let stopped = false;
    try { await stop.waitFor({ state: "hidden", timeout: 15000 }); stopped = true; } catch {}
    check("Escape interrupts the run (Stop button reverts)", stopped);
    await page.waitForTimeout(500);
    await page.screenshot({ path: "/tmp/pw-esc-2-interrupted.png" });
  }

  await app.close();
  console.log(`DONE failures=${failures} dataRoot=${dataRoot}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("PW ERROR", e); process.exit(1); });
