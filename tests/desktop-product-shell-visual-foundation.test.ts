// Spec: docs_v2/specs/desktop-product-shell-visual-foundation.md
// Spec: docs_v2/specs/workbench-browser-pane-evidence-loop.md
// Spec: docs_v2/specs/tide-mcp-browser-action-tool.md

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  applyProductShellBackendEvent,
  applyProductShellPromptState,
  createProductShellState,
  createProductShellViewModel,
  closeProductShellWorkbenchPane,
  editProductShellWorkbenchEditorPane,
  focusProductShellWorkbenchPane,
  confirmProductShellThreadArchive,
  toggleProductShellThreadPin,
  submitProductShellThreadRename,
  goToProductShellEditorDefinition,
  goToProductShellEditorReferences,
  moveProductShellEditorCursor,
  openProductShellLeftUiMenu,
  openProductShellThread,
  openProductShellThreadFromLeftUi,
  selectProductShellFileTreeEntry,
  selectProductShellChoiceSurfaceRow,
  selectProductShellLauncherAction,
  setProductShellComposerActiveSurface,
  showProductShellThreadArchiveConfirm,
  submitProductShellComposerDraft,
  saveProductShellWorkbenchEditorPane,
  toggleProductShellFileTree,
  toggleProductShellFileTreeWithRefresh,
  toggleProductShellLeftUi,
  toggleProductShellWorkbench,
  toggleProductShellWorkbenchWithLauncher,
  updateProductShellBrowserActionResult,
  updateProductShellBrowserSnapshot,
  updateProductShellComposerDraft,
  writeProductShellTerminalInput,
} from "../src/desktop/application/domains/product-shell/product-shell-state.ts";
import { AgentIdentityIcon, TideProductShell } from "../src/desktop/adapters/inbound/react-renderer/tide-product-shell.ts";
import {
  CONTRACT_VERSION,
  validateBackendCommandEnvelope,
} from "../src/shared/contracts/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("product_shell_renders_left_ui_agent_chat_composer_and_app_chrome", () => {
  const html = renderProductShell();

  assert.match(html, /class="[^"]*\btide-product-shell\b/);
  assert.match(html, /aria-label="Left UI"/);
  assert.match(html, /aria-label="Agent Chat"/);
  assert.match(html, /aria-label="Composer"/);
  assert.match(html, /aria-label="Agent Chat Top Row"/);
});

test("left_ui_renders_project_grouped_thread_rows_without_thread_icons", () => {
  const html = renderProductShell();

  assert.match(html, /Pinned/);
  assert.match(html, /Projects/);
  assert.match(html, /Scratch/);
  assert.match(html, /data-left-row-kind="project"/);
  assert.match(html, /data-left-row-kind="thread"/);
  assert.doesNotMatch(html, /class="thread-row[^"]*".*data-agent-icon=/s);
  assert.doesNotMatch(html, /project-row__count/);
});

test("product_shell_applies_thread_listed_event_to_left_ui", () => {
  // Spec: docs_v2/specs/backend-thread-list-product-shell-bootstrap.md
  const state = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    {
      kind: "thread.listed",
      payload: {
        threads: [
          {
            threadId: "thread-real",
            title: "Real backend thread",
            agentBinding: {
              agentId: "claude",
              runtimeSource: { kind: "provider_cli", integrationId: "claude" },
            },
            scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
            createdAt: "2026-05-29T00:00:00.000Z",
            updatedAt: "2026-05-29T00:01:00.000Z",
            pinned: true,
            archived: false,
            lastKnownState: "idle",
          },
        ],
      },
    },
  );
  const view = createProductShellViewModel(state);

  assert.deepEqual(
    view.projectGroups.map((project) => project.projectId),
    ["tide"],
  );
  assert.equal(view.projectGroups[0]?.threads[0]?.threadId, "thread-real");
  assert.equal(view.pinnedThreads[0]?.threadId, "thread-real");
  assert.equal(view.projectGroups[0]?.threads[0]?.agentId, "claude");
});

test("product_shell_requests_backend_thread_list_on_mount_without_fixture_threads", () => {
  // Spec: docs_v2/specs/backend-thread-list-product-shell-bootstrap.md
  const source = fs.readFileSync(
    path.join(repoRoot, "src/desktop/adapters/inbound/react-renderer/tide-product-shell.ts"),
    "utf8",
  );

  assert.match(source, /kind:\s*"thread\.list"/);
  assert.match(source, /includeFixtureData:\s*false/);
});

function threadListState() {
  function summary(threadId: string, title: string) {
    return {
      threadId,
      title,
      agentBinding: {
        agentId: "codex",
        runtimeSource: { kind: "provider_cli", integrationId: "codex" },
      },
      scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
      createdAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:01:00.000Z",
      pinned: false,
      archived: false,
      lastKnownState: "idle",
    };
  }
  return applyProductShellBackendEvent(createProductShellState(), {
    kind: "thread.listed",
    payload: { threads: [summary("thread-keep", "Keep"), summary("thread-archive", "Archive me")] },
  });
}

test("confirming_thread_archive_emits_command_and_drops_it_from_the_list", () => {
  // Spec: docs_v2/specs/backend-thread-list-product-shell-bootstrap.md
  const state = threadListState();
  const result = confirmProductShellThreadArchive(state, "thread-archive");

  assert.deepEqual(result.command, {
    kind: "thread.archive",
    payload: { threadId: "thread-archive", archived: true },
  });
  assert.deepEqual(
    result.state.threads.map((thread) => thread.threadId),
    ["thread-keep"],
  );
  assert.equal(result.state.archiveConfirmThreadId, null);
});

test("toggling_thread_pin_emits_set_pinned_command_and_updates_optimistically", () => {
  // Spec: docs_v2/specs/backend-thread-list-product-shell-bootstrap.md
  const state = threadListState();
  const result = toggleProductShellThreadPin(state, "thread-archive");

  assert.deepEqual(result.command, {
    kind: "thread.setPinned",
    payload: { threadId: "thread-archive", pinned: true },
  });
  const pinnedThread = result.state.threads.find((thread) => thread.threadId === "thread-archive");
  assert.equal(pinnedThread?.pinned, true);
});

test("thread_pin_changed_event_updates_thread_pinned_state", () => {
  // Spec: docs_v2/specs/backend-thread-list-product-shell-bootstrap.md
  const state = threadListState();
  const next = applyProductShellBackendEvent(state, {
    kind: "thread.pinChanged",
    payload: {
      thread: {
        threadId: "thread-keep",
        title: "Keep",
        agentBinding: {
          agentId: "codex",
          runtimeSource: { kind: "provider_cli", integrationId: "codex" },
        },
        scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
        createdAt: "2026-05-29T00:00:00.000Z",
        updatedAt: "2026-05-29T00:03:00.000Z",
        pinned: true,
        archived: false,
        lastKnownState: "idle",
      },
    },
  });

  assert.equal(
    next.threads.find((thread) => thread.threadId === "thread-keep")?.pinned,
    true,
  );
});

test("submitting_thread_rename_emits_command_and_updates_title_optimistically", () => {
  // Spec: docs_v2/specs/backend-thread-list-product-shell-bootstrap.md
  const state = threadListState();
  const result = submitProductShellThreadRename(state, "thread-keep", "  Renamed   Keep  ");

  assert.deepEqual(result.command, {
    kind: "thread.rename",
    payload: { threadId: "thread-keep", title: "Renamed Keep" },
  });
  assert.equal(
    result.state.threads.find((thread) => thread.threadId === "thread-keep")?.title,
    "Renamed Keep",
  );
  assert.equal(result.state.renamingThreadId, null);
});

test("submitting_an_empty_thread_rename_emits_no_command", () => {
  const state = threadListState();
  const result = submitProductShellThreadRename(state, "thread-keep", "   ");
  assert.equal(result.command, null);
  assert.equal(result.state.renamingThreadId, null);
});

test("thread_renamed_event_updates_thread_title", () => {
  // Spec: docs_v2/specs/backend-thread-list-product-shell-bootstrap.md
  const state = threadListState();
  const next = applyProductShellBackendEvent(state, {
    kind: "thread.renamed",
    payload: {
      thread: {
        threadId: "thread-keep",
        title: "Server Renamed",
        agentBinding: {
          agentId: "codex",
          runtimeSource: { kind: "provider_cli", integrationId: "codex" },
        },
        scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
        createdAt: "2026-05-29T00:00:00.000Z",
        updatedAt: "2026-05-29T00:04:00.000Z",
        pinned: false,
        archived: false,
        lastKnownState: "idle",
      },
    },
  });

  assert.equal(
    next.threads.find((thread) => thread.threadId === "thread-keep")?.title,
    "Server Renamed",
  );
});

test("thread_archived_event_removes_the_thread_from_the_list", () => {
  // Spec: docs_v2/specs/backend-thread-list-product-shell-bootstrap.md
  const state = threadListState();
  const next = applyProductShellBackendEvent(state, {
    kind: "thread.archived",
    payload: {
      thread: {
        threadId: "thread-archive",
        title: "Archive me",
        agentBinding: {
          agentId: "codex",
          runtimeSource: { kind: "provider_cli", integrationId: "codex" },
        },
        scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
        createdAt: "2026-05-29T00:00:00.000Z",
        updatedAt: "2026-05-29T00:02:00.000Z",
        pinned: false,
        archived: true,
        lastKnownState: "idle",
      },
    },
  });

  assert.deepEqual(
    next.threads.map((thread) => thread.threadId),
    ["thread-keep"],
  );
});

test("thread_rows_use_list_style_selection_not_card_blocks", () => {
  const css = fs.readFileSync(
    path.join(repoRoot, "src/desktop/renderer/tide-product-shell.css"),
    "utf8",
  );

  assert.match(css, /\.thread-row--active\s*{[^}]*background:\s*var\(--tide-selection\)/s);
  assert.doesNotMatch(css, /\.thread-row--active\s*{[^}]*linear-gradient/s);
  assert.doesNotMatch(css, /\.thread-row--active\s*{[^}]*border-color/s);
});

test("composer_is_anchored_inside_agent_chat", () => {
  const html = renderProductShell();
  const chatIndex = html.indexOf('aria-label="Agent Chat"');
  const composerIndex = html.indexOf('aria-label="Composer"');
  const workbenchIndex = html.indexOf('aria-label="Workbench"');

  assert.ok(chatIndex >= 0);
  assert.ok(composerIndex > chatIndex);
  assert.equal(workbenchIndex, -1);
});

test("agent_chat_empty_state_reads_like_a_product_start_surface", () => {
  const html = renderProductShell();

  assert.match(html, /What should we build in tide\?/);
  assert.match(html, /Do anything/);
  assert.match(html, /Codex CLI/);
  assert.match(html, /current folder/);
  assert.doesNotMatch(html, /Review changes/);
  assert.doesNotMatch(html, /Open a browser check/);
  assert.doesNotMatch(html, /Continue implementation/);
  assert.doesNotMatch(html, /No Agent Session Blocks yet/);
});

test("composer_uses_icon_chrome_for_options_model_voice_and_send", () => {
  const html = renderProductShell();

  assert.match(html, /aria-label="Composer options"/);
  assert.match(html, /aria-label="Permission"/);
  assert.match(html, /aria-label="Model"/);
  assert.match(html, /aria-label="Voice input"/);
  assert.match(html, /aria-label="Send"/);
  assert.match(html, /Do anything/);
});

test("visual_foundation_css_uses_tide_icon_key_colors_without_pure_black_shell", () => {
  const css = fs.readFileSync(
    path.join(repoRoot, "src/desktop/renderer/tide-product-shell.css"),
    "utf8",
  );

  assert.match(css, /--tide-bg:\s*#fcfcfb/i);
  assert.match(css, /--tide-surface:\s*#f7f7f5/i);
  assert.match(css, /--tide-selection:\s*#eeedea/i);
  assert.match(css, /--tide-line:\s*#e4e2de/i);
  assert.match(css, /--tide-text:\s*#242424/i);
  assert.match(css, /--tide-muted:\s*#8a8781/i);
  assert.match(css, /--tide-action:\s*#343038/i);
  assert.match(css, /--tide-danger:\s*#ba322f/i);
  assert.match(css, /--agent-codex/);
  assert.doesNotMatch(css, /--tide-bg:\s*#000\b/i);
  assert.doesNotMatch(css, /background:\s*#000\b/i);
});

test("visual_foundation_css_avoids_decorative_glow_and_heavy_cards", () => {
  const css = fs.readFileSync(
    path.join(repoRoot, "src/desktop/renderer/tide-product-shell.css"),
    "utf8",
  );

  assert.doesNotMatch(css, /radial-gradient/);
  assert.doesNotMatch(css, /0 18px 60px/);
  assert.match(css, /\.tide-product-shell__stage\s*{[^}]*background:\s*var\(--tide-bg\)/s);
  assert.match(css, /\.composer-shell\s*{[^}]*box-shadow:\s*var\(--tide-shadow-composer\)/s);
});

test("agent_icons_use_deterministic_identity_palette", () => {
  const html = renderToStaticMarkup(
    createElement(
      "div",
      null,
      createElement(AgentIdentityIcon, { agentId: "codex" }),
      createElement(AgentIdentityIcon, { agentId: "claude" }),
      createElement(AgentIdentityIcon, { agentId: "antigravity" }),
    ),
  );

  assert.match(html, /data-agent-icon="codex"/);
  assert.match(html, /data-agent-icon="claude"/);
  assert.match(html, /data-agent-icon="antigravity"/);
});

test("renderer_entry_mounts_product_shell_not_bare_agent_chat", () => {
  const renderer = fs.readFileSync(
    path.join(repoRoot, "src/desktop/renderer/renderer-entry.ts"),
    "utf8",
  );

  assert.match(renderer, /TideProductShell/);
  assert.doesNotMatch(renderer, /createElement\(AgentChatShell/);
});

test("opening_thread_from_left_ui_marks_it_active_and_hydrates_follow_up_composer", () => {
  const state = openProductShellThread(createProductShellState(), "thread-workbench");
  const view = createProductShellViewModel(state);

  assert.equal(view.activeThreadId, "thread-workbench");
  assert.equal(view.agentChat.thread?.threadId, "thread-workbench");
  assert.equal(view.agentChat.composer.mode, "follow_up");
  assert.equal(view.appChrome.statusBar.agentLabel, "Codex CLI");
  assert.equal(
    view.projectGroups.flatMap((group) => group.threads).find((thread) => thread.threadId === "thread-workbench")
      ?.active,
    true,
  );
});

test("product_shell_thread_selection_emits_thread_hydrate_when_backend_transport_exists", () => {
  const result = openProductShellThreadFromLeftUi(
    createProductShellState(),
    "thread-workbench",
    { backendTransportAvailable: true },
  );
  const view = createProductShellViewModel(result.state);

  assert.deepEqual(result.command, {
    kind: "thread.hydrate",
    payload: { threadId: "thread-workbench" },
  });
  assert.equal(view.activeThreadId, null);
  assert.equal(view.agentChat.thread, null);
  assert.doesNotMatch(renderProductShell(result.state), /Local preview/);
});

test("typing_in_start_composer_fills_the_local_draft", () => {
  const state = updateProductShellComposerDraft(
    createProductShellState(),
    "Review the current diff and summarize risk.",
  );
  const view = createProductShellViewModel(state);

  assert.equal(view.agentChat.composer.mode, "start");
  assert.equal(view.agentChat.composer.draft, "Review the current diff and summarize risk.");
  assert.equal(view.activeThreadId, null);
});

test("sending_start_composer_from_product_shell_emits_thread_start_without_local_preview", () => {
  const drafted = updateProductShellComposerDraft(
    createProductShellState(),
    "Build the Product Shell interactions",
  );
  const result = submitProductShellComposerDraft(drafted);
  const view = createProductShellViewModel(result.state);

  assert.equal(result.command?.kind, "thread.start");
  assert.equal(result.command?.payload.initialMessage, "Build the Product Shell interactions");
  assert.equal(result.command?.payload.launchOptions?.model, "gpt-5.5");
  assert.equal(view.agentChat.composer.modelLabel, "GPT-5.5 High");
  assert.equal(view.activeThreadId, null);
  assert.equal(view.agentChat.thread, null);
  assert.equal(view.agentChat.composer.draft, "Build the Product Shell interactions");
  assert.equal(view.projectGroups[0].threads[0].threadId, "thread-master-plan");
  assert.doesNotMatch(
    view.agentChat.blocks.map((block) => block.body).join("\n"),
    /Local preview|local-thread/,
  );
});

test("sending_start_composer_from_product_shell_uses_provider_native_model_value", () => {
  // Spec: docs_v2/specs/composer-agent-runtime-source.md
  const drafted = updateProductShellComposerDraft(
    createProductShellState(),
    "Start Codex with the default model",
  );
  const result = submitProductShellComposerDraft(drafted);

  assert.equal(result.command?.kind, "thread.start");
  assert.deepEqual(result.command?.payload.launchOptions, {
    model: "gpt-5.5",
    permission: "Auto-review",
    worktree: "current folder",
    branch: "main",
  });
});

test("opening_thread_with_workbench_context_renders_right_workbench_tabs", () => {
  const state = openProductShellThread(createProductShellState(), "thread-workbench");
  const view = createProductShellViewModel(state);

  assert.equal(view.agentChat.workbenchOpen, true);
  assert.deepEqual(
    view.appChrome.workbenchTabStrip.visibleTabs.map((tab) => tab.title),
    ["Browser preview", "Review diff"],
  );
  assert.equal(view.appChrome.workbenchTabStrip.visibleTabs[0].active, true);
});

test("right_workbench_tab_actions_emit_backend_commands_and_apply_workbench_events", () => {
  const opened = openProductShellThread(createProductShellState(), "thread-workbench");
  const focused = focusProductShellWorkbenchPane(opened, "pane-thread-workbench-diff");
  const focusedView = createProductShellViewModel(focused.state);

  assert.deepEqual(focused.command, {
    kind: "workbench.command",
    payload: {
      threadId: "thread-workbench",
      command: "focus_pane",
      targetPaneId: "pane-thread-workbench-diff",
    },
  });
  assert.equal(focusedView.appChrome.workbenchTabStrip.visibleTabs[1].active, true);

  const closeRequested = closeProductShellWorkbenchPane(focused.state, "pane-thread-workbench-diff");
  assert.deepEqual(closeRequested.command, {
    kind: "workbench.command",
    payload: {
      threadId: "thread-workbench",
      command: "close_pane",
      targetPaneId: "pane-thread-workbench-diff",
    },
  });

  const closed = applyProductShellBackendEvent(closeRequested.state, {
    kind: "workbench.changed",
    payload: {
      threadId: "thread-workbench",
      activePaneId: "pane-thread-workbench-browser",
      panes: [
        {
          paneId: "pane-thread-workbench-browser",
          kind: "browser",
          title: "Browser preview",
          visible: true,
          revision: "pane-thread-workbench-browser:rev",
          updatedAt: "2026-05-28T00:00:00.000Z",
          loading: false,
        },
        {
          paneId: "pane-thread-workbench-diff",
          kind: "diff",
          title: "Review diff",
          visible: false,
          revision: "pane-thread-workbench-diff:rev",
          updatedAt: "2026-05-28T00:00:00.000Z",
        },
      ],
    },
  });
  const closedView = createProductShellViewModel(closed);

  assert.deepEqual(
    closedView.appChrome.workbenchTabStrip.visibleTabs.map((tab) => tab.title),
    ["Browser preview"],
  );
  assert.equal(closedView.agentChat.workbenchOpen, true);
});

test("workbench_browser_pane_renders_url_loading_and_preview", () => {
  // Spec: docs_v2/specs/desktop-workbench-pane-content-rendering.md
  const state = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        activePaneId: "pane-browser",
        panes: [
          {
            paneId: "pane-browser",
            kind: "browser",
            title: "Browser preview",
            visible: true,
            revision: "pane-browser:rev",
            updatedAt: "2026-05-28T00:00:00.000Z",
            loading: true,
            url: "https://example.test/docs",
            pageTitle: "Example Docs",
            bodyTextPreview: "Install Tide and run the local Agent.",
          },
        ],
      },
    },
  );
  const html = renderProductShell(state);

  assert.match(html, /data-pane-kind="browser"/);
  assert.match(html, /Example Docs/);
  assert.match(html, /https:\/\/example\.test\/docs/);
  assert.match(html, /loading/);
  assert.match(html, /Install Tide and run the local Agent/);
  assert.doesNotMatch(html, /Thread-bound Workbench Pane content appears here/);
});

test("workbench_browser_pane_renders_electron_webview_for_url", () => {
  // Spec: docs_v2/specs/workbench-browser-webview-pane.md
  const state = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        activePaneId: "pane-browser",
        panes: [
          {
            paneId: "pane-browser",
            kind: "browser",
            title: "Browser preview",
            visible: true,
            revision: "pane-browser:rev",
            updatedAt: "2026-05-28T00:00:00.000Z",
            loading: false,
            url: "https://example.test/docs",
            pageTitle: "Example Docs",
            bodyTextPreview: "Install Tide and run the local Agent.",
          },
        ],
      },
    },
  );
  const html = renderProductShell(state);

  assert.match(html, /<webview/);
  assert.match(html, /src="https:\/\/example\.test\/docs"/);
  assert.match(html, /data-browser-pane-webview="pane-browser"/);
});

test("product_shell_browser_webview_snapshot_emits_update_command", () => {
  // Spec: docs_v2/specs/workbench-browser-pane-evidence-loop.md
  const state = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        activePaneId: "pane-browser",
        panes: [
          {
            paneId: "pane-browser",
            kind: "browser",
            title: "Browser preview",
            visible: true,
            revision: "pane-browser:rev",
            updatedAt: "2026-05-28T00:00:00.000Z",
            loading: true,
            url: "https://example.test/docs",
          },
        ],
      },
    },
  );

  const result = updateProductShellBrowserSnapshot(state, "pane-browser", {
    revision: "pane-browser:rev",
    url: "https://example.test/ready",
    pageTitle: "Example ready",
    bodyTextPreview: "Loaded page body",
    loading: false,
  });

  assert.deepEqual(result.command, {
    kind: "workbench.command",
    payload: {
      threadId: "thread-workbench",
      command: "update_browser_snapshot",
      targetPaneId: "pane-browser",
      data: {
        revision: "pane-browser:rev",
        url: "https://example.test/ready",
        pageTitle: "Example ready",
        bodyTextPreview: "Loaded page body",
        loading: false,
      },
    },
  });
});

test("product_shell_browser_action_result_emits_workbench_command", () => {
  // Spec: docs_v2/specs/tide-mcp-browser-action-tool.md
  const state = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        activePaneId: "pane-browser",
        panes: [
          {
            paneId: "pane-browser",
            kind: "browser",
            title: "Browser preview",
            visible: true,
            revision: "pane-browser:action-rev",
            updatedAt: "2026-05-28T00:00:00.000Z",
            loading: false,
            url: "https://example.test/docs",
            pendingAction: {
              actionId: "action-1",
              kind: "click",
              selector: "button.primary",
              requestedAt: "2026-05-28T00:00:01.000Z",
            },
          },
        ],
      },
    },
  );

  const result = updateProductShellBrowserActionResult(state, "pane-browser", {
    revision: "pane-browser:action-rev",
    actionId: "action-1",
    status: "completed",
    message: "Clicked button.primary",
    url: "https://example.test/next",
    pageTitle: "Next page",
    bodyTextPreview: "Next page body",
    loading: false,
  });

  assert.deepEqual(result.command, {
    kind: "workbench.command",
    payload: {
      threadId: "thread-workbench",
      command: "update_browser_action_result",
      targetPaneId: "pane-browser",
      data: {
        revision: "pane-browser:action-rev",
        actionId: "action-1",
        status: "completed",
        message: "Clicked button.primary",
        url: "https://example.test/next",
        pageTitle: "Next page",
        bodyTextPreview: "Next page body",
        loading: false,
      },
    },
  });
});

test("workbench_editor_pane_renders_path_size_and_preview", () => {
  // Spec: docs_v2/specs/desktop-workbench-pane-content-rendering.md
  const state = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        activePaneId: "pane-editor",
        panes: [
          {
            paneId: "pane-editor",
            kind: "editor",
            title: "README.md",
            visible: true,
            revision: "pane-editor:rev",
            updatedAt: "2026-05-28T00:00:00.000Z",
            filePath: "/Users/eatnug/Workspace/tide/README.md",
            relativePath: "README.md",
            bodyTextPreview: "# Tide\n\nLocal coding Agent workbench.",
            byteLength: 42,
            truncated: true,
          },
        ],
      },
    },
  );
  const html = renderProductShell(state);

  assert.match(html, /data-pane-kind="editor"/);
  assert.match(html, /README\.md/);
  assert.match(html, /42 bytes/);
  assert.match(html, /readonly/);
  // The editor surface (CodeMirror) renders; the file body itself is rendered
  // by CodeMirror on mount and is covered by the jsdom editor tests.
  assert.match(html, /aria-label="Editor Pane text"/);
  assert.doesNotMatch(html, /Thread-bound Workbench Pane content appears here/);
});

test("editing_workbench_editor_pane_marks_draft_dirty", () => {
  // Spec: docs_v2/specs/workbench-editor-pane-editing.md
  const state = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        activePaneId: "pane-editor",
        panes: [
          {
            paneId: "pane-editor",
            kind: "editor",
            title: "README.md",
            visible: true,
            revision: "pane-editor:rev",
            updatedAt: "2026-05-28T00:00:00.000Z",
            filePath: "/Users/eatnug/Workspace/tide/README.md",
            relativePath: "README.md",
            bodyText: "# Tide\n",
            bodyTextPreview: "# Tide\n",
            byteLength: 7,
            truncated: false,
          },
        ],
      },
    },
  );

  const edited = editProductShellWorkbenchEditorPane(
    state,
    "pane-editor",
    "# Tide\n\nEdited\n",
  );

  assert.equal(edited.editorDrafts["pane-editor"]?.dirty, true);
  assert.equal(edited.editorDrafts["pane-editor"]?.baseRevision, "pane-editor:rev");
});

test("saving_workbench_editor_pane_emits_save_editor_file_command", () => {
  // Spec: docs_v2/specs/workbench-editor-pane-editing.md
  const state = editProductShellWorkbenchEditorPane(
    applyProductShellBackendEvent(
      openProductShellThread(createProductShellState(), "thread-workbench"),
      {
        kind: "workbench.changed",
        payload: {
          threadId: "thread-workbench",
          activePaneId: "pane-editor",
          panes: [
            {
              paneId: "pane-editor",
              kind: "editor",
              title: "README.md",
              visible: true,
              revision: "pane-editor:rev",
              updatedAt: "2026-05-28T00:00:00.000Z",
              filePath: "/Users/eatnug/Workspace/tide/README.md",
              relativePath: "README.md",
              bodyText: "# Tide\n",
              bodyTextPreview: "# Tide\n",
              byteLength: 7,
              truncated: false,
            },
          ],
        },
      },
    ),
    "pane-editor",
    "# Tide\n\nEdited\n",
  );

  const saved = saveProductShellWorkbenchEditorPane(state, "pane-editor");

  assert.deepEqual(saved.command, {
    kind: "workbench.command",
    payload: {
      threadId: "thread-workbench",
      command: "save_editor_file",
      targetPaneId: "pane-editor",
      data: {
        baseRevision: "pane-editor:rev",
        content: "# Tide\n\nEdited\n",
      },
    },
  });
});

test("product_shell_go_to_definition_emits_cursor_position_command", () => {
  // Spec: docs_v2/specs/workbench-editor-code-navigation.md
  const opened = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        activePaneId: "pane-editor",
        panes: [
          {
            paneId: "pane-editor",
            kind: "editor",
            title: "app.ts",
            visible: true,
            revision: "pane-editor:rev",
            updatedAt: "2026-05-28T00:00:00.000Z",
            filePath: "/Users/eatnug/Workspace/tide/src/app.ts",
            relativePath: "src/app.ts",
            bodyText: "const local = 1;\nconsole.log(local);\n",
            bodyTextPreview: "const local = 1;\nconsole.log(local);\n",
            byteLength: 36,
            truncated: false,
          },
        ],
      },
    },
  );
  const cursorOffset = "const local = 1;\nconsole.".length;
  const moved = moveProductShellEditorCursor(opened, "pane-editor", cursorOffset);

  const result = goToProductShellEditorDefinition(moved, "pane-editor");

  assert.deepEqual(result.command, {
    kind: "workbench.command",
    payload: {
      threadId: "thread-workbench",
      command: "go_to_definition",
      targetPaneId: "pane-editor",
      data: {
        line: 1,
        character: 8,
      },
    },
  });
  assert.equal(result.state.appChrome.activeWorkbenchPaneId, "pane-editor");
});

test("product_shell_find_references_emits_go_to_references_command", () => {
  // Spec: docs_v2/specs/workbench-editor-code-navigation.md (D5)
  const opened = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        activePaneId: "pane-editor",
        panes: [
          {
            paneId: "pane-editor",
            kind: "editor",
            title: "app.ts",
            visible: true,
            revision: "pane-editor:rev",
            updatedAt: "2026-05-28T00:00:00.000Z",
            filePath: "/Users/eatnug/Workspace/tide/src/app.ts",
            relativePath: "src/app.ts",
            bodyText: "const local = 1;\nconsole.log(local);\n",
            bodyTextPreview: "const local = 1;\nconsole.log(local);\n",
            byteLength: 36,
            truncated: false,
          },
        ],
      },
    },
  );
  const cursorOffset = "const lo".length;
  const moved = moveProductShellEditorCursor(opened, "pane-editor", cursorOffset);

  const result = goToProductShellEditorReferences(moved, "pane-editor");

  assert.deepEqual(result.command, {
    kind: "workbench.command",
    payload: {
      threadId: "thread-workbench",
      command: "go_to_references",
      targetPaneId: "pane-editor",
      data: {
        line: 0,
        character: 8,
      },
    },
  });
  assert.equal(result.state.appChrome.activeWorkbenchPaneId, "pane-editor");
});

test("workbench_editor_pane_renders_references_list", () => {
  // Spec: docs_v2/specs/workbench-editor-code-navigation.md (D5)
  const state = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        activePaneId: "pane-editor",
        panes: [
          {
            paneId: "pane-editor",
            kind: "editor",
            title: "app.ts",
            visible: true,
            revision: "pane-editor:rev",
            updatedAt: "2026-05-28T00:00:00.000Z",
            filePath: "/Users/eatnug/Workspace/tide/src/app.ts",
            relativePath: "src/app.ts",
            bodyText: "export const value = 1;\nconst a = value;\n",
            bodyTextPreview: "export const value = 1;\nconst a = value;\n",
            byteLength: 40,
            truncated: false,
            references: {
              query: "src/app.ts",
              truncated: false,
              items: [
                { relativePath: "src/app.ts", line: 0, character: 13, length: 5, label: "export const value = 1;" },
                { relativePath: "src/lib.ts", line: 7, character: 2, length: 5, label: "return value;" },
              ],
            },
          },
        ],
      },
    },
  );
  const html = renderProductShell(state);

  assert.match(html, /aria-label="References"/);
  assert.match(html, /References to src\/app\.ts \(2\)/);
  assert.match(html, /Find references/);
  // Locations render as relativePath:line+1:character+1.
  assert.match(html, /src\/app\.ts:1:14/);
  assert.match(html, /src\/lib\.ts:8:3/);
  assert.match(html, /return value;/);
});

test("truncated_workbench_editor_pane_renders_read_only", () => {
  // Spec: docs_v2/specs/workbench-editor-pane-editing.md
  const state = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        activePaneId: "pane-editor",
        panes: [
          {
            paneId: "pane-editor",
            kind: "editor",
            title: "large.md",
            visible: true,
            revision: "pane-editor:rev",
            updatedAt: "2026-05-28T00:00:00.000Z",
            filePath: "/Users/eatnug/Workspace/tide/large.md",
            relativePath: "large.md",
            bodyTextPreview: "partial",
            byteLength: 200000,
            truncated: true,
          },
        ],
      },
    },
  );
  const edited = editProductShellWorkbenchEditorPane(state, "pane-editor", "unsafe");
  const html = renderProductShell(state);

  assert.equal(edited.editorDrafts["pane-editor"], undefined);
  assert.match(html, /readonly/);
  assert.doesNotMatch(html, /Save file/);
});

test("workbench_diff_pane_renders_diff_metadata_and_text", () => {
  // Spec: docs_v2/specs/desktop-workbench-pane-content-rendering.md
  const state = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        activePaneId: "pane-diff",
        panes: [
          {
            paneId: "pane-diff",
            kind: "diff",
            title: "README.md diff",
            visible: true,
            revision: "pane-diff:rev",
            updatedAt: "2026-05-28T00:00:00.000Z",
            filePath: "/Users/eatnug/Workspace/tide/README.md",
            relativePath: "README.md",
            diffText: "@@ -1 +1 @@\n-Old Tide\n+New Tide",
            beforeByteLength: 9,
            afterByteLength: 8,
            truncated: false,
          },
        ],
      },
    },
  );
  const html = renderProductShell(state);

  assert.match(html, /data-pane-kind="diff"/);
  assert.match(html, /README\.md/);
  assert.match(html, /9 -&gt; 8 bytes/);
  assert.match(html, /@@ -1 \+1 @@/);
  assert.match(html, /New Tide/);
  assert.doesNotMatch(html, /Thread-bound Workbench Pane content appears here/);
});

test("workbench_diff_pane_renders_structured_unified_diff_lines", () => {
  // Spec: docs_v2/specs/desktop-workbench-pane-content-rendering.md (D4)
  const state = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        activePaneId: "pane-diff",
        panes: [
          {
            paneId: "pane-diff",
            kind: "diff",
            title: "README.md diff",
            visible: true,
            revision: "pane-diff:rev",
            updatedAt: "2026-05-28T00:00:00.000Z",
            filePath: "/Users/eatnug/Workspace/tide/README.md",
            relativePath: "README.md",
            diffText:
              "--- README.md\n+++ README.md\n@@ -1,2 +1,2 @@\n Title\n-Old Tide\n+New Tide\n[diff truncated]",
            beforeByteLength: 20,
            afterByteLength: 20,
            truncated: true,
          },
        ],
      },
    },
  );
  const html = renderProductShell(state);

  // D4: each diff line carries a change-type tag instead of one flat <pre> block.
  assert.match(html, /workbench-diff-line--header[\s\S]*?\+\+\+ README\.md/);
  assert.match(html, /workbench-diff-line--hunk[\s\S]*?@@ -1,2 \+1,2 @@/);
  assert.match(html, /workbench-diff-line--removed[\s\S]*?Old Tide/);
  assert.match(html, /workbench-diff-line--added[\s\S]*?New Tide/);
  assert.match(html, /workbench-diff-line--context[\s\S]*?Title/);
  // Truncation notice stays visible as context, never hidden.
  assert.match(html, /\[diff truncated\]/);
  // No flat single-block preview for a known diff anymore.
  assert.doesNotMatch(html, /aria-label="Diff preview"/);
});

test("provider_setup_terminal_pane_renders_preview_and_input_controls", () => {
  // Spec: docs_v2/specs/provider-setup-surface-input-and-retry.md
  const state = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        activePaneId: "pane-provider-setup",
        panes: [providerSetupTerminalPane()],
      },
    },
  );
  const html = renderProductShell(state);

  assert.match(html, /data-pane-kind="terminal"/);
  assert.match(html, /Provider setup: codex/);
  assert.match(html, /running/);
  assert.match(html, /\/Users\/eatnug\/\.local\/bin\/codex/);
  assert.match(html, /Welcome to Codex setup/);
  assert.match(html, /aria-label="Provider Setup Surface input"/);
  assert.match(html, /Enter/);
  assert.match(html, /Esc/);
});

test("product_shell_setup_terminal_input_emits_workbench_command", () => {
  // Spec: docs_v2/specs/provider-setup-surface-input-and-retry.md
  const state = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        activePaneId: "pane-provider-setup",
        panes: [providerSetupTerminalPane()],
      },
    },
  );
  const result = writeProductShellTerminalInput(
    state,
    "pane-provider-setup",
    "trust\r",
  );

  assert.deepEqual(result.command, {
    kind: "workbench.command",
    payload: {
      threadId: "thread-workbench",
      command: "write_terminal_input",
      targetPaneId: "pane-provider-setup",
      data: { bytes: "trust\r" },
    },
  });
}
);

test("product_shell_ignores_thread_scoped_events_for_inactive_threads", () => {
  const opened = openProductShellThread(createProductShellState(), "thread-workbench");
  const afterOtherThreadRuntime = applyProductShellBackendEvent(opened, {
    kind: "agentRuntime.stateChanged",
    payload: {
      threadId: "thread-other",
      state: "running",
      changedAt: "2026-05-29T00:00:00.000Z",
    },
  });
  const afterOtherThreadBlock = applyProductShellBackendEvent(afterOtherThreadRuntime, {
    kind: "agentSessionBlock.upserted",
    payload: {
      block: {
        blockId: "block-other-thread",
        threadId: "thread-other",
        agentId: "antigravity",
        kind: "agent_message",
        role: "agent",
        status: "complete",
        body: "This belongs to another Thread",
        updatedAt: "2026-05-29T00:00:00.000Z",
      },
    },
  });
  const view = createProductShellViewModel(afterOtherThreadBlock);
  const html = renderProductShell(afterOtherThreadBlock);

  assert.equal(view.activeThreadId, "thread-workbench");
  assert.equal(view.agentChat.runtimeState, "idle");
  assert.doesNotMatch(html, /This belongs to another Thread/);
});

test("product_shell_uses_column_owned_top_rows_without_global_window_chrome", () => {
  const html = renderProductShell();

  assert.match(html, /aria-label="Left UI Top Row"/);
  assert.match(html, /aria-label="Agent Chat Top Row"/);
  assert.doesNotMatch(html, /tide-window-chrome/);
  assert.doesNotMatch(html, /aria-label="Tide Window Chrome"/);
});

test("file_tree_opens_as_one_independent_column_next_to_workbench", () => {
  const state = toggleProductShellFileTree(openProductShellThread(createProductShellState(), "thread-workbench"));
  const view = createProductShellViewModel(state);
  const html = renderProductShell(state);

  assert.equal(view.workbenchOpen, true);
  assert.equal(view.fileTreeOpen, true);
  assert.match(html, /data-column="workbench"/);
  assert.match(html, /data-column="file-tree"/);
  assert.equal((html.match(/aria-label="FileTree"/g) ?? []).length, 1);
});

test("opening_file_tree_emits_refresh_workbench_command_for_active_thread", () => {
  // Spec: docs_v2/specs/workbench-filetree-view.md
  const state = openProductShellThread(createProductShellState(), "thread-workbench");
  const result = toggleProductShellFileTreeWithRefresh(state);

  assert.equal(result.state.fileTreeOpen, true);
  assert.equal(result.command?.kind, "workbench.command");
  assert.deepEqual(result.command?.payload, {
    threadId: "thread-workbench",
    command: "refresh_file_tree",
    data: {
      maxDepth: 2,
      maxEntries: 160,
    },
  });
});

test("opening_empty_product_shell_workbench_requests_launcher_pane", () => {
  // Spec: docs_v2/specs/workbench-launcher-pane.md
  const state = openProductShellThread(createProductShellState(), "thread-sketch");
  const result = toggleProductShellWorkbenchWithLauncher(state);

  assert.equal(result.state.workbenchOpen, true);
  assert.equal(result.command?.kind, "workbench.command");
  assert.deepEqual(result.command?.payload, {
    threadId: "thread-sketch",
    command: "open_launcher",
  });
});

test("workbench_launcher_pane_renders_real_workbench_actions", () => {
  // Spec: docs_v2/specs/workbench-launcher-pane.md
  const state = applyProductShellBackendEvent(
    toggleProductShellWorkbench(openProductShellThread(createProductShellState(), "thread-sketch")),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-sketch",
        panes: [
          {
            paneId: "pane-launcher",
            kind: "launcher",
            title: "Workbench launcher",
            visible: true,
            revision: "rev-launcher",
            updatedAt: "2026-05-29T00:00:00.000Z",
            actions: [
              {
                actionId: "open_browser",
                label: "Browser",
                description: "Open a Browser Pane",
                enabled: true,
              },
              {
                actionId: "open_file_tree",
                label: "FileTree",
                description: "Show the Thread FileTree",
                enabled: true,
              },
            ],
          },
        ],
      },
    },
  );
  const html = renderProductShell(state);

  assert.match(html, /data-pane-kind="launcher"/);
  assert.match(html, /Workbench launcher/);
  assert.match(html, /Browser/);
  assert.match(html, /Open a Browser Pane/);
  assert.match(html, /FileTree/);
  assert.match(html, /Show the Thread FileTree/);
  assert.doesNotMatch(html, /No visible Workbench Pane/);
});

test("product_shell_launcher_terminal_action_emits_open_terminal_command", () => {
  // Spec: docs_v2/specs/workbench-terminal-pane-session.md
  const state = applyProductShellBackendEvent(
    toggleProductShellWorkbench(openProductShellThread(createProductShellState(), "thread-sketch")),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-sketch",
        panes: [
          {
            paneId: "pane-launcher",
            kind: "launcher",
            title: "Workbench launcher",
            visible: true,
            revision: "rev-launcher",
            updatedAt: "2026-05-29T00:00:00.000Z",
            actions: [
              {
                actionId: "open_terminal",
                label: "Terminal",
                description: "Open a visible Terminal Pane",
                enabled: true,
              },
            ],
          },
        ],
      },
    },
  );
  const result = selectProductShellLauncherAction(state, "open_terminal");

  assert.equal(result.command?.kind, "workbench.command");
  assert.deepEqual(result.command?.payload, {
    threadId: "thread-sketch",
    command: "open_terminal",
  });
});

test("product_shell_launcher_browser_action_emits_open_browser_command", () => {
  // Spec: docs_v2/specs/workbench-launcher-pane.md
  const state = applyProductShellBackendEvent(
    toggleProductShellWorkbench(openProductShellThread(createProductShellState(), "thread-sketch")),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-sketch",
        panes: [
          {
            paneId: "pane-launcher",
            kind: "launcher",
            title: "Workbench launcher",
            visible: true,
            revision: "rev-launcher",
            updatedAt: "2026-05-29T00:00:00.000Z",
            actions: [
              {
                actionId: "open_browser",
                label: "Browser",
                description: "Open a Browser Pane",
                enabled: true,
              },
            ],
          },
        ],
      },
    },
  );
  const result = selectProductShellLauncherAction(state, "open_browser");

  assert.equal(result.command?.kind, "workbench.command");
  assert.deepEqual(result.command?.payload, {
    threadId: "thread-sketch",
    command: "open_browser",
  });
});

test("product_shell_launcher_file_tree_action_opens_column_and_refreshes_tree", () => {
  // Spec: docs_v2/specs/workbench-launcher-pane.md
  const state = applyProductShellBackendEvent(
    toggleProductShellWorkbench(openProductShellThread(createProductShellState(), "thread-sketch")),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-sketch",
        panes: [
          {
            paneId: "pane-launcher",
            kind: "launcher",
            title: "Workbench launcher",
            visible: true,
            revision: "rev-launcher",
            updatedAt: "2026-05-29T00:00:00.000Z",
            actions: [
              {
                actionId: "open_file_tree",
                label: "FileTree",
                description: "Show the Thread FileTree",
                enabled: true,
              },
            ],
          },
        ],
      },
    },
  );
  const result = selectProductShellLauncherAction(state, "open_file_tree");

  assert.equal(result.state.fileTreeOpen, true);
  assert.equal(result.command?.kind, "workbench.command");
  assert.deepEqual(result.command?.payload, {
    threadId: "thread-sketch",
    command: "refresh_file_tree",
    data: {
      maxDepth: 2,
      maxEntries: 160,
    },
  });
});

test("file_tree_renders_backend_entries_without_fixture_paths", () => {
  // Spec: docs_v2/specs/workbench-filetree-view.md
  const state = applyProductShellBackendEvent(
    toggleProductShellFileTree(openProductShellThread(createProductShellState(), "thread-workbench")),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        panes: [],
        fileTree: {
          root: "/repo/tide",
          cwdLabel: "tide",
          revision: "tree-rev-1",
          updatedAt: "2026-05-29T00:00:00.000Z",
          truncated: false,
          entries: [
            {
              id: "src",
              name: "src",
              relativePath: "src",
              depth: 0,
              kind: "folder",
            },
            {
              id: "package.json",
              name: "package.json",
              relativePath: "package.json",
              depth: 0,
              kind: "file",
              active: true,
            },
          ],
        },
      },
    },
  );
  const view = createProductShellViewModel(state);
  const html = renderProductShell(state);

  assert.deepEqual(
    view.fileTree.entries.map((entry) => entry.name),
    ["src", "package.json"],
  );
  assert.match(html, />src</);
  assert.match(html, />package\.json</);
  assert.doesNotMatch(html, /tide-product-shell\.css/);
});

test("product_shell_file_tree_file_row_emits_open_editor_command", () => {
  // Spec: docs_v2/specs/workbench-filetree-view.md
  const state = applyProductShellBackendEvent(
    toggleProductShellFileTree(openProductShellThread(createProductShellState(), "thread-workbench")),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        panes: [],
        fileTree: {
          root: "/repo/tide",
          cwdLabel: "tide",
          revision: "tree-rev-1",
          updatedAt: "2026-05-29T00:00:00.000Z",
          truncated: false,
          entries: [
            {
              id: "src",
              name: "src",
              relativePath: "src",
              depth: 0,
              kind: "folder",
            },
            {
              id: "src/app.ts",
              name: "app.ts",
              relativePath: "src/app.ts",
              depth: 1,
              kind: "file",
            },
          ],
        },
      },
    },
  );
  const folderResult = selectProductShellFileTreeEntry(state, "src");
  const fileResult = selectProductShellFileTreeEntry(state, "src/app.ts");

  assert.equal(folderResult.command, null);
  assert.equal(fileResult.state.workbenchOpen, true);
  assert.deepEqual(fileResult.command, {
    kind: "workbench.command",
    payload: {
      threadId: "thread-workbench",
      command: "open_editor",
      data: { path: "src/app.ts" },
    },
  });
});

test("right_window_actions_move_to_the_rightmost_visible_column", () => {
  const startHtml = renderProductShell();
  const workbenchHtml = renderProductShell(openProductShellThread(createProductShellState(), "thread-workbench"));
  const fileTreeHtml = renderProductShell(
    toggleProductShellFileTree(openProductShellThread(createProductShellState(), "thread-workbench")),
  );

  assert.match(startHtml, /data-right-actions-owner="agent-chat"/);
  assert.match(workbenchHtml, /data-right-actions-owner="workbench"/);
  assert.match(fileTreeHtml, /data-right-actions-owner="file-tree"/);
});

test("prompt_choice_surface_renders_above_composer_with_canonical_spacing", () => {
  const state = applyProductShellPromptState(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      promptId: "prompt-approval",
      threadId: "thread-workbench",
      agentId: "codex",
      kind: "permission",
      message: "Permission required",
      source: "provider_signal",
      choices: [
        { choiceId: "allow-once", label: "Allow once", providerValue: "allow_once" },
        { choiceId: "explain-risk", label: "Explain risk", providerValue: "explain_risk" },
        { choiceId: "deny", label: "Deny", providerValue: "deny" },
      ],
    },
  );
  const html = renderProductShell(state);
  const css = fs.readFileSync(
    path.join(repoRoot, "src/desktop/renderer/tide-product-shell.css"),
    "utf8",
  );

  assert.ok(html.indexOf('aria-label="Choice Surface"') < html.indexOf('aria-label="Composer"'));
  assert.match(css, /\.agent-chat-shell__composer-stack\s*{[^}]*gap:\s*16px/s);
  assert.match(html, /Allow once/);
  assert.match(html, /Explain risk/);
  assert.match(html, /Deny/);
});

test("product_shell_prompt_choice_row_emits_prompt_answer_command", () => {
  const state = applyProductShellPromptState(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      promptId: "prompt-approval",
      threadId: "thread-workbench",
      agentId: "codex",
      kind: "permission",
      message: "Permission required",
      source: "provider_signal",
      choices: [
        { choiceId: "allow-once", label: "Allow once", providerValue: "allow_once" },
      ],
    },
  );

  const result = selectProductShellChoiceSurfaceRow(state, "prompt_state", "allow-once");

  assert.deepEqual(result.command, {
    kind: "prompt.answer",
    payload: {
      threadId: "thread-workbench",
      promptId: "prompt-approval",
      choiceId: "allow-once",
      value: "allow_once",
    },
  });
});

test("product_shell_antigravity_selection_updates_model_before_thread_start", () => {
  const withMenu = setProductShellComposerActiveSurface(createProductShellState(), "agent_menu");
  const result = selectProductShellChoiceSurfaceRow(withMenu, "agent_menu", "antigravity");
  const view = createProductShellViewModel(result.state);

  assert.equal(view.agentChat.composer.contextItems[0].value, "Antigravity CLI");
  assert.equal(view.agentChat.composer.modelLabel, "Antigravity default");
  assert.equal(view.agentChat.composer.permissionLabel, "default");
});

test("product_shell_antigravity_selection_updates_start_command_launch_options", () => {
  const withAgentMenu = setProductShellComposerActiveSurface(createProductShellState(), "agent_menu");
  const selected = selectProductShellChoiceSurfaceRow(
    withAgentMenu,
    "agent_menu",
    "antigravity",
  );
  const withDraft = updateProductShellComposerDraft(
    selected.state,
    "Start an Antigravity Thread",
  );

  const submitted = submitProductShellComposerDraft(withDraft);

  assert.deepEqual(submitted.command, {
    kind: "thread.start",
    payload: {
      initialMessage: "Start an Antigravity Thread",
      agentBinding: {
        agentId: "antigravity",
        runtimeSource: {
          kind: "provider_cli",
          integrationId: "antigravity",
        },
      },
      scope: {
        kind: "project",
        projectId: "tide",
        cwd: "/Users/eatnug/Workspace/tide",
      },
      launchOptions: {
        model: "Antigravity default",
        permission: "default",
        worktree: "current folder",
        branch: "main",
      },
    },
  });
});

test("product_shell_thread_started_preserves_antigravity_model_label", () => {
  const withAgentMenu = setProductShellComposerActiveSurface(createProductShellState(), "agent_menu");
  const selected = selectProductShellChoiceSurfaceRow(
    withAgentMenu,
    "agent_menu",
    "antigravity",
  );
  const withDraft = updateProductShellComposerDraft(
    selected.state,
    "Start Antigravity and keep its model source",
  );
  const submitted = submitProductShellComposerDraft(withDraft);

  assert.equal(submitted.command?.kind, "thread.start");

  const started = applyProductShellBackendEvent(submitted.state, {
    kind: "thread.started",
    payload: {
      thread: {
        threadId: "thread-antigravity-started",
        title: "Start Antigravity and keep its model source",
        agentBinding: {
          agentId: "antigravity",
          runtimeSource: {
            kind: "provider_cli",
            integrationId: "antigravity",
          },
        },
        scope: {
          kind: "project",
          projectId: "tide",
          cwd: "/Users/eatnug/Workspace/tide",
        },
        launchOptions: {
          model: "Antigravity default",
          permission: "default",
          worktree: "current folder",
          branch: "main",
        },
        context: {
          worktree: "current folder",
          branch: "main",
        },
        createdAt: "2026-05-29T00:00:00.000Z",
        updatedAt: "2026-05-29T00:00:01.000Z",
        pinned: false,
        archived: false,
        lastKnownState: "running",
      },
      runtimeState: "running",
    },
  });
  const view = createProductShellViewModel(started);

  assert.equal(view.activeThreadId, "thread-antigravity-started");
  assert.equal(view.agentChat.thread?.agentLabel, "Antigravity CLI");
  assert.equal(view.agentChat.composer.mode, "follow_up");
  assert.equal(view.agentChat.composer.modelLabel, "Antigravity default");
  assert.equal(view.agentChat.composer.permissionLabel, "default");
  assert.notEqual(view.agentChat.composer.modelLabel, "GPT-5.5 High");
  assert.deepEqual(view.agentChat.composer.contextItems.map((item) => item.value), [
    "Antigravity CLI",
    "tide",
    "current folder",
    "main",
  ]);
});

test("product_shell_start_command_uses_contract_runtime_source_shape", () => {
  const withAgentMenu = setProductShellComposerActiveSurface(createProductShellState(), "agent_menu");
  const selected = selectProductShellChoiceSurfaceRow(
    withAgentMenu,
    "agent_menu",
    "antigravity",
  );
  const withDraft = updateProductShellComposerDraft(selected.state, "Run Antigravity");
  const submitted = submitProductShellComposerDraft(withDraft);

  assert.equal(submitted.command?.kind, "thread.start");
  const validation = validateBackendCommandEnvelope({
    contractVersion: CONTRACT_VERSION,
    requestId: "req-product-shell-contract-source",
    kind: "thread.start",
    issuedAt: "2026-05-29T00:00:00.000Z",
    payload: submitted.command?.payload,
  });

  assert.equal(validation.ok, true);
});

test("shell_columns_can_close_without_losing_top_row_alignment", () => {
  const state = toggleProductShellWorkbench(
    toggleProductShellFileTree(toggleProductShellLeftUi(openProductShellThread(createProductShellState(), "thread-workbench"))),
  );
  const view = createProductShellViewModel(state);
  const html = renderProductShell(state);

  assert.equal(view.leftUiOpen, false);
  assert.equal(view.workbenchOpen, false);
  assert.equal(view.fileTreeOpen, true);
  assert.doesNotMatch(html, /aria-label="Left UI"/);
  assert.match(html, /aria-label="Agent Chat Top Row"/);
  assert.match(html, /aria-label="FileTree Top Row"/);
});

test("thread_archive_intent_replaces_actions_with_one_confirm_pill", () => {
  const state = showProductShellThreadArchiveConfirm(createProductShellState(), "thread-workbench");
  const html = renderProductShell(state);
  const row = extractByDataAttribute(html, "data-thread-row", "thread-workbench");

  assert.match(row, /thread-row--archive-confirming/);
  assert.match(row, /Confirm/);
  assert.equal((row.match(/>Confirm</g) ?? []).length, 1);
  assert.doesNotMatch(row, /aria-label="Pin Thread"/);
  assert.doesNotMatch(row, /aria-label="Archive Thread"/);
});

test("left_ui_context_menus_match_figma_items_and_keep_rows_highlighted", () => {
  const threadHtml = renderProductShell(
    openProductShellLeftUiMenu(createProductShellState(), {
      kind: "thread",
      threadId: "thread-workbench",
    }),
  );
  const projectHtml = renderProductShell(
    openProductShellLeftUiMenu(createProductShellState(), {
      kind: "project",
      projectId: "tide",
    }),
  );

  assert.match(extractByDataAttribute(threadHtml, "data-thread-row", "thread-workbench"), /thread-row--menu-open/);
  assert.match(threadHtml, /data-left-ui-menu-kind="thread"/);
  assert.match(threadHtml, /Pin \/ unpin/);
  assert.match(threadHtml, /Archive/);
  assert.match(extractByDataAttribute(projectHtml, "data-project-row", "tide"), /project-row--menu-open/);
  assert.match(projectHtml, /data-left-ui-menu-kind="project"/);
  assert.match(projectHtml, /Pin project/);
  assert.match(projectHtml, /Open in Finder/);
  assert.match(projectHtml, /Create permanent worktree/);
  assert.match(projectHtml, /Rename project/);
  assert.match(projectHtml, /Archive chats/);
  assert.match(projectHtml, /Remove/);
});

function renderProductShell(state = createProductShellState()): string {
  return renderToStaticMarkup(createElement(TideProductShell, { initialState: state }));
}

function providerSetupTerminalPane() {
  return {
    paneId: "pane-provider-setup",
    kind: "terminal",
    title: "Provider setup: codex",
    visible: true,
    revision: "pane-provider-setup:rev",
    updatedAt: "2026-05-28T00:00:00.000Z",
    status: "running",
    command: "/Users/eatnug/.local/bin/codex",
    cwd: "/Users/eatnug/Workspace/tide",
    expectedCompletion: "retry_preflight",
    transcriptPreview: "Welcome to Codex setup\nSelect trust and press Enter",
  };
}

function extractByDataAttribute(html: string, attr: string, value: string): string {
  const index = html.indexOf(`${attr}="${value}"`);
  assert.ok(index >= 0, `Expected ${attr}=${value}`);
  const start = html.lastIndexOf("<div", index);
  assert.ok(start >= 0, `Expected opening div for ${attr}=${value}`);
  const end = html.indexOf("</div>", index);
  assert.ok(end >= 0, `Expected closing div for ${attr}=${value}`);
  return html.slice(start, end + "</div>".length);
}
