const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const repo = require("path").resolve(__dirname, "..");

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-md-"));
  spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot], { cwd: repo, stdio: "inherit" });
  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(900);
  await page.locator(".thread-row__main").first().click();
  await page.waitForTimeout(800);
  await page.locator('[aria-label="Open FileTree"]').first().click();
  await page.waitForTimeout(1000);
  // open AGENTS.md (markdown)
  const md = page.locator('.file-tree-row:has-text("AGENTS.md")').first();
  await md.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "/tmp/pw-md.png" });

  const probe = await page.evaluate(() => {
    const out = {};
    const sel = (s) => {
      const el = document.querySelector(s);
      if (!el) return "MISSING";
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, color: cs.color, colorScheme: cs.colorScheme };
    };
    out.colorScheme = getComputedStyle(document.documentElement).colorScheme;
    out.mediaDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    out.preview = sel(".workbench-md-preview");
    out.breadcrumb = sel(".workbench-editor-breadcrumb");
    out.editorPane = sel(".workbench-pane-content--editor");
    out.columnPane = sel(".workbench-column__pane");
    out.body = { bg: getComputedStyle(document.body).backgroundColor };
    return out;
  });
  console.log(JSON.stringify(probe, null, 2));
  await app.close();
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
