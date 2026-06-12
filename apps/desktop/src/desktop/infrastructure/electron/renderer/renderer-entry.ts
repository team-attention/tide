import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { TideProductShell } from "../../../adapters/inbound/react-renderer/product-shell/product-shell.ts";
import type {
  AgentChatBackendEvent,
} from "../../../application/domains/agent-chat/agent-chat.ts";
import type { ProductShellBackendCommand } from "../../../application/domains/product-shell/product-shell.ts";
import {
  CONTRACT_VERSION,
  sanitizeJsonValue,
  type BackendCommandEnvelope,
  type BackendEventEnvelope,
} from "../../../../shared/contracts/index.ts";
// Inter (OFL-1.1, self-hosted) is the canonical Figma typeface; load the weights
// the design uses (regular / medium / semibold) so the UI does not fall back to
// the platform system font.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@xterm/xterm/css/xterm.css";
import "../../../adapters/inbound/react-renderer/styles/index.css";
import { applyThemePreference, loadThemePreference, watchSystemTheme } from "../../../adapters/inbound/react-renderer/support/theme.ts";

// The inline script in index.html already set the boot theme to avoid a flash;
// re-apply from the source of truth and keep "auto" in sync with the OS.
applyThemePreference(loadThemePreference());
watchSystemTheme(loadThemePreference);

export function createInitialRendererElement() {
  return createElement(TideProductShell, {
    onBackendCommand: dispatchBackendCommand,
    onBackendEvent: subscribeBackendEvents,
    projectBridge:
      window.tide === undefined
        ? undefined
        : {
            openDirectory: () => window.tide!.openDirectory(),
            listProjects: () => window.tide!.listProjects(),
            registerProject: (cwd: string) => window.tide!.registerProject(cwd),
            unregisterProject: (cwd: string) => window.tide!.unregisterProject(cwd),
            renameProject: (cwd: string, name: string) => window.tide!.renameProject(cwd, name),
            revealInFinder: (cwd: string) => window.tide!.revealInFinder(cwd),
            createWorktree: (
              cwd: string,
              name: string,
              options?: { baseDirPattern?: string; copyFiles?: string[]; baseBranch?: string },
            ) => window.tide!.createWorktree(cwd, name, options),
            removeWorktree: (cwd: string) => window.tide!.removeWorktree(cwd),
            worktreeInfo: (cwd: string) => window.tide!.worktreeInfo(cwd),
            deleteWorktree: (cwd: string, options: { deleteBranch: boolean; force: boolean }) =>
              window.tide!.deleteWorktree(cwd, options),
            gitContext: (cwd: string) => window.tide!.gitContext(cwd),
            listCommands: (cwd: string, agentId: string) => window.tide!.listCommands(cwd, agentId),
          },
  });
}

export function mountTideRenderer(rootElement: HTMLElement | null): void {
  if (rootElement === null) {
    throw new Error("Missing Tide renderer root element.");
  }

  createRoot(rootElement).render(createInitialRendererElement());
}

mountTideRenderer(document.getElementById("root"));

declare global {
  interface Window {
    tide?: {
      contractVersion: 1;
      transport: "message_port";
      sendBackendCommand(command: BackendCommandEnvelope): Promise<BackendEventEnvelope[]>;
      onBackendEvent(listener: (event: BackendEventEnvelope) => void): () => void;
      onCloseIntent(listener: () => void): () => void;
      openDirectory(): Promise<string | null>;
      listProjects(): Promise<{ projectId: string; name: string; cwd: string }[]>;
      registerProject(cwd: string): Promise<{ projectId: string; name: string; cwd: string }[]>;
      unregisterProject(cwd: string): Promise<{ projectId: string; name: string; cwd: string }[]>;
      renameProject(cwd: string, name: string): Promise<{ projectId: string; name: string; cwd: string }[]>;
      revealInFinder(cwd: string): Promise<void>;
      openExternal(url: string): Promise<void>;
      createWorktree(cwd: string, name: string, options?: { baseDirPattern?: string; copyFiles?: string[]; baseBranch?: string }): Promise<{ entries: { projectId: string; name: string; cwd: string }[]; createdCwd: string | null }>;
      removeWorktree(cwd: string): Promise<{ entries: { projectId: string; name: string; cwd: string }[] }>;
      worktreeInfo(cwd: string): Promise<{ repoRoot: string | null; branch: string | null; branchMerged: boolean; isWorktree: boolean }>;
      deleteWorktree(cwd: string, options: { deleteBranch: boolean; force: boolean }): Promise<{ entries: { projectId: string; name: string; cwd: string }[]; worktreeRemoved: boolean; branch: string | null; branchDeleted: boolean }>;
      gitContext(cwd: string): Promise<{
        isGitRepo: boolean;
        currentBranch: string | null;
        branches: { name: string; kind: "local" | "remote"; current: boolean }[];
        worktrees: { path: string; branch: string | null; current: boolean }[];
      }>;
      listCommands(cwd: string, agentId: string): Promise<{
        name: string;
        description: string;
        trigger: "/" | "$";
        source: "project" | "user" | "builtin";
        agentId: "codex" | "claude";
      }[]>;
    };
  }
}

function dispatchBackendCommand(
  command: ProductShellBackendCommand,
): Promise<AgentChatBackendEvent[]> | AgentChatBackendEvent[] | undefined {
  if (window.tide === undefined) {
    return [
      {
        kind: "contract.error",
        payload: {
          code: "backend_transport_unavailable",
          message:
            "Backend transport unavailable. Run Tide through the Electron app to start Agents.",
        },
      },
    ];
  }

  const envelope: BackendCommandEnvelope = {
    contractVersion: CONTRACT_VERSION,
    requestId: `renderer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind: command.kind,
    issuedAt: new Date().toISOString(),
    // Strip undefined/non-finite values so the envelope is a strict JsonObject.
    // Builders set optional fields (e.g. launchOptions on threads with no saved
    // options, like adopted-from-history threads) to undefined, which would fail
    // the backend's isJsonObject envelope check ("invalid_command") and silently
    // mark the turn failed before it ever reaches the runtime.
    payload: (sanitizeJsonValue(command.payload) ?? {}) as BackendCommandEnvelope["payload"],
  };

  return window.tide.sendBackendCommand(envelope).then((events) =>
    events.map((event) => ({
      kind: event.kind,
      payload: event.payload as Record<string, unknown>,
    })),
  );
}

function subscribeBackendEvents(
  listener: (event: AgentChatBackendEvent) => void,
): (() => void) | undefined {
  if (window.tide === undefined) {
    return undefined;
  }

  return window.tide.onBackendEvent((event) => {
    listener({
      kind: event.kind,
      payload: event.payload as Record<string, unknown>,
    });
  });
}
