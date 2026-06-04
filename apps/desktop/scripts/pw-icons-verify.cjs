const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path"); const os = require("node:os"); const fs = require("node:fs");
const repo = require("path").resolve(__dirname, "..");
(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-icons-"));
  spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot, "codex"], { cwd: repo, stdio: "inherit" });
  const app = await _electron.launch({ args: [path.join(repo, "out/main/electron-main.js")], env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot } });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(1000);
  const GLYPHS = /[◆◇⌘⌙─✓□⌕]/;
  // Chips
  const chipsText = await page.locator(".composer-shell__start-context").innerText();
  const chipSvgs = await page.locator(".composer-shell__chip-icon svg").count();
  // Agent menu
  await page.locator('.composer-shell__context-chip[data-context-kind="agent"]').first().click();
  await page.waitForSelector('[data-choice-surface="agent_menu"]', { timeout: 5000 });
  const agentHtml = await page.locator('[data-choice-surface="agent_menu"]').innerHTML();
  await page.mouse.click(5,5); await page.waitForTimeout(200);
  // Branch menu scroll
  await page.locator('.composer-shell__context-chip[data-context-kind="branch"]').first().click();
  await page.waitForSelector('[data-choice-surface="branch_menu"]', { timeout: 5000 });
  await page.waitForTimeout(500);
  const rowsBox = await page.locator('[data-choice-surface="branch_menu"] .choice-surface__rows').boundingBox();
  const scrollable = await page.locator('[data-choice-surface="branch_menu"] .choice-surface__rows').evaluate(el => el.scrollHeight > el.clientHeight + 2);
  await page.mouse.click(5,5); await page.waitForTimeout(200);
  // Section + buttons
  const projAdd = await page.locator('.left-ui-section[aria-label="Projects"] [aria-label="Add project"]').count();
  const scratchAdd = await page.locator('.left-ui-section[aria-label="Scratch"] [aria-label="New scratch thread"]').count();
  await app.close();
  console.log("chip svg icons:", chipSvgs, "| chips text has glyph:", GLYPHS.test(chipsText));
  console.log("agent menu has glyph:", GLYPHS.test(agentHtml.replace(/<[^>]+>/g,"")), "| agent menu svgs:", (agentHtml.match(/<svg/g)||[]).length);
  console.log("branch rows scrollable:", scrollable, "| rows height:", rowsBox? Math.round(rowsBox.height):"n/a");
  console.log("Projects + btn:", projAdd, "| Scratch + btn:", scratchAdd);
  console.log("ICONS OK?", chipSvgs >= 4 && !GLYPHS.test(chipsText) && scrollable && projAdd===1 && scratchAdd===1);
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
