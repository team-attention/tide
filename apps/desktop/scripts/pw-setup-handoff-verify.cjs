// LIVE verification (spec: provider-cli-setup-handoff, slice 2): on the New Thread composer,
// a NOT-INSTALLED agent slot must be SELECTABLE (not greyed), and selecting it must IMMEDIATELY
// surface its install readiness card (the new provider.checkReadiness on-select handoff) — not
// only on Send. An installed+authed agent must show NO readiness card (ready).
//
// To exercise the not-installed path on a machine where every CLI is installed, the wrapper
// temporarily renames ~/.local/bin/codex aside (restored via trap) so `which codex` fails and
// codex alone appears not-installed; claude, opencode, and npm stay available. (The app
// re-derives the login-shell PATH at startup and hardcodes ~/.local/bin + /opt/homebrew/bin as
// fallbacks, so pruning PATH cannot hide a CLI — removing the binary is the only lever.)
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

async function openAgentMenu(page) {
  const chip = page.locator('button[data-composer-context-chip][data-context-kind="agent"]').first();
  await chip.click();
  await page.waitForSelector('[data-choice-surface="agent_menu"]', { timeout: 5000 });
  // thread.listed (which carries availableAgents) is built synchronously alongside the opencode
  // catalog subprocess, so it can land a beat AFTER the menu opens. Until it does, the menu shows
  // the default "all available" snapshot. Wait for the availability to settle (codex is hidden in
  // this run → its row must read "Not installed") before reading labels, so the assertion isn't
  // racing the async snapshot. Times out gracefully so a genuine regression still FAILs the check.
  await page
    .waitForFunction(
      () => {
        const rows = Array.from(document.querySelectorAll('[data-choice-surface="agent_menu"] [data-choice-row]'));
        const codex = rows.find((r) => /codex/i.test(r.querySelector("[data-choice-row-label]")?.textContent || ""));
        return codex && /not installed/i.test(codex.querySelector("[data-choice-row-detail]")?.textContent || "");
      },
      { timeout: 12000 },
    )
    .catch(() => {});
  await page.waitForTimeout(150);
}

async function agentRows(page) {
  return page.$$eval('[data-choice-surface="agent_menu"] [data-choice-row]', (els) =>
    els.map((el) => ({
      label: el.querySelector("[data-choice-row-label]")?.textContent?.trim() ?? "",
      detail: el.querySelector("[data-choice-row-detail]")?.textContent?.trim() ?? "",
      disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
    })),
  );
}

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pw-handoff-"));
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
  await page.waitForTimeout(900);

  await page.locator("button", { hasText: /New thread/i }).first().click();
  await page.waitForTimeout(400);

  // --- 1. The agent menu lists a not-installed agent as SELECTABLE ---
  await openAgentMenu(page);
  let rows = await agentRows(page);
  await page.screenshot({ path: "/tmp/pw-handoff-1-agent-menu.png" });
  console.log("agent rows:", JSON.stringify(rows));

  const codexRow = rows.find((r) => /codex/i.test(r.label));
  const claudeRow = rows.find((r) => /claude/i.test(r.label));
  check("codex row is present", codexRow !== undefined);
  check("codex shows 'Not installed' (CLI hidden via PATH)", /not installed/i.test(codexRow?.detail ?? ""), codexRow?.detail);
  check("codex row is SELECTABLE (not disabled)", codexRow !== undefined && !codexRow.disabled);
  check("claude row stays installed (only codex hidden)", claudeRow !== undefined && !claudeRow.disabled && /agent integration/i.test(claudeRow?.detail ?? ""), claudeRow?.detail);

  // --- 2. Selecting the not-installed slot surfaces its install card IMMEDIATELY ---
  await page.locator('[data-choice-surface="agent_menu"] [data-choice-row]', { hasText: /codex/i }).first().click();
  await page.waitForTimeout(1200); // provider.checkReadiness round-trip → providerReadiness.changed
  const readiness = page.locator('[data-choice-surface="provider_readiness"]');
  check("a Provider Readiness card appears on select (no Send)", (await readiness.count()) > 0);
  await page.screenshot({ path: "/tmp/pw-handoff-2-codex-install-card.png" });

  const readyRows = (await readiness.count())
    ? await page.$$eval('[data-choice-surface="provider_readiness"] [data-choice-row]', (els) =>
        els.map((el) => ({
          label: el.querySelector("[data-choice-row-label]")?.textContent?.trim() ?? "",
          rowSelected: el.getAttribute("data-selected"),
        })),
      )
    : [];
  console.log("readiness rows:", JSON.stringify(readyRows));
  check(
    "card names the missing Codex executable (not_installed blocker)",
    readyRows.some((r) => /codex/i.test(r.label) && /not be found|not found/i.test(r.label)),
    readyRows.map((r) => r.label).join(" | "),
  );
  check(
    "card offers a setup/install action row (slice-1 install setup attached)",
    readyRows.some((r) => /set up|install/i.test(r.label)),
  );

  // --- 3. PROBE: an installed + authed agent shows NO install card (readiness ran, returned ready) ---
  await openAgentMenu(page);
  rows = await agentRows(page);
  const opencodeRow = rows.find((r) => /opencode/i.test(r.label));
  check("opencode row present + selectable (installed)", opencodeRow !== undefined && !opencodeRow.disabled, opencodeRow?.detail);
  await page.locator('[data-choice-surface="agent_menu"] [data-choice-row]', { hasText: /opencode/i }).first().click();
  await page.waitForTimeout(1200);
  const cardAfterOpencode = await page.locator('[data-choice-surface="provider_readiness"]').count();
  const installLabelAfterOpencode = cardAfterOpencode
    ? await page.$$eval('[data-choice-surface="provider_readiness"] [data-choice-row]', (els) =>
        els.some((el) => /not be found|not found/i.test(el.querySelector("[data-choice-row-label]")?.textContent ?? "")))
    : false;
  await page.screenshot({ path: "/tmp/pw-handoff-3-opencode-selected.png" });
  console.log("opencode → readiness card count:", cardAfterOpencode, "has not-installed row:", installLabelAfterOpencode);
  check("selecting installed opencode shows NO not-installed card (readiness re-ran for the new agent)", installLabelAfterOpencode === false);

  await app.close();
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error("verify failed:", error);
  process.exit(1);
});
