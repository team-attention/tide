import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { TideProductShell } from "../adapters/inbound/react-renderer/tide-product-shell.ts";
import type {
  AgentChatBackendEvent,
} from "../application/domains/agent-chat/agent-chat-shell-state.ts";
import type { ProductShellBackendCommand } from "../application/domains/product-shell/product-shell-state.ts";
import {
  CONTRACT_VERSION,
  type BackendCommandEnvelope,
  type BackendEventEnvelope,
} from "../../shared/contracts/index.ts";
import "./tide-product-shell.css";

export function createInitialRendererElement() {
  return createElement(TideProductShell, {
    onBackendCommand: dispatchBackendCommand,
    onBackendEvent: subscribeBackendEvents,
  });
}

export function mountTideRenderer(rootElement: HTMLElement | null): void {
  if (rootElement === null) {
    throw new Error("Missing Tide renderer root element.");
  }

  createRoot(rootElement).render(createInitialRendererElement());
}

mountTideRenderer(document.getElementById("root"));

declare global {
  interface Window {
    tide?: {
      contractVersion: 1;
      transport: "message_port";
      sendBackendCommand(command: BackendCommandEnvelope): Promise<BackendEventEnvelope[]>;
      onBackendEvent(listener: (event: BackendEventEnvelope) => void): () => void;
    };
  }
}

function dispatchBackendCommand(
  command: ProductShellBackendCommand,
): Promise<AgentChatBackendEvent[]> | AgentChatBackendEvent[] | undefined {
  if (window.tide === undefined) {
    return [
      {
        kind: "contract.error",
        payload: {
          code: "backend_transport_unavailable",
          message:
            "Backend transport unavailable. Run Tide through the Electron app to start Agents.",
        },
      },
    ];
  }

  const envelope: BackendCommandEnvelope = {
    contractVersion: CONTRACT_VERSION,
    requestId: `renderer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind: command.kind,
    issuedAt: new Date().toISOString(),
    payload: command.payload as BackendCommandEnvelope["payload"],
  };

  return window.tide.sendBackendCommand(envelope).then((events) =>
    events.map((event) => ({
      kind: event.kind,
      payload: event.payload as Record<string, unknown>,
    })),
  );
}

function subscribeBackendEvents(
  listener: (event: AgentChatBackendEvent) => void,
): (() => void) | undefined {
  if (window.tide === undefined) {
    return undefined;
  }

  return window.tide.onBackendEvent((event) => {
    listener({
      kind: event.kind,
      payload: event.payload as Record<string, unknown>,
    });
  });
}
