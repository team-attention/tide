import type { AgentChatChoiceSurfaceView } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { ChevronLeft, ExternalLink, KeyRound, Wrench } from "lucide-react";

export function OpencodeModelProviderPanel(props: {
  surface: AgentChatChoiceSurfaceView;
  onRowSelect?: (surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"], rowId: string) => void;
  onConnectApiKey?: (vendorId: string, key: string) => void;
}): ReactElement {
  const data = props.surface.opencodeModelProvider;
  const [keyDraft, setKeyDraft] = useState("");
  const select = (rowId: string) => props.onRowSelect?.("opencode_model_provider", rowId);

  useEffect(() => {
    setKeyDraft("");
  }, [data?.step, data?.providerId]);

  if (data === undefined) {
    return (
      <section className="oc-model-provider" aria-label="opencode model provider">
        <header className="oc-model-provider__head">
          <h2>Provider</h2>
          <span>opencode</span>
        </header>
      </section>
    );
  }

  const providerLabel = data.providerLabel ?? "Provider";
  const apiKeySubmitLabel = submitLabelForProviderStatus(data.providerStatus);
  return (
    <section
      className="oc-model-provider"
      aria-label="opencode model provider"
      data-choice-surface="opencode_model_provider"
      data-opencode-step={data.step}
    >
      <header className="oc-model-provider__head">
        <h2>{props.surface.title}</h2>
        <span>{data.version ? `opencode ${data.version}` : props.surface.sourceLabel}</span>
      </header>

      {data.step === "provider_list" || data.step === "connect_vendor" ? (
        <div className="oc-model-provider__rows">
          {data.providers.map((provider) => (
            <button
              key={provider.rowId}
              type="button"
              className="oc-model-provider__row"
              data-selected={provider.selected ? "true" : "false"}
              data-connected={provider.connected ? "true" : "false"}
              data-reconnect={provider.needsReconnect ? "true" : undefined}
              onClick={() => select(provider.rowId)}
            >
              <span className="oc-model-provider__mark" aria-hidden>{provider.monogram}</span>
              <span className="oc-model-provider__body">
                <b>{provider.label}</b>
                <span>{provider.detail}</span>
              </span>
              <span className="oc-model-provider__meta">
                {provider.selected ? "Current" : provider.needsReconnect ? "Reconnect" : provider.connected ? ">" : "Connect"}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {data.step === "model_list" ? (
        <div className="oc-model-provider__rows">
          <BackRow label="Back to providers" detail="opencode" onClick={() => select("opencode-back")} />
          {data.connection ? (
            <button
              type="button"
              className="oc-model-provider__row oc-model-provider__row--subtle"
              onClick={() => select(data.connection?.rowId ?? "")}
            >
              <span className="oc-model-provider__mark" aria-hidden><Wrench size={13} strokeWidth={1.9} /></span>
              <span className="oc-model-provider__body">
                <b>{data.connection.label}</b>
                <span>{data.connection.detail}</span>
              </span>
              <span className="oc-model-provider__meta">Update</span>
            </button>
          ) : null}
          <div className="oc-model-provider__section">Models</div>
          {data.models.length > 0 ? data.models.map((model) => (
            <button
              key={model.rowId}
              type="button"
              className="oc-model-provider__row"
              data-selected={model.selected ? "true" : "false"}
              onClick={() => select(model.rowId)}
            >
              <span className="oc-model-provider__mark" aria-hidden>{model.monogram}</span>
              <span className="oc-model-provider__body">
                <b>{model.label}</b>
                <span>{model.detail ?? model.value}</span>
              </span>
              <span className="oc-model-provider__meta">{model.selected ? "Current" : model.meta ?? ""}</span>
            </button>
          )) : (
            <div className="oc-model-provider__empty">No models from {providerLabel} yet.</div>
          )}
          <div className="oc-model-provider__section">Effort</div>
          <div className="oc-model-provider__effort">
            {data.effortRows.map((row) => (
              <button
                key={row.rowId}
                type="button"
                data-active={row.selected ? "true" : "false"}
                onClick={() => select(row.rowId)}
              >
                {row.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {data.step === "vendor_method" ? (
        <div className="oc-model-provider__rows">
          <BackRow label="Back" detail={providerLabel} onClick={() => select("opencode-back")} />
          <button
            type="button"
            className="oc-model-provider__method"
            onClick={() => data.method && select(data.method.browserRowId)}
          >
            <ExternalLink size={15} strokeWidth={1.9} aria-hidden />
            <span className="oc-model-provider__body">
              <b>Sign in with browser</b>
              <span>opens opencode auth in a readiness terminal</span>
            </span>
          </button>
          <button
            type="button"
            className="oc-model-provider__method"
            onClick={() => data.method && select(data.method.apiKeyRowId)}
          >
            <KeyRound size={15} strokeWidth={1.9} aria-hidden />
            <span className="oc-model-provider__body">
              <b>Paste API key</b>
              <span>stored by opencode, not Tide</span>
            </span>
          </button>
        </div>
      ) : null}

      {data.step === "api_key" ? (
        <form
          className="oc-model-provider__key"
          onSubmit={(event) => {
            event.preventDefault();
            if (data.providerId && keyDraft.trim().length > 0) {
              props.onConnectApiKey?.(data.providerId, keyDraft.trim());
              select("opencode-api-key-finished");
            }
          }}
        >
          <input
            type="password"
            autoFocus
            spellCheck={false}
            value={keyDraft}
            placeholder="sk-..."
            aria-label={`${providerLabel} API key`}
            onChange={(event) => setKeyDraft(event.currentTarget.value)}
          />
          <div className="oc-model-provider__foot">
            <button type="button" onClick={() => select("opencode-back")}>
              Back
            </button>
            <button type="submit" data-primary="true" disabled={keyDraft.trim().length === 0}>
              {apiKeySubmitLabel}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function submitLabelForProviderStatus(status: string | undefined): "Connect" | "Reconnect" | "Update" {
  if (status === "Reconnect") {
    return "Reconnect";
  }
  if (status === undefined || status === "Connect") {
    return "Connect";
  }
  return "Update";
}

function BackRow(props: { label: string; detail: string; onClick: () => void }): ReactElement {
  return (
    <button type="button" className="oc-model-provider__row" onClick={props.onClick}>
      <span className="oc-model-provider__mark" aria-hidden>
        <ChevronLeft size={14} strokeWidth={2} />
      </span>
      <span className="oc-model-provider__body">
        <b>{props.label}</b>
        <span>{props.detail}</span>
      </span>
      <span className="oc-model-provider__meta">Esc</span>
    </button>
  );
}
