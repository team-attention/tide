import type {
  BackendCommandPayloadByKind,
  BackendEventEnvelope,
} from "../../../../../shared/contracts/index.ts";
import {
  applyAppChromeBackendEvent,
  type AppChromeBackendCommand,
  type AppChromeState,
} from "../../../../application/domains/app-chrome/app-chrome-state.ts";

export type AppChromeBackendCommandDraft = {
  kind: "workbench.command";
  payload: BackendCommandPayloadByKind["workbench.command"];
};

export function applyBackendEventToAppChrome(
  state: AppChromeState,
  event: BackendEventEnvelope,
): AppChromeState {
  return applyAppChromeBackendEvent(state, {
    kind: event.kind,
    payload: event.payload as Record<string, unknown>,
  });
}

export function toBackendCommandDraft(
  command: AppChromeBackendCommand,
): AppChromeBackendCommandDraft {
  return {
    kind: "workbench.command",
    payload: command.payload,
  };
}
