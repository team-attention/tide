// Spec: docs_v2/specs/desktop-product-shell-visual-foundation.md
// Spec: docs_v2/specs/workbench-browser-pane-evidence-loop.md
// Spec: docs_v2/specs/tide-mcp-browser-action-tool.md

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import { highlightToHtml } from "../src/desktop/adapters/inbound/react-renderer/support/code-highlight.ts";

import {
  applyProductShellBackendEvent,
  applyProductShellPromptState,
  applyStartPageEditorDefinition,
  applyStartPageEditorReferences,
  createProductShellState,
  createProductShellViewModel,
  startFilePaneId,
  quickOpenFilesFromState,
  closeProductShellWorkbenchPane,
  editProductShellWorkbenchEditorPane,
  focusProductShellWorkbenchPane,
  confirmProductShellThreadArchive,
  toggleProductShellThreadPin,
  toggleProductShellProjectPin,
  submitProductShellThreadRename,
  setProductShellSearchQuery,
  toggleProductShellSearch,
  goToProductShellEditorDefinition,
  goToProductShellEditorReferences,
  moveProductShellEditorCursor,
  openProductShellLeftRailMenu,
  openProductShellThread,
  openProductShellThreadFromLeftRail,
  selectProductShellFileTreeEntry,
  selectProductShellChoiceSurfaceRow,
  selectProductShellLauncherAction,
  selectProductShellEditorPickerFile,
  selectWorkbenchViewModel,
  setProductShellWorkbenchLayout,
  openProductShellBrowserAtUrl,
  openProductShellDraftBrowser,
  setProductShellComposerActiveSurface,
  setProductShellComposerFolderScope,
  setProductShellRegisteredProjects,
  showProductShellThreadArchiveConfirm,
  startNewProductShellThread,
  submitProductShellComposerDraft,
  saveProductShellWorkbenchEditorPane,
  toggleProductShellFileTree,
  toggleProductShellFileTreeWithRefresh,
  interruptProductShellRuntime,
  toggleProductShellLeftRail,
  toggleProductShellProject,
  toggleProductShellWorkbench,
  toggleProductShellWorkbenchWithLauncher,
  updateProductShellBrowserActionResult,
  updateProductShellBrowserSnapshot,
  updateProductShellComposerDraft,
  writeProductShellTerminalInput,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import { AgentIdentityIcon, TideProductShell } from "../src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.tsx";
import {
  CONTRACT_VERSION,
  validateBackendCommandEnvelope,
} from "../src/shared/contracts/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The product-shell stylesheet is an ordered @import index over styles/*.css
// (docs_v2/specs/navigable-source-structure.md); assertions run against the
// inlined concatenation so match/doesNotMatch cover the whole cascade.
function readProductShellCss(): string {
  const indexPath = path.join(repoRoot, "src/desktop/adapters/inbound/react-renderer/styles/index.css");
  const indexSource = fs.readFileSync(indexPath, "utf8");
  return indexSource.replace(/@import\s+"([^"]+)";/g, (_, importPath: string) =>
    fs.readFileSync(path.join(path.dirname(indexPath), importPath), "utf8"),
  );
}

test("product_shell_renders_left_ui_agent_chat_composer_and_app_chrome", () => {
  const html = renderProductShell();

  assert.match(html, /class="[^"]*\btide-product-shell\b/);
  assert.match(html, /aria-label="Left Rail"/);
  assert.match(html, /aria-label="Agent Chat"/);
  assert.match(html, /aria-label="Composer"/);
  assert.match(html, /aria-label="Agent Chat Top Row"/);
});

test("left_ui_renders_project_grouped_thread_rows_with_agent_identity_icons", () => {
  const html = renderProductShell();

  assert.match(html, /Pinned/);
  assert.match(html, /Projects/);
  assert.match(html, /Scratch/);
  assert.match(html, /data-left-row-kind="project"/);
  assert.match(html, /data-left-row-kind="thread"/);
  // Thread rows carry the per-agent identity icon (Codex-app aesthetic), the
  // same mark used in the composer agent chip.
  assert.match(html, /class="thread-row__main"[^>]*>\s*<span class="agent-identity-icon/);
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
  // A pinned thread is lifted OUT of its project group into the Pinned section
  // (spec: left-rail-manual-ordering): the group is present but holds no rows, and the
  // thread surfaces in pinnedThreads with its agent identity.
  assert.deepEqual(view.projectGroups[0]?.threads ?? [], []);
  assert.equal(view.pinnedThreads[0]?.threadId, "thread-real");
  assert.equal(view.pinnedThreads[0]?.agentId, "claude");
});

test("product_shell_requests_backend_thread_list_on_mount_without_fixture_threads", () => {
  // Spec: docs_v2/specs/backend-thread-list-product-shell-bootstrap.md
  const source = fs.readFileSync(
    path.join(repoRoot, "src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.tsx"),
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

test("switching_threads_preserves_each_threads_agent_chat_state", () => {
  // Spec: docs_v2/specs/runtime-mental-model.md — switching threads is a pure
  // selection; it must never lose another thread's state. Here thread A is blocked
  // on directory trust; viewing B and returning to A must keep A's blocker.
  const summary = (threadId: string, title: string) => ({
    threadId,
    title,
    agentBinding: { agentId: "codex", runtimeSource: { kind: "provider_cli", integrationId: "codex" } },
    scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:01:00.000Z",
    pinned: false,
    archived: false,
    lastKnownState: "idle",
  });
  const base = applyProductShellBackendEvent(createProductShellState({ includeFixtureData: false }), {
    kind: "thread.listed",
    payload: { threads: [summary("thread-a", "A"), summary("thread-b", "B")] },
  });

  const openA = openProductShellThreadFromLeftRail(base, "thread-a", {
    backendTransportAvailable: true,
  }).state;
  const aBlocked = applyProductShellBackendEvent(openA, {
    kind: "providerReadiness.changed",
    payload: {
      threadId: "thread-a",
      readiness: {
        agentId: "codex",
        ready: false,
        blockers: [
          { kind: "directory_trust_required", scope: "execution_context", message: "trust needed" },
        ],
      },
    },
  });
  assert.equal(aBlocked.agentChat.providerReadiness?.ready, false);

  const onB = openProductShellThreadFromLeftRail(aBlocked, "thread-b", {
    backendTransportAvailable: true,
  }).state;
  // B has its own (clean) state — A's blocker did not bleed into it.
  assert.equal(onB.agentChat.providerReadiness, null);

  const backToA = openProductShellThreadFromLeftRail(onB, "thread-a", {
    backendTransportAvailable: true,
  }).state;
  assert.equal(backToA.activeThreadId, "thread-a");
  // A's blocker survived the round-trip instead of being rebuilt blank.
  assert.equal(backToA.agentChat.providerReadiness?.ready, false);
  assert.ok(
    backToA.agentChat.providerReadiness?.blockers.some((b) => b.kind === "directory_trust_required"),
  );
});

test("switching_back_to_a_prompt_waiting_thread_keeps_the_select_box_then_follows_the_backend_hydrate", () => {
  // The renderer side of the "go away, come back, the select box is gone" report:
  // proves the renderer is NOT the cause. The pending prompt survives switch-away/
  // back (optimistic restore) AND a hydrate that re-asserts it; it only clears when
  // the BACKEND's authoritative hydrate drops it (runtime reconciled to idle).
  const summary = (threadId: string, title: string, lastKnownState = "idle") => ({
    threadId,
    title,
    agentBinding: { agentId: "codex", runtimeSource: { kind: "provider_cli", integrationId: "codex" } },
    scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:01:00.000Z",
    pinned: false,
    archived: false,
    lastKnownState,
  });
  const prompt = {
    promptId: "perm-1",
    threadId: "thread-a",
    agentId: "codex",
    kind: "approval" as const,
    message: "Allow command?",
    source: "provider_signal" as const,
    choices: [{ choiceId: "allow", label: "Allow", providerValue: "allow" }],
  };

  const base = applyProductShellBackendEvent(createProductShellState({ includeFixtureData: false }), {
    kind: "thread.listed",
    payload: { threads: [summary("thread-a", "A"), summary("thread-b", "B")] },
  });
  const openA = openProductShellThreadFromLeftRail(base, "thread-a", { backendTransportAvailable: true }).state;
  const aWaiting = applyProductShellBackendEvent(openA, {
    kind: "prompt.changed",
    payload: { threadId: "thread-a", prompt },
  });
  assert.equal(aWaiting.agentChat.promptState?.promptId, "perm-1");
  assert.match(renderProductShell(aWaiting), /Allow command\?/);

  const onB = openProductShellThreadFromLeftRail(aWaiting, "thread-b", { backendTransportAvailable: true }).state;
  const backToA = openProductShellThreadFromLeftRail(onB, "thread-a", { backendTransportAvailable: true }).state;
  // (1) Optimistic restore must keep the prompt.
  assert.equal(backToA.agentChat.promptState?.promptId, "perm-1", "OPTIMISTIC restore lost the prompt");

  // (2) Backend hydrate for a still-live runtime RETURNS the prompt -> must survive.
  const hydratedWithPrompt = applyProductShellBackendEvent(backToA, {
    kind: "thread.hydrated",
    payload: { thread: summary("thread-a", "A", "waiting_for_approval"), blocks: [], runtimeState: "waiting_for_approval", prompt },
  });
  assert.equal(hydratedWithPrompt.agentChat.promptState?.promptId, "perm-1", "HYDRATE-with-prompt lost the prompt");

  // (3) Backend hydrate that DROPS the prompt (runtime reconciled to idle / dead) is
  // authoritative — the renderer faithfully clears it. So when users DO see the box
  // vanish, the backend returned prompt=null here; the cause is upstream, not in the
  // renderer's switch/restore.
  const hydratedNull = applyProductShellBackendEvent(backToA, {
    kind: "thread.hydrated",
    payload: { thread: summary("thread-a", "A", "idle"), blocks: [], runtimeState: "idle", prompt: null },
  });
  assert.equal(hydratedNull.agentChat.promptState, null);
  assert.equal(hydratedNull.agentChat.runtimeState, "idle");
});

test("a_late_thread_hydrated_for_a_non_active_thread_clears_its_skeleton_so_switch_back_renders", () => {
  // flow C (spec: waiting-state-recovery): a thread.hydrated that lands AFTER the user
  // switched away must clear the background entry's `hydrating`. Otherwise re-opening the
  // thread restores a preserved state stuck in the loading skeleton forever — the
  // "새로고침했더니 내용 안 보임 (점 붙은 스레드만)" report. The skeleton is renderer-only;
  // the backend serves the blocks fine.
  const summary = (threadId: string, title: string, lastKnownState = "idle") => ({
    threadId,
    title,
    agentBinding: { agentId: "claude", runtimeSource: { kind: "provider_cli", integrationId: "claude" } },
    scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:01:00.000Z",
    pinned: true,
    archived: false,
    lastKnownState,
  });
  const block = (id: string) => ({
    blockId: id, threadId: "thread-a", agentId: "claude", kind: "agent_message",
    role: "agent", status: "complete", body: "restored content", createdAt: "x", updatedAt: "x",
    sourceFrameIds: [],
  });

  const base = applyProductShellBackendEvent(createProductShellState({ includeFixtureData: false }), {
    kind: "thread.listed",
    payload: { threads: [summary("thread-a", "A", "waiting_for_approval"), summary("thread-b", "B")] },
  });
  // Open A → optimistic skeleton (hydrating, no blocks yet).
  const onA = openProductShellThreadFromLeftRail(base, "thread-a", { backendTransportAvailable: true }).state;
  assert.equal(createProductShellViewModel(onA).agentChat.chatState, "hydrating", "A starts as skeleton");
  // Switch to B BEFORE A's hydrate returns (preserves A's hydrating state in the bg map).
  const onB = openProductShellThreadFromLeftRail(onA, "thread-b", { backendTransportAvailable: true }).state;
  // A's hydrate arrives LATE, while B is active → must still clear A's preserved skeleton.
  const afterLateHydrate = applyProductShellBackendEvent(onB, {
    kind: "thread.hydrated",
    payload: {
      thread: summary("thread-a", "A", "waiting_for_approval"),
      blocks: [block("b1")],
      runtimeState: "waiting_for_approval",
      prompt: null,
    },
  });
  // Switching back to A must render its content, not a permanent skeleton.
  const backToA = openProductShellThreadFromLeftRail(afterLateHydrate, "thread-a", { backendTransportAvailable: true }).state;
  assert.notEqual(
    createProductShellViewModel(backToA).agentChat.chatState,
    "hydrating",
    "switch-back must not re-show the skeleton",
  );
});

test("a_background_threads_prompt_folds_into_its_stored_state_no_hydrate_needed_on_switch", () => {
  // The concurrency guarantee (spec: waiting-state-recovery): a sibling thread that raises
  // an AskUserQuestion WHILE you are viewing another thread must have its card waiting for
  // you when you switch to it — folded into its authoritative per-thread state as the event
  // arrives, NOT reconstructed by a hydrate race at switch time (which dropped it under
  // concurrency: the chat stayed "Working"). Here NO thread.hydrated is applied after the
  // background prompt — switching back alone must surface the card.
  const summary = (threadId: string, title: string, lastKnownState = "idle") => ({
    threadId,
    title,
    agentBinding: { agentId: "claude", runtimeSource: { kind: "provider_cli", integrationId: "claude" } },
    scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:01:00.000Z",
    pinned: true,
    archived: false,
    lastKnownState,
  });
  const prompt = {
    promptId: "auq-1", threadId: "thread-a", agentId: "claude", kind: "choice" as const,
    message: "Which is your favorite?", source: "provider_hook" as const,
    choices: [{ choiceId: "red", label: "Red", providerValue: "structured:option:Red" }],
  };
  const base = applyProductShellBackendEvent(createProductShellState({ includeFixtureData: false }), {
    kind: "thread.listed",
    payload: { threads: [summary("thread-a", "A", "running"), summary("thread-b", "B", "running")] },
  });
  // Open A then B so BOTH have stored chat state (A preserved into the map on the switch).
  const onA = openProductShellThreadFromLeftRail(base, "thread-a", { backendTransportAvailable: true }).state;
  const onB = openProductShellThreadFromLeftRail(onA, "thread-b", { backendTransportAvailable: true }).state;
  // A is BACKGROUND now. Its AskUserQuestion arrives — must fold into A's stored entry.
  const aPromptWhileOnB = applyProductShellBackendEvent(onB, {
    kind: "prompt.changed",
    payload: { threadId: "thread-a", prompt },
  });
  assert.equal(
    aPromptWhileOnB.agentChatByThreadId["thread-a"]?.promptState?.promptId,
    "auq-1",
    "a background thread's prompt must fold into its stored state",
  );
  // The thread we are LOOKING at (B) must be untouched by A's prompt.
  assert.equal(aPromptWhileOnB.agentChat.promptState, null, "the active thread's surface is not cross-contaminated");
  // Switch back to A — NO hydrate applied — the card is already there.
  const backToA = openProductShellThreadFromLeftRail(aPromptWhileOnB, "thread-a", { backendTransportAvailable: true }).state;
  assert.equal(backToA.agentChat.promptState?.promptId, "auq-1", "switch-back surfaces the card without a hydrate");
});

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

test("search_query_filters_threads_by_title_in_the_left_ui", () => {
  // Spec: docs_v2/specs/backend-thread-list-product-shell-bootstrap.md
  const state = threadListState(); // threads titled "Keep" and "Archive me"

  const all = createProductShellViewModel(state);
  const allTitles = all.projectGroups.flatMap((group) => group.threads.map((t) => t.title));
  assert.deepEqual(allTitles.sort(), ["Archive me", "Keep"]);

  const searched = createProductShellViewModel(setProductShellSearchQuery(state, "archive"));
  const searchedTitles = searched.projectGroups.flatMap((group) =>
    group.threads.map((t) => t.title),
  );
  assert.deepEqual(searchedTitles, ["Archive me"]);
  assert.equal(searched.searchQuery, "archive");
  // Project groups with no matching thread are hidden while searching.
  assert.ok(searched.projectGroups.every((group) => group.threads.length > 0));

  const noMatch = createProductShellViewModel(setProductShellSearchQuery(state, "zzz-nomatch"));
  assert.equal(
    noMatch.projectGroups.flatMap((group) => group.threads).length,
    0,
  );
});

test("left_ui_search_is_a_nav_row_until_activated", () => {
  // Spec: docs_v2/specs/desktop-product-shell-visual-foundation.md
  // Canonical Figma workbench frame (1223:2): the Left Rail "Search" entry is a
  // nav row (icon + "Search"), like "New thread". The inline filter input
  // belongs only to the FileTree. Activating Search reveals the inline input.
  const resting = renderProductShell();
  assert.match(resting, /<span>Search<\/span>/);
  assert.doesNotMatch(resting, /aria-label="Search threads"/);

  const activeState = toggleProductShellSearch(createProductShellState());
  assert.equal(activeState.searchActive, true);
  const active = renderProductShell(activeState);
  assert.match(active, /aria-label="Search threads"/);

  // Toggling again closes the input and clears any in-progress query.
  const reclosed = toggleProductShellSearch(setProductShellSearchQuery(activeState, "abc"));
  assert.equal(reclosed.searchActive, false);
  assert.equal(reclosed.searchQuery, "");
});

test("a_launcher_only_workbench_change_does_not_force_the_workbench_open", () => {
  // Opening the FileTree emits a refresh_file_tree -> workbench.changed carrying
  // just the (default-visible) launcher pane. That must NOT pop the Workbench open.
  // The thread must be the ACTIVE one for its workbench changes to touch the view
  // (a background thread's pane change is ignored — see multi-thread-routing).
  const hydrated = applyProductShellBackendEvent(createProductShellState(), {
    kind: "thread.hydrated",
    payload: {
      thread: {
        threadId: "thread-wb",
        title: "thread-wb",
        agentBinding: { agentId: "codex" },
        scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
        pinned: false,
        archived: false,
        updatedAt: "2026-06-04T00:00:00.000Z",
        lastKnownState: "idle",
      },
      blocks: [],
      runtimeState: "idle",
    },
  });
  const base = openProductShellThread(hydrated, "thread-wb");
  assert.equal(base.activeThreadId, "thread-wb");
  const launcherOnly = applyProductShellBackendEvent(base, {
    kind: "workbench.changed",
    payload: {
      threadId: "thread-wb",
      panes: [
        { paneId: "p-launcher", kind: "launcher", title: "Workbench launcher", visible: true, revision: "1", updatedAt: "2026-06-01T00:00:00.000Z" },
      ],
    },
  });
  assert.equal(launcherOnly.workbenchOpen, false, "launcher-only change keeps workbench closed");

  // A real (non-launcher) visible pane does auto-open the workbench.
  const withEditor = applyProductShellBackendEvent(launcherOnly, {
    kind: "workbench.changed",
    payload: {
      threadId: "thread-wb",
      panes: [
        { paneId: "p-launcher", kind: "launcher", title: "Workbench launcher", visible: false, revision: "2", updatedAt: "2026-06-01T00:00:00.000Z" },
        { paneId: "p-editor", kind: "editor", title: "app.ts", visible: true, revision: "2", updatedAt: "2026-06-01T00:00:00.000Z" },
      ],
    },
  });
  assert.equal(withEditor.workbenchOpen, true, "a visible editor pane opens the workbench");
});

test("an_existing_pane_update_does_not_reopen_a_workbench_the_user_closed", () => {
  // A terminal streams workbench.changed updates (same paneId) as it runs. After the
  // user closes the workbench, those updates must NOT re-open it — otherwise the
  // workbench can never be closed while a terminal pane is active.
  const opened = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        panes: [
          { paneId: "p-term", kind: "terminal", title: "Terminal", visible: true, revision: "1", updatedAt: "2026-06-01T00:00:00.000Z" },
        ],
      },
    },
  );
  assert.equal(opened.workbenchOpen, true, "a new terminal pane opens the workbench");

  const closed = toggleProductShellWorkbench(opened);
  assert.equal(closed.workbenchOpen, false, "the user closed the workbench");

  const afterUpdate = applyProductShellBackendEvent(closed, {
    kind: "workbench.changed",
    payload: {
      threadId: "thread-workbench",
      panes: [
        { paneId: "p-term", kind: "terminal", title: "Terminal", visible: true, revision: "2", updatedAt: "2026-06-01T00:00:01.000Z" },
      ],
    },
  });
  assert.equal(
    afterUpdate.workbenchOpen,
    false,
    "an update to the existing pane does not re-open the closed workbench",
  );
});

// Quick Open must search EVERY loaded file: folders are collapsed by default,
// and the rendered FileTree view hides collapsed descendants — deriving the
// search list from that view left Cmd+P blind to all nested files.
// Spec: start-page-file-viewer — the START page tree must behave like a real
// tree: folders expand (no thread required) and files open as a real, EDITABLE
// Workbench editor pane (read via workspace.readFile, saved via
// workspace.writeFile), not an overlay over the chat.
test("start_page_file_opens_as_an_editable_workbench_editor_pane", () => {
  const scoped = setProductShellComposerFolderScope(createProductShellState(), "/repo/tide");
  const state = applyProductShellBackendEvent(scoped, {
    kind: "workspace.fileTreeLoaded",
    payload: {
      cwd: "/repo/tide",
      fileTree: {
        cwdLabel: "tide",
        entries: [
          { id: "d-src", name: "src", relativePath: "src", depth: 0, kind: "folder" },
          { id: "f-app", name: "app.ts", relativePath: "src/app.ts", depth: 1, kind: "file" },
        ],
      },
    },
  });
  assert.equal(state.activeThreadId, null);

  // Folder toggle works WITHOUT a thread (this froze the start-page tree at
  // its top level).
  const expanded = selectProductShellFileTreeEntry(state, "d-src");
  assert.equal(expanded.command, null);
  assert.ok(expanded.state.expandedFolderPaths.includes("src"));

  // A file click reads the file thread-independently AND opens the workbench so
  // the editor column animates in immediately (not as a chat overlay).
  const opened = selectProductShellFileTreeEntry(expanded.state, "f-app");
  assert.deepEqual(opened.command, {
    kind: "workspace.readFile",
    payload: { cwd: "/repo/tide", path: "src/app.ts" },
  });
  assert.equal(opened.state.workbenchOpen, true);

  // The loaded content lands in start-page state and the view-model synthesizes a
  // real editor pane (kind "editor") for the Workbench column — no overlay.
  const loaded = applyProductShellBackendEvent(opened.state, {
    kind: "workspace.fileLoaded",
    payload: { cwd: "/repo/tide", relativePath: "src/app.ts", content: "export {};", truncated: false },
  });
  assert.equal(loaded.workbenchOpen, true);
  const loadedVm = createProductShellViewModel(loaded);
  const appPaneId = startFilePaneId("src/app.ts");
  const pane = loadedVm.appChrome.activeWorkbenchPane;
  assert.equal(pane?.paneId, appPaneId);
  assert.equal(pane?.kind, "editor");
  assert.equal(pane?.relativePath, "src/app.ts");
  assert.equal(pane?.bodyText, "export {};");
  assert.equal(loadedVm.editorDrafts[appPaneId]?.content, "export {};");
  assert.equal(loadedVm.editorDrafts[appPaneId]?.dirty, false);

  // Opening a SECOND, different file opens its OWN editor tab (does NOT replace the
  // first) — two editor panes, the new one active.
  const twoFiles = applyProductShellBackendEvent(loaded, {
    kind: "workspace.fileLoaded",
    payload: { cwd: "/repo/tide", relativePath: "src/two.ts", content: "export const two = 2;", truncated: false },
  });
  const twoVm = createProductShellViewModel(twoFiles);
  const editorTabs = twoVm.appChrome.workbenchTabStrip.visibleTabs.filter((tab) => tab.kind === "editor");
  assert.equal(editorTabs.length, 2);
  assert.equal(twoVm.appChrome.activeWorkbenchPane?.paneId, startFilePaneId("src/two.ts"));

  // Reopening the FIRST file from the tree just focuses its existing tab (no re-read,
  // still two files).
  const refocus = selectProductShellFileTreeEntry(twoFiles, "f-app");
  assert.equal(refocus.command, null);
  assert.equal(refocus.state.startPageFiles.length, 2);
  assert.equal(refocus.state.draftActiveWorkbenchPaneId, appPaneId);

  // Editing the synthetic pane marks it dirty without any thread…
  const edited = editProductShellWorkbenchEditorPane(loaded, appPaneId, "export const x = 1;");
  assert.equal(edited.startPageFiles[0]?.draft, "export const x = 1;");
  assert.equal(edited.startPageFiles[0]?.dirty, true);
  assert.equal(createProductShellViewModel(edited).editorDrafts[appPaneId]?.dirty, true);

  // …and saving writes the buffer thread-independently under the composer cwd.
  const saved = saveProductShellWorkbenchEditorPane(edited, appPaneId);
  assert.deepEqual(saved.command, {
    kind: "workspace.writeFile",
    payload: { cwd: "/repo/tide", path: "src/app.ts", content: "export const x = 1;" },
  });

  // The fileSaved event re-bases the editor: new on-disk content, no longer dirty.
  const settled = applyProductShellBackendEvent(edited, {
    kind: "workspace.fileSaved",
    payload: { cwd: "/repo/tide", relativePath: "src/app.ts", content: "export const x = 1;", truncated: false },
  });
  assert.equal(settled.startPageFiles[0]?.content, "export const x = 1;");
  assert.equal(settled.startPageFiles[0]?.dirty, false);
  assert.equal(settled.startPageFiles[0]?.draft, undefined);

  // A SAME-directory tree reload (FileTree toggle) keeps the open file…
  const sameTree = applyProductShellBackendEvent(loaded, {
    kind: "workspace.fileTreeLoaded",
    payload: { cwd: "/repo/tide", fileTree: { cwdLabel: "tide", entries: [] } },
  });
  assert.equal(sameTree.startPageFiles.length, 1);

  // …a composer scope chip switch to ANOTHER directory closes it…
  const otherTree = applyProductShellBackendEvent(sameTree, {
    kind: "workspace.fileTreeLoaded",
    payload: { cwd: "/repo/other", fileTree: { cwdLabel: "other", entries: [] } },
  });
  assert.equal(otherTree.startPageFiles.length, 0);

  // …and closing the pane drops the file and collapses the empty workbench.
  const closed = closeProductShellWorkbenchPane(loaded, appPaneId);
  assert.equal(closed.state.startPageFiles.length, 0);
  assert.equal(closed.state.workbenchOpen, false);
  assert.equal(closed.command, null);
});

// Spec: start-page-file-viewer — go-to-definition/references work on the
// thread-less start-page editor too (thread-independent workspace.codeIntel).
test("start_page_editor_go_to_definition_and_references_apply_thread_independently", () => {
  const scoped = setProductShellComposerFolderScope(createProductShellState(), "/repo/tide");
  const loaded = applyProductShellBackendEvent(scoped, {
    kind: "workspace.fileLoaded",
    payload: { cwd: "/repo/tide", relativePath: "src/app.ts", content: "export const x = 1;\nconsole.log(x);", truncated: false },
  });

  const appPaneId = startFilePaneId("src/app.ts");

  // Same-file definition scrolls in place: navigationTarget set, no backend round-trip.
  const sameFile = applyStartPageEditorDefinition(loaded, appPaneId, { relativePath: "src/app.ts", line: 0, character: 13, length: 1, label: "x" });
  assert.equal(sameFile.command, null);
  assert.deepEqual(sameFile.state.startPageFiles[0]?.navigationTarget, {
    line: 0, character: 13, length: 1, label: "x", sourcePaneId: appPaneId,
  });
  // …and it surfaces on the synthetic editor pane the workbench renders.
  assert.deepEqual(
    createProductShellViewModel(sameFile.state).appChrome.activeWorkbenchPane?.navigationTarget,
    sameFile.state.startPageFiles[0]?.navigationTarget,
  );

  // Cross-file definition opens the other file in its OWN tab, then applies the
  // target on load (the first file stays open).
  const crossFile = applyStartPageEditorDefinition(loaded, appPaneId, { relativePath: "src/util.ts", line: 4, character: 2, label: "helper" });
  assert.deepEqual(crossFile.command, {
    kind: "workspace.readFile",
    payload: { cwd: "/repo/tide", path: "src/util.ts" },
  });
  assert.equal(crossFile.state.startPagePendingNavigation?.relativePath, "src/util.ts");
  const crossLoaded = applyProductShellBackendEvent(crossFile.state, {
    kind: "workspace.fileLoaded",
    payload: { cwd: "/repo/tide", relativePath: "src/util.ts", content: "export const helper = () => {};", truncated: false },
  });
  assert.equal(crossLoaded.startPageFiles.length, 2);
  const utilFile = crossLoaded.startPageFiles.find((file) => file.relativePath === "src/util.ts");
  assert.equal(utilFile?.navigationTarget?.line, 4);
  assert.equal(utilFile?.navigationTarget?.label, "helper");
  assert.equal(crossLoaded.startPagePendingNavigation, null);

  // References populate the editor's references panel on the synthetic pane.
  const withRefs = applyStartPageEditorReferences(loaded, appPaneId, {
    items: [
      { relativePath: "src/app.ts", line: 1, character: 12 },
      { relativePath: "src/other.ts", line: 3, character: 0, label: "x" },
    ],
    truncated: false,
  });
  const refs = createProductShellViewModel(withRefs).appChrome.activeWorkbenchPane?.references;
  assert.equal(refs?.items.length, 2);
  assert.equal(refs?.items[1]?.relativePath, "src/other.ts");
  assert.equal(refs?.truncated, false);
});

test("quick_open_files_include_collapsed_folder_descendants", () => {
  const state = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        panes: [],
        fileTree: {
          cwdLabel: "tide",
          entries: [
            { id: "d-src", name: "src", relativePath: "src", depth: 0, kind: "folder" },
            { id: "f-app", name: "app.ts", relativePath: "src/app.ts", depth: 1, kind: "file" },
            { id: "f-readme", name: "README.md", relativePath: "README.md", depth: 0, kind: "file" },
          ],
        },
      },
    },
  );
  // The rendered tree hides the collapsed descendant…
  const rendered = createProductShellViewModel(state).fileTree.entries.map((e) => e.relativePath);
  assert.ok(!rendered.includes("src/app.ts"));
  // …but Quick Open still sees it (and never lists folders).
  assert.deepEqual(quickOpenFilesFromState(state), [
    { relativePath: "src/app.ts", name: "app.ts" },
    { relativePath: "README.md", name: "README.md" },
  ]);
});

test("clicking_a_file_tree_folder_collapses_and_expands_its_descendants", () => {
  // Spec: docs_v2/specs/workbench-filetree-view.md
  const state = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        panes: [],
        fileTree: {
          cwdLabel: "tide",
          entries: [
            { id: "d-src", name: "src", relativePath: "src", depth: 0, kind: "folder" },
            { id: "f-app", name: "app.ts", relativePath: "src/app.ts", depth: 1, kind: "file" },
            { id: "f-readme", name: "README.md", relativePath: "README.md", depth: 0, kind: "file" },
          ],
        },
      },
    },
  );
  const visible = (s: typeof state) =>
    createProductShellViewModel(s).fileTree.entries.map((e) => e.relativePath);

  // D6: folders are collapsed by default, so the descendant is hidden initially
  // while the top-level folder and file rows stay visible.
  assert.ok(!visible(state).includes("src/app.ts"), "descendant hidden initially");
  assert.ok(visible(state).includes("src"), "top-level folder visible initially");
  assert.ok(visible(state).includes("README.md"), "top-level file visible initially");

  // Expanding reveals already-loaded children with no Backend round-trip.
  const expanded = selectProductShellFileTreeEntry(state, "d-src");
  assert.equal(expanded.command, null, "folder toggle emits no Backend command");
  assert.ok(visible(expanded.state).includes("src/app.ts"), "descendant visible when expanded");
  const folder = createProductShellViewModel(expanded.state).fileTree.entries.find(
    (e) => e.relativePath === "src",
  );
  assert.equal(folder?.expanded, true);

  // Collapsing hides the descendant again.
  const collapsed = selectProductShellFileTreeEntry(expanded.state, "d-src");
  assert.equal(collapsed.command, null);
  assert.ok(!visible(collapsed.state).includes("src/app.ts"), "descendant hidden when collapsed");
  assert.ok(visible(collapsed.state).includes("src"), "folder itself stays visible");
});

test("clicking_a_file_tree_file_opens_it_in_the_editor", () => {
  // Spec: docs_v2/specs/workbench-filetree-view.md
  const state = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        panes: [],
        fileTree: {
          cwdLabel: "tide",
          entries: [{ id: "f-readme", name: "README.md", relativePath: "README.md", depth: 0, kind: "file" }],
        },
      },
    },
  );
  const result = selectProductShellFileTreeEntry(state, "f-readme");
  assert.equal(result.command?.kind, "workbench.command");
  assert.equal(result.command?.payload.command, "open_editor");
  assert.equal((result.command?.payload.data as { path?: string })?.path, "README.md");
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
  const css = readProductShellCss();

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

test("composer_uses_icon_chrome_for_options_model_and_send", () => {
  const html = renderProductShell();

  assert.match(html, /aria-label="Composer options"/);
  assert.match(html, /aria-label="Permission"/);
  assert.match(html, /aria-label="Model"/);
  // The voice/mic button was removed — it has no implementation and added composer noise.
  assert.doesNotMatch(html, /aria-label="Voice input"/);
  assert.match(html, /aria-label="Send"/);
  assert.match(html, /Do anything/);
});

test("visual_foundation_css_uses_tide_icon_key_colors_without_pure_black_shell", () => {
  const css = readProductShellCss();

  // Palette conformed to exact Figma values (frame 1223:2 / composer 1223:91).
  assert.match(css, /--tide-bg:\s*#fdfdfc/i);
  assert.match(css, /--tide-surface:\s*#f4f3f0/i);
  assert.match(css, /--tide-selection:\s*#eeedea/i);
  assert.match(css, /--tide-line:\s*#e4e2de/i);
  assert.match(css, /--tide-line-strong:\s*#d9d6cf/i);
  assert.match(css, /--tide-text:\s*#242424/i);
  assert.match(css, /--tide-muted:\s*#8a8781/i);
  assert.match(css, /--tide-action:\s*#343038/i);
  assert.match(css, /--tide-danger:\s*#ba322f/i);
  assert.match(css, /--agent-codex/);
  assert.doesNotMatch(css, /--tide-bg:\s*#000\b/i);
  assert.doesNotMatch(css, /background:\s*#000\b/i);
});

test("visual_foundation_css_avoids_decorative_glow_and_heavy_cards", () => {
  const css = readProductShellCss();

  assert.doesNotMatch(css, /radial-gradient/);
  assert.doesNotMatch(css, /0 18px 60px/);
  assert.match(css, /\.tide-product-shell__stage\s*{[^}]*background:\s*var\(--tide-bg\)/s);
  assert.match(css, /\.composer-shell\s*{[^}]*box-shadow:\s*var\(--tide-shadow-composer\)/s);
});

test("agent_icons_use_deterministic_identity_palette", () => {
  const html = renderToStaticMarkup(
    <div>
      <AgentIdentityIcon agentId="codex" />
      <AgentIdentityIcon agentId="claude" />
      <AgentIdentityIcon agentId="gemini" />
    </div>,
  );

  assert.match(html, /data-agent-icon="codex"/);
  assert.match(html, /data-agent-icon="claude"/);
  assert.match(html, /data-agent-icon="gemini"/);
});

test("renderer_entry_mounts_product_shell_not_bare_agent_chat", () => {
  const renderer = fs.readFileSync(
    path.join(repoRoot, "src/desktop/infrastructure/electron/renderer/renderer-entry.tsx"),
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

test("product_shell_thread_selection_switches_focus_locally_and_emits_thread_hydrate", () => {
  const result = openProductShellThreadFromLeftRail(
    createProductShellState(),
    "thread-workbench",
    { backendTransportAvailable: true },
  );
  const view = createProductShellViewModel(result.state);

  // A click owns focus: switch to the thread instantly (locally, from cache) and
  // refresh from the backend. Events never move focus.
  assert.deepEqual(result.command, {
    kind: "thread.hydrate",
    payload: { threadId: "thread-workbench" },
  });
  assert.equal(view.activeThreadId, "thread-workbench");
  assert.equal(
    (view.agentChat.thread as { threadId?: string } | null)?.threadId,
    "thread-workbench",
  );
  // The optimistic switch shows the thread header with an empty body until the real
  // blocks arrive — never a fake "local preview" placeholder block (which then
  // vanished when thread.hydrated replaced it).
  assert.ok(
    view.agentChat.blocks.every(
      (block) => !(block.body ?? "").includes("local Product Shell preview"),
    ),
    "the backend switch must not inject a local-preview placeholder block",
  );
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

test("sending_start_composer_from_product_shell_opens_the_new_thread_optimistically", () => {
  const drafted = updateProductShellComposerDraft(
    createProductShellState(),
    "Build the Product Shell interactions",
  );
  const result = submitProductShellComposerDraft(drafted);
  const view = createProductShellViewModel(result.state);

  assert.equal(result.command?.kind, "thread.start");
  assert.equal(result.command?.payload.initialMessage, "Build the Product Shell interactions");
  assert.equal(result.command?.payload.launchOptions?.model, "gpt-5.5");
  // The command carries a client-generated id; the new thread is shown right away
  // with that id as active, and the draft is cleared so a re-click can't resend.
  const newThreadId = result.command?.payload.threadId;
  assert.equal(typeof newThreadId, "string");
  assert.equal(view.activeThreadId, newThreadId);
  assert.equal((view.agentChat.thread as { threadId?: string } | null)?.threadId, newThreadId);
  assert.equal(view.agentChat.composer.draft, "");
  // The optimistic thread is in the rail immediately.
  assert.ok(view.flatThreads.some((thread) => thread.threadId === newThreadId));
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
    permission: "approve-for-me",
    worktree: "current folder",
    branch: "main",
  });
});

test("new_thread_in_project_prescopes_start_composer_to_that_project", () => {
  // Spec: docs_v2/specs/desktop-product-shell-visual-foundation.md UC-6b inv-18
  // "slice" project (cwd /Users/you/Workspace/slice) must scope the new thread.
  const state = startNewProductShellThread(createProductShellState(), "slice");
  const drafted = updateProductShellComposerDraft(state, "Investigate the slice build");
  const result = submitProductShellComposerDraft(drafted);

  assert.equal(result.command?.kind, "thread.start");
  assert.deepEqual(result.command?.payload.scope, {
    kind: "project",
    projectId: "slice",
    cwd: "/Users/you/Workspace/slice",
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

test("active_thread_with_closed_workbench_renders_open_workbench_action", () => {
  // Spec: docs_v2/specs/app-chrome-workbench-tab-strip.md UC-6 D9
  // thread-sketch has no Workbench panes, so opening it leaves the Workbench closed.
  const state = openProductShellThread(createProductShellState(), "thread-sketch");
  const view = createProductShellViewModel(state);
  assert.equal(view.workbenchOpen, false, "workbench starts closed for a no-pane thread");

  const html = renderProductShell(state);
  assert.match(html, /aria-label="Open Workbench"/);
  assert.match(html, /title="Open Workbench"/);
});

test("opening_closed_workbench_for_active_thread_emits_open_launcher", () => {
  // Spec: docs_v2/specs/app-chrome-workbench-tab-strip.md UC-6 D9
  const state = openProductShellThread(createProductShellState(), "thread-sketch");
  const result = toggleProductShellWorkbenchWithLauncher(state);

  assert.equal(result.state.workbenchOpen, true);
  assert.deepEqual(result.command, {
    kind: "workbench.command",
    payload: {
      threadId: "thread-sketch",
      command: "open_launcher",
    },
  });
});

test("open_workbench_tab_strip_renders_new_pane_action", () => {
  // Spec: docs_v2/specs/app-chrome-workbench-tab-strip.md UC-6 D9
  // thread-workbench opens with visible panes, so the Workbench is open.
  const state = openProductShellThread(createProductShellState(), "thread-workbench");
  const html = renderProductShell(state);
  assert.match(html, /aria-label="New Pane"/);
  assert.match(html, /title="New Pane"/);
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
  // Flat browser pane: editable address bar (URL input + loading) then the page.
  assert.match(html, /aria-label="Browser address input"/);
  assert.match(html, /https:\/\/example\.test\/docs/);
  assert.match(html, /loading/);
  // The live <webview> renders the page (the human view); the text snapshot is
  // the Agent's evidence, not a human-facing preview panel.
  assert.match(html, /data-browser-pane-webview="pane-browser"/);
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

function editorPaneState(pane: Record<string, unknown>) {
  return applyProductShellBackendEvent(
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
            visible: true,
            revision: "pane-editor:rev",
            updatedAt: "2026-05-28T00:00:00.000Z",
            ...pane,
          },
        ],
      },
    },
  );
}

test("workbench_editor_pane_renders_as_a_code_editor_not_a_viewer", () => {
  // Spec: docs_v2/specs/workbench-markdown-preview-editor.md (UC-3)
  const state = editorPaneState({
    title: "app.ts",
    filePath: "/Users/you/Workspace/tide/src/app.ts",
    relativePath: "src/app.ts",
    bodyText: "export const value = 1;\n",
    bodyTextPreview: "export const value = 1;\n",
    byteLength: 24,
    truncated: false,
  });
  const html = renderProductShell(state);

  assert.match(html, /data-pane-kind="editor"/);
  // Path shows as a breadcrumb (with workspace root), not a file-info panel.
  assert.match(html, /workbench-editor-breadcrumb/);
  assert.match(html, /src/);
  assert.match(html, /app\.ts/);
  // Real code editor surface (CodeMirror), no markdown preview toggle.
  assert.match(html, /aria-label="Editor Pane text"/);
  assert.doesNotMatch(html, /Markdown view mode/);
  // Not a viewer: no Size/byte panel and no LSP/save action buttons.
  assert.doesNotMatch(html, /24 bytes/);
  assert.doesNotMatch(html, /workbench-editor-actions/);
  assert.doesNotMatch(html, /Save file/);
});

test("code_editor_pane_has_no_markdown_preview_toggle", () => {
  // Spec: docs_v2/specs/workbench-markdown-preview-editor.md (UC-3)
  const html = renderProductShell(
    editorPaneState({
      title: "lib.rs",
      filePath: "/Users/you/Workspace/tide/src/lib.rs",
      relativePath: "src/lib.rs",
      bodyText: "fn main() {}\n",
      bodyTextPreview: "fn main() {}\n",
      byteLength: 13,
      truncated: false,
    }),
  );
  assert.doesNotMatch(html, /Markdown view mode/);
  assert.match(html, /aria-label="Editor Pane text"/);
});

test("markdown_editor_pane_renders_preview_with_rendered_headings", () => {
  // Spec: docs_v2/specs/workbench-markdown-preview-editor.md (UC-1)
  const html = renderProductShell(
    editorPaneState({
      title: "CLAUDE.md",
      filePath: "/Users/you/Workspace/tide/CLAUDE.md",
      relativePath: "CLAUDE.md",
      bodyText: "# Tide — Project Rules\n\n## Evidence-First\n\nEvery claim needs evidence.\n",
      bodyTextPreview: "# Tide — Project Rules\n\n## Evidence-First\n\nEvery claim needs evidence.\n",
      byteLength: 70,
      truncated: false,
    }),
  );
  // Markdown renders to a Preview (rendered headings), not raw "# " source.
  assert.match(html, /aria-label="Markdown preview"/);
  assert.match(html, /<h1>Tide — Project Rules<\/h1>/);
  assert.match(html, /<h2>Evidence-First<\/h2>/);
  assert.doesNotMatch(html, /# Tide — Project Rules/);
  // A Preview/Edit toggle is present for markdown.
  assert.match(html, /Markdown view mode/);
  // Breadcrumb includes the workspace root, like the Figma (`tide › CLAUDE.md`).
  assert.match(html, /workbench-editor-breadcrumb/);
});

test("markdown_preview_escapes_raw_html", () => {
  // Spec: docs_v2/specs/workbench-markdown-preview-editor.md (D1)
  const html = renderProductShell(
    editorPaneState({
      title: "evil.md",
      filePath: "/Users/you/Workspace/tide/evil.md",
      relativePath: "evil.md",
      bodyText: "# Hi\n\n<img src=x onerror=alert(1)>\n",
      bodyTextPreview: "# Hi\n\n<img src=x onerror=alert(1)>\n",
      byteLength: 36,
      truncated: false,
    }),
  );
  // Raw HTML in the file is escaped, never emitted as a live element.
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.match(html, /&lt;img/);
});

test("markdown_editor_pane_renders_gfm_table", () => {
  // Spec: docs_v2/specs/workbench-markdown-preview-editor.md (UC-4, UC-5)
  const body = "# T\n\n| A | B |\n| - | - |\n| 1 | 2 |\n";
  const html = renderProductShell(
    editorPaneState({
      title: "table.md",
      filePath: "/Users/you/Workspace/tide/table.md",
      relativePath: "table.md",
      bodyText: body,
      bodyTextPreview: body,
      byteLength: body.length,
      truncated: false,
    }),
  );
  // The pipe table renders as a real table, not raw "| A | B |" source.
  assert.match(html, /<table>/);
  assert.match(html, /<th>A<\/th>/);
  assert.match(html, /<td>1<\/td>/);
  assert.doesNotMatch(html, /\| A \| B \|/);
});

test("markdown_editor_pane_renders_task_list_checkboxes", () => {
  // Spec: docs_v2/specs/workbench-markdown-preview-editor.md (UC-4, Invariant 1)
  const body = "# Todo\n\n- [ ] open item\n- [x] done item\n";
  const html = renderProductShell(
    editorPaneState({
      title: "todo.md",
      filePath: "/Users/you/Workspace/tide/todo.md",
      relativePath: "todo.md",
      bodyText: body,
      bodyTextPreview: body,
      byteLength: body.length,
      truncated: false,
    }),
  );
  // Markers become real (read-only) checkboxes, not literal "[ ]"/"[x]" text.
  assert.match(html, /class="contains-task-list"/);
  assert.match(html, /class="task-list-item-checkbox"[^>]*type="checkbox"/);
  assert.match(html, /checked=""/); // the [x] item
  assert.match(html, /disabled=""/); // read-only
  assert.doesNotMatch(html, /\[ \] open item/);
  assert.doesNotMatch(html, /\[x\] done item/);
});

test("markdown_editor_pane_renders_fenced_code_highlighted_on_view", () => {
  // Spec: docs_v2/specs/workbench-markdown-preview-editor.md (UC-4, D6)
  // Fences render as plain, PENDING code up front so a code-heavy markdown file
  // opens without paying every fence's highlight parse; WorkbenchMarkdownView
  // then upgrades each fence to tok-* spans once it scrolls into view (an
  // IntersectionObserver effect, which the static server render does not run).
  const body = "# Code\n\n```ts\nconst x = 1;\n```\n";
  const html = renderProductShell(
    editorPaneState({
      title: "code.md",
      filePath: "/Users/you/Workspace/tide/code.md",
      relativePath: "code.md",
      bodyText: body,
      bodyTextPreview: body,
      byteLength: body.length,
      truncated: false,
    }),
  );
  // The fence is emitted pending (marked for deferred highlight), tagged with its
  // language, carrying the plain code — inside the md-fence block.
  assert.match(html, /class="md-fence"/);
  assert.match(html, /data-tide-fence/);
  assert.match(html, /data-tide-lang="ts"/);
  assert.match(html, /const x = 1;/);
  // The deferred upgrade applies real tok-* highlight spans from the bundled
  // highlighter (the function the IntersectionObserver effect runs per fence).
  assert.match(highlightToHtml("const x = 1;", "ts"), /class="tok-/);
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
            filePath: "/Users/you/Workspace/tide/README.md",
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
              filePath: "/Users/you/Workspace/tide/README.md",
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
            filePath: "/Users/you/Workspace/tide/src/app.ts",
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
            filePath: "/Users/you/Workspace/tide/src/app.ts",
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
            filePath: "/Users/you/Workspace/tide/src/app.ts",
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
            filePath: "/Users/you/Workspace/tide/large.md",
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
            filePath: "/Users/you/Workspace/tide/README.md",
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
            filePath: "/Users/you/Workspace/tide/README.md",
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

  // D4: each diff line carries a change-type tag instead of one flat <pre> block,
  // now GitHub/VS Code-style with a +/- stat header and line-number gutters.
  assert.match(html, /workbench-diff__stat/);
  assert.match(html, /workbench-diff-row--hunk[\s\S]*?@@ -1,2 \+1,2 @@/);
  assert.match(html, /workbench-diff-row--removed[\s\S]*?Old Tide/);
  assert.match(html, /workbench-diff-row--added[\s\S]*?New Tide/);
  assert.match(html, /workbench-diff-row--context[\s\S]*?Title/);
  assert.match(html, /workbench-diff-row__gutter/);
  // The +++/--- file header lines are dropped (the pane breadcrumb shows the path).
  assert.doesNotMatch(html, /\+\+\+ README\.md/);
  // Truncation notice stays visible as context, never hidden.
  assert.match(html, /\[diff truncated\]/);
  // No flat single-block preview for a known diff anymore.
  assert.doesNotMatch(html, /aria-label="Diff preview"/);
});

test("provider_setup_terminal_pane_renders_dark_xterm_surface", () => {
  // Spec: docs_v2/specs/provider-setup-surface-input-and-retry.md
  // The terminal (incl. provider setup) is a dark xterm surface: input and the
  // setup transcript live inside the live terminal, not in metadata chrome.
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
  assert.match(html, /data-terminal-xterm="pane-provider-setup"/);
  // No metadata/preview/input chrome leaks into the terminal surface anymore.
  assert.doesNotMatch(html, /aria-label="Provider Setup Surface input"/);
  assert.doesNotMatch(html, /workbench-terminal__meta/);
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
  // These arrive over the async push channel from another (background) thread.
  const afterOtherThreadRuntime = applyProductShellBackendEvent(
    opened,
    {
      kind: "agentRuntime.stateChanged",
      payload: {
        threadId: "thread-other",
        state: "running",
        changedAt: "2026-05-29T00:00:00.000Z",
      },
    },
    "broadcast",
  );
  const afterOtherThreadBlock = applyProductShellBackendEvent(
    afterOtherThreadRuntime,
    {
      kind: "agentSessionBlock.upserted",
      payload: {
        block: {
          blockId: "block-other-thread",
          threadId: "thread-other",
          agentId: "gemini",
          kind: "agent_message",
          role: "agent",
          status: "complete",
          body: "This belongs to another Thread",
          updatedAt: "2026-05-29T00:00:00.000Z",
        },
      },
    },
    "broadcast",
  );
  const view = createProductShellViewModel(afterOtherThreadBlock);
  const html = renderProductShell(afterOtherThreadBlock);

  assert.equal(view.activeThreadId, "thread-workbench");
  assert.equal(view.agentChat.runtimeState, "idle");
  assert.doesNotMatch(html, /This belongs to another Thread/);
});

test("project_row_collapse_toggle_hides_and_restores_its_threads", () => {
  // Spec: docs_v2/specs/desktop-product-shell-visual-foundation.md (project nesting)
  const state = createProductShellState();
  const tideBefore = createProductShellViewModel(state).projectGroups.find(
    (group) => group.projectId === "tide",
  );
  assert.equal(tideBefore?.expanded, true, "projects are expanded by default");
  assert.ok((tideBefore?.threads.length ?? 0) > 0, "tide has threads");

  const collapsed = toggleProductShellProject(state, "tide");
  const tideCollapsed = createProductShellViewModel(collapsed).projectGroups.find(
    (group) => group.projectId === "tide",
  );
  assert.equal(tideCollapsed?.expanded, false, "toggle collapses the project");

  const reExpanded = toggleProductShellProject(collapsed, "tide");
  assert.equal(
    createProductShellViewModel(reExpanded).projectGroups.find((group) => group.projectId === "tide")
      ?.expanded,
    true,
    "toggle again re-expands",
  );
});

test("agent_session_shows_working_indicator_while_runtime_is_running", () => {
  // Spec: docs_v2/specs/agent-session-block-rendering-path.md (visible progress)
  const opened = openProductShellThread(createProductShellState(), "thread-workbench");
  const withUserTurn = applyProductShellBackendEvent(opened, {
    kind: "agentSessionBlock.upserted",
    payload: {
      block: {
        blockId: "block-user-turn",
        threadId: "thread-workbench",
        agentId: "codex",
        kind: "user_message",
        role: "user",
        status: "complete",
        body: "Do the thing",
        updatedAt: "2026-05-29T00:00:00.000Z",
      },
    },
  });
  const running = applyProductShellBackendEvent(withUserTurn, {
    kind: "agentRuntime.stateChanged",
    payload: {
      threadId: "thread-workbench",
      state: "running",
      changedAt: "2026-05-29T00:00:00.000Z",
    },
  });
  // Running + last block is the user's turn (no agent reply yet) -> indicator shows.
  assert.match(renderProductShell(running), /agent-session-working/);

  // A *complete* agent reply mid-turn does NOT end the turn — the agent routinely
  // pauses after a sentence before its next tool call. While the runtime is still
  // "running" the indicator must stay up; clearing it here (the old heuristic) made
  // an active multi-step turn read as idle for most of its life.
  const midTurnReply = applyProductShellBackendEvent(running, {
    kind: "agentSessionBlock.upserted",
    payload: {
      block: {
        blockId: "block-agent-reply",
        threadId: "thread-workbench",
        agentId: "codex",
        kind: "agent_message",
        role: "agent",
        status: "complete",
        body: "Let me check that.",
        updatedAt: "2026-05-29T00:00:01.000Z",
      },
    },
  });
  assert.match(renderProductShell(midTurnReply), /agent-session-working/);

  // While the answer is actively streaming, the block carries its own blinking
  // caret, so the separate indicator hides to avoid a redundant double-indicator.
  const streamingReply = applyProductShellBackendEvent(running, {
    kind: "agentSessionBlock.upserted",
    payload: {
      block: {
        blockId: "block-agent-reply",
        threadId: "thread-workbench",
        agentId: "codex",
        kind: "agent_message",
        role: "agent",
        status: "streaming",
        body: "Strea",
        updatedAt: "2026-05-29T00:00:01.000Z",
      },
    },
  });
  assert.doesNotMatch(renderProductShell(streamingReply), /agent-session-working/);

  // The turn *ending* is what clears the indicator: the runtime flips to idle (no
  // lingering loading after the answer), governed by state — not by guessing the
  // turn is over because one block completed.
  const settled = applyProductShellBackendEvent(midTurnReply, {
    kind: "agentRuntime.stateChanged",
    payload: {
      threadId: "thread-workbench",
      state: "idle",
      changedAt: "2026-05-29T00:00:02.000Z",
    },
  });
  assert.doesNotMatch(renderProductShell(settled), /agent-session-working/);

  // When idle from the start, no working indicator.
  assert.doesNotMatch(renderProductShell(opened), /agent-session-working/);
});

test("composer_button_is_stop_while_running_but_becomes_send_when_typing_a_followup", () => {
  const running = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "agentRuntime.stateChanged",
      payload: { threadId: "thread-workbench", state: "running", changedAt: "2026-05-29T00:00:00.000Z" },
    },
  );
  // Running with an empty composer → the Stop (interrupt) button, no Send.
  const stopHtml = renderProductShell(running);
  assert.match(stopHtml, /aria-label="Interrupt"/);
  assert.doesNotMatch(stopHtml, /class="composer-shell__send"/);

  // Start typing a follow-up → the button becomes Send so you can queue it; the
  // composer Stop is gone (interrupt lives on the queued rows instead).
  const typing = updateProductShellComposerDraft(running, "follow up");
  const sendHtml = renderProductShell(typing);
  assert.match(sendHtml, /class="composer-shell__send"/);
  assert.doesNotMatch(sendHtml, /aria-label="Interrupt"/);
});

test("submitting_during_a_running_turn_shows_a_queued_row_then_clears_on_flush", () => {
  // Spec: docs_v2/specs/agent-session-block-rendering-path.md (queue UX)
  const running = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "agentRuntime.stateChanged",
      payload: { threadId: "thread-workbench", state: "running", changedAt: "2026-05-29T00:00:00.000Z" },
    },
  );
  const drafted = updateProductShellComposerDraft(running, "follow up while busy");
  const submitted = submitProductShellComposerDraft(drafted);

  // Queued behind the live turn: composer.sendInput + the "Queued" badge (the agent
  // is genuinely running).
  assert.equal(submitted.command?.kind, "composer.sendInput");
  assert.deepEqual(createProductShellViewModel(submitted.state).agentChat.queuedInputs, [
    "follow up while busy",
  ]);
  const queuedHtml = renderProductShell(submitted.state);
  assert.match(queuedHtml, /Queued/);
  assert.match(queuedHtml, /follow up while busy/);

  // An idle send (no live turn) shows the same optimistic row WITHOUT the badge — the
  // message just goes in; "Queued" only means "waiting behind a running turn".
  const idle = openProductShellThread(createProductShellState(), "thread-workbench");
  const idleSubmitted = submitProductShellComposerDraft(
    updateProductShellComposerDraft(idle, "send while idle"),
  );
  const idleHtml = renderProductShell(idleSubmitted.state);
  assert.doesNotMatch(idleHtml, /Queued/);
  assert.match(idleHtml, /send while idle/);

  // The backend is authoritative: when it flushes the queued input, the turn's
  // agentRuntime.stateChanged carries the now-empty queue and the row clears.
  const flushed = applyProductShellBackendEvent(submitted.state, {
    kind: "agentRuntime.stateChanged",
    payload: {
      threadId: "thread-workbench",
      state: "running",
      changedAt: "2026-05-29T00:00:02.000Z",
      queuedInputs: [],
    },
  });
  assert.deepEqual(createProductShellViewModel(flushed).agentChat.queuedInputs, []);
});

test("starting_a_thread_in_a_new_project_adds_that_project_to_the_rail", () => {
  // Spec: docs_v2/specs/desktop-product-shell-visual-foundation.md (project grouping)
  const state = createProductShellState({ includeFixtureData: false });
  const started = applyProductShellBackendEvent(state, {
    kind: "thread.started",
    payload: {
      thread: {
        threadId: "thread-slice-new",
        title: "Slice work",
        agentBinding: { agentId: "codex" },
        scope: { kind: "project", projectId: "slice", cwd: "/Users/you/Workspace/slice" },
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        pinned: false,
        archived: false,
        lastKnownState: "running",
      },
      runtimeState: "running",
    },
  });
  const view = createProductShellViewModel(started);
  const slice = view.projectGroups.find((group) => group.projectId === "slice");
  assert.ok(slice, "the slice project appears in the rail immediately");
  assert.deepEqual(
    slice?.threads.map((thread) => thread.threadId),
    ["thread-slice-new"],
  );
});

test("interrupt_stops_a_running_turn_and_shows_a_stop_button", () => {
  // Spec: docs_v2/specs/app-chrome-workbench-tab-strip.md (runtime stop)
  const running = applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "agentRuntime.stateChanged",
      payload: { threadId: "thread-workbench", state: "running", changedAt: "2026-05-29T00:00:00.000Z" },
    },
  );
  // While running, the composer shows an Interrupt control.
  assert.match(renderProductShell(running), /aria-label="Interrupt"/);

  const result = interruptProductShellRuntime(running);
  assert.deepEqual(result.command, {
    kind: "agentRuntime.stop",
    payload: { threadId: "thread-workbench" },
  });

  // Idle thread: interrupt is a no-op (nothing to stop).
  const idle = openProductShellThread(createProductShellState(), "thread-workbench");
  assert.equal(interruptProductShellRuntime(idle).command, null);
  assert.doesNotMatch(renderProductShell(idle), /aria-label="Interrupt"/);
});

test("product_shell_uses_column_owned_top_rows_without_global_window_chrome", () => {
  const html = renderProductShell();

  assert.match(html, /aria-label="Left Rail Top Row"/);
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

test("an_expanding_folder_renders_a_skeleton_child_row_while_children_load", () => {
  // Spec: docs_v2/specs/workbench-filetree-view.md (D6 lazy expand skeleton).
  const loaded = applyProductShellBackendEvent(
    toggleProductShellFileTree(openProductShellThread(createProductShellState(), "thread-workbench")),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        panes: [],
        fileTree: {
          cwdLabel: "tide",
          entries: [
            { id: "d-src", name: "src", relativePath: "src", depth: 0, kind: "folder" },
            { id: "f-readme", name: "README.md", relativePath: "README.md", depth: 0, kind: "file" },
          ],
        },
      },
    },
  );
  // Expanding the not-yet-loaded "src" marks it loading; a skeleton child row renders
  // under it until the children arrive.
  const expanding = selectProductShellFileTreeEntry(loaded, "d-src");
  assert.equal(expanding.state.fileTree?.loadingFolderPath, "src");
  assert.match(renderProductShell(expanding.state), /file-tree-row--loading/);
});

test("opening_file_tree_emits_refresh_workbench_command_for_active_thread", () => {
  // Spec: docs_v2/specs/workbench-filetree-view.md
  const state = openProductShellThread(createProductShellState(), "thread-workbench");
  const result = toggleProductShellFileTreeWithRefresh(state);

  assert.equal(result.state.fileTreeOpen, true);
  assert.equal(result.command?.kind, "workbench.command");
  // Lazy: opening the tree lists the root level only (empty expanded set).
  assert.deepEqual(result.command?.payload, {
    threadId: "thread-workbench",
    command: "refresh_file_tree",
    data: {
      expandedPaths: [],
      maxEntries: 4000,
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
  // The Launcher is a placeholder: the backend RESOLVES it into the Browser Pane
  // (replace-in-slot), so no disposition is sent from here.
  assert.deepEqual(result.command?.payload, {
    threadId: "thread-sketch",
    command: "open_browser",
  });
});

// --- workbench-dock-parity ---

test("workbench_set_layout_split_emits_set_layout_mode_command", () => {
  // Spec: docs_v2/specs/workbench-dock-parity.md (T6) — Stacked/Split is backend-owned.
  const state = openProductShellThread(createProductShellState(), "thread-sketch");
  const result = setProductShellWorkbenchLayout(state, "split");
  assert.equal(result.state.workbenchLayoutMode, "split");
  assert.deepEqual(result.command, {
    kind: "workbench.command",
    payload: { threadId: "thread-sketch", command: "set_layout_mode", data: { mode: "split" } },
  });
});

test("chat_link_open_browser_uses_new_pane_disposition_only_with_modifier", () => {
  // Spec: docs_v2/specs/workbench-dock-parity.md (T5) — cmd/ctrl+click → new pane.
  const state = openProductShellThread(createProductShellState(), "thread-sketch");
  const reuse = openProductShellBrowserAtUrl(state, "https://a.test");
  assert.deepEqual(reuse.command?.payload, {
    threadId: "thread-sketch",
    command: "open_browser",
    data: { url: "https://a.test" },
  });
  const newPane = openProductShellBrowserAtUrl(state, "https://a.test", { newPane: true });
  assert.deepEqual(newPane.command?.payload, {
    threadId: "thread-sketch",
    command: "open_browser",
    data: { url: "https://a.test", disposition: "new_browser_pane" },
  });
});

test("composer_launcher_is_a_placeholder_resolved_into_the_browser_on_open", () => {
  // Spec: docs_v2/specs/workbench-dock-parity.md (T7/T8) — composer-screen launcher
  // is a PLACEHOLDER: empty shows the Launcher; picking Browser RESOLVES it (the
  // Launcher is replaced by the Browser Pane, not kept beside it). v1 parity.
  const state = createProductShellState({ includeFixtureData: false });
  assert.equal(state.activeThreadId, null);

  // Empty composer Workbench shows the Launcher placeholder.
  const empty = selectWorkbenchViewModel(state).appChrome.visibleWorkbenchPanes;
  assert.equal(empty[0]?.kind, "launcher");

  // Picking Browser adds a live draft pane (renderer-local, no backend command)...
  const opened = selectProductShellLauncherAction(state, "open_browser");
  assert.equal(opened.command, null);
  assert.equal(opened.state.draftWorkbenchPanes.length, 1);
  assert.equal(opened.state.draftWorkbenchPanes[0]?.kind, "browser");
  // ...and the Launcher placeholder is RESOLVED (gone): only the Browser shows.
  const panes = selectWorkbenchViewModel(opened.state).appChrome.visibleWorkbenchPanes;
  assert.equal(panes.length, 1);
  assert.equal(panes[0]?.kind, "browser");
});

test("composer_draft_browsers_are_adopted_by_the_new_thread_on_send", () => {
  // Spec: docs_v2/specs/workbench-dock-parity.md (T7) — adoption on send.
  let state = openProductShellDraftBrowser(createProductShellState(), "https://adopt.test");
  state = updateProductShellComposerDraft(state, "start with this page open");
  const result = submitProductShellComposerDraft(state);
  assert.equal(result.command?.kind, "thread.start");
  const seeded =
    result.command?.kind === "thread.start" ? result.command.payload.initialWorkbenchPanes : undefined;
  assert.equal(seeded?.length, 1);
  assert.equal(seeded?.[0]?.kind, "browser");
  assert.equal(seeded?.[0]?.url, "https://adopt.test");
  // The drafts are handed off and the Workbench stays open for the adopted pane.
  assert.equal(result.state.draftWorkbenchPanes.length, 0);
  assert.equal(result.state.workbenchOpen, true);
});

test("product_shell_launcher_editor_action_opens_in_pane_file_picker", () => {
  // Spec: docs_v2/specs/workbench-launcher-pane.md
  // The Editor launcher entry turns the Launcher pad into an in-pane file picker
  // (it does NOT open the FileTree column); it loads the tree behind the picker.
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
                actionId: "open_editor",
                label: "Editor",
                description: "Pick a file from the FileTree to edit",
                enabled: true,
              },
            ],
          },
        ],
      },
    },
  );
  const result = selectProductShellLauncherAction(state, "open_editor");

  // In-pane picker: the FileTree column is NOT forced open; the picker is active.
  assert.equal(result.state.fileTreeOpen, false);
  assert.equal(result.state.editorPickerFilter, "");
  assert.equal(result.command?.kind, "workbench.command");
  assert.deepEqual(result.command?.payload, {
    threadId: "thread-sketch",
    command: "refresh_file_tree",
    data: {
      maxDepth: 12,
      maxEntries: 4000,
    },
  });

  // Picking a file opens it in an Editor Pane and closes the picker.
  const picked = selectProductShellEditorPickerFile(result.state, "src/app.ts");
  assert.equal(picked.state.editorPickerFilter, null);
  assert.deepEqual(picked.command?.payload, {
    threadId: "thread-sketch",
    command: "open_editor",
    data: { path: "src/app.ts" },
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

test("window_toggles_are_a_fixed_top_right_cluster_independent_of_open_panels", () => {
  // The Workbench/FileTree toggles live in one fixed window-level cluster, not in
  // whichever column happens to be rightmost — so they never jump around.
  const startHtml = renderProductShell();
  assert.match(startHtml, /class="tide-window-toggles"/);
  assert.match(startHtml, /aria-label="Open Workbench"/);
  assert.match(startHtml, /aria-label="Open FileTree"/);

  const workbenchOpen = openProductShellThread(createProductShellState(), "thread-workbench");
  const workbenchHtml = renderProductShell(workbenchOpen);
  assert.match(workbenchHtml, /class="tide-window-toggles"/);
  // Active panel surfaces a Close affordance with the active state.
  assert.match(workbenchHtml, /aria-label="Close Workbench"/);

  const fileTreeHtml = renderProductShell(toggleProductShellFileTree(workbenchOpen));
  assert.match(fileTreeHtml, /aria-label="Close FileTree"/);
  // The toggle cluster is not duplicated into the columns.
  assert.doesNotMatch(fileTreeHtml, /data-right-actions-owner/);
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
  const css = readProductShellCss();

  assert.ok(html.indexOf('aria-label="Choice Surface"') < html.indexOf('aria-label="Composer"'));
  assert.match(css, /\.agent-chat-shell__composer-stack\s*{[^}]*gap:\s*16px/s);
  assert.match(html, /Allow once/);
  assert.match(html, /Explain risk/);
  assert.match(html, /Deny/);
});

// Spec: docs_v2/specs/prompt-card-height-overflow.md
test("prompt_card_with_a_tall_body_caps_height_and_keeps_actions_reachable", () => {
  // A long approval body (e.g. `gh pr create … --body "<long>"`) must not grow the docked
  // card past the viewport and clip the Skip/Submit controls with no way to scroll.
  const longBody = Array.from({ length: 80 }, (_, i) => `pr body line ${i}`).join("\n");
  const state = applyProductShellPromptState(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      promptId: "prompt-approval-tall",
      threadId: "thread-workbench",
      agentId: "claude",
      kind: "approval",
      message: `gh pr create --base main --head bugs --body "${longBody}"`,
      source: "provider_signal",
      choices: [
        { choiceId: "allow", label: "Allow", providerValue: "allow" },
        { choiceId: "deny", label: "Deny", providerValue: "deny" },
      ],
    },
  );
  const html = renderProductShell(state);
  const css = readProductShellCss();

  // The live prompt card renders the FULL body plus the answer controls — the controls
  // must be present in the DOM (never conditionally dropped when the body is long). The
  // message + approval detail are wrapped in the single scrollable `.prompt-card__body`.
  assert.match(html, /aria-label="Agent prompt"/);
  assert.match(html, /prompt-card__body/);
  assert.match(html, /pr body line 79/);
  assert.match(html, /Submit/);
  assert.match(html, /Allow/);

  // The card is height-capped; the message/detail scroll together as ONE region
  // (`.prompt-card__body`), while the kind badge, option list, and actions stay pinned
  // (flex: 0 0 auto). The head clips (`overflow: hidden`) so a tall body can never overlap
  // the options below it, and the option list never shrinks to cram Allow/Deny.
  assert.match(css, /\.prompt-card\s*{[^}]*max-height:/s);
  assert.match(css, /\.prompt-card__body\s*{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.prompt-card__head\s*{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.prompt-card__options\s*{[^}]*flex:\s*0 0 auto/s);
  assert.match(css, /\.prompt-card__options\s*{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.prompt-card__actions\s*{[^}]*flex:\s*0 0 auto/s);
  // The "Other…" reply + note textareas live inside the scrollable option column; pin them
  // (flex: 0 0 auto) so a tall option list can't flex-shrink them to crushed slivers.
  assert.match(css, /\.prompt-card__other\s*{[^}]*flex:\s*0 0 auto/s);
  assert.match(css, /\.prompt-card__note\s*{[^}]*flex:\s*0 0 auto/s);
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

test("product_shell_gemini_selection_updates_model_before_thread_start", () => {
  const withMenu = setProductShellComposerActiveSurface(createProductShellState(), "agent_menu");
  const result = selectProductShellChoiceSurfaceRow(withMenu, "agent_menu", "gemini");
  const view = createProductShellViewModel(result.state);

  assert.equal(view.agentChat.composer.contextItems[0].value, "Gemini CLI");
  assert.equal(view.agentChat.composer.modelLabel, "Default");
});

test("product_shell_gemini_selection_updates_start_command_launch_options", () => {
  const withAgentMenu = setProductShellComposerActiveSurface(createProductShellState(), "agent_menu");
  const selected = selectProductShellChoiceSurfaceRow(
    withAgentMenu,
    "agent_menu",
    "gemini",
  );
  const withDraft = updateProductShellComposerDraft(
    selected.state,
    "Start a Gemini Thread",
  );

  const submitted = submitProductShellComposerDraft(withDraft);

  assert.equal(submitted.command?.kind, "thread.start");
  assert.equal(typeof submitted.command?.payload.threadId, "string");
  assert.equal(submitted.command?.payload.initialMessage, "Start a Gemini Thread");
  assert.deepEqual(submitted.command?.payload.agentBinding, {
    agentId: "gemini",
    runtimeSource: {
      kind: "provider_cli",
      integrationId: "gemini",
    },
  });
  assert.deepEqual(submitted.command?.payload.scope, {
    kind: "project",
    projectId: "tide",
    cwd: "/Users/you/Workspace/tide",
  });
  assert.deepEqual(submitted.command?.payload.launchOptions, {
    model: "Gemini default",
    permission: "default",
    worktree: "current folder",
    branch: "main",
  });
});

test("product_shell_thread_started_preserves_gemini_model_label", () => {
  const withAgentMenu = setProductShellComposerActiveSurface(createProductShellState(), "agent_menu");
  const selected = selectProductShellChoiceSurfaceRow(
    withAgentMenu,
    "agent_menu",
    "gemini",
  );
  const withDraft = updateProductShellComposerDraft(
    selected.state,
    "Start Gemini and keep its model source",
  );
  const submitted = submitProductShellComposerDraft(withDraft);

  assert.equal(submitted.command?.kind, "thread.start");
  // The backend honors the optimistic client id, so thread.started arrives for the
  // same thread the user already opened (focus is already on it).
  const newThreadId = submitted.command?.payload.threadId;
  assert.equal(typeof newThreadId, "string");

  const started = applyProductShellBackendEvent(submitted.state, {
    kind: "thread.started",
    payload: {
      thread: {
        threadId: newThreadId as string,
        title: "Start Gemini and keep its model source",
        agentBinding: {
          agentId: "gemini",
          runtimeSource: {
            kind: "provider_cli",
            integrationId: "gemini",
          },
        },
        scope: {
          kind: "project",
          projectId: "tide",
          cwd: "/Users/you/Workspace/tide",
        },
        launchOptions: {
          model: "Gemini default",
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

  assert.equal(view.activeThreadId, newThreadId);
  assert.equal(view.agentChat.thread?.agentLabel, "Gemini CLI");
  assert.equal(view.agentChat.composer.mode, "follow_up");
  assert.equal(view.agentChat.composer.modelLabel, "Default");
  assert.equal(view.agentChat.composer.permissionLabel, "Ask permissions");
  assert.notEqual(view.agentChat.composer.modelLabel, "GPT-5.5 High");
  assert.deepEqual(view.agentChat.composer.contextItems.map((item) => item.value), [
    "Gemini CLI",
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
    "gemini",
  );
  const withDraft = updateProductShellComposerDraft(selected.state, "Run Gemini");
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
    toggleProductShellFileTree(toggleProductShellLeftRail(openProductShellThread(createProductShellState(), "thread-workbench"))),
  );
  const view = createProductShellViewModel(state);
  const html = renderProductShell(state);

  assert.equal(view.leftRailOpen, false);
  assert.equal(view.workbenchOpen, false);
  assert.equal(view.fileTreeOpen, true);
  // Collapsed, the Left Rail leaves the grid (so the remaining columns' top rows stay
  // aligned) and becomes the out-of-flow floating peek (spec: multitask-navigation L1).
  assert.match(html, /rail-peek__hot-zone/);
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
    openProductShellLeftRailMenu(createProductShellState(), {
      kind: "thread",
      threadId: "thread-workbench",
    }),
  );
  const projectHtml = renderProductShell(
    openProductShellLeftRailMenu(createProductShellState(), {
      kind: "project",
      projectId: "tide",
    }),
  );

  assert.match(extractByDataAttribute(threadHtml, "data-thread-row", "thread-workbench"), /thread-row--menu-open/);
  assert.match(threadHtml, /data-left-rail-menu-kind="thread"/);
  assert.match(threadHtml, /Pin \/ unpin/);
  assert.match(threadHtml, /Archive/);
  assert.match(extractByDataAttribute(projectHtml, "data-project-row", "tide"), /project-row--menu-open/);
  assert.match(projectHtml, /data-left-rail-menu-kind="project"/);
  assert.match(projectHtml, /Pin project/);
  assert.match(projectHtml, /Open in Finder/);
  assert.match(projectHtml, /Create permanent worktree/);
  assert.match(projectHtml, /Rename project/);
  assert.match(projectHtml, /Archive chats/);
  // "tide" has threads, so it can't be removed from the sidebar (it would be
  // re-derived) — Remove is hidden; Archive chats is the way to clear it.
  assert.doesNotMatch(projectHtml, /Remove from sidebar/);
});

function renderProductShell(state = createProductShellState()): string {
  return renderToStaticMarkup(<TideProductShell initialState={state} />);
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
    command: "/Users/you/.local/bin/codex",
    cwd: "/Users/you/Workspace/tide",
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

// Spec: docs_v2/specs/project-open-folder-registry.md
test("registered_project_appears_in_projects_even_with_no_threads", () => {
  const state = setProductShellRegisteredProjects(
    createProductShellState({ includeFixtureData: false }),
    [{ projectId: "money", name: "money", cwd: "/Users/you/Workspace/money" }],
  );
  const view = createProductShellViewModel(state);

  const ids = view.projectGroups.map((group) => group.projectId);
  assert.ok(ids.includes("money"), "registered project lists even with no threads");
  const money = view.projectGroups.find((group) => group.projectId === "money");
  assert.equal(money?.threads.length, 0);
});

test("registered_and_thread_derived_projects_dedupe_by_id", () => {
  // Seed a thread in project "tide", then register the same "tide" folder.
  const seeded = applyProductShellBackendEvent(createProductShellState({ includeFixtureData: false }), {
    kind: "thread.listed",
    payload: {
      threads: [
        {
          threadId: "t1",
          title: "x",
          agentBinding: { agentId: "codex" },
          scope: { kind: "project", projectId: "tide", cwd: "/Users/you/Workspace/tide" },
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
          lastKnownState: "idle",
          pinned: false,
          archived: false,
        },
      ],
    },
  });
  const withRegistry = setProductShellRegisteredProjects(seeded, [
    { projectId: "tide", name: "tide", cwd: "/Users/you/Workspace/tide" },
  ]);
  const view = createProductShellViewModel(withRegistry);

  const tideGroups = view.projectGroups.filter((group) => group.projectId === "tide");
  assert.equal(tideGroups.length, 1, "no duplicate tide project");
  assert.equal(tideGroups[0].threads.length, 1, "keeps the thread under it");
});

test("project_menu_offers_a_single_open_folder_action", () => {
  const html = renderProductShell(
    setProductShellComposerActiveSurface(createProductShellState({ includeFixtureData: false }), "project_menu"),
  );
  assert.match(html, /Open folder/);
  assert.doesNotMatch(html, /Create new project/);
  assert.doesNotMatch(html, /Use existing folder/);
});

test("collapsed_project_bubbles_a_waiting_thread_attention", () => {
  // A thread waiting for input raises attention; when its project is collapsed,
  // the indicator bubbles to the project row.
  const listed = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    {
      kind: "thread.listed",
      payload: {
        threads: [
          {
            threadId: "t-wait",
            title: "Needs input",
            agentBinding: { agentId: "claude", runtimeSource: { kind: "provider_cli", integrationId: "claude" } },
            scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
            createdAt: "2026-05-29T00:00:00.000Z",
            updatedAt: "2026-05-29T00:01:00.000Z",
            archived: false,
            lastKnownState: "waiting_for_input",
          },
        ],
      },
    },
  );
  // Expanded: project carries attention but renders the dot on the thread row.
  const expandedView = createProductShellViewModel(listed);
  assert.equal(expandedView.projectGroups.find((p) => p.projectId === "tide")?.attention, true);

  // Collapsed: the project row shows the attention dot.
  const collapsed = toggleProductShellProject(listed, "tide");
  const html = renderProductShell(collapsed);
  assert.match(html, /data-project-row="tide"[\s\S]*?project-row__attention/);
});

test("project_limits_visible_threads_and_offers_show_more", () => {
  // A project with many threads shows only the first N, with a "Show more"
  // affordance for the rest (projects accumulate many adopted local sessions).
  const threads = Array.from({ length: 11 }, (_unused, index) => ({
    threadId: `t-${index}`,
    title: `Session ${index}`,
    agentBinding: { agentId: "claude" as const, runtimeSource: { kind: "provider_cli" as const, integrationId: "claude" } },
    scope: { kind: "project" as const, projectId: "tide", cwd: "/repo/tide" },
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: `2026-05-29T00:${String(index).padStart(2, "0")}:00.000Z`,
    archived: false,
    lastKnownState: "idle" as const,
  }));
  const state = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    { kind: "thread.listed", payload: { threads } },
  );
  const html = renderProductShell(state);

  // Collapsed (static) render shows 8 thread rows and a "Show 3 more" button.
  const rowCount = (html.match(/data-left-row-kind="thread"/g) ?? []).length;
  assert.equal(rowCount, 8);
  assert.match(html, /Show 3 more/);
});

test("pinned_project_renders_as_expandable_group_with_its_threads", () => {
  // A pinned project is a full expandable group (not a flat shortcut), so its
  // Threads are reachable from the Pinned section.
  const pinned = toggleProductShellProjectPin(createProductShellState(), "tide");
  const view = createProductShellViewModel(pinned);
  const tidePinned = view.pinnedProjects.find((p) => p.projectId === "tide");
  assert.ok(tidePinned, "tide appears in the Pinned section");
  assert.equal(tidePinned?.expanded, true, "expanded by default");
  assert.ok((tidePinned?.threads.length ?? 0) > 0, "pinned project carries its threads");

  // It renders with the expandable project-row toggle (chevron), like Projects.
  const html = renderProductShell(pinned);
  assert.match(
    html,
    /aria-label="Pinned"[\s\S]*?data-left-row-kind="project"[\s\S]*?project-row__chevron/,
  );
});

test("chip_open_folder_scopes_composer_without_registering_a_left_list_project", () => {
  // Picking a folder from the composer's Project chip only sets the Thread's
  // Execution Context (cwd). It must NOT appear in the left Projects list until
  // a Thread is actually started in it (thread-derived).
  const state = createProductShellState({ includeFixtureData: false });
  const scoped = setProductShellComposerFolderScope(state, "/Users/you/Workspace/battleship");
  const view = createProductShellViewModel(scoped);

  // The Project chip reflects the picked folder's basename.
  const projectItem = view.agentChat.composer.contextItems.find((item) => item.label === "Project");
  assert.equal(projectItem?.value, "battleship");

  // ...but the left Projects list gains no "battleship" entry.
  assert.ok(!view.projectGroups.some((group) => group.projectId === "battleship"));
});
