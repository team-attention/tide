import { createInterface } from "node:readline";

import { runTideMcpSocketBackedLineDelimitedStdio } from "../../../adapters/inbound/tide-mcp-server/tide-mcp-socket-bridge.ts";

export async function runTideMcpStdioBridgeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const socketPath = env.TIDE_SOCKET;
  if (socketPath === undefined || socketPath.trim().length === 0) {
    process.stderr.write("TIDE_SOCKET is required for Tide MCP stdio bridge.\n");
    return 1;
  }

  const lines = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  await runTideMcpSocketBackedLineDelimitedStdio({
    socketPath,
    env,
    input: lines,
    writeLine: (line) => {
      process.stdout.write(`${line}\n`);
    },
  });

  return 0;
}
