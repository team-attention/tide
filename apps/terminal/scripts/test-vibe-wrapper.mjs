// Spec: docs/specs/vibe-wrapped-agent.md — UC-1 BR-1/2/3.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const dir = mkdtempSync(join(tmpdir(), 'tide-vibe-'));
try {
  writeFileSync(join(dir, 'vibe'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE_ARGS"\nprintf "%s" "$VIBE_MCP_SERVERS" > "$CAPTURE_MCP"\nprintf "%s" "$VIBE_EXPERIMENTAL_ENABLE_TAB_STATUS" > "$CAPTURE_STATUS"\nexit 7\n', { mode: 0o755 });
  writeFileSync(join(dir, 'tide'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CAPTURE_NOTIFY"\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${dir}:/usr/bin:/bin`, CAPTURE_STATUS: join(dir, 'status'), VIBE_EXPERIMENTAL_ENABLE_TAB_STATUS: 'false', CAPTURE_ARGS: join(dir, 'args'), CAPTURE_MCP: join(dir, 'mcp'), CAPTURE_NOTIFY: join(dir, 'notify') };
  delete env.TIDE_TERMINAL_BIN; delete env.VIBE_MCP_SERVERS;
  const wrapper = resolve('crates/tide-app/resources/bin/vibe');
  let result = spawnSync('/bin/bash', [wrapper, '--model', 'custom model'], { env });
  assert.equal(result.status, 7);
  assert.equal(readFileSync(env.CAPTURE_ARGS, 'utf8'), '--model\ncustom model\n');
  assert.equal(readFileSync(env.CAPTURE_MCP, 'utf8'), '');
  assert.equal(readFileSync(env.CAPTURE_STATUS, 'utf8'), 'false');
  result = spawnSync('/bin/bash', [wrapper, '--continue'], { env: { ...env, TIDE_TERMINAL_BIN: join(dir, 'tide'), TIDE_TERMINAL_PANE: '42', TIDE_TERMINAL_SOCKET: '/tmp/a "quoted" socket', VIBE_MCP_SERVERS: '[{"name":"existing","transport":"stdio","command":["existing"]}]' } });
  assert.equal(result.status, 7, result.stderr?.toString());
  assert.equal(readFileSync(env.CAPTURE_STATUS, 'utf8'), 'true');
  const servers = JSON.parse(readFileSync(env.CAPTURE_MCP, 'utf8'));
  assert.equal(servers[0].name, 'existing');
  assert.equal(servers[1].name, 'tide-terminal');
  assert.equal(servers[1].env.TIDE_TERMINAL_PANE, '42');
  assert.equal(servers[1].env.TIDE_TERMINAL_SOCKET, '/tmp/a "quoted" socket');
  assert.match(readFileSync(env.CAPTURE_NOTIFY, 'utf8'), /agent-attached.*--agent vibe/);
  assert.match(readFileSync(env.CAPTURE_NOTIFY, 'utf8'), /agent-detached.*--agent vibe/);
  console.log('Vibe wrapper behavior passed');
} finally { rmSync(dir, { recursive: true, force: true }); }
