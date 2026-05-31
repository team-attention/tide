// Figma conformance harness — NOT shipped. Mounts the real TideProductShell
// with a fixture state matching the canonical Figma workbench frame (1223:2):
// left rail populated, an open project thread (follow-up composer), the
// Workbench Editor pane showing CLAUDE.md, and the FileTree column open. This
// lets the shell render in a plain browser (no Electron backend) so its layout
// can be screenshotted and compared pixel-for-pixel against the Figma frame.
import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { TideProductShell } from "../adapters/inbound/react-renderer/tide-product-shell.ts";
import {
  applyProductShellBackendEvent,
  createProductShellState,
  openProductShellThread,
} from "../application/domains/product-shell/product-shell-state.ts";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@xterm/xterm/css/xterm.css";
import "./tide-product-shell.css";

const CLAUDE_MD_PREVIEW = [
  "# Tide — Project Rules",
  "",
  "## Evidence-First (BLOCKING)",
  "",
  "Every factual claim in a response MUST be backed by",
  "evidence you gathered in this conversation.",
  "",
  "Evidence means: code you read, search results you got,",
  "docs you checked, or something the user told you.",
  "",
  "This is a blocking rule. Do NOT write a response containing",
  "factual claims, then plan to verify afterward. Verify FIRST,",
  "respond SECOND.",
].join("\n");

const fileTreeEntry = (
  id: string,
  name: string,
  kind: "folder" | "file",
  active = false,
) => ({ id, name, relativePath: name, depth: 0, kind, active });

function figmaFixtureState() {
  const opened = openProductShellThread(
    createProductShellState({ includeFixtureData: true }),
    "thread-master-plan",
  );
  // Hydrate the thread so the composer renders in its follow-up state (the 90px
  // canonical Figma composer), not the start composer with the launch-context
  // block.
  const hydrated = applyProductShellBackendEvent(opened, {
    kind: "thread.hydrated",
    payload: {
      thread: {
        threadId: "thread-master-plan",
        title: "v2 master plan implementation",
        agentBinding: { agentId: "codex" },
        scope: { kind: "project", projectId: "tide", cwd: "/Users/eatnug/Workspace/tide" },
        createdAt: "2026-05-31T00:00:00.000Z",
        updatedAt: "2026-05-31T00:00:00.000Z",
        pinned: false,
        archived: false,
        lastKnownState: "idle",
      },
      runtimeState: "idle",
      blocks: [
        {
          blockId: "b-user-1",
          threadId: "thread-master-plan",
          kind: "message",
          role: "user",
          status: "complete",
          body: "Reproduce the Figma workbench layout exactly.",
          updatedAt: "2026-05-31T00:00:00.000Z",
        },
        {
          blockId: "b-agent-1",
          threadId: "thread-master-plan",
          kind: "message",
          role: "agent",
          status: "complete",
          body: "Conforming the shell to the canonical frame now.",
          updatedAt: "2026-05-31T00:00:01.000Z",
        },
      ],
    },
  });
  return applyProductShellBackendEvent(hydrated, {
    kind: "workbench.changed",
    payload: {
      threadId: "thread-master-plan",
      activePaneId: "pane-editor",
      panes: [
        {
          paneId: "pane-editor",
          kind: "editor",
          title: "CLAUDE.md",
          visible: true,
          revision: "pane-editor:rev",
          updatedAt: "2026-05-31T00:00:00.000Z",
          filePath: "/Users/eatnug/Workspace/tide/CLAUDE.md",
          relativePath: "CLAUDE.md",
          bodyTextPreview: CLAUDE_MD_PREVIEW,
          byteLength: 4096,
          truncated: false,
        },
      ],
      fileTree: {
        cwdLabel: "tide",
        root: "/Users/eatnug/Workspace/tide",
        entries: [
          fileTreeEntry("e-assets", "assets", "folder"),
          fileTreeEntry("e-crates", "crates", "folder"),
          fileTreeEntry("e-dist", "dist", "folder"),
          fileTreeEntry("e-docs", "docs", "folder"),
          fileTreeEntry("e-docs2", "docs_v2", "folder"),
          fileTreeEntry("e-src", "src", "folder"),
          fileTreeEntry("e-target", "target", "folder"),
          fileTreeEntry("e-tests", "tests", "folder"),
          fileTreeEntry("e-agents", "AGENTS.md", "file"),
          fileTreeEntry("e-cargo", "Cargo.toml", "file"),
          fileTreeEntry("e-claude", "CLAUDE.md", "file", true),
          fileTreeEntry("e-readme", "README.md", "file"),
          fileTreeEntry("e-package", "package.json", "file"),
        ],
      },
    },
  });
}

// Measurements are reported via document.title because the Tide Browser Pane
// snapshot extractor does not surface this CSS-grid DOM as readable text, but
// capture_pane reliably returns the title.
function setTitle(payload: unknown): void {
  document.title = "M:" + JSON.stringify(payload);
}

function px(selector: string): number | null {
  const el = document.querySelector(selector);
  return el ? Math.round((el as HTMLElement).getBoundingClientRect().width) : null;
}
function pxH(selector: string): number | null {
  const el = document.querySelector(selector);
  return el ? Math.round((el as HTMLElement).getBoundingClientRect().height) : null;
}

function measure(): void {
  setTitle({
    interLoaded: (document as unknown as { fonts?: { check(f: string): boolean } }).fonts?.check(
      "500 12px Inter",
    ),
    leftRailW: px('[data-column="left-ui"]'), // Figma 256
    topRowH: pxH(".left-ui__top-row"), // Figma 52
    fileTreeW: px('[aria-label="FileTree"]'), // Figma 344
    fileTreeSearchH: pxH(".file-tree-column__search"), // Figma 32
    fileRowH: pxH(".file-tree-row"), // Figma 30
    composerMode: (document.querySelector(".composer-shell") as HTMLElement | null)?.dataset
      .composerMode,
    composerH: pxH(".composer-shell"), // Figma 90
    composerInputH: pxH(".composer-shell__input"),
    composerToolbarH: pxH(".composer-shell__toolbar"),
    composerBodyH: pxH(".composer-shell__body"),
    composerChipH: pxH(".composer-shell__choice-chip"), // Figma 28
    tabH: pxH(".workbench-tab"), // Figma 30
    tabBarH: pxH('[data-column="workbench"] .column-top-row'), // Figma 52
  });
}

const root = document.getElementById("root");
if (root) {
  try {
    // FileTree column is gated by fileTreeOpen; flip it on for the fixture.
    const state = { ...figmaFixtureState(), fileTreeOpen: true };
    createRoot(root).render(createElement(TideProductShell, { initialState: state }));
    const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (fonts?.ready) {
      fonts.ready.then(() => setTimeout(measure, 150));
    } else {
      setTimeout(measure, 400);
    }
  } catch (error) {
    setTitle({ harnessError: (error as Error)?.stack ?? String(error) });
  }
}
window.addEventListener("error", (event) => {
  setTitle({ windowError: event.message, stack: event.error?.stack ?? "" });
});
window.addEventListener("unhandledrejection", (event) => {
  setTitle({ rejection: String((event as PromiseRejectionEvent).reason) });
});
