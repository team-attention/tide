import { BrowserWindow, app } from "electron";
import { parsePositiveIntegerEnv } from "./backend-bridge.ts";
// Extracted from electron-main.ts (spec: navigable-source-structure).

export async function runElectronRuntimeSmoke(mainWindow: BrowserWindow): Promise<void> {
  const commandJson = process.env.TIDE_ELECTRON_SMOKE_COMMAND;
  if (commandJson === undefined) {
    return;
  }

  const timeoutMs = parsePositiveIntegerEnv("TIDE_ELECTRON_SMOKE_TIMEOUT_MS", 75000);
  const pollMs = parsePositiveIntegerEnv("TIDE_ELECTRON_SMOKE_POLL_MS", 1000);
  const token = process.env.TIDE_ELECTRON_SMOKE_TOKEN ?? "";
  const expectPushedAgentOutput =
    process.env.TIDE_ELECTRON_SMOKE_EXPECT_PUSHED_AGENT_OUTPUT === "1";
  const openSetupSurface = process.env.TIDE_ELECTRON_SMOKE_OPEN_SETUP_SURFACE === "1";

  try {
    const result = await mainWindow.webContents.executeJavaScript(
      electronRuntimeSmokeScript({
        commandJson,
        timeoutMs,
        pollMs,
        token,
        expectPushedAgentOutput,
        openSetupSurface,
      }),
      true,
    );
    console.log(`TIDE_ELECTRON_SMOKE_RESULT ${JSON.stringify(result)}`);
    app.exit(0);
  } catch (error) {
    console.error(
      `TIDE_ELECTRON_SMOKE_ERROR ${error instanceof Error ? error.message : String(error)}`,
    );
    app.exit(1);
  }
}

function electronRuntimeSmokeScript(input: {
  commandJson: string;
  timeoutMs: number;
  pollMs: number;
  token: string;
  expectPushedAgentOutput: boolean;
  openSetupSurface: boolean;
}): string {
  return `
    (async () => {
      const command = JSON.parse(${JSON.stringify(input.commandJson)});
      const token = ${JSON.stringify(input.token)};
      const expectPushedAgentOutput = ${JSON.stringify(input.expectPushedAgentOutput)};
      const openSetupSurface = ${JSON.stringify(input.openSetupSurface)};
      if (window.tide === undefined) {
        throw new Error("window.tide is unavailable.");
      }

      const pushedEvents = [];
      const unsubscribe = window.tide.onBackendEvent((event) => {
        pushedEvents.push(event);
      });
      const startEvents = await window.tide.sendBackendCommand(command);
      const readiness = startEvents.find((event) => event.kind === "providerReadiness.changed");
      if (readiness !== undefined) {
        let setupSurface = undefined;
        if (openSetupSurface) {
          setupSurface = await openProviderSetupSurface(readiness);
        }
        unsubscribe();
        return {
          ok: false,
          phase: "provider-not-ready",
          threadId: readiness.payload.threadId,
          readiness: readiness.payload.readiness,
          setupSurface,
          startEventKinds: eventKinds(startEvents),
          pushedCount: pushedEvents.length,
          pushedEventKinds: eventKinds(pushedEvents),
        };
      }

      const started = startEvents.find((event) => event.kind === "thread.started");
      if (started === undefined) {
        unsubscribe();
        return {
          ok: false,
          phase: "not-started",
          startEventKinds: eventKinds(startEvents),
          pushedCount: pushedEvents.length,
          pushedEventKinds: eventKinds(pushedEvents),
        };
      }

      const threadId = started.payload.thread.threadId;
      const deadline = Date.now() + ${input.timeoutMs};
      let hydrateEvents = [];
      let agentOutputFound = false;
      let pushedAgentOutputFound = false;
      while (Date.now() <= deadline) {
        hydrateEvents = await window.tide.sendBackendCommand({
          contractVersion: command.contractVersion,
          requestId: command.requestId + "-hydrate-" + Date.now(),
          kind: "thread.hydrate",
          issuedAt: new Date().toISOString(),
          payload: { threadId },
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        pushedAgentOutputFound = agentOutputContainsToken(pushedEvents, token);
        agentOutputFound = agentOutputContainsToken(
          [...startEvents, ...pushedEvents, ...hydrateEvents],
          token,
        );
        if (
          token.length === 0 ||
          (agentOutputFound && (!expectPushedAgentOutput || pushedAgentOutputFound))
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, ${input.pollMs}));
      }

      const hydrated = [...hydrateEvents, ...pushedEvents]
        .find((event) => event.kind === "thread.hydrated");
      unsubscribe();
      return {
        ok: true,
        threadId,
        agent: started.payload.thread.agentBinding.agentId,
        runtimeSource: started.payload.thread.agentBinding.runtimeSource,
        launchOptions: started.payload.thread.launchOptions,
        hydratedAgent: hydrated?.payload.thread.agentBinding.agentId,
        hydratedLaunchOptions: hydrated?.payload.thread.launchOptions,
        blockCount: hydrated?.payload.blocks?.length ?? 0,
        agentOutputFound,
        pushedAgentOutputFound,
        pushedCount: pushedEvents.length,
        startEventKinds: eventKinds(startEvents),
        pushedEventKinds: eventKinds(pushedEvents),
        hydrateEventKinds: eventKinds(hydrateEvents),
      };

      function eventKinds(events) {
        return events.map((event) => event.kind);
      }

      async function openProviderSetupSurface(readinessEvent) {
        const setup = (readinessEvent.payload.readiness.blockers ?? [])
          .find((blocker) => blocker.setup)?.setup;
        if (setup === undefined) {
          return { opened: false, error: "missing_setup_action" };
        }

        const setupEvents = await window.tide.sendBackendCommand({
          contractVersion: command.contractVersion,
          requestId: command.requestId + "-open-setup-" + Date.now(),
          kind: "workbench.command",
          issuedAt: new Date().toISOString(),
          payload: {
            threadId: readinessEvent.payload.threadId,
            command: "open_provider_setup_surface",
            data: { setup },
          },
        });
        const workbenchChanged = setupEvents
          .find((event) => event.kind === "workbench.changed");
        const pane = workbenchChanged?.payload.panes
          ?.find((candidate) => candidate.kind === "terminal");
        return {
          opened: pane !== undefined,
          paneId: pane?.paneId,
          title: pane?.title,
          status: pane?.status,
          command: pane?.command,
          expectedCompletion: pane?.expectedCompletion,
          eventKinds: eventKinds(setupEvents),
        };
      }

      function agentOutputContainsToken(events, expectedToken) {
        if (expectedToken.length === 0) {
          return false;
        }
        for (const event of events) {
          if (event.kind === "agentSessionBlock.upserted") {
            if (blockContainsToken(event.payload.block, expectedToken)) {
              return true;
            }
          }
          if (event.kind === "thread.hydrated") {
            for (const block of event.payload.blocks ?? []) {
              if (blockContainsToken(block, expectedToken)) {
                return true;
              }
            }
          }
        }
        return false;
      }

      function blockContainsToken(block, expectedToken) {
        if (block?.role !== "agent") {
          return false;
        }
        return String(block.body ?? "").includes(expectedToken) ||
          String(block.rawFallback ?? "").includes(expectedToken);
      }
    })()
  `;
}
