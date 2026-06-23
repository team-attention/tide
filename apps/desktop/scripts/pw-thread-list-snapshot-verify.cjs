// Live verify: thread-list first-paint snapshot (spec: thread-list-first-paint-snapshot.md).
// Boots the REAL built app twice:
//   (A) against a seeded dataRoot whose enriched index has records → asserts the Main
//       sendSync snapshot reaches window.tide.initialThreadList AND the rail shows real
//       rows with no rail-skeleton.
//   (B) against an empty dataRoot → asserts the snapshot is null (skeleton fallback) and
//       the app still settles (backend list, zero threads). Never spawns codex.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");
const main = path.join(repo, "out/main/electron-main.js");

async function launch(dataRoot) {
  const app = await _electron.launch({
    args: [main],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  return { app, page };
}

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failures += 1;
}

(async () => {
  // ---- (A) seeded → snapshot fast path ----
  const seededRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-snap-A-"));
  const seed = spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), seededRoot], {
    cwd: repo,
    stdio: "inherit",
  });
  if (seed.status !== 0) throw new Error("seed failed");

  // Backend-side proof: the persisted index now embeds the full record.
  const indexJson = JSON.parse(
    fs.readFileSync(path.join(seededRoot, "threads", "index.json"), "utf8"),
  );
  check(
    "enriched index entry carries record.threadId",
    indexJson?.threads?.[0]?.record?.threadId === "thread-seed-filetree",
  );

  const a = await launch(seededRoot);
  const snapshot = await a.page.evaluate(() => window.tide?.initialThreadList ?? null);
  check("window.tide.initialThreadList is populated", Array.isArray(snapshot?.threads) && snapshot.threads.length > 0);
  check(
    "snapshot carries the seeded thread",
    !!snapshot?.threads?.some((t) => t.threadId === "thread-seed-filetree" && t.title === "Seeded file tree thread"),
  );
  check("snapshot omits live flag at boot (absent ⇒ false)", snapshot?.threads?.[0]?.live === undefined);

  const railRows = await a.page.locator(".thread-row__main").count();
  const skeleton = await a.page.locator(".rail-skeleton").count();
  check("rail shows real thread rows", railRows > 0);
  check("rail has no skeleton", skeleton === 0);
  await a.page.screenshot({ path: path.join(os.tmpdir(), "pw-snap-A-seeded.png") });
  await a.app.close();

  // ---- (B) empty dataRoot → null snapshot / skeleton fallback ----
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-snap-B-"));
  const b = await launch(emptyRoot);
  const emptySnap = await b.page.evaluate(() => {
    if (!window.tide || !("initialThreadList" in window.tide)) return "KEY_MISSING";
    return window.tide.initialThreadList === null ? "IS_NULL" : "HAS_VALUE";
  });
  check("empty dataRoot → initialThreadList is null (not throwing)", emptySnap === "IS_NULL");
  await b.page.waitForTimeout(1500);
  const emptyRows = await b.page.locator(".thread-row__main").count();
  check("empty dataRoot settles with zero rows (no crash)", emptyRows === 0);
  await b.page.screenshot({ path: path.join(os.tmpdir(), "pw-snap-B-empty.png") });
  await b.app.close();

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAIL`} — seededRoot=${seededRoot}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("PW ERROR", e);
  process.exit(1);
});
