// Live verification for issue 3 (spec: composer-prompt-browser-fixes): while a reply
// streams, scrolling up must STICK — the auto-scroll must not yank the user back to the
// bottom on every token. Drives a real opencode/openai stream, scrolls up mid-stream,
// and asserts the position holds.
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
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pw-scroll-"));
  spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot], { cwd: repo, stdio: "inherit" });
  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector("[data-product-shell]", { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.evaluate(async (cwd) => { await window.tide.registerProject(cwd); }, repo);
  await page.waitForTimeout(400);
  const projectRow = page.locator("[data-project-row]").first();
  if (await projectRow.count()) await projectRow.hover().catch(() => {});
  await page.waitForTimeout(300);
  const newInProject = page.locator("[aria-label='New thread in project']").first();
  if (await newInProject.count()) await newInProject.click({ force: true });
  await page.waitForSelector('[data-chat-start="true"] textarea', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(600);

  await page.locator(`[data-chat-start="true"] [data-context-kind='agent']`).first().click().catch(() => {});
  await page.waitForTimeout(500);
  const ocRow = page.locator("[data-choice-row], [data-choice-row]").filter({ hasText: /opencode/i }).first();
  if (await ocRow.count()) await ocRow.click({ force: true });
  await page.waitForTimeout(9500);
  await page.locator(`[data-chat-start="true"] [aria-label='Model']`).first().click().catch(() => {});
  await page.waitForTimeout(700);
  const gpt = page.locator("[data-choice-row], [data-choice-row], [role='option']").filter({ hasText: /gpt-5\.5-fast|gpt-5\.5|gpt-5\.4/i }).first();
  if (await gpt.count()) await gpt.click({ force: true }); else await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  const composer = page.locator('[data-chat-start="true"] textarea, [data-agent-chat-shell] textarea').first();
  await composer.click();
  await composer.fill("List every integer from 1 to 220, one number per line with a short word after each. No preamble.");
  await composer.press("Enter");

  // Wait until the transcript has grown tall enough to scroll (content overflows).
  const grew = await page.waitForFunction(() => {
    const el = document.querySelector("[data-agent-session]");
    return el ? el.scrollHeight - el.clientHeight > 300 : false;
  }, { timeout: 30000 }).then(() => true).catch(() => false);
  check("the streaming transcript grows tall enough to scroll", grew);

  if (grew) {
    // Scroll up to the top-ish while the stream continues — simulate a real trackpad
    // wheel-up (the intent signal) plus the resulting position move.
    await page.evaluate(() => {
      const el = document.querySelector("[data-agent-session]");
      if (!el) return;
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: -400, bubbles: true }));
      el.scrollTop = 50;
    });
    const after = await page.evaluate(() => {
      const el = document.querySelector("[data-agent-session]");
      return el ? el.scrollTop : -1;
    });
    // Let several more tokens stream in (each previously snapped us back to the bottom).
    await page.waitForTimeout(2500);
    const held = await page.evaluate(() => {
      const el = document.querySelector("[data-agent-session]");
      return el ? { top: el.scrollTop, max: el.scrollHeight - el.clientHeight } : { top: -1, max: -1 };
    });
    console.log("scrollTop after up:", after, "→ after 2.5s of streaming:", held.top, "(bottom=", held.max, ")");
    check("scroll position holds near the top during streaming (not snapped to bottom)", held.top < 200, `top=${held.top}`);
    check("the user is NOT pinned at the bottom", held.max - held.top > 200, `dist-from-bottom=${held.max - held.top}`);
  }

  await app.close();
  console.log(`DONE failures=${failures} dataRoot=${dataRoot}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("PW ERROR", e); process.exit(1); });
