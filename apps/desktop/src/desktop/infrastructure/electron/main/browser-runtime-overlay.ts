export const BROWSER_RUNTIME_OVERLAY_TAKE_CONTROL_URL = "tide-browser-runtime://take-control";

export function browserRuntimeOverlayDataUrl(input: {
  cursor?: { x: number; y: number };
  threadId: string;
  paneId: string;
}): string {
  const cursor = input.cursor;
  const cursorHtml =
    cursor === undefined
      ? ""
      : `<div class="cursor" style="left:${cssNumber(cursor.x)}px;top:${cssNumber(cursor.y)}px"><span></span></div>`;
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: transparent;
      color: #f7f7f7;
      font: 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .veil {
      position: fixed;
      inset: 0;
      cursor: not-allowed;
      box-shadow: inset 0 0 0 2px #3478f6;
      background: transparent;
    }
    .cursor {
      position: fixed;
      width: 14px;
      height: 14px;
      margin: -1px 0 0 -1px;
      border-radius: 50%;
      background: #3478f6;
      border: 2px solid #fff;
      pointer-events: none;
    }
    .cursor span {
      position: absolute;
      inset: -7px;
      border-radius: 50%;
      border: 2px solid #3478f6;
      animation: ripple 1.6s ease-out infinite;
    }
    @keyframes ripple {
      0% { transform: scale(0.4); opacity: 0.6; }
      100% { transform: scale(1.7); opacity: 0; }
    }
    .banner {
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 8px 6px 12px;
      border-radius: 999px;
      background: rgba(30, 30, 34, 0.94);
      border: 1px solid rgba(255, 255, 255, 0.18);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.32);
      white-space: nowrap;
    }
    .button {
      display: inline-flex;
      align-items: center;
      height: 24px;
      padding: 0 9px;
      border-radius: 999px;
      background: #3478f6;
      color: white;
      text-decoration: none;
      font-weight: 600;
    }
  </style>
</head>
<body data-thread-id="${escapeHtml(input.threadId)}" data-pane-id="${escapeHtml(input.paneId)}">
  <div class="veil" aria-hidden="true"></div>
  ${cursorHtml}
  <div class="banner">
    <span>Agent is driving this browser</span>
    <a class="button" href="${BROWSER_RUNTIME_OVERLAY_TAKE_CONTROL_URL}">Take control</a>
  </div>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function cssNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
