// Spec: docs_v2/specs/live-model-catalog-and-vibe.md
import assert from "node:assert/strict";
import test from "node:test";
import { parseClaudeModels, createProtocolModelCatalog } from "../src/backend/infrastructure/node/provider/protocol-model-catalog.ts";
import { createVibeAgentIntegration } from "../src/backend/adapters/outbound/agent-integrations/vibe/vibe-agent-integration.ts";

test("Claude catalog retains native aliases and supported effort levels", () => {
  const models = parseClaudeModels({ models: [
    { value: "opus[1m]", displayName: "Opus", description: "Native description", supportedEffortLevels: ["low", "max"] },
    { value: "sonnet", displayName: "Sonnet" },
  ] });
  assert.equal(models[0].value, "opus[1m]");
  assert.deepEqual(models[0].effortOptions, ["low", "max"]);
  assert.equal(models[1].label, "Sonnet");
  assert.throws(() => parseClaudeModels({ models: [] }));
  assert.throws(() => parseClaudeModels({}));
});

test("catalog discovery coalesces concurrent calls and retries failures", async () => {
  let calls = 0;
  const catalog = createProtocolModelCatalog("claude", () => "/fake/claude", async () => {
    calls++;
    if (calls === 1) throw new Error("offline");
    return { models: [{ value: "native", displayName: "Native" }] };
  });
  await assert.rejects(catalog.get("/tmp"), /offline/);
  const [a, b] = await Promise.all([catalog.get("/tmp"), catalog.get("/tmp")]);
  assert.deepEqual(a, b);
  assert.equal(calls, 2);
  assert.equal(a.models[0].value, "native");
});

test("Vibe launches ACP with native config and Tide MCP", async () => {
  const integration = createVibeAgentIntegration({ resolveExecutable: () => "/bin/vibe-acp", tideMcp: { command: "/bin/tide", args: ["mcp"] } });
  const plan = await integration.buildStartPlan({ threadId: "t", runtimeId: "r", launchOptions: { model: "native-alias", reasoning: "high", permission: "plan" } } as never);
  assert.equal(plan.command, "/bin/vibe-acp");
  assert.deepEqual(plan.args, []);
  assert.equal(plan.transport, "acp");
  assert.deepEqual(plan.protocolParams?.configOptions, [
    { configId: "model", value: "native-alias" }, { configId: "thinking", value: "high" }, { configId: "mode", value: "plan" },
  ]);
  assert.equal((plan.protocolParams?.mcpServers as Array<{name: string}>)[0].name, "tide");
  const readiness = await integration.preflight({} as never);
  assert.equal(readiness.agentId, "vibe");
  assert.equal(readiness.ready, true);
});

test("Vibe catalog preserves model aliases and native thinking choices", async () => {
  const catalog = createProtocolModelCatalog("vibe", () => "/fake/vibe", async () => ({ configOptions: [
    { id: "model", category: "model", currentValue: "custom", options: [{ value: "custom", name: "Custom model" }] },
    { id: "thinking", category: "thinking", options: [{ value: "off", name: "Off" }, { value: "max", name: "Max" }] },
  ] }));
  const result = await catalog.get("/tmp");
  assert.equal(result.defaultModel, "custom");
  assert.deepEqual(result.models[0].effortOptions, ["off", "max"]);
});

test("Composer accepts Vibe and renders provider-reported models", async () => {
  const { createAgentChatShellState, selectComposerAgent, setComposerActiveSurface, createAgentChatShellViewModel, selectAgentChatChoiceSurfaceRow } = await import("../src/desktop/application/domains/agent-chat/agent-chat.ts");
  for (const agentId of ["claude", "vibe"] as const) {
    const state = selectComposerAgent(createAgentChatShellState(), agentId).state;
    state.availableProviderCatalogs = { [agentId]: { agentId, status: "ready", defaultModel: "custom", models: [{ value: "custom", label: "Live native model", effortOptions: ["low"] }] } };
    const menu = setComposerActiveSurface(state, "model_menu").state;
    const rows = createAgentChatShellViewModel(menu).composer.activeSurface?.rows ?? [];
    assert.ok(rows.some((row) => row.rowId === "model:custom" && row.label === "Live native model"));
    const selected = selectAgentChatChoiceSurfaceRow(menu, "model_menu", "model:custom").state;
    assert.equal(selected.composer.startOptions.launchOptions?.model, "custom");
    assert.equal(selected.composer.startOptions.agentBinding.runtimeSource?.integrationId, agentId);
  }
});

test("protocol discovery sends no prompt, handles early exit and has a bounded lifetime", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { probeModelProtocol } = await import("../src/backend/infrastructure/node/provider/protocol-model-catalog.ts");
  const root = mkdtempSync(join(tmpdir(), "tide-model-probe-"));
  const executable = join(root, "fake-cli");
  const script = (body: string) => writeFileSync(executable, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
  try {
    script(`let buffer=''; process.stdin.on('data', chunk => { buffer+=chunk; const line=buffer.split('\\n')[0]; if(!line)return; const m=JSON.parse(line); if(m.request?.subtype!=='initialize')process.exit(9); process.stdout.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{models:[{value:'native',displayName:'Native'}]}}})+'\\n'); });`);
    const result = await probeModelProtocol("claude", executable, root);
    assert.equal(parseClaudeModels(result)[0].value, "native");
    script("process.exit(1)");
    await assert.rejects(probeModelProtocol("vibe", executable, root), /exited before/);
    script("console.log('not json'); setInterval(()=>{},1000)");
    await assert.rejects(probeModelProtocol("vibe", executable, root), /Invalid/);
    script("setInterval(()=>{},1000)");
    await assert.rejects(probeModelProtocol("vibe", executable, root, undefined, 100), /timed out/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Vibe native messages are eligible for visible Agent Session rendering", async () => {
  const { isSemanticAgentSessionProvider } = await import("../src/backend/application/domains/native-agent/semantic-agent-block.ts");
  assert.equal(isSemanticAgentSessionProvider("vibe"), true);
});

test("ACP applies initial model configuration before the first prompt", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createAcpClient } = await import("../src/backend/adapters/outbound/agent-runtime/structured/acp-client.ts");
  const root = mkdtempSync(join(tmpdir(), "tide-acp-config-"));
  const script = join(root, "fake.cjs");
  writeFileSync(script, `let configured=false; require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);const send=result=>console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));if(m.method==='initialize')send({});if(m.method==='session/new')send({sessionId:'s'});if(m.method==='session/set_config_option')setTimeout(()=>{configured=true;send({});},80);if(m.method==='session/prompt'){if(configured)send({stopReason:'end_turn'});else console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-1,message:'prompt sent before model configuration'}}));}});`);
  let complete!: (event: any) => void;
  const completed = new Promise<any>((resolve) => { complete = resolve; });
  const client = createAcpClient({ plan: { command: process.execPath, args: [script], env: {}, cwd: root, transport: "acp", protocolParams: { configOptions: [{ configId: "model", value: "native" }] } }, threadId: "t", runtimeId: "r", agentId: "vibe", sessionRefKind: "provider_native", initialPrompt: "hello", onEvent: (event) => { if(event.kind === "turn_completed") complete(event); } });
  const timeout = setTimeout(() => complete({ status: "timeout" }), 3000);
  try { assert.equal((await completed).status, "completed"); }
  finally { clearTimeout(timeout); await client.stop(); rmSync(root, {recursive: true, force: true}); }
});

test("every provider catalog survives strict transport validation with optional fields absent", async () => {
  const { providerCatalogChangedEvent } = await import("../src/backend/adapters/inbound/contract-message-adapter/dto/provider-dtos.ts");
  const { validateBackendEventEnvelope } = await import("../src/shared/contracts/index.ts");
  for (const agentId of ["codex", "claude", "vibe", "opencode"] as const) {
    for (const requestId of [undefined, "refresh"]) {
      const event = providerCatalogChangedEvent({ eventId: "catalog", emittedAt: new Date().toISOString(), requestId,
        catalog: { agentId, status: "ready", scope: undefined, defaultModel: "future/model", models: [{ value: "future/model", label: "Future model", detail: undefined, effortOptions: ["future-effort"] }] },
      });
      assert.equal(validateBackendEventEnvelope(event).ok, true, agentId);
    }
  }
});

test("Codex Claude and Vibe render and select unfamiliar native model and effort values", async () => {
  const { createAgentChatShellState, selectComposerAgent, setComposerActiveSurface, createAgentChatShellViewModel, selectAgentChatChoiceSurfaceRow } = await import("../src/desktop/application/domains/agent-chat/agent-chat.ts");
  for (const agentId of ["codex", "claude", "vibe"] as const) {
    let state = selectComposerAgent(createAgentChatShellState(), agentId).state;
    state.availableProviderCatalogs = { [agentId]: { agentId, status: "ready", defaultModel: "future-model", models: [{ value: "future-model", label: "Future model", effortOptions: ["future-effort"] }] } };
    state = setComposerActiveSurface(state, "model_menu").state;
    state = selectAgentChatChoiceSurfaceRow(state, "model_menu", "model:future-model").state;
    state = setComposerActiveSurface(state, "model_menu").state;
    const menu = createAgentChatShellViewModel(state).composer.activeSurface;
    assert.ok(menu?.rows.some(row => row.rowId === "reasoning-future-effort"), agentId);
    state = selectAgentChatChoiceSurfaceRow(state, "model_menu", "reasoning-future-effort").state;
    assert.equal(state.composer.startOptions.launchOptions?.reasoning, "future-effort", agentId);
    if (agentId === "vibe") {
      const integration = createVibeAgentIntegration({ resolveExecutable: () => "/bin/vibe-acp" });
      const plan = await integration.buildStartPlan({ threadId: "t", runtimeId: "r", launchOptions: state.composer.startOptions.launchOptions } as never);
      assert.ok((plan.protocolParams?.configOptions as Array<{configId: string; value: string}>).some(option => option.configId === "thinking" && option.value === "future-effort"));
    }
  }
});
