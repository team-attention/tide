// Auth-safe live check for the slash menu. Seeds a thread at the REPO ROOT (where
// .claude/commands/* live) with the claude agent, boots the real built app, then:
//   A) opens the seeded thread (repo-root, claude) and types "/" — expect the
//      project commands AND the built-in session commands (/model, …) to list.
//   B) scopes a NEW Start Composer to that project ("New thread in project") and
//      types "/" — expect ONLY the project commands; the built-ins must be hidden.
// Never sends a message, never spawns a provider.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const desktop = path.resolve(__dirname, "..");
const repoRoot = path.resolve(__dirname, "../../..");

const PROJECT_CMD = /\/(check|work|design-eye|language-map|tide-v2-plan)/;
const BUILTIN_CMD = /\/(model|clear|compact|context|agents|review|resume|init|config)\b/;

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pw-start-slash-"));
  const ts = "2026-05-31T00:00:00.000Z";
  const record = {
    storageVersion: 1,
    threadId: "thread-seed-root",
    title: "Seeded repo-root thread",
    pinned: false,
    archived: false,
    createdAt: ts,
    updatedAt: ts,
    agentBinding: { agentId: "claude" },
    scope: { kind: "project", projectId: "tide-root", cwd: repoRoot },
    executionContext: { cwd: repoRoot, branch: "main" },
    lastKnownState: "idle",
  };
  const seedCode = `
import { createThreadPersistenceService } from ${JSON.stringify(path.join(desktop, "src/backend/application/services/thread/thread-persistence-service.ts"))};
import { createFileAppStorage } from ${JSON.stringify(path.join(desktop, "src/backend/adapters/outbound/app-storage/file-app-storage.ts"))};
const svc = createThreadPersistenceService({ storage: createFileAppStorage({ appDataRoot: ${JSON.stringify(dataRoot)} }) });
const res = await svc.saveThreadMetadata(${JSON.stringify(record)});
if (!res.ok) { console.error("seed failed", res.error); process.exit(1); }
console.log("seeded");
`;
  const seed = spawnSync("node", ["--experimental-strip-types", "--input-type=module", "-e", seedCode], {
    cwd: desktop,
    stdio: "inherit",
  });
  if (seed.status !== 0) throw new Error("seed failed");

  const app = await _electron.launch({
    args: [path.join(desktop, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector("[data-product-shell]", { timeout: 20000 });
  await page.waitForSelector("[data-thread-row-main]", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  console.log("project rows:", await page.locator("[data-project-row-title]").count());
  console.log("thread rows:", await page.locator("[data-thread-row-main]").count());

  const dumpRows = async () => {
    const rows = page.locator("[data-choice-row], [data-choice-row], [role='option']");
    const n = await rows.count();
    const labels = [];
    for (let i = 0; i < Math.min(n, 40); i += 1) labels.push((await rows.nth(i).innerText()).trim().replace(/\s+/g, " "));
    return labels;
  };
  const typeSlash = async (scopeSel) => {
    const composer = page.locator(`${scopeSel} textarea`).first();
    if ((await composer.count()) === 0) return null;
    await composer.click();
    await composer.fill("");
    await composer.type("/", { delay: 60 });
    await page.waitForTimeout(800);
    return dumpRows();
  };

  // PART B FIRST (clean rail) — Start Composer scoped to the project: project
  // commands only, the built-ins must be hidden.
  const projectRow = page.locator("[data-project-row]").first();
  if ((await projectRow.count()) > 0) await projectRow.hover().catch(() => {});
  await page.waitForTimeout(400);
  const newInProject = page.locator("[aria-label='New thread in project']").first();
  let bLabels = null;
  if ((await newInProject.count()) > 0) {
    await newInProject.click({ force: true });
    await page.waitForSelector('[data-chat-start="true"] textarea', { timeout: 6000 }).catch(() => {});
    // The Start Composer scope dispatches provider.discoverCommands; the backend
    // handshake probe spawns the agent (~1-2s) and replies via commandsChanged.
    await page.waitForTimeout(4500);
    const onStart = await page.locator('[data-chat-start="true"] textarea').count();
    console.log("B) on start composer?", onStart > 0);
    bLabels = await typeSlash('[data-chat-start="true"]');
    await page.screenshot({ path: "/tmp/pw-slash-B-start.png" });
    const bJoined = (bLabels ?? []).join(" | ");
    console.log("B) start-composer rows:", (bLabels ?? []).length, JSON.stringify((bLabels ?? []).map((l) => l.split(" ")[0])));
    // Now the Start Composer must mirror the agent's FULL set incl. /goal.
    console.log("B) VERDICT popoverOpens=", (bLabels ?? []).length > 0, " hasProjectCmd=", PROJECT_CMD.test(bJoined), " has/goal(expect TRUE)=", /\/goal\b/.test(bJoined));
  } else {
    console.log("B) WARN: 'New thread in project' not found — cannot scope start composer");
  }

  // Dismiss the open suggestions popover (its backdrop intercepts clicks) before
  // navigating to PART A.
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('[data-chat-start="true"] textarea, [data-agent-chat-shell] textarea').first().fill("").catch(() => {});
  await page.waitForTimeout(300);

  // PART A — in-thread (repo-root, claude): full list incl. built-ins.
  await page.locator("[data-thread-row-main]").first().click();
  await page.waitForTimeout(1200);
  const threadLabels = await typeSlash("[data-agent-chat-shell]");
  await page.screenshot({ path: "/tmp/pw-slash-A-thread.png" });
  const aJoined = (threadLabels ?? []).join(" | ");
  console.log("A) in-thread rows:", JSON.stringify(threadLabels));
  console.log("A) VERDICT hasProjectCmd=", PROJECT_CMD.test(aJoined), " hasBuiltin(expect true)=", BUILTIN_CMD.test(aJoined));

  await app.close();
  console.log("DONE dataRoot=", dataRoot);
})().catch((e) => {
  console.error("PW ERROR", e);
  process.exit(1);
});
