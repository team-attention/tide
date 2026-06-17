// Phase 3 ratchet (docs_v2/implementation/codebase-issues-and-remediation-plan.md).
//
// The product goal demands structurally simple, small files. This guard makes that
// mechanical: any NEW source file must be <= MAX_LINES; the existing oversized files
// are pinned at their current line counts and may only SHRINK, never grow. As the
// decomposition phases land, lower each pin (or delete the entry once it drops under
// the global cap). A file that grows past its pin fails the suite with a pointer to
// extract a collaborator instead of piling on.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const srcDir = path.join(root, "src");

// New files must stay under this. The working target is ~500; 800 is the hard cap.
const MAX_LINES = 800;

// Pinned ceilings for the known god-files (the Phase 3 decomposition backlog).
// Each may shrink or hold, never grow. Lower these as collaborators are extracted.
const PINNED_MAX: Record<string, number> = {
  // Prior base 1512 + multi-step wizard stepAnswers (main) + Draft Thread lifecycle
  // (composer-draft-thread): createDraftThread/discardDraftThread delegates + the
  // prepareStartInPlace branch in startThread (bodies extracted to DraftThreadService,
  // incl. newThreadRecord) + withdrawProviderPrompt (provider-retracted prompt recovery,
  // spec waiting-state-recovery). +1: forward the AskUserQuestion answer `notes` to the runtime
  // write (prompt-full-fidelity-fields Slice 2). +44: checkReadiness (on-demand Provider Readiness
  // for the Composer slot-select handoff) + the no-pending-input readiness re-emit in
  // replayPendingInputIfProviderReady (install/sign-in card refresh). Spec: provider-cli-setup-handoff.md.
  // +8: checkReadiness replaces the WHOLE agentBinding (runtimeSource + cleared session), not just
  // agentId, so a switched agent can't inherit a stale source/session (Gemini review on PR #136).
  // The full thread-runtime-service split is still the real fix.
  // +7: wiring the shared BrowserCaptureCoordinator into the MCP + workbench-command handlers
  // for the observe-time screenshot pull + the injectable pull timeout
  // (browser-pane-screenshot-on-load-decoupling).
  "backend/application/services/thread/thread-runtime-service.ts": 1673,
  // The inbound command switch (already at the 800 cap) gained the
  // provider.discoverCommands handler for live command mirroring, then the
  // thread.launchOptionsChanged event builder gained the applied + changedKeys
  // signal for mid-thread chip feedback. Splitting this giant switch into
  // per-domain handler modules is the real fix (Phase-3 backlog); until then this
  // holds the ceiling so it can only shrink. See
  // docs_v2/specs/live-provider-command-mirroring.md and
  // docs_v2/specs/mid-thread-launch-option-feedback.md.
  // +28: thread.createDraft / thread.discardDraft dispatch cases + the start-time
  // workbench.changed push for a Draft Thread started in place (composer-draft-thread) —
  // the minimal command surface for the Composer's Draft Thread; the per-domain handler
  // split remains the real fix.
  // +18: the provider.checkReadiness routing case (on-demand readiness for the Composer
  // slot-select install/sign-in handoff). Spec: provider-cli-setup-handoff.md.
  // +18: providerCatalogChangedEvent builder + connect re-push — opencode's catalog is delivered
  // OUT OF BAND from thread.listed so the agent menu is never blocked behind opencode's
  // subprocesses (same spec); the giant switch split remains the real fix.
  "backend/adapters/inbound/contract-message-adapter/contract-message-adapter.ts": 893,
  // live-backend is the composition root and sat right at the 800 cap. Decoupling opencode's
  // catalog from thread.listed added a small startup push (setImmediate → providerCatalog.changed)
  // so the agent menu's availableAgents is never gated by opencode's slower subprocesses. The real
  // fix is the long-pending live-backend split; until then this holds so it can only shrink.
  // Spec: provider-cli-setup-handoff.md.
  // +8: constructs + injects the agent-CLI update checker (createLiveAgentUpdateChecker) — all
  // detection logic + scheduling live in the collaborator; only the wiring is here.
  // Spec: version-management.md (Lane 2).
  "backend/infrastructure/node/live/live-backend.ts": 827,
};

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function lineCount(file: string): number {
  return fs.readFileSync(file, "utf8").split("\n").length;
}

test("no source file grows past the global cap or its pinned ceiling", () => {
  const violations: string[] = [];
  for (const file of listSourceFiles(srcDir)) {
    const rel = path.relative(srcDir, file);
    const lines = lineCount(file);
    const ceiling = PINNED_MAX[rel] ?? MAX_LINES;
    if (lines > ceiling) {
      const which = PINNED_MAX[rel] !== undefined
        ? `pinned ceiling ${ceiling} (extract a collaborator; lower the pin)`
        : `cap ${MAX_LINES} (split this file before merging)`;
      violations.push(`${rel}: ${lines} lines > ${which}`);
    }
  }
  assert.deepEqual(violations, [], `\n${violations.join("\n")}`);
});

test("the ratchet allowlist has no stale entries (every pinned file still exists and is still oversized)", () => {
  const stale: string[] = [];
  for (const [rel, ceiling] of Object.entries(PINNED_MAX)) {
    const full = path.join(srcDir, rel);
    if (!fs.existsSync(full)) {
      stale.push(`${rel}: pinned but no longer exists — remove the entry`);
      continue;
    }
    if (lineCount(full) <= MAX_LINES) {
      stale.push(`${rel}: now under the global cap — remove the pin (ceiling ${ceiling})`);
    }
  }
  assert.deepEqual(stale, [], `\n${stale.join("\n")}`);
});
