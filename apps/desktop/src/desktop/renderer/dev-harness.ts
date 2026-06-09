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
  submitProductShellComposerDraft,
  updateProductShellComposerDraft,
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
        scope: { kind: "project", projectId: "tide", cwd: "/Users/you/Workspace/tide" },
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
          title: "workbench-markdown-preview-editor.md",
          visible: true,
          revision: "pane-editor:rev",
          updatedAt: "2026-05-31T00:00:00.000Z",
          filePath: "/Users/you/Workspace/tide/docs_v2/specs/workbench-markdown-preview-editor.md",
          relativePath: "docs_v2/specs/workbench-markdown-preview-editor.md",
          bodyTextPreview: CLAUDE_MD_PREVIEW,
          byteLength: 4096,
          truncated: false,
        },
      ],
      fileTree: {
        cwdLabel: "tide",
        root: "/Users/you/Workspace/tide",
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

// Queued-message fixture: a running turn with a follow-up queued behind it, so the
// "대기 중" queued row and its edit affordance render for visual verification.
// Spec: docs_v2/specs/composer-message-edit.md.
function queuedFixtureState() {
  const base = { ...figmaFixtureState(), fileTreeOpen: true };
  const running = applyProductShellBackendEvent(base, {
    kind: "agentRuntime.stateChanged",
    payload: { threadId: "thread-master-plan", state: "running", changedAt: "2026-05-31T00:00:02.000Z" },
  });
  const drafted = updateProductShellComposerDraft(running, "Also update the README while you're at it");
  return submitProductShellComposerDraft(drafted).state;
}

// Rich-transcript fixture: a realistic multi-block agent conversation (user turn,
// reasoning, agent markdown with code + lists, a read file-chip, a shell tool call
// + result, and an edit diff) so the transcript's visual fidelity can be eyeballed
// against the native Codex/Claude apps. Not shipped.
function richTranscriptFixtureState() {
  const opened = openProductShellThread(
    createProductShellState({ includeFixtureData: true }),
    "thread-master-plan",
  );
  const at = (s: number) => `2026-05-31T00:00:${String(s).padStart(2, "0")}.000Z`;
  const block = (b: Record<string, unknown>) => ({
    threadId: "thread-master-plan",
    status: "complete",
    updatedAt: at(0),
    ...b,
  });
  const hydrated = applyProductShellBackendEvent(opened, {
    kind: "thread.hydrated",
    payload: {
      thread: {
        threadId: "thread-master-plan",
        title: "Tighten the agent transcript",
        agentBinding: { agentId: "codex" },
        scope: { kind: "project", projectId: "tide", cwd: "/Users/you/Workspace/tide" },
        createdAt: at(0),
        updatedAt: at(9),
        pinned: false,
        archived: false,
        lastKnownState: "idle",
      },
      runtimeState: "idle",
      blocks: [
        block({
          blockId: "r-user-1",
          kind: "message",
          role: "user",
          body: "The agent transcript feels a bit flat next to the Codex app. Read the renderer, then tighten the spacing and tool log so it reads cleanly.",
          updatedAt: at(1),
        }),
        block({
          blockId: "r-reason-1",
          kind: "reasoning",
          role: "reasoning",
          title: "Thought for 8s",
          body: "The user wants the transcript to feel premium. I should open the chat shell renderer first to see how turns, tool logs, and diffs are styled, then adjust the spacing scale and the tool-log treatment. Let me read the file before changing anything.",
          updatedAt: at(2),
        }),
        block({
          blockId: "r-tool-read",
          kind: "tool_call",
          role: "tool",
          title: "Read",
          body: JSON.stringify({ file_path: "/Users/you/Workspace/tide/src/desktop/adapters/inbound/react-renderer/agent-chat-shell.ts" }),
          updatedAt: at(3),
        }),
        block({
          blockId: "r-tool-grep",
          kind: "tool_call",
          role: "tool",
          title: "Shell",
          body: JSON.stringify({ command: "rg -n \"agent-session-turn\" src/desktop/renderer/tide-product-shell.css | head" }),
          updatedAt: at(4),
        }),
        block({
          blockId: "r-tool-grep-out",
          kind: "tool_result",
          role: "tool",
          title: "Shell",
          body: "1198:.agent-session-turn {\n1207:.agent-session-turn--agent {\n1214:.agent-session-turn--user {\n1242:.agent-session-turn__label {",
          updatedAt: at(5),
        }),
        block({
          blockId: "r-agent-1",
          kind: "message",
          role: "agent",
          body: [
            "Found it. The transcript renders through `createAgentSessionTurn`, and the spacing is driven by a single `--gap`. Here's the plan:",
            "",
            "1. Tighten the vertical rhythm between turns so related blocks group.",
            "2. Give the **tool log** a quieter, monospace treatment with a left rail.",
            "3. Render reasoning as a collapsible, muted section.",
            "",
            "The core change is small:",
            "",
            "```ts",
            "const role = block.role === \"user\" ? \"user\" : \"agent\";",
            "return createElement(\"article\", { className: `turn turn--${role}` }, body);",
            "```",
            "",
            "I'll start with the spacing and tool log.",
          ].join("\n"),
          updatedAt: at(6),
        }),
        block({
          blockId: "r-tool-edit",
          kind: "tool_call",
          role: "tool",
          title: "Edit",
          body: JSON.stringify({
            file_path: "src/desktop/renderer/tide-product-shell.css",
            old_string: ".agent-session-turn {\n  margin-bottom: 16px;\n}",
            new_string: ".agent-session-turn {\n  margin-bottom: 22px;\n  line-height: 1.62;\n}",
          }),
          updatedAt: at(7),
        }),
        block({
          blockId: "r-agent-2",
          kind: "message",
          role: "agent",
          body: "Done — the turns now breathe and the tool log sits on its own rail. Want me to apply the same rhythm to the diff view?",
          updatedAt: at(8),
        }),
      ],
    },
  });
  const withUsage = applyProductShellBackendEvent(hydrated, {
    kind: "agentRuntime.usageChanged",
    payload: {
      threadId: "thread-master-plan",
      usage: { totalTokens: 82400, contextWindow: 256000, contextUsedPercent: 32, model: "gpt-5.5" },
    },
  });
  // Seed a couple of composer content chips so the "Add to chat" pills render.
  return {
    ...withUsage,
    agentChat: {
      ...withUsage.agentChat,
      composer: {
        ...withUsage.agentChat.composer,
        contextChips: [
          { id: "chip-1", kind: "code" as const, label: "agent-chat-shell.ts L817-871", text: "" },
          { id: "chip-2", kind: "terminal" as const, label: "Terminal output", text: "" },
        ],
      },
    },
  };
}

// Rich transcript with a live turn + a message queued behind it, so the docked
// Composer "steer" chip (대기 중 + 수정) can be eyeballed.
// A thread paused on an agent prompt, so the unified PromptCard can be eyeballed.
function promptFixtureState() {
  const base = richTranscriptFixtureState();
  return {
    ...base,
    agentChat: {
      ...base.agentChat,
      promptState: {
        promptId: "prompt-1",
        threadId: "thread-master-plan",
        agentId: "codex",
        kind: "question" as const,
        message: "'123 다 괜찮은데 흠..' — 그 걸림의 정체가 뭐야? (제일 가까운 거 골라줘)",
        source: "pty" as const,
        defaultChoiceId: "c1",
        choices: [
          { choiceId: "c1", label: "역할이 변두리 같아서", providerValue: "1" },
          { choiceId: "c2", label: "이 회사들이 안 꽂혀서", providerValue: "2" },
          { choiceId: "c3", label: "현실성이 흠", providerValue: "3" },
          { choiceId: "c4", label: "사실 다른 축이다", providerValue: "4" },
        ],
      },
    },
  };
}

function richQueuedFixtureState() {
  const running = applyProductShellBackendEvent(richTranscriptFixtureState(), {
    kind: "agentRuntime.stateChanged",
    payload: { threadId: "thread-master-plan", state: "running", changedAt: "2026-05-31T00:00:10.000Z" },
  });
  const drafted = updateProductShellComposerDraft(running, "오 그리고 README도 같이 정리해줘");
  return submitProductShellComposerDraft(drafted).state;
}

// Diff-pane fixture: a Workbench Diff pane with a sample unified diff, to eyeball
// the diff view (line-number gutters, syntax highlight, +/- stat).
function diffFixtureState() {
  const opened = openProductShellThread(
    createProductShellState({ includeFixtureData: true }),
    "thread-master-plan",
  );
  const diffText = [
    "--- a/src/diff-view.ts",
    "+++ b/src/diff-view.ts",
    "@@ -12,7 +12,9 @@ export function createDiffView(text: string) {",
    "   const lines = text.split(\"\\n\");",
    "-  return lines.map((line) => renderPlain(line));",
    "+  const { rows, adds, dels } = parseDiffRows(text);",
    "+  const lang = guessLanguage(rows.map((r) => r.text).join(\"\\n\"));",
    "+  return rows.map((row) => renderRow(row, lang));",
    " }",
    "@@ -40,6 +42,7 @@ function renderRow(row: DiffRow) {",
    "   const marker = row.kind === \"added\" ? \"+\" : \"-\";",
    "   return el(\"div\", { className: row.kind }, marker, row.text);",
    "+  // gutters now carry the old/new line numbers",
    " }",
  ].join("\n");
  return applyProductShellBackendEvent(opened, {
    kind: "workbench.changed",
    payload: {
      threadId: "thread-master-plan",
      activePaneId: "pane-diff",
      panes: [
        {
          paneId: "pane-diff",
          kind: "diff",
          title: "diff-view.ts",
          visible: true,
          revision: "pane-diff:rev",
          updatedAt: "2026-05-31T00:00:00.000Z",
          filePath: "/Users/you/Workspace/tide/src/diff-view.ts",
          relativePath: "src/diff-view.ts",
          diffText,
          beforeByteLength: 980,
          afterByteLength: 1120,
          truncated: false,
        },
      ],
    },
  });
}

// Browser-pane fixture: a Workbench Browser pane pointing at a visible page so
// the live <webview> load can be verified headlessly via offscreen Electron.
function browserFixtureState() {
  const opened = openProductShellThread(
    createProductShellState({ includeFixtureData: true }),
    "thread-master-plan",
  );
  return applyProductShellBackendEvent(opened, {
    kind: "workbench.changed",
    payload: {
      threadId: "thread-master-plan",
      activePaneId: "pane-browser",
      panes: [
        {
          paneId: "pane-browser",
          kind: "browser",
          title: "Browser",
          visible: true,
          revision: "pane-browser:rev",
          updatedAt: "2026-05-31T00:00:00.000Z",
          url: "data:text/html,%3Cbody%20style%3D%22margin%3A0%3Bbackground%3A%23123456%3Bcolor%3A%23fff%3Bfont%3A40px%20sans-serif%3Bdisplay%3Aflex%3Balign-items%3Acenter%3Bjustify-content%3Acenter%3Bheight%3A100vh%22%3EBROWSER%20PANE%20LIVE%3C%2Fbody%3E",
          loading: false,
        },
      ],
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
    const params = new URLSearchParams(location.search);
    const wantsBrowser = params.get("pane") === "browser";
    const wantsQueued = params.get("mode") === "queued";
    const wantsRich = params.get("mode") === "rich";
    const wantsRichQueued = params.get("mode") === "rich-queued";
    const wantsPrompt = params.get("mode") === "prompt";
    const wantsDiff = params.get("pane") === "diff";
    // FileTree column is gated by fileTreeOpen; flip it on for the fixture.
    const state = wantsDiff
      ? diffFixtureState()
      : wantsBrowser
      ? browserFixtureState()
      : wantsPrompt
        ? promptFixtureState()
        : wantsQueued
        ? queuedFixtureState()
        : wantsRichQueued
          ? richQueuedFixtureState()
          : wantsRich
            ? richTranscriptFixtureState()
            : { ...figmaFixtureState(), fileTreeOpen: true };
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
