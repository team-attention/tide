// Phase 1 symmetry guard (docs_v2/implementation/codebase-issues-and-remediation-plan.md).
//
// Adding (or re-adding) an agent must mean ONE descriptor entry plus its backend
// integration factory — not edits scattered across the UI, the runtime port, and
// infra. These tests make that structural: every provider-CLI agent id has a
// descriptor, a session-ref kind, an integration factory, and harness coverage;
// and the hot consolidation points may not re-grow a hardcoded agent-id list or a
// `=== "claude"`-style branch.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AGENT_DESCRIPTORS,
  PROVIDER_CLI_AGENT_IDS,
  agentDescriptor,
  isProviderCliAgentId,
  sessionRefKindForAgent,
} from "../src/shared/agent-descriptors.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

// The canonical provider-CLI agent ids. The contract type ProviderCliAgentId is a
// compile-time union; this is its runtime twin, and the descriptor table + helpers
// must agree with it. Adding an id to the type without updating this list (and a
// descriptor) is the exact fan-out this guard prevents.
const EXPECTED_PROVIDER_CLI_IDS = ["codex", "claude", "opencode", "qwen"] as const;

test("every provider-CLI agent id has a descriptor and a session-ref kind", () => {
  for (const id of EXPECTED_PROVIDER_CLI_IDS) {
    const descriptor = agentDescriptor(id);
    assert.ok(descriptor !== undefined, `missing descriptor for ${id}`);
    assert.equal(descriptor.isProviderCli, true, `${id} must be a provider-CLI descriptor`);
    assert.ok(descriptor.displayName.length > 0, `${id} needs a displayName`);
    assert.ok(descriptor.monogram.length > 0, `${id} needs a monogram`);
    assert.ok(sessionRefKindForAgent(id).length > 0, `${id} needs a sessionRefKind`);
    assert.ok(descriptor.permission.options.length > 0, `${id} needs permission modes`);
  }
});

test("provider-CLI permission descriptors are self-owned", () => {
  for (const id of EXPECTED_PROVIDER_CLI_IDS) {
    const descriptor = agentDescriptor(id);
    assert.ok(descriptor !== undefined, `missing descriptor for ${id}`);
    assert.ok(
      descriptor.permission.options.some((option) => option.value === descriptor.permission.default),
      `${id} default permission must be one of its options`,
    );
    for (const option of descriptor.permission.options) {
      assert.ok(
        option.id.startsWith(`${id}-`),
        `${id} permission option ${option.id} must use the ${id}- prefix`,
      );
    }
  }
});

test("desktop agent vocabulary derives identity and permissions from shared descriptors", () => {
  const source = read("src/desktop/application/domains/agent-chat/state/agent-vocab.ts");
  assert.match(source, /AGENT_DESCRIPTORS/);
  assert.match(source, /agentDescriptor\(agentId\)\?\.displayName/);
  assert.doesNotMatch(
    source,
    /export const PERMISSION_OPTIONS:[\s\S]*\{\s*codex:/,
    "desktop agent vocab must not re-grow a hand-maintained permission table",
  );
});

test("PROVIDER_CLI_AGENT_IDS is derived from the descriptor table and matches the canonical list", () => {
  assert.deepEqual(
    [...PROVIDER_CLI_AGENT_IDS].sort(),
    [...EXPECTED_PROVIDER_CLI_IDS].sort(),
  );
  // Derived purely from descriptors flagged isProviderCli (no hand-listing).
  const derived = Object.values(AGENT_DESCRIPTORS)
    .filter((descriptor) => descriptor.isProviderCli)
    .map((descriptor) => descriptor.id)
    .sort();
  assert.deepEqual(derived, [...EXPECTED_PROVIDER_CLI_IDS].sort());
});

test("isProviderCliAgentId accepts provider CLIs and rejects the Tide API agent and unknowns", () => {
  for (const id of EXPECTED_PROVIDER_CLI_IDS) {
    assert.equal(isProviderCliAgentId(id), true, `${id} should be a provider CLI`);
  }
  assert.equal(isProviderCliAgentId("openai_api"), false);
  assert.equal(isProviderCliAgentId("bogus"), false);
});

test("every provider-CLI agent has an integration factory module", () => {
  for (const id of EXPECTED_PROVIDER_CLI_IDS) {
    const file = `src/backend/adapters/outbound/agent-integrations/${id}/${id}-agent-integration.ts`;
    assert.ok(
      fs.existsSync(path.join(root, file)),
      `missing integration factory ${file}`,
    );
    const source = read(file);
    assert.match(
      source,
      new RegExp(`create${id[0].toUpperCase()}${id.slice(1)}AgentIntegration`),
      `${file} must export create${id[0].toUpperCase()}${id.slice(1)}AgentIntegration`,
    );
  }
});

test("the canonical provider harnesses name every provider-CLI agent", () => {
  // A new agent must be added to the answer+settle gate AND the permission flow,
  // so the e2e gate produces a real column for it (closes the A7 harness asymmetry).
  for (const harness of ["scripts/v2-provider-smoke.mjs", "scripts/v2-provider-permission-flow.mjs"]) {
    const source = read(harness);
    for (const id of EXPECTED_PROVIDER_CLI_IDS) {
      // The agent appears either as a quoted string (smoke's Set) or an object
      // key (permission-flow's SCENARIOS map).
      assert.match(source, new RegExp(`["']${id}["']|\\b${id}:`), `${harness} must name ${id}`);
    }
  }
});

test("the runtime port derives agent membership and session-ref kind from the registry", () => {
  const source = read(
    "src/backend/adapters/outbound/agent-runtime/runtime-ports/agent-integration-agent-runtime-port.ts",
  );
  // No re-grown hardcoded provider-CLI id chain.
  assert.doesNotMatch(
    source,
    /agentId === "codex"[\s\S]*agentId === "claude"[\s\S]*agentId === "opencode"/,
    "runtime port must not hardcode the provider-CLI id list — derive it from the registry",
  );
  // No inline sessionRefKind ternary; it comes from sessionRefKindForAgent
  // (now in the shared createTransportClient helper, so the arg is input.agentId).
  assert.doesNotMatch(source, /sessionRefKind:\s*agentId === "opencode"/);
  assert.match(source, /sessionRefKindForAgent\((input\.)?agentId\)/);
});

test("infra detectAvailableAgents iterates the registry, not a hardcoded array", () => {
  // Extracted from live-backend into provider-detection (file-size ratchet).
  const source = read("src/backend/infrastructure/node/provider/provider-detection.ts");
  assert.match(source, /PROVIDER_CLI_AGENT_IDS\.filter/);
  assert.doesNotMatch(
    source,
    /\["codex",\s*"claude",\s*"opencode"\]/,
    "detectAvailableAgents must use PROVIDER_CLI_AGENT_IDS, not a literal id array",
  );
});

// Audit 5.2 / A5: provider home-path knowledge (.claude/.codex file
// layouts) belongs to the agent integrations. The live spine and entrypoints
// may dispatch per provider, but must not hardcode provider path literals —
// those moved to claude-history-connector /
// agent-integrations/shared/provider-cli-commands.
test("infrastructure live/entrypoints contain no quoted provider home-path literals", () => {
  const dirs = [
    "src/backend/infrastructure/node/live",
    "src/backend/infrastructure/node/entrypoints",
  ];
  const violations: string[] = [];
  for (const dir of dirs) {
    for (const entry of fs.readdirSync(path.join(root, dir))) {
      if (!entry.endsWith(".ts")) continue;
      const rel = `${dir}/${entry}`;
      const source = read(rel);
      for (const [index, line] of source.split("\n").entries()) {
        if (/["'`]\.(claude|codex)\b/.test(line)) {
          violations.push(`${rel}:${index + 1}: ${line.trim()}`);
        }
      }
    }
  }
  assert.deepEqual(violations, [], `\n${violations.join("\n")}`);
});
