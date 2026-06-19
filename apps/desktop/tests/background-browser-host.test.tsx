// Spec: docs_v2/specs/browser-pane-action-liveness.md
// Regression: the offscreen Browser host must not form a snapshot feedback loop when
// its backend echo re-renders the Product Shell.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";

import {
  createProductShellState,
  openProductShellThread,
  type ProductShellBackendCommand,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import { TideProductShell } from "../src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.tsx";
import type { AgentChatBackendEvent } from "../src/desktop/application/domains/agent-chat/agent-chat.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.test/",
});

(globalThis as unknown as { window: unknown }).window = dom.window;
(globalThis as unknown as { document: unknown }).document = dom.window.document;
(globalThis as unknown as { HTMLElement: unknown }).HTMLElement = dom.window.HTMLElement;
(globalThis as unknown as { Element: unknown }).Element = dom.window.Element;
(globalThis as unknown as { MutationObserver: unknown }).MutationObserver =
  dom.window.MutationObserver;
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const originalCreateElement = dom.window.document.createElement.bind(dom.window.document);
dom.window.document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
  const element = originalCreateElement(tagName, options);
  if (tagName.toLowerCase() === "webview") {
    Object.assign(element, {
      isLoading: () => false,
      getURL: () => "https://example.test/",
      executeJavaScript: async () => ({
        url: "https://example.test/",
        pageTitle: "Example",
        bodyTextPreview: "Example body",
      }),
    });
  }
  return element;
}) as typeof dom.window.document.createElement;

test("background browser snapshot echo does not re-run the settled-webview snapshot effect", async () => {
  const { createRoot } = await import("react-dom/client");
  const opened = openProductShellThread(createProductShellState(), "thread-workbench");
  const activeThread = opened.threads.find(
    (thread) => thread.threadId === "thread-workbench",
  );
  const initialState = {
    ...opened,
    threads: activeThread === undefined ? opened.threads : [activeThread],
    // The active thread's browser pane is visible but not foregrounded, so
    // BackgroundBrowserHost owns the single live webview for it.
    workbenchOpen: false,
    workbenchOpenByThreadId: {
      ...opened.workbenchOpenByThreadId,
      "thread-workbench": false,
    },
  };
  let snapshotCommands = 0;
  const commands: ProductShellBackendCommand[] = [];
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <TideProductShell
        initialState={initialState}
        onBackendCommand={(command) => {
          commands.push(command);
          if (
            command.kind !== "workbench.command" ||
            command.payload.command !== "update_browser_snapshot"
          ) {
            return undefined;
          }
          snapshotCommands += 1;
          return [
            {
              kind: "workbench.changed",
              payload: {
                threadId: command.payload.threadId,
                activePaneId: command.payload.targetPaneId,
                panes: [
                  {
                    paneId: command.payload.targetPaneId,
                    kind: "browser",
                    title: "Example",
                    visible: true,
                    revision: "preview-1",
                    updatedAt: `2026-06-19T00:00:0${snapshotCommands}.000Z`,
                    loading: false,
                    url: "https://example.test/",
                    pageTitle: "Example",
                    bodyTextPreview: "Example body",
                    agentDriving: false,
                  },
                ],
              },
            } satisfies AgentChatBackendEvent,
          ];
        }}
      />,
    );
  });

  await act(async () => {
    await Promise.resolve();
  });

  assert.equal(
    snapshotCommands,
    1,
    "the backend workbench.changed echo must not cause the background webview to emit another snapshot",
  );
  assert.ok(
    commands.some(
      (command) =>
        command.kind === "workbench.command" &&
        command.payload.command === "update_browser_snapshot",
    ),
    "the background webview still emits its initial snapshot",
  );

  await act(async () => {
    root.unmount();
  });
  container.remove();
});
