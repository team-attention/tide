const TIDE_RUNTIME_ENV_ALLOWLIST = new Set([
  "TIDE_THREAD_ID",
  "TIDE_RUNTIME_ID",
  "TIDE_AGENT_ID",
]);

const TIDE_OWNER_ENV = new Set([
  "TIDE_APP_DATA_ROOT",
  "TIDE_BACKEND_INSTANCE_ID",
  "TIDE_BIN",
  "TIDE_MCP_ENTRYPOINT",
  "TIDE_SOCKET",
  "TIDE_PANE",
  "TIDE_WINDOW",
  "TIDE_ELECTRON_SMOKE_COMMAND",
  "ELECTRON_RUN_AS_NODE",
]);

export function sanitizeProviderRuntimeEnv(
  env: NodeJS.ProcessEnv,
  options: { allowRuntimeTags?: boolean } = {},
): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue;
    }
    if (TIDE_OWNER_ENV.has(key)) {
      continue;
    }
    if (key.startsWith("TIDE_")) {
      if (options.allowRuntimeTags === true && TIDE_RUNTIME_ENV_ALLOWLIST.has(key)) {
        sanitized[key] = value;
      }
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}
