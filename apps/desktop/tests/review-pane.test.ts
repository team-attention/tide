import assert from "node:assert/strict";
import test from "node:test";

import type { ReviewPaneState } from "../src/backend/application/domains/workbench/workbench.ts";
import { workbenchSnapshotPaneRef } from "../src/backend/application/services/workbench/workbench-snapshot.ts";

test("review pane snapshots carry cwd and provider agent", () => {
  const pane: ReviewPaneState = {
    paneId: "pane-review",
    kind: "review",
    title: "Review",
    revision: "rev-1",
    updatedAt: "2026-07-04T00:00:00.000Z",
    cwd: "/repo/tide",
    agentId: "codex",
  };

  const ref = workbenchSnapshotPaneRef(pane);

  assert.equal(ref.kind, "review");
  assert.equal(ref.cwd, "/repo/tide");
  assert.equal(ref.agentId, "codex");
});
