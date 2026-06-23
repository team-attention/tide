// Spec: docs_v2/specs/thread-list-first-paint-snapshot.md
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TideProductShell } from "../src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.tsx";
import type { ProductShellBackendCommand } from "../src/desktop/application/domains/product-shell/product-shell.ts";
import type { AgentChatBackendEvent, AgentChatThreadSummary } from "../src/desktop/application/domains/agent-chat/agent-chat.ts";

class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const bootThread: AgentChatThreadSummary = {
  threadId: "thread-boot",
  title: "Boot Snapshot Thread",
  agentBinding: {
    agentId: "codex",
    runtimeSource: { kind: "provider_cli", integrationId: "codex" },
  },
  scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
  createdAt: "2026-06-23T00:00:00.000Z",
  updatedAt: "2026-06-23T00:00:01.000Z",
  pinned: false,
  archived: false,
  lastKnownState: "idle",
};

test("initialThreadList paints real rail rows before backend list resolves", () => {
  const html = renderToStaticMarkup(
    <TideProductShell initialThreadList={[bootThread]} />,
  );

  assert.match(html, /Boot Snapshot Thread/);
  assert.doesNotMatch(html, /rail-skeleton/);
});

test("initialThreadList still requests the authoritative backend list", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const globalObject = globalThis as unknown as {
    window: unknown;
    document: unknown;
    HTMLElement: unknown;
    Element: unknown;
    MutationObserver: unknown;
    ResizeObserver: unknown;
    IS_REACT_ACT_ENVIRONMENT: boolean;
  };
  const original = {
    window: globalObject.window,
    document: globalObject.document,
    HTMLElement: globalObject.HTMLElement,
    Element: globalObject.Element,
    MutationObserver: globalObject.MutationObserver,
    ResizeObserver: globalObject.ResizeObserver,
    actEnv: globalObject.IS_REACT_ACT_ENVIRONMENT,
  };
  (dom.window as unknown as { ResizeObserver: typeof TestResizeObserver }).ResizeObserver = TestResizeObserver;
  globalObject.window = dom.window;
  globalObject.document = dom.window.document;
  globalObject.HTMLElement = dom.window.HTMLElement;
  globalObject.Element = dom.window.Element;
  globalObject.MutationObserver = dom.window.MutationObserver;
  globalObject.ResizeObserver = TestResizeObserver;
  globalObject.IS_REACT_ACT_ENVIRONMENT = true;

  try {
    const { createRoot } = await import("react-dom/client");
    const container = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(container);
    const root = createRoot(container);
    const commands: ProductShellBackendCommand[] = [];

    await act(async () => {
      root.render(
        <TideProductShell
          initialThreadList={[bootThread]}
          onBackendCommand={(command) => {
            commands.push(command);
            if (command.kind !== "thread.list") {
              return undefined;
            }
            return [
              {
                kind: "thread.listed",
                payload: { threads: [bootThread] },
              } satisfies AgentChatBackendEvent,
            ];
          }}
        />,
      );
    });

    assert.equal(commands[0]?.kind, "thread.list");

    await act(async () => {
      root.unmount();
    });
  } finally {
    globalObject.window = original.window;
    globalObject.document = original.document;
    globalObject.HTMLElement = original.HTMLElement;
    globalObject.Element = original.Element;
    globalObject.MutationObserver = original.MutationObserver;
    globalObject.ResizeObserver = original.ResizeObserver;
    globalObject.IS_REACT_ACT_ENVIRONMENT = original.actEnv;
  }
});
