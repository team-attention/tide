// Dev-only: render a URL in offscreen Electron (same Chromium as the app) and
// write a PNG, so the editor/shell can actually be SEEN, not just measured.
const { app, BrowserWindow } = require("electron");
const fs = require("fs");

const url = process.argv[2] || "http://localhost:5199/dev-harness.html?probe=shot";
const out = process.argv[3] || "/tmp/mine.png";
const width = Number(process.argv[4] || 1440);
const height = Number(process.argv[5] || 900);

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    webPreferences: { offscreen: true, webviewTag: true },
  });
  win.webContents.setFrameRate(2);
  await win.loadURL(url);
  await new Promise((r) => setTimeout(r, 3000));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(out, image.toPNG());
  console.log("wrote", out, image.getSize());
  app.quit();
});
