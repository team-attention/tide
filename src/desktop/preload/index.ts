import { contextBridge, ipcRenderer } from "electron";
import type {
  BackendCommandEnvelope,
  BackendEventEnvelope,
} from "../../shared/contracts/index.ts";

export interface TidePreloadSurface {
  contractVersion: 1;
  transport: "message_port";
  sendBackendCommand(command: BackendCommandEnvelope): Promise<BackendEventEnvelope[]>;
  onBackendEvent(listener: (event: BackendEventEnvelope) => void): () => void;
}

export const tidePreloadSurface: TidePreloadSurface = {
  contractVersion: 1,
  transport: "message_port",
  sendBackendCommand(command) {
    return ipcRenderer.invoke("tide:backend-command", command) as Promise<BackendEventEnvelope[]>;
  },
  onBackendEvent(listener) {
    const wrappedListener = (_event: unknown, event: BackendEventEnvelope) => {
      listener(event);
    };
    ipcRenderer.on("tide:backend-event", wrappedListener);
    return () => {
      ipcRenderer.removeListener("tide:backend-event", wrappedListener);
    };
  },
};

contextBridge.exposeInMainWorld("tide", tidePreloadSurface);
