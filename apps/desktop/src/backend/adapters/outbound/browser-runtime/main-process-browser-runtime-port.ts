import type {
  BrowserRuntimeActInput,
  BrowserRuntimeActionResult,
  BrowserRuntimeCloseInput,
  BrowserRuntimeEnsureInput,
  BrowserRuntimeObservation,
  BrowserRuntimeObserveInput,
  BrowserRuntimePort,
  BrowserRuntimeResult,
} from "../../../application/ports/outbound/browser-runtime-port.ts";
import type {
  BrowserRuntimeRequestEnvelopeDto,
  BrowserRuntimeResponseEnvelopeDto,
  BrowserRuntimeResponsePayloadDto,
} from "../../../../shared/contracts/index.ts";
import { isBrowserRuntimeResponseEnvelope } from "../../../../shared/contracts/index.ts";

type ElectronParentPort = {
  postMessage: (message: unknown) => void;
};

interface PendingBrowserRuntimeRequest {
  resolve: (response: BrowserRuntimeResponseEnvelopeDto) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const BROWSER_RUNTIME_REQUEST_TIMEOUT_MS = 30_000;

export interface MainProcessBrowserRuntimePort {
  port: BrowserRuntimePort;
  handleParentMessage(message: unknown): boolean;
}

export function createMainProcessBrowserRuntimePort(
  parentPort: ElectronParentPort | undefined,
): MainProcessBrowserRuntimePort {
  const pending = new Map<string, PendingBrowserRuntimeRequest>();

  const send = async (
    operation: BrowserRuntimeRequestEnvelopeDto["operation"],
    payload: BrowserRuntimeRequestEnvelopeDto["payload"],
  ): Promise<BrowserRuntimeResponseEnvelopeDto> => {
    if (parentPort === undefined) {
      return unavailableResponse("browser_runtime_unavailable", "Electron parent port is unavailable.");
    }
    const requestId = `browser-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const response = await new Promise<BrowserRuntimeResponseEnvelopeDto>((resolve) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        resolve(
          unavailableResponse(
            "browser_runtime_timeout",
            "BrowserRuntime request timed out before Electron main responded.",
            requestId,
          ),
        );
      }, BROWSER_RUNTIME_REQUEST_TIMEOUT_MS);
      pending.set(requestId, { resolve, timeout });
      parentPort.postMessage({
        kind: "browserRuntime.request",
        requestId,
        operation,
        payload,
      } satisfies BrowserRuntimeRequestEnvelopeDto);
    });
    return response;
  };

  const responseToResult = <T>(
    response: BrowserRuntimeResponseEnvelopeDto,
    parse: (payload: BrowserRuntimeResponsePayloadDto) => T | undefined,
  ): BrowserRuntimeResult<T> => {
    if (!response.ok) {
      return {
        ok: false,
        error: response.error ?? {
          code: "browser_runtime_error",
          message: "BrowserRuntime request failed.",
        },
      };
    }
    if (response.payload === undefined) {
      return {
        ok: false,
        error: {
          code: "browser_runtime_invalid_response",
          message: "BrowserRuntime response did not include a payload.",
        },
      };
    }
    const value = parse(response.payload);
    if (value === undefined) {
      return {
        ok: false,
        error: {
          code: "browser_runtime_invalid_response",
          message: "BrowserRuntime response payload did not match the requested operation.",
        },
      };
    }
    return { ok: true, value };
  };

  return {
    port: {
      async ensure(input: BrowserRuntimeEnsureInput) {
        return responseToResult(
          await send("ensure", input),
          (payload) =>
            "observation" in payload
              ? { observation: payload.observation as BrowserRuntimeObservation }
              : undefined,
        );
      },
      async observe(input: BrowserRuntimeObserveInput) {
        return responseToResult(
          await send("observe", input),
          (payload) =>
            "observation" in payload
              ? { observation: payload.observation as BrowserRuntimeObservation }
              : undefined,
        );
      },
      async act(input: BrowserRuntimeActInput) {
        return responseToResult(
          await send("act", input),
          (payload): BrowserRuntimeActionResult | undefined =>
            "status" in payload &&
            "message" in payload &&
            "completedAt" in payload &&
            "observation" in payload
              ? {
                  status: payload.status,
                  message: payload.message,
                  completedAt: payload.completedAt,
                  observation: payload.observation as BrowserRuntimeObservation,
                }
              : undefined,
        );
      },
      async close(input: BrowserRuntimeCloseInput) {
        const response = await send("close", input);
        if (!response.ok) {
          return {
            ok: false,
            error: response.error ?? {
              code: "browser_runtime_error",
              message: "BrowserRuntime close request failed.",
            },
          };
        }
        if (
          response.payload !== undefined &&
          "closed" in response.payload &&
          response.payload.closed === true
        ) {
          return { ok: true, value: undefined };
        }
        return {
          ok: false,
          error: {
            code: "browser_runtime_invalid_response",
            message: "BrowserRuntime close response payload was invalid.",
          },
        };
      },
    },
    handleParentMessage(message: unknown): boolean {
      if (!isBrowserRuntimeResponseEnvelope(message)) {
        return false;
      }
      const waiter = pending.get(message.requestId);
      if (waiter === undefined) {
        return true;
      }
      clearTimeout(waiter.timeout);
      pending.delete(message.requestId);
      waiter.resolve(message);
      return true;
    },
  };
}

function unavailableResponse(
  code: string,
  message: string,
  requestId = "browser-runtime-unavailable",
): BrowserRuntimeResponseEnvelopeDto {
  return {
    kind: "browserRuntime.response",
    requestId,
    ok: false,
    error: { code, message },
  };
}
