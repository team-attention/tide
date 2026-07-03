// Auth-safe editor language-intelligence verification: drives the REAL built
// app (Playwright + seeded thread, hydrate only — never sends a message) and
// exercises the workbench-editor-language-intelligence surface end-to-end
// through the real backend: themed syntax tokens, backend autocomplete, hover,
// occurrence highlighting, and the grown context menu.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");
const shots = [];
let failures = 0;

function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function dump(page, label) {
  const file = `/tmp/pw-editor-intel-${label}.png`;
  await page.screenshot({ path: file });
  shots.push(file);
}

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pw-intel-"));
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
  await page.waitForSelector("[data-product-shell]", { timeout: 20000 });
  await page.waitForTimeout(1000);

  const threadRows = page.locator("[data-thread-row-main]");
  if ((await threadRows.count()) > 0) {
    await threadRows.first().click();
    await page.waitForTimeout(1200);
  }

  // Open a real TS file via Quick Open so we land on a known-intelligent file.
  // The full tree loads asynchronously after Cmd+P — retype until results land.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+p" : "Control+p");
  await page.waitForTimeout(1000);
  let resultRows = 0;
  for (let attempt = 0; attempt < 10 && resultRows === 0; attempt += 1) {
    await page.locator("[data-quick-open-input]").fill("");
    await page.keyboard.type("code-intel-mappers");
    await page.waitForTimeout(1000);
    resultRows = await page.locator("[data-quick-open-row]").count();
  }
  console.log("quick-open results:", resultRows);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);
  await dump(page, "1-file-open");

  const editor = page.locator("[data-code-editor-host] .cm-content");
  check("editor pane opened", (await editor.count()) > 0);

  // 1. Themed syntax highlighting: classHighlighter emits tok-* spans.
  const tokenCount = await page.locator("[data-code-editor-host] .cm-content [class*='tok-']").count();
  check("themed tok-* syntax tokens render", tokenCount > 20, `${tokenCount} tokens`);

  // 1b. Render isolation (spec: desktop-product-shell-render-isolation): typing in the
  // composer re-renders the shell on every keystroke. With per-slice subscriptions the
  // workbench column bails, so the CodeMirror editor is NOT reconfigured and keeps its
  // tok-* highlighting. Before the redesign this churn dropped highlighting mid-stream.
  const composer = page.locator("[data-composer-input]").first();
  if (await composer.count()) {
    await composer.click();
    await page.keyboard.type("render isolation probe — editor must stay highlighted", { delay: 15 });
    await page.waitForTimeout(300);
    const tokensWhileTyping = await page
      .locator("[data-code-editor-host] .cm-content [class*='tok-']")
      .count();
    check(
      "editor keeps tok-* highlighting while the composer re-renders the shell",
      tokensWhileTyping > 20,
      `${tokensWhileTyping} tokens while typing`,
    );
    await composer.fill("");
  } else {
    check("editor keeps tok-* highlighting while the composer re-renders the shell", false, "no composer input");
  }

  // 2. Occurrence highlighting: put the caret on an identifier, expect marks.
  const identifier = page.locator("[data-code-editor-host] .cm-content .tok-variableName").first();
  if (await identifier.count()) {
    await identifier.click();
    await page.waitForTimeout(1500);
    const occurrences = await page.locator(".cm-tide-occurrence").count();
    check("occurrence highlights appear at the cursor", occurrences >= 1, `${occurrences} marks`);
  } else {
    check("occurrence highlights appear at the cursor", false, "no identifier token found");
  }
  await dump(page, "2-occurrences");

  // 3. Hover tooltip through the real backend TS engine.
  const hoverTarget = page.locator("[data-code-editor-host] .cm-content .tok-variableName").first();
  if (await hoverTarget.count()) {
    await hoverTarget.hover();
    await page.waitForTimeout(2000);
    const hoverCount = await page.locator(".cm-tide-hover").count();
    check("hover tooltip renders type info", hoverCount > 0, `${hoverCount} tooltip`);
    if (hoverCount > 0) {
      console.log("hover text:", (await page.locator(".cm-tide-hover").first().innerText()).slice(0, 120));
    }
  }
  await dump(page, "3-hover");

  // 4. Autocomplete through the real backend: type a member access.
  await editor.first().click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("const probe = JSON.", { delay: 40 });
  await page.waitForTimeout(2500);
  const completionOptions = await page.locator(".cm-tooltip-autocomplete li").count();
  check("autocomplete options surface for JSON. member access", completionOptions > 0, `${completionOptions} options`);
  if (completionOptions > 0) {
    console.log(
      "first options:",
      (await page.locator(".cm-tooltip-autocomplete").first().innerText()).split("\n").slice(0, 5).join(", "),
    );
  }
  await dump(page, "4-autocomplete");
  await page.keyboard.press("Escape");

  // 5. Diagnostics: the junk member access on a misspelled global should
  // produce squiggles (cm-lintRange) or EOF lint points (cm-lintPoint).
  await page.keyboard.type("nosuchglobal.x", { delay: 30 });
  await page.waitForTimeout(3000);
  const lintMarks = await page.locator("[data-code-editor-host] [class*='cm-lint']").count();
  check("diagnostics render on the dirty buffer", lintMarks > 0, `${lintMarks} lint marks`);

  // 6. Context menu: right-click shows the grown action set.
  await editor.first().click({ button: "right" });
  await page.waitForTimeout(400);
  const menuText = (await page.locator("[data-editor-menu]").innerText().catch(() => "")) ?? "";
  for (const item of ["Cut", "Copy", "Paste", "Go to Definition", "Find References"]) {
    check(`context menu lists ${item}`, menuText.includes(item));
  }
  await dump(page, "5-context-menu");
  await page.keyboard.press("Escape");

  await app.close();
  console.log("screenshots:", shots.join(" "));
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error("verify failed:", error);
  process.exit(1);
});
