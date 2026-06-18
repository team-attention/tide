// Spec: version-management.md (Lane 2 / D2). The agent-CLI update advisory renders
// as a compact `↑ Update <Agent>` chip in the composer toolbar — NOT a full
// choice-surface card — and a single click runs the same Setup Surface handoff
// (update_available:setup). It shows even when the agent is ready and on the start
// composer (no active thread). The application-layer wiring (the row → Setup
// Surface command) is covered by agent-cli-version-update-ui.test.ts; this locks
// the rendering and the click dispatch.

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { act } from "react";

import {
  createComposer,
  createComposerStack,
} from "../src/desktop/adapters/inbound/react-renderer/agent-chat/composer/composer.tsx";
import {
  createAgentChatShellState,
  createAgentChatShellViewModel,
} from "../src/desktop/application/domains/agent-chat/agent-chat.ts";
import type { AgentChatShellState } from "../src/desktop/application/domains/agent-chat/agent-chat.ts";
import type { ComposerHandlers } from "../src/desktop/adapters/inbound/react-renderer/agent-chat/support/types.ts";

const advisorySetup = {
  command: "npm",
  args: ["install", "-g", "@anthropic-ai/claude-code@latest"],
  cwd: ".",
  expectedCompletion: "retry_preflight" as const,
};

function viewModelWith(update?: {
  currentVersion: string;
  latestVersion: string;
  setup: typeof advisorySetup;
}) {
  const state: AgentChatShellState = {
    ...createAgentChatShellState(),
    // Ready + no blockers: the advisory must surface anyway (it never gates).
    providerReadiness: { agentId: "claude", ready: true, blockers: [], update },
  };
  return createAgentChatShellViewModel(state);
}

test("composer toolbar shows an Update <Agent> chip when an advisory is present", () => {
  const markup = renderToStaticMarkup(
    createComposer(viewModelWith({ currentVersion: "2.1.179", latestVersion: "2.1.181", setup: advisorySetup }), {}),
  );
  assert.match(markup, /composer-shell__choice-chip--update/);
  assert.match(markup, /Update Claude Code/);
  // The version detail lives in the tooltip, not as card body text.
  assert.match(markup, /v2\.1\.179 → v2\.1\.181/);
});

test("composer toolbar shows no update chip when there is no advisory", () => {
  const markup = renderToStaticMarkup(createComposer(viewModelWith(undefined), {}));
  assert.doesNotMatch(markup, /composer-shell__choice-chip--update/);
  assert.doesNotMatch(markup, /Update Claude Code/);
});

test("the update advisory is a chip, not a choice-surface card", () => {
  const markup = renderToStaticMarkup(
    createComposerStack(
      viewModelWith({ currentVersion: "2.1.179", latestVersion: "2.1.181", setup: advisorySetup }),
      {},
    ),
  );
  // The chip is present...
  assert.match(markup, /composer-shell__choice-chip--update/);
  // ...but the old nudge card's "Update available" source label is gone.
  assert.doesNotMatch(markup, /Update available/);
});

test("clicking the update chip dispatches the update_available:setup Setup Surface", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  // This test needs real DOM globals (the other tests here render to static markup).
  // Save + restore them so the mutation can't leak to anything that runs after.
  const g = globalThis as unknown as {
    window?: unknown;
    document?: unknown;
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const original = { window: g.window, document: g.document, actEnv: g.IS_REACT_ACT_ENVIRONMENT };
  g.window = dom.window;
  g.document = dom.window.document;
  g.IS_REACT_ACT_ENVIRONMENT = true;

  try {
    const selected: Array<[string, string]> = [];
    const handlers: ComposerHandlers = {
      onChoiceSurfaceRowSelect: (surfaceKind, rowId) => selected.push([surfaceKind, rowId]),
    };

    const { createRoot } = await import("react-dom/client");
    const container = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createComposer(
          viewModelWith({ currentVersion: "2.1.179", latestVersion: "2.1.181", setup: advisorySetup }),
          handlers,
        ),
      );
    });

    const chip = container.querySelector(".composer-shell__choice-chip--update");
    assert.ok(chip, "expected an update chip in the toolbar");
    await act(async () => {
      (chip as HTMLButtonElement).dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
    });
    await act(async () => {
      root.unmount();
    });

    assert.deepEqual(selected, [["provider_readiness", "update_available:setup"]]);
  } finally {
    g.window = original.window;
    g.document = original.document;
    g.IS_REACT_ACT_ENVIRONMENT = original.actEnv;
  }
});
