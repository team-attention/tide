// Auth-safe verification of the UI/UX polish pass (ui-ux-polish-pass.md).
// Boots the real built app on a seeded data dir (never sends a message) and
// measures the three reported fixes: section-collapse height animation, start
// composer auto-grow + font size, and fullscreen toggle alignment.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");
const shot = (page, label) => page.screenshot({ path: `/tmp/polish-${label}.png` });
let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-polish-"));
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
  // Verify in LIGHT theme — that's where low-contrast issues (focus boxes, the
  // toggle/traffic-light overlap) actually show; dark theme hid them before.
  await page.evaluate(() => {
    try { localStorage.setItem("tide.theme", "light"); } catch {}
    document.documentElement.setAttribute("data-theme", "light");
  });
  await page.waitForTimeout(150);

  // Ensure the start surface (New Thread) is showing for the composer test.
  const newThread = page.locator("[data-left-nav-row]", { hasText: "New thread" }).first();
  if (await newThread.count()) {
    await newThread.click();
    await page.waitForTimeout(500);
  }
  await shot(page, "0-start");

  // ---- Rail toggle: same window x whether opening or closing, and clear of the
  //      macOS traffic lights (lights end ~72px; require >= 80). ----
  const closeBtn = page.locator('[aria-label="Close Left Rail"]').first();
  const closeX = (await closeBtn.boundingBox())?.x ?? -1;
  await closeBtn.click();
  await page.waitForTimeout(350);
  const openBtn = page.locator('[aria-label="Open Left Rail"]').first();
  const openX = (await openBtn.boundingBox())?.x ?? -1;
  await shot(page, "7-rail-closed");
  check(
    "rail toggle clears traffic lights + doesn't jump when toggling",
    Math.abs(closeX - openX) <= 3 && openX >= 80,
    `close@${closeX.toFixed(1)} open@${openX.toFixed(1)}`,
  );
  await openBtn.click(); // restore rail-open for the rest of the checks
  await page.waitForTimeout(350);

  // ---- Fix 2: start composer auto-grows + font 16px ----
  const input = page.locator('[data-composer-shell][data-composer-mode="start"] [data-composer-input]').first();
  if (await input.count()) {
    const font = await input.evaluate((el) => getComputedStyle(el).fontSize);
    const h0 = (await input.boundingBox()).height;
    const long = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}: build a thing that does X, Y, and Z`).join("\n");
    await input.fill(long);
    await page.waitForTimeout(300);
    const h1 = (await input.boundingBox()).height;
    await shot(page, "1-composer-grown");
    const outline = await input.evaluate((el) => getComputedStyle(el).outlineStyle);
    check("composer input has no focus outline box", outline === "none", `outline-style=${outline}`);
    check("composer font-size is 16px", font === "16px", font);
    check("composer grows with content", h1 > h0 + 20, `${Math.round(h0)}px -> ${Math.round(h1)}px`);
    const capped = await input.evaluate((el) => el.scrollHeight > el.clientHeight + 2);
    check("composer caps height then scrolls (max-height)", h1 <= 244, `${Math.round(h1)}px, scrolls=${capped}`);
    await input.fill("");
  } else {
    check("start composer present", false, "input not found");
  }

  // ---- Fix 1: section collapse is height-animated ([data-left-rail-collapsible]), not unmount ----
  const toggle = page.locator("[data-left-rail-section-toggle]").first();
  if (await toggle.count()) {
    const section = toggle.locator("xpath=ancestor::section[1]");
    const body = section.locator("[data-left-rail-collapsible]").first();
    check("section body uses [data-left-rail-collapsible] wrapper", (await body.count()) > 0);
    const exp0 = await body.getAttribute("data-expanded");
    const hExpanded = (await body.boundingBox())?.height ?? 0;
    await toggle.click();
    await page.waitForTimeout(350); // let the 0.2s grid-rows transition finish
    const exp1 = await body.getAttribute("data-expanded");
    const hCollapsed = (await body.boundingBox())?.height ?? 0;
    const rowsStillInDom = await body.locator("[data-thread-row], [data-project-group]").count();
    await shot(page, "2-section-collapsed");
    check("data-expanded flips true->false", exp0 === "true" && exp1 === "false", `${exp0} -> ${exp1}`);
    check("collapsed height shrinks toward 0", hCollapsed < hExpanded && hCollapsed <= 4, `${Math.round(hExpanded)}px -> ${Math.round(hCollapsed)}px`);
    check("rows stay mounted (animated, not unmounted)", rowsStillInDom > 0, `${rowsStillInDom} rows in DOM`);
    await toggle.click(); // restore
    await page.waitForTimeout(300);
  } else {
    check("a collapsible section exists", false, "no section toggle found");
  }

  // ---- Fix 3: fullscreen toggle aligns with the New Thread icon below it ----
  await page.evaluate(() => document.documentElement.classList.add("tide-fullscreen"));
  await page.waitForTimeout(150);
  const toggleBtn = page.locator('[aria-label="Close Left Rail"]').first();
  const toggleIcon = toggleBtn.locator("svg").first();
  const newThreadIcon = page.locator("[data-left-nav-row]", { hasText: "New thread" }).first().locator("svg").first();
  const trafficW = await page.locator("[data-traffic-controls]").first().evaluate((el) => el.getBoundingClientRect().width).catch(() => -1);
  if ((await toggleIcon.count()) && (await newThreadIcon.count())) {
    const a = await toggleIcon.boundingBox();
    const b = await newThreadIcon.boundingBox();
    const ca = a.x + a.width / 2;
    const cb = b.x + b.width / 2;
    await shot(page, "3-fullscreen-aligned");
    check("traffic spacer collapses in fullscreen (display:none)", trafficW === 0, `width=${trafficW}`);
    check("toggle icon aligns with New Thread icon (<=4px)", Math.abs(ca - cb) <= 4, `toggle@${ca.toFixed(1)} vs newThread@${cb.toFixed(1)}`);
  } else {
    check("fullscreen icons measurable", false);
  }
  await page.evaluate(() => document.documentElement.classList.remove("tide-fullscreen"));

  // ---- Workbench controls render INLINE when there's room (no "…" menu) ----
  const openWbCtl = page.locator('[aria-label="Open Workbench"]').first();
  if (await openWbCtl.count()) {
    await openWbCtl.click();
    await page.waitForTimeout(800);
    // Inline ⟺ the WorkbenchControlsMenu ("…" trigger) is ABSENT and the action
    // buttons render directly. (isVisible() can't tell inline from the collapsed
    // menu — the menu's popover buttons are opacity:0, which Playwright still calls
    // visible — so key off the menu trigger's presence.)
    const newPaneCount = await page.locator('[data-window-toggle-cluster] [aria-label="New Pane"]').count();
    const fsCount = await page.locator('[data-window-toggle-cluster] [aria-label="Fullscreen pane"]').count();
    const menuPresent = (await page.locator('[aria-label="Workbench controls"]').count()) > 0;
    await shot(page, "9-wb-controls-inline");
    check(
      "workbench controls render inline when wide (no '…' menu)",
      !menuPresent && newPaneCount > 0 && fsCount > 0,
      `menu=${menuPresent} newPane=${newPaneCount} fullscreen=${fsCount}`,
    );

    // Narrow the window so the rightmost column can't host the inline controls — they
    // must collapse back into the "…" menu (keeping the cramped column's tabs).
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(960, 760));
    await page.waitForTimeout(500);
    const menuWhenNarrow = (await page.locator('[aria-label="Workbench controls"]').count()) > 0;
    await shot(page, "10-wb-controls-collapsed");
    check("workbench controls collapse to '…' menu when cramped", menuWhenNarrow, `menu=${menuWhenNarrow}`);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 820));
    await page.waitForTimeout(400);
  }

  // ---- Deep-audit captures (animations are temporal; confirm overlays RENDER) ----
  const settingsRow = page.locator("[data-left-nav-row]", { hasText: "Settings" }).first();
  if (await settingsRow.count()) {
    await settingsRow.click();
    await page.waitForTimeout(300);
    const modal = page.locator("[data-settings-modal]").first();
    const modalVisible = (await modal.count()) > 0 && (await modal.boundingBox())?.height > 100;
    const anim = await modal.evaluate((el) => getComputedStyle(el).animationName).catch(() => "none");
    check("settings modal renders with entrance animation", modalVisible && anim === "tide-modal-in", `visible=${modalVisible} anim=${anim}`);
    await shot(page, "4-settings");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }

  const modelChip = page.locator('[aria-label="Model"]').first();
  if (await modelChip.count()) {
    await modelChip.click();
    await page.waitForTimeout(300);
    const surface = page.locator("[data-choice-surface]").first();
    const surfVisible = (await surface.count()) > 0 && (await surface.boundingBox())?.height > 30;
    check("composer dropdown (choice-surface) renders", surfVisible);
    await shot(page, "5-model-menu");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }

  const ftToggle = page.locator('[aria-label="Open FileTree"]').first();
  if (await ftToggle.count()) {
    await ftToggle.click();
    await page.waitForTimeout(900);
    const folder = page.locator('[data-file-kind="folder"]').first();
    let grew = false;
    if (await folder.count()) {
      const before = await page.locator("[data-file-kind]").count();
      await folder.click();
      await page.waitForTimeout(500);
      const after = await page.locator("[data-file-kind]").count();
      grew = after > before;
      const rowAnim = await page.locator("[data-file-kind]").first().evaluate((el) => getComputedStyle(el).animationName).catch(() => "none");
      check("file-tree rows carry entrance animation", rowAnim === "tide-tree-row-in", rowAnim);
    }
    check("file-tree folder expands", grew);
    await shot(page, "6-filetree");

    // Opening two DIFFERENT files opens two editor tabs (not replace-in-slot).
    const fileA = page.locator('[data-file-kind="file"]', { hasText: "README.md" }).first();
    const fileB = page.locator('[data-file-kind="file"]', { hasText: "package.json" }).first();
    if ((await fileA.count()) > 0 && (await fileB.count()) > 0) {
      await fileA.click();
      await page.waitForTimeout(800);
      await fileB.click();
      await page.waitForTimeout(900);
      const editorTabs = await page.locator('[data-workbench-tab][data-kind="editor"]').count();
      await shot(page, "12-two-editors");
      check("opening two files opens two editor tabs (no replace)", editorTabs === 2, `editorTabs=${editorTabs}`);

      // Markdown preview: the Preview/Edit/Pick controls live IN the file-path header
      // row (one bar), not a separate floating toolbar.
      await fileA.click(); // back to README.md (markdown)
      await page.waitForTimeout(700);
      const mdHeader = page.locator("[data-md-header]");
      const headerHasBreadcrumb = (await mdHeader.locator("[data-editor-breadcrumb]").count()) > 0;
      const headerHasToggle = (await mdHeader.locator("[data-md-toggle]").count()) > 0;
      const strayToggle = await page
        .locator("[data-md-mode] > [data-md-toggle]")
        .count(); // old floating bar (direct child) must be gone
      await shot(page, "13-md-header");
      check(
        "markdown controls live in the file-path header row (one bar)",
        (await mdHeader.count()) > 0 && headerHasBreadcrumb && headerHasToggle && strayToggle === 0,
        `header=${await mdHeader.count()} breadcrumb=${headerHasBreadcrumb} toggle=${headerHasToggle} stray=${strayToggle}`,
      );
    }
  }

  // ---- Browser pane must never render a nameless tab (about:blank) ----
  const openWb = page.locator('[aria-label="Open Workbench"]').first();
  if (await openWb.count()) {
    await openWb.click();
    await page.waitForTimeout(800);
  }
  // Earlier steps may have left an editor (not the launcher) active; summon a fresh
  // launcher with New Pane so the open_browser action is present.
  if ((await page.locator('[data-launcher-action="open_browser"]').count()) === 0) {
    const newPane = page.locator('[aria-label="New Pane"]').first();
    if (await newPane.count()) {
      await newPane.click();
      await page.waitForTimeout(600);
    }
  }
  const openBrowser = page.locator('[data-launcher-action="open_browser"]').first();
  if (await openBrowser.count()) {
    await openBrowser.click();
    await page.waitForTimeout(1800);
    const browserTab = page.locator('[data-workbench-tab][data-kind="browser"] [data-workbench-tab-title]').first();
    const browserTitle = ((await browserTab.count()) ? await browserTab.innerText() : "").trim();
    await shot(page, "8-browser-tab");
    check("browser tab has a name even at about:blank", browserTitle.length > 0, `title="${browserTitle}"`);

    // Cmd/Ctrl+click on a link opens a NEW Browser Pane. The gesture's disposition
    // can't be faked from the host page, so simulate exactly what Main's
    // setWindowOpenHandler does for a "background-tab": send the IPC the preload now
    // bridges. This exercises preload → renderer subscription → onOpenBrowserPane →
    // a fresh (draft) pane.
    const browserTabsBefore = await page.locator('[data-workbench-tab][data-kind="browser"]').count();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.send("tide:open-browser-pane", "https://example.com/new-pane"),
    );
    await page.waitForTimeout(800);
    const browserTabsAfter = await page.locator('[data-workbench-tab][data-kind="browser"]').count();
    await shot(page, "11-cmd-click-new-pane");
    check(
      "cmd/ctrl+click link opens a NEW browser pane",
      browserTabsAfter === browserTabsBefore + 1,
      `${browserTabsBefore} -> ${browserTabsAfter}`,
    );
  } else {
    check("open_browser launcher available", false);
  }

  await app.close();
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("PW ERROR", e);
  process.exit(1);
});
