// The v2 renderer had NO error boundary, so a single throw during a child's render/effect
// (e.g. a <webview> guest method called before dom-ready) unmounted the WHOLE app — a blank
// white screen. These tests prove the boundary contains a throw and shows a fallback instead.
// Uses a real jsdom + react-dom/client mount (error boundaries only fire in the reconciler).
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import type { ReactElement } from "react";

import {
  AppErrorFallback,
  ErrorBoundary,
} from "../src/desktop/adapters/inbound/react-renderer/product-shell/support/error-boundary.tsx";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as unknown as { window: unknown }).window = dom.window;
(globalThis as unknown as { document: unknown }).document = dom.window.document;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Boom(props: { message?: string }): ReactElement {
  throw new Error(props.message ?? "boom");
}

// Mount into a fresh container; React logs caught errors to console.error, so silence it
// across the act() so the suite output stays clean. Returns the container for assertions
// plus a render() for re-renders (resetKey recovery).
async function mountFresh(node: ReactElement): Promise<{
  container: HTMLElement;
  rerender: (next: ReactElement) => Promise<void>;
}> {
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const render = async (n: ReactElement): Promise<void> => {
    const orig = console.error;
    console.error = () => {};
    try {
      await act(async () => {
        root.render(n);
      });
    } finally {
      console.error = orig;
    }
  };
  await render(node);
  return { container, rerender: render };
}

test("ErrorBoundary shows a fallback (not a blank unmount) when a child throws", async () => {
  const { container } = await mountFresh(
    <ErrorBoundary label="the browser pane">
      <Boom message="kaboom" />
    </ErrorBoundary>,
  );
  const text = container.textContent ?? "";
  assert.match(text, /Something went wrong in the browser pane/);
  assert.match(text, /kaboom/); // the real error message is surfaced
  assert.match(text, /Retry/);
});

test("ErrorBoundary honours a custom fallback (render nothing for an invisible host)", async () => {
  const { container } = await mountFresh(
    <ErrorBoundary fallback={() => null}>
      <Boom />
    </ErrorBoundary>,
  );
  assert.equal(container.textContent, "");
});

test("a changed resetKey clears a caught error so new children render", async () => {
  const { container, rerender } = await mountFresh(
    <ErrorBoundary resetKey="pane-a">
      <Boom />
    </ErrorBoundary>,
  );
  // A different pane (new resetKey) with a healthy child must recover, not stick on the card.
  await rerender(
    <ErrorBoundary resetKey="pane-b">
      <div>healthy</div>
    </ErrorBoundary>,
  );
  assert.equal(container.textContent, "healthy");
});

test("the top-level AppErrorFallback offers a hard Reload alongside Try again", async () => {
  const { container } = await mountFresh(
    <ErrorBoundary fallback={(error, reset) => <AppErrorFallback error={error} reset={reset} />}>
      <Boom message="fatal detail" />
    </ErrorBoundary>,
  );
  const text = container.textContent ?? "";
  assert.match(text, /Tide hit an unexpected error/);
  assert.match(text, /fatal detail/);
  assert.match(text, /Try again/);
  assert.match(text, /Reload/);
});
