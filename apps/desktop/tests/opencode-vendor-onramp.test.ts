import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  buildOpencodeVendors,
  createOpencodeVendorCatalog,
  parseOpencodeAuthList,
  reconcileVendorUsability,
} from "../src/backend/infrastructure/node/provider/opencode-vendor-catalog.ts";
import { createOpencodeAuthServer } from "../src/backend/infrastructure/node/provider/opencode-auth-server.ts";
import {
  buildOpencodeConnectSurface,
  createAgentChatShellState,
  createAgentChatShellViewModel,
  isOpencodeUsable,
  selectAgentChatChoiceSurfaceRow,
  setComposerActiveSurface,
  setOpencodeEnvironment,
  setOpencodeModelCatalog,
  setOpencodeVendors,
} from "../src/desktop/application/domains/agent-chat/agent-chat.ts";

// Spec: docs_v2/specs/opencode-vendor-onramp.md

function resetOnrampState() {
  setOpencodeVendors(null);
  setOpencodeEnvironment(null);
  setOpencodeModelCatalog(null);
}

function opencodeStartState() {
  return createAgentChatShellState({
    startOptions: {
      agentBinding: { agentId: "opencode" },
      scope: { kind: "project", projectId: "tide", cwd: "/repo" },
      launchOptions: {},
    },
  });
}

// ---- backend: `opencode auth list` parser ----

test("parseOpencodeAuthList reads ● rows, ignores the frame, keeps spaced names + method", () => {
  const out = [
    "[0m",
    "┌  Credentials [90m~/.local/share/opencode/auth.json",
    "│",
    "●  Anthropic [90moauth",
    "│",
    "●  OpenAI [90moauth",
    "│",
    "●  GitHub Copilot [90moauth",
    "└  3 credentials",
  ].join("\n");
  const entries = parseOpencodeAuthList(out);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ["Anthropic", "OpenAI", "GitHub Copilot"],
  );
  assert.equal(entries[0].method, "oauth");
  assert.equal(entries[2].name, "GitHub Copilot");
});

test("parseOpencodeAuthList tolerates empty output", () => {
  assert.deepEqual(parseOpencodeAuthList(""), []);
});

test("opencode vendor catalog tolerates cold CLI startup above one second", async () => {
  const catalog = createOpencodeVendorCatalog(
    () => "/fake/opencode",
    async (_executablePath, args) => {
      assert.deepEqual(args, ["auth", "list"]);
      await delay(1200);
      return "●  OpenAI oauth\n";
    },
  );
  const vendors = await catalog.get();
  assert.equal(vendors.find((vendor) => vendor.id === "openai")?.connected, true);
  assert.equal(vendors.find((vendor) => vendor.id === "openai")?.method, "oauth");
});

// ---- backend: curated tiles ⨉ connected merge ----

test("buildOpencodeVendors merges curated tiles with connected entries (case-insensitive) and appends uncurated", () => {
  const vendors = buildOpencodeVendors([
    { name: "OpenAI", method: "oauth" },
    { name: "Anthropic", method: "oauth" },
    { name: "Some Local Router", method: "api" },
  ]);
  const openai = vendors.find((vendor) => vendor.id === "openai");
  assert.equal(openai?.connected, true);
  assert.equal(openai?.popular, true);
  assert.equal(openai?.method, "oauth");
  assert.equal(vendors.find((vendor) => vendor.id === "google")?.connected, false);
  const local = vendors.find((vendor) => vendor.label === "Some Local Router");
  assert.equal(local?.connected, true);
  assert.equal(local?.popular, false);
});

test("buildOpencodeVendors with no logins → curated tiles, none connected", () => {
  const vendors = buildOpencodeVendors([]);
  assert.ok(vendors.length >= 7);
  assert.ok(vendors.every((vendor) => vendor.connected === false));
  assert.ok(vendors.some((vendor) => vendor.id === "openai" && vendor.popular));
});

test("buildOpencodeVendors de-dupes a vendor with multiple credentials (no duplicate ids)", () => {
  // A vendor can carry several credentials (e.g. OAuth + an API key) — they must not
  // become duplicate tiles / duplicate React keys.
  const vendors = buildOpencodeVendors([
    { name: "OpenAI", method: "oauth" },
    { name: "OpenAI", method: "api" },
    { name: "Some Router", method: "api" },
    { name: "Some Router", method: "oauth" },
  ]);
  assert.equal(vendors.filter((vendor) => vendor.id === "openai").length, 1);
  assert.equal(vendors.filter((vendor) => vendor.id === "some-router").length, 1);
  assert.equal(new Set(vendors.map((vendor) => vendor.id)).size, vendors.length);
});

// ---- backend: reconcile connected vendors against the model catalog ----

test("reconcileVendorUsability flags a connected vendor with no models as usable:false", () => {
  // openai has models in the catalog; anthropic is connected (auth list) but absent
  // from `opencode models` (e.g. expired OAuth) → not usable.
  const vendors = buildOpencodeVendors([
    { name: "OpenAI", method: "oauth" },
    { name: "Anthropic", method: "oauth" },
  ]);
  const reconciled = reconcileVendorUsability(vendors, [
    { vendor: "openai" },
    { vendor: "opencode" },
  ]);
  assert.equal(reconciled.find((vendor) => vendor.id === "openai")?.usable, true);
  assert.equal(reconciled.find((vendor) => vendor.id === "anthropic")?.usable, false);
  // A non-connected curated tile is left untouched (no usable flag forced on).
  assert.equal(reconciled.find((vendor) => vendor.id === "google")?.usable, undefined);
});

test("reconcileVendorUsability leaves vendors untouched when the catalog is empty (no signal)", () => {
  const vendors = buildOpencodeVendors([{ name: "Anthropic", method: "oauth" }]);
  const reconciled = reconcileVendorUsability(vendors, []);
  assert.equal(reconciled.find((vendor) => vendor.id === "anthropic")?.usable, undefined);
});

// ---- desktop: "is opencode usable" gate ----

test("isOpencodeUsable is false when the only connected vendor is unusable (expired) and no concrete model", () => {
  resetOnrampState();
  setOpencodeVendors([{ id: "anthropic", label: "Anthropic", connected: true, popular: true, usable: false }]);
  assert.equal(isOpencodeUsable(), false);
  resetOnrampState();
});

test("buildOpencodeConnectSurface marks an unusable connected vendor needsReconnect", () => {
  resetOnrampState();
  setOpencodeVendors([
    { id: "openai", label: "OpenAI", connected: true, popular: true, usable: true },
    { id: "anthropic", label: "Anthropic", connected: true, popular: true, usable: false },
  ]);
  const surface = buildOpencodeConnectSurface(true);
  const anthropic = surface.opencodeConnect?.vendors.find((vendor) => vendor.id === "anthropic");
  const openai = surface.opencodeConnect?.vendors.find((vendor) => vendor.id === "openai");
  assert.equal(anthropic?.needsReconnect, true);
  assert.equal(openai?.needsReconnect, false);
  resetOnrampState();
});

test("isOpencodeUsable is false with no vendors and only the default model", () => {
  resetOnrampState();
  assert.equal(isOpencodeUsable(), false);
});

test("isOpencodeUsable is true once a vendor is connected", () => {
  resetOnrampState();
  setOpencodeVendors([{ id: "openai", label: "OpenAI", connected: true, popular: true }]);
  assert.equal(isOpencodeUsable(), true);
  resetOnrampState();
});

test("isOpencodeUsable is true once a concrete model exists", () => {
  resetOnrampState();
  setOpencodeModelCatalog([{ value: "openai/gpt-5.5", label: "gpt-5.5", vendor: "openai" }]);
  assert.equal(isOpencodeUsable(), true);
  resetOnrampState();
});

// ---- desktop: the connect surface view ----

test("buildOpencodeConnectSurface carries Zen count, connected count, version, vendor + action rows", () => {
  resetOnrampState();
  setOpencodeVendors([
    { id: "openai", label: "OpenAI", connected: true, popular: true },
    { id: "google", label: "Google", connected: false, popular: true },
  ]);
  setOpencodeModelCatalog([
    { value: "opencode/big-pickle", label: "big-pickle", vendor: "opencode" },
    { value: "opencode/grok-free", label: "grok-free", vendor: "opencode" },
    { value: "openai/gpt-5.5", label: "gpt-5.5", vendor: "openai" },
  ]);
  setOpencodeEnvironment({ version: "1.17.1", executablePath: "/bin/opencode" });

  const surface = buildOpencodeConnectSurface(false);
  assert.equal(surface.surfaceKind, "opencode_connect");
  assert.equal(surface.opencodeConnect?.zenFreeCount, 2);
  assert.equal(surface.opencodeConnect?.connectedCount, 1);
  assert.equal(surface.opencodeConnect?.version, "1.17.1");
  assert.equal(surface.opencodeConnect?.vendors.length, 2);
  assert.equal(surface.opencodeConnect?.vendors[0].monogram, "O");
  assert.ok(surface.rows.some((row) => row.rowId === "use-free-model"));
  assert.ok(surface.rows.some((row) => row.rowId === "connect-vendor:openai"));
  assert.ok(surface.rows.some((row) => row.rowId === "all-providers"));
  assert.ok(!surface.rows.some((row) => row.rowId === "back-to-models"));
  assert.ok(buildOpencodeConnectSurface(true).rows.some((row) => row.rowId === "back-to-models"));
  resetOnrampState();
});

// ---- desktop: the Model chip opens the on-ramp only when not usable ----

test("modelChipSurface always opens the opencode model/provider surface", () => {
  resetOnrampState();
  assert.equal(createAgentChatShellViewModel(opencodeStartState()).composer.modelChipSurface, "opencode_model_provider");
  setOpencodeVendors([{ id: "openai", label: "OpenAI", connected: true, popular: true }]);
  assert.equal(createAgentChatShellViewModel(opencodeStartState()).composer.modelChipSurface, "opencode_model_provider");
  resetOnrampState();
});

// ---- desktop: connect actions drive opencode's own auth login via the readiness terminal ----

test("connect-vendor dispatches the readiness terminal `auth login -p <id>`", () => {
  resetOnrampState();
  setOpencodeVendors([{ id: "openai", label: "OpenAI", connected: false, popular: true }]);
  setOpencodeEnvironment({ version: "1.17.1", executablePath: "/bin/opencode" });
  const opened = setComposerActiveSurface(opencodeStartState(), "opencode_connect").state;
  const result = selectAgentChatChoiceSurfaceRow(opened, "opencode_connect", "connect-vendor:openai", "thread-1");
  assert.equal(result.command?.kind, "workbench.command");
  if (result.command?.kind === "workbench.command") {
    assert.equal(result.command.payload.command, "open_terminal");
    assert.equal(result.command.payload.threadId, "thread-1");
    assert.equal(result.command.payload.data.command, "/bin/opencode");
    assert.deepEqual(result.command.payload.data.args, ["auth", "login", "-p", "openai"]);
    assert.equal(result.command.payload.data.terminalRole, "provider_readiness");
    assert.equal(result.command.payload.data.expectedCompletion, "retry_preflight");
  }
  assert.equal(result.state.composer.activeSurface, null);
  resetOnrampState();
});

test("all-providers dispatches `auth login` with no -p", () => {
  resetOnrampState();
  setOpencodeEnvironment({ executablePath: "/bin/opencode" });
  const opened = setComposerActiveSurface(opencodeStartState(), "opencode_connect").state;
  const result = selectAgentChatChoiceSurfaceRow(opened, "opencode_connect", "all-providers", "thread-1");
  assert.equal(
    result.command?.kind === "workbench.command" && result.command.payload.data.args.join(" "),
    "auth login",
  );
  resetOnrampState();
});

test("connect is a no-op with no thread, or with no opencode executable", () => {
  resetOnrampState();
  setOpencodeVendors([{ id: "openai", label: "OpenAI", connected: false, popular: true }]);
  setOpencodeEnvironment({ executablePath: "/bin/opencode" });
  const opened = setComposerActiveSurface(opencodeStartState(), "opencode_connect").state;
  // No thread + no activeThreadId → nothing to host the surface.
  assert.equal(selectAgentChatChoiceSurfaceRow(opened, "opencode_connect", "connect-vendor:openai").command, null);
  // No executable path → nothing to launch.
  setOpencodeEnvironment(null);
  const opened2 = setComposerActiveSurface(opencodeStartState(), "opencode_connect").state;
  assert.equal(selectAgentChatChoiceSurfaceRow(opened2, "opencode_connect", "connect-vendor:openai", "t1").command, null);
  resetOnrampState();
});

test("use-free-model sets opencode's default model and closes the panel", () => {
  resetOnrampState();
  const opened = setComposerActiveSurface(opencodeStartState(), "opencode_connect").state;
  const result = selectAgentChatChoiceSurfaceRow(opened, "opencode_connect", "use-free-model");
  assert.equal(result.state.composer.activeSurface, null);
  assert.equal(result.state.composer.startOptions.launchOptions?.model, "opencode default");
  resetOnrampState();
});

test("model_menu requests are normalized to the opencode model/provider surface", () => {
  resetOnrampState();
  const opened = setComposerActiveSurface(opencodeStartState(), "model_menu").state;
  assert.equal(opened.composer.activeSurface, "opencode_model_provider");
  resetOnrampState();
});

// ---- backend: the "정석" path — opencode's own HTTP server (PUT /auth/{id}) ----

function fakeResponse(init: { ok: boolean; status: number; json?: unknown; text?: string }): Response {
  return {
    ok: init.ok,
    status: init.status,
    json: async () => init.json,
    text: async () => init.text ?? "",
  } as unknown as Response;
}

test("auth server setApiKey PUTs { type:'api', key } to /auth/{id} (palot's mechanism)", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const server = createOpencodeAuthServer({
    resolveExecutable: () => "/bin/opencode",
    resolveBaseUrl: async () => "http://127.0.0.1:9999",
    fetchImpl: (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return fakeResponse({ ok: true, status: 200 });
    }) as typeof fetch,
  });
  await server.setApiKey("openai", "sk-test");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:9999/auth/openai");
  assert.equal(calls[0].init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { type: "api", key: "sk-test" });
});

test("auth server setApiKey throws on a non-2xx response", async () => {
  const server = createOpencodeAuthServer({
    resolveExecutable: () => "/bin/opencode",
    resolveBaseUrl: async () => "http://127.0.0.1:9999",
    fetchImpl: (async () => fakeResponse({ ok: false, status: 400, text: "bad key" })) as typeof fetch,
  });
  await assert.rejects(() => server.setApiKey("openai", "x"), /400/);
});

test("auth server listProviderAuth returns the parsed method map", async () => {
  const map = { openai: [{ type: "api", label: "Manually enter API Key" }] };
  const server = createOpencodeAuthServer({
    resolveExecutable: () => "/bin/opencode",
    resolveBaseUrl: async () => "http://127.0.0.1:9999",
    fetchImpl: (async () => fakeResponse({ ok: true, status: 200, json: map })) as typeof fetch,
  });
  assert.deepEqual(await server.listProviderAuth(), map);
});
