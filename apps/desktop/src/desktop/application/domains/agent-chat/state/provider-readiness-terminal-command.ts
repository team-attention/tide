import { providerReadinessTerminalActionPayload } from "./composer.ts";

export function providerReadinessTerminalCommandData(
  blockerKind: string,
  action: Parameters<typeof providerReadinessTerminalActionPayload>[0],
) {
  const payload = providerReadinessTerminalActionPayload(action);
  const data = {
    blockerKind,
    command: payload.command,
    args: payload.args,
    cwd: payload.cwd,
    terminalRole: "provider_readiness" as const,
    expectedCompletion: payload.expectedCompletion,
  };
  if (payload.env === undefined) {
    return data;
  }
  return {
    ...data,
    env: payload.env,
  };
}
