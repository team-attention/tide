// Auth-safe: boots the real app, scopes a Start Composer to the repo-root project,
// then for each agent (opencode, Codex) switches the composer agent and types "/" to
// verify the menu mirrors that agent's REAL command set (backend handshake probe →
// commandsChanged). Discovery is handshake-only — never sends a turn (codex auth safe).
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const desktop = path.resolve(__dirname, "..");
const repoRoot = path.resolve(__dirname, "../../..");

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pw-agentcmds-"));
  const ts = "2026-05-31T00:00:00.000Z";
  const record = {
    storageVersion: 1, threadId: "thread-seed-root", title: "Seeded repo-root thread",
    pinned: false, archived: false, createdAt: ts, updatedAt: ts,
    agentBinding: { agentId: "claude" },
    scope: { kind: "project", projectId: "tide-root", cwd: repoRoot },
    executionContext: { cwd: repoRoot, branch: "main" }, lastKnownState: "idle",
  };
  const seedCode = `
import { createThreadPersistenceService } from ${JSON.stringify(path.join(desktop, "src/backend/application/services/thread/thread-persistence-service.ts"))};
import { createFileAppStorage } from ${JSON.stringify(path.join(desktop, "src/backend/adapters/outbound/app-storage/file-app-storage.ts"))};
const svc = createThreadPersistenceService({ storage: createFileAppStorage({ appDataRoot: ${JSON.stringify(dataRoot)} }) });
const res = await svc.saveThreadMetadata(${JSON.stringify(record)});
if (!res.ok) { console.error("seed failed", res.error); process.exit(1); }
`;
  if (spawnSync("node", ["--experimental-strip-types", "--input-type=module", "-e", seedCode], { cwd: desktop, stdio: "inherit" }).status !== 0) throw new Error("seed failed");

  const app = await _electron.launch({ args: [path.join(desktop, "out/main/electron-main.js")], env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot } });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForSelector(".thread-row__main", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);

  // Scope a Start Composer to the repo-root project.
  const projectRow = page.locator(".project-row, [class*='project-row']").first();
  if ((await projectRow.count()) > 0) await projectRow.hover().catch(() => {});
  await page.waitForTimeout(400);
  const newInProject = page.locator("[aria-label='New thread in project']").first();
  if ((await newInProject.count()) === 0) { console.log("no New thread in project"); await app.close(); process.exit(2); }
  await newInProject.click({ force: true });
  await page.waitForSelector(".agent-chat-shell--start textarea", { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(600);

  const dumpRows = async () => {
    const rows = page.locator(".chip-popover__row, .choice-surface__row, [role='option']");
    const n = await rows.count(); const out = [];
    for (let i = 0; i < Math.min(n, 60); i += 1) out.push((await rows.nth(i).innerText()).trim().replace(/\s+/g, " "));
    return out;
  };

  for (const label of ["opencode", "Codex CLI"]) {
    // Open the agent chip menu and pick the agent.
    await page.locator(".agent-chat-shell--start [data-context-kind='agent']").first().click().catch(() => {});
    await page.waitForTimeout(500);
    const row = page.locator(".chip-popover__row, .choice-surface__row").filter({ hasText: label }).first();
    if ((await row.count()) === 0) { console.log(`[${label}] agent row not found; menu=`, JSON.stringify(await dumpRows())); await page.keyboard.press("Escape"); continue; }
    await row.click({ force: true });
    // Read AFTER the probe resolves (8s timeout) so a slow handshake isn't misread as empty.
    await page.waitForTimeout(9500);
    const composer = page.locator(".agent-chat-shell--start textarea").first();
    await composer.click(); await composer.fill(""); await composer.type("/", { delay: 60 });
    await page.waitForTimeout(900);
    const rows = await dumpRows();
    await page.screenshot({ path: `/tmp/pw-agentcmds-${label.split(" ")[0]}.png` });
    const names = rows.map((r) => r.split(" ")[0]);
    console.log(`[${label}] menu rows: ${rows.length} →`, JSON.stringify(names.slice(0, 50)));
    // Reset for next agent.
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
    await composer.fill("").catch(() => {});
    await page.waitForTimeout(300);
  }

  await app.close();
  console.log("DONE dataRoot=", dataRoot);
})().catch((e) => { console.error("PW ERROR", e); process.exit(1); });
