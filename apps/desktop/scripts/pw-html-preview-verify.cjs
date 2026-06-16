// Live verification (spec: workbench-html-preview.md): opening an .html file shows a
// rendered <webview> Preview by default, with a Preview/Code toggle to the source.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");
let failures = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures += 1; };

const htmlName = `pw-html-preview-${Date.now()}.html`;
const htmlPath = path.join(repo, htmlName);
const HTML = `<!doctype html><html><body style="background:#fff"><h1 id="probe" style="color:rebeccapurple;font-family:system-ui">HELLO TIDE PREVIEW</h1><p>rendered from file://</p></body></html>`;

(async () => {
  fs.writeFileSync(htmlPath, HTML, "utf8");
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pw-html-"));
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

  // Scope the start composer to the repo project so the file tree lists its files.
  const scopeChip = page.locator("button", { hasText: "Scratch" }).first();
  if (await scopeChip.count()) {
    await scopeChip.click();
    await page.waitForTimeout(400);
    await page.locator("button", { hasText: /desktop|tide/ }).last().click().catch(() => {});
    await page.waitForTimeout(700);
  }
  const treeToggle = page.locator("[aria-label='Open FileTree']");
  if (await treeToggle.count()) { await treeToggle.first().click(); await page.waitForTimeout(1500); }

  const fileRow = page.locator(".file-tree-row", { hasText: htmlName });
  const found = (await fileRow.count()) > 0;
  check("the .html file is listed in the file tree", found, htmlName);
  if (found) {
    await fileRow.first().click();
    await page.waitForTimeout(1500);
  }

  // Default: rendered <webview> preview + Preview/Code toggle, no source editor.
  await page.screenshot({ path: "/tmp/pw-html-1-preview.png" });
  const webview = page.locator(".workbench-html-webview");
  check("an HTML webview preview renders by default", (await webview.count()) > 0);
  check("the Preview/Code toggle is present", (await page.locator(".workbench-html-toggle__option").count()) >= 2);
  check("no source editor in preview mode", (await page.locator(".workbench-html .cm-editor").count()) === 0);
  const src = (await webview.first().getAttribute("src").catch(() => "")) || "";
  check("the webview loads the file via file://", src.startsWith("file://") && src.includes("pw-html-preview"), src);

  // Toggle to Code → source editor shows the HTML; webview gone.
  const codeBtn = page.locator(".workbench-html-toggle__option", { hasText: "Code" });
  await codeBtn.first().click().catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/pw-html-2-code.png" });
  const cm = await page.locator(".workbench-html .cm-content").innerText().catch(() => "");
  check("Code mode shows the HTML source", /HELLO TIDE PREVIEW/.test(cm), cm.slice(0, 80));
  check("the webview is gone in Code mode", (await page.locator(".workbench-html-webview").count()) === 0);

  // Toggle back to Preview → webview returns.
  await page.locator(".workbench-html-toggle__option", { hasText: "Preview" }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  check("toggling back to Preview restores the webview", (await page.locator(".workbench-html-webview").count()) > 0);
  await page.screenshot({ path: "/tmp/pw-html-3-preview-again.png" });

  fs.rmSync(htmlPath, { force: true });
  await app.close();
  console.log(`DONE failures=${failures} dataRoot=${dataRoot}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { try { fs.rmSync(htmlPath, { force: true }); } catch {} console.error("PW ERROR", e); process.exit(1); });
