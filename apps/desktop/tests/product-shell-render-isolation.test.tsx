// Spec: desktop-product-shell-render-isolation. Empirical proof of the mechanism: a
// React.memo component subscribed (via the store hook) to one slice does NOT re-render
// when an UNRELATED slice changes — which is exactly what keeps a chat token from
// reconfiguring the workbench editor. Uses a real jsdom + react-dom/client mount.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { Profiler, act, memo } from "react";

import {
  createProductShellState,
  createProductShellStore,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import {
  ProductShellStoreProvider,
  useProductShellSlice,
} from "../src/desktop/adapters/inbound/react-renderer/product-shell/store-context.ts";
import { WorkbenchColumnView } from "../src/desktop/adapters/inbound/react-renderer/product-shell/product-shell-columns.ts";
import type { ProductShellHandlers } from "../src/desktop/adapters/inbound/react-renderer/product-shell/support/types.ts";

// jsdom globals must exist before react-dom/client renders (imported dynamically below).
const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as unknown as { window: unknown }).window = dom.window;
(globalThis as unknown as { document: unknown }).document = dom.window.document;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let railRenders = 0;
const Rail = memo(function Rail() {
  railRenders += 1;
  const searchQuery = useProductShellSlice((state) => state.searchQuery);
  return <div data-testid="rail">{searchQuery}</div>;
});

let workbenchRenders = 0;
const Workbench = memo(function Workbench() {
  workbenchRenders += 1;
  const open = useProductShellSlice((state) => state.workbenchOpen);
  return <div data-testid="workbench">{String(open)}</div>;
});

test("an unrelated slice change re-renders only the subscribing memo component", async () => {
  const { createRoot } = await import("react-dom/client");
  const store = createProductShellStore(createProductShellState({ includeFixtureData: false }));
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <ProductShellStoreProvider value={store}>
        <Rail />
        <Workbench />
      </ProductShellStoreProvider>,
    );
  });

  const railBaseline = railRenders;
  const workbenchBaseline = workbenchRenders;
  assert.ok(railBaseline >= 1 && workbenchBaseline >= 1, "both mounted at least once");

  // Change ONLY searchQuery (the rail's slice). The workbench subscribes to
  // workbenchOpen, which is untouched, so its snapshot is stable and it must not render.
  await act(async () => {
    store.setState((state) => ({ ...state, searchQuery: "filter" }));
  });

  assert.equal(railRenders, railBaseline + 1, "Rail (subscribed to searchQuery) re-renders");
  assert.equal(
    workbenchRenders,
    workbenchBaseline,
    "Workbench (subscribed to workbenchOpen) must NOT re-render on a searchQuery change",
  );

  await act(async () => {
    root.unmount();
  });
});

test("the REAL workbench column does not re-commit on a chat-only change but does on a workbench change", async () => {
  const { createRoot } = await import("react-dom/client");
  const store = createProductShellStore(createProductShellState({ includeFixtureData: false }));
  // Handlers are only wired to event props (not called during render); a no-op proxy
  // renders the column without a real shell behind it.
  const handlers = new Proxy({}, { get: () => () => undefined }) as unknown as ProductShellHandlers;
  // Stable docked-Changes-pane prop (closed); identity must not change so the memo can
  // still bail on chat-only changes.
  const changes = {
    open: false,
    active: false,
    isGitRepo: false,
    branch: null,
    files: [],
    loadDiff: () => Promise.resolve(""),
    onRefresh: () => undefined,
    onClose: () => undefined,
    onActivate: () => undefined,
    onDeactivate: () => undefined,
  };

  let commits = 0;
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ProductShellStoreProvider value={store}>
        <Profiler id="workbench" onRender={() => { commits += 1; }}>
          <WorkbenchColumnView handlers={handlers} changes={changes} />
        </Profiler>
      </ProductShellStoreProvider>,
    );
  });
  const mounted = commits;
  assert.ok(mounted >= 1, "workbench column mounted");

  // A streaming chat token: changes only state.agentChat. The workbench slice is stable,
  // so the React.memo boundary must bail — no new commit, so the editor never reconfigures.
  await act(async () => {
    store.setState((state) => ({ ...state, agentChat: { ...state.agentChat } }));
  });
  assert.equal(commits, mounted, "workbench column must NOT re-commit on a chat-only change");

  // Positive control: a workbench-slice change DOES re-commit it (proves the counter works).
  await act(async () => {
    store.setState((state) => ({ ...state, workbenchFullscreen: !state.workbenchFullscreen }));
  });
  assert.equal(commits, mounted + 1, "workbench column re-commits when its own slice changes");

  await act(async () => {
    root.unmount();
  });
});
