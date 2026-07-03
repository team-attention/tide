import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { parseReviewFindings } from "../src/desktop/application/domains/product-shell/state/review-findings.ts";
import { ReviewPanel } from "../src/desktop/adapters/inbound/react-renderer/product-shell/workbench/review-panel.tsx";
import type {
  ProductShellHandlers,
  ReviewFinding,
  ReviewProvider,
  ReviewRunResult,
  ReviewTarget,
} from "../src/desktop/adapters/inbound/react-renderer/product-shell/support/types.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as unknown as { window: unknown }).window = dom.window;
(globalThis as unknown as { document: unknown }).document = dom.window.document;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("review_panel_disables_invalid_commit_target_then_runs_selected_target", async () => {
  let ranTarget: ReviewTarget | null = null;
  const { container, root } = renderReviewPanel({
    onRunReview: async (_cwd, _provider, target) => {
      ranTarget = target;
      return reviewResult({ target });
    },
  });
  await flushEffects();

  const targetSelect = container.querySelector("#review-target") as HTMLSelectElement | null;
  assert.notEqual(targetSelect, null);
  await act(async () => {
    targetSelect!.value = "commit";
    targetSelect!.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });

  const runButton = buttonByText(container, "Run review");
  assert.equal(runButton?.disabled, true);

  await act(async () => {
    targetSelect!.value = "base_branch";
    targetSelect!.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });

  assert.equal(buttonByText(container, "Run review")?.disabled, false);
  await act(async () => {
    buttonByText(container, "Run review")?.click();
  });
  await flushEffects();
  assert.deepEqual(ranTarget, { kind: "base_branch", baseBranch: "main" });
  assert.match(container.innerHTML, /Completed/);
  await act(async () => {
    root.unmount();
  });
});

test("review_panel_renders_findings_and_hands_raw_output_to_chat", async () => {
  let attached: { label: string; text: string } | null = null;
  let draft = "";
  let opened: { path: string; line?: number; character?: number; label?: string } | null = null;
  const { container, root } = renderReviewPanel({
    onRunReview: async (_cwd, _provider, target) => reviewResult({
      target,
      rawText: "- High: src/app.ts:12 avoids stale state\n\nFull raw review output.",
    }),
    onAddContentToChat: (chip) => {
      attached = { label: chip.label, text: chip.text };
    },
    onDraftChange: (next) => {
      draft = next;
    },
    onOpenFile: (path, target) => {
      opened = { path, ...(target ?? {}) };
    },
  });
  await flushEffects();

  await act(async () => {
    buttonByText(container, "Run review")?.click();
  });
  await flushEffects();

  assert.match(container.innerHTML, /High: src\/app\.ts:12 avoids stale state/);
  assert.match(container.innerHTML, /Full raw review output/);

  await act(async () => {
    buttonByText(container, "High: src/app.ts:12")?.click();
  });
  assert.equal(opened?.path, "src/app.ts");
  assert.equal(opened?.line, 12);
  assert.equal(opened?.character, 1);

  await act(async () => {
    buttonByText(container, "Ask agent to fix")?.click();
  });

  assert.equal(attached?.label, "Review findings");
  assert.match(attached?.text ?? "", /Full raw review output/);
  assert.match(draft, /Please fix the review findings/);
  await act(async () => {
    root.unmount();
  });
});

test("review_panel_prefers_persisted_structured_findings_over_raw_output", async () => {
  let opened: { path: string; line?: number; character?: number; label?: string } | null = null;
  const persistedFinding: ReviewFinding = {
    findingId: "persisted-1",
    severity: "high",
    file: "src/persisted.ts",
    line: 24,
    title: "High: src/persisted.ts:24 persisted parser result",
    body: "Provider-specific parser produced this finding.",
  };
  const { container, root } = renderReviewPanel({
    onRunReview: async (_cwd, _provider, target) => reviewResult({
      target,
      rawText: "Provider summary without markdown bullets.",
      findings: [persistedFinding],
    }),
    onOpenFile: (path, target) => {
      opened = { path, ...(target ?? {}) };
    },
  });
  await flushEffects();

  await act(async () => {
    buttonByText(container, "Run review")?.click();
  });
  await flushEffects();

  assert.match(container.innerHTML, /High: src\/persisted\.ts:24 persisted parser result/);
  assert.match(container.innerHTML, /Provider summary without markdown bullets/);

  await act(async () => {
    buttonByText(container, "High: src/persisted.ts:24")?.click();
  });
  assert.equal(opened?.path, "src/persisted.ts");
  assert.equal(opened?.line, 24);
  assert.equal(opened?.character, 1);
  assert.equal(opened?.label, "High: src/persisted.ts:24 persisted parser result");
  await act(async () => {
    root.unmount();
  });
});

function renderReviewPanel(overrides: {
  onRunReview?: (cwd: string, provider: ReviewProvider, target: ReviewTarget) => Promise<ReviewRunResult>;
  onAddContentToChat?: (chip: { kind: "code" | "terminal" | "browser" | "message"; label: string; text: string }) => void;
  onDraftChange?: (draft: string) => void;
  onOpenFile?: (
    path: string,
    target?: { line: number; character: number; length?: number; label?: string; sourcePaneId?: string },
  ) => void;
}): { container: HTMLDivElement; root: ReturnType<typeof createRoot> } {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const handlers = {
    onRunReview: overrides.onRunReview ?? (async (_cwd, _provider, target) => reviewResult({ target })),
    onAddContentToChat: overrides.onAddContentToChat ?? (() => undefined),
    onDraftChange: overrides.onDraftChange ?? (() => undefined),
    onOpenFile: overrides.onOpenFile ?? (() => undefined),
  } as Partial<ProductShellHandlers> as ProductShellHandlers;

  void act(() => {
    root.render(<ReviewPanel cwd="/repo" handlers={handlers} />);
  });
  return { container, root };
}

function reviewResult(input: { target: ReviewTarget; rawText?: string; findings?: ReviewFinding[] }): ReviewRunResult {
  const rawText = input.rawText ?? "- Medium: src/app.ts:1 review finding";
  return {
    ok: true,
    provider: "codex",
    source: "codex_cli",
    target: input.target,
    cwd: "/repo",
    command: "codex review --uncommitted",
    startedAt: "2026-07-04T00:00:00.000Z",
    completedAt: "2026-07-04T00:00:01.000Z",
    rawText,
    findings: input.findings ?? parseReviewFindings(rawText),
  };
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text),
  ) as HTMLButtonElement | undefined;
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
