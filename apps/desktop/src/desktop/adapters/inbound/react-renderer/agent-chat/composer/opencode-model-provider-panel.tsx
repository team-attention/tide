import type { AgentChatChoiceSurfaceView } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { ChevronLeft, ExternalLink, KeyRound, Wrench } from "lucide-react";
import { styled } from "styled-components";

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
      <OpencodeModelProviderSurface aria-label="opencode model provider">
        <OpencodeModelProviderHeader>
          <OpencodeModelProviderTitle>Provider</OpencodeModelProviderTitle>
          <OpencodeModelProviderVersion>opencode</OpencodeModelProviderVersion>
        </OpencodeModelProviderHeader>
      </OpencodeModelProviderSurface>
    );
  }

  const providerLabel = data.providerLabel ?? "Provider";
  const apiKeySubmitLabel = submitLabelForProviderStatus(data.providerStatus);
  return (
    <OpencodeModelProviderSurface
      aria-label="opencode model provider"
      data-choice-surface="opencode_model_provider"
      data-opencode-step={data.step}
    >
      <OpencodeModelProviderHeader>
        <OpencodeModelProviderTitle>{props.surface.title}</OpencodeModelProviderTitle>
        <OpencodeModelProviderVersion>
          {data.version ? `opencode ${data.version}` : props.surface.sourceLabel}
        </OpencodeModelProviderVersion>
      </OpencodeModelProviderHeader>

      {data.step === "provider_list" || data.step === "connect_vendor" ? (
        <OpencodeProviderRows>
          {data.providers.map((provider) => (
            <OpencodeProviderRowButton
              key={provider.rowId}
              type="button"
              $selected={provider.selected}
              onClick={() => select(provider.rowId)}
            >
              <OpencodeProviderMark aria-hidden>{provider.monogram}</OpencodeProviderMark>
              <OpencodeProviderBody>
                <OpencodeProviderName>{provider.label}</OpencodeProviderName>
                <OpencodeProviderDetail>{provider.detail}</OpencodeProviderDetail>
              </OpencodeProviderBody>
              <OpencodeProviderMeta>
                {provider.selected ? "Current" : provider.needsReconnect ? "Reconnect" : provider.connected ? ">" : "Connect"}
              </OpencodeProviderMeta>
            </OpencodeProviderRowButton>
          ))}
        </OpencodeProviderRows>
      ) : null}

      {data.step === "model_list" ? (
        <OpencodeProviderRows>
          <BackRow label="Back to providers" detail="opencode" onClick={() => select("opencode-back")} />
          {data.connection ? (
            <OpencodeProviderRowButton
              type="button"
              $subtle
              onClick={() => select(data.connection?.rowId ?? "")}
            >
              <OpencodeProviderMark aria-hidden><Wrench size={13} strokeWidth={1.9} /></OpencodeProviderMark>
              <OpencodeProviderBody>
                <OpencodeProviderName $subtle>{data.connection.label}</OpencodeProviderName>
                <OpencodeProviderDetail>{data.connection.detail}</OpencodeProviderDetail>
              </OpencodeProviderBody>
              <OpencodeProviderMeta>Update</OpencodeProviderMeta>
            </OpencodeProviderRowButton>
          ) : null}
          <OpencodeProviderSection>Models</OpencodeProviderSection>
          {data.models.length > 0 ? data.models.map((model) => (
            <OpencodeProviderRowButton
              key={model.rowId}
              type="button"
              $selected={model.selected}
              onClick={() => select(model.rowId)}
            >
              <OpencodeProviderMark aria-hidden>{model.monogram}</OpencodeProviderMark>
              <OpencodeProviderBody>
                <OpencodeProviderName>{model.label}</OpencodeProviderName>
                <OpencodeProviderDetail>{model.detail ?? model.value}</OpencodeProviderDetail>
              </OpencodeProviderBody>
              <OpencodeProviderMeta>{model.selected ? "Current" : model.meta ?? ""}</OpencodeProviderMeta>
            </OpencodeProviderRowButton>
          )) : (
            <OpencodeProviderEmpty>No models from {providerLabel} yet.</OpencodeProviderEmpty>
          )}
          <OpencodeProviderSection>Effort</OpencodeProviderSection>
          <OpencodeProviderEffortGrid>
            {data.effortRows.map((row) => (
              <OpencodeProviderEffortButton
                key={row.rowId}
                type="button"
                $active={row.selected}
                onClick={() => select(row.rowId)}
              >
                {row.label}
              </OpencodeProviderEffortButton>
            ))}
          </OpencodeProviderEffortGrid>
        </OpencodeProviderRows>
      ) : null}

      {data.step === "vendor_method" ? (
        <OpencodeProviderRows>
          <BackRow label="Back" detail={providerLabel} onClick={() => select("opencode-back")} />
          <OpencodeProviderMethodButton
            type="button"
            onClick={() => data.method && select(data.method.browserRowId)}
          >
            <ExternalLink size={15} strokeWidth={1.9} aria-hidden />
            <OpencodeProviderBody>
              <OpencodeProviderName>Sign in with browser</OpencodeProviderName>
              <OpencodeProviderDetail>opens opencode auth in a readiness terminal</OpencodeProviderDetail>
            </OpencodeProviderBody>
          </OpencodeProviderMethodButton>
          <OpencodeProviderMethodButton
            type="button"
            onClick={() => data.method && select(data.method.apiKeyRowId)}
          >
            <KeyRound size={15} strokeWidth={1.9} aria-hidden />
            <OpencodeProviderBody>
              <OpencodeProviderName>Paste API key</OpencodeProviderName>
              <OpencodeProviderDetail>stored by opencode, not Tide</OpencodeProviderDetail>
            </OpencodeProviderBody>
          </OpencodeProviderMethodButton>
        </OpencodeProviderRows>
      ) : null}

      {data.step === "api_key" ? (
        <OpencodeProviderKeyForm
          onSubmit={(event) => {
            event.preventDefault();
            if (data.providerId && keyDraft.trim().length > 0) {
              props.onConnectApiKey?.(data.providerId, keyDraft.trim());
              select("opencode-api-key-finished");
            }
          }}
        >
          <OpencodeProviderKeyInput
            type="password"
            autoFocus
            autoComplete="new-password"
            spellCheck={false}
            value={keyDraft}
            placeholder="sk-..."
            aria-label={`${providerLabel} API key`}
            onChange={(event) => setKeyDraft(event.currentTarget.value)}
          />
          <OpencodeProviderFooter>
            <OpencodeProviderFooterButton type="button" onClick={() => select("opencode-back")}>
              Back
            </OpencodeProviderFooterButton>
            <OpencodeProviderFooterButton type="submit" $primary disabled={keyDraft.trim().length === 0}>
              {apiKeySubmitLabel}
            </OpencodeProviderFooterButton>
          </OpencodeProviderFooter>
        </OpencodeProviderKeyForm>
      ) : null}
    </OpencodeModelProviderSurface>
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
    <OpencodeProviderRowButton type="button" onClick={props.onClick}>
      <OpencodeProviderMark aria-hidden>
        <ChevronLeft size={14} strokeWidth={2} />
      </OpencodeProviderMark>
      <OpencodeProviderBody>
        <OpencodeProviderName>{props.label}</OpencodeProviderName>
        <OpencodeProviderDetail>{props.detail}</OpencodeProviderDetail>
      </OpencodeProviderBody>
      <OpencodeProviderMeta>Esc</OpencodeProviderMeta>
    </OpencodeProviderRowButton>
  );
}

const OpencodeModelProviderSurface = styled.section`
  display: flex;
  flex-direction: column;
  width: 384px;
  max-width: 100%;
  max-height: 100%;
  overflow: hidden;
  padding: 6px;
  border: 1px solid var(--tide-line);
  border-radius: 12px;
  background: var(--tide-bg);
  box-shadow: var(--tide-shadow-popover);
  transform-origin: top;
  animation: tide-pop-in 0.13s ease;
`;

const OpencodeModelProviderHeader = styled.header`
  min-height: 24px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 2px 8px 4px;
`;

const OpencodeModelProviderTitle = styled.h2`
  margin: 0;
  overflow: hidden;
  color: var(--tide-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
`;

const OpencodeModelProviderVersion = styled.span`
  color: var(--tide-muted);
  font-size: 12px;
  white-space: nowrap;
`;

const OpencodeProviderRows = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  max-height: 56vh;
  display: grid;
  gap: 0;
  overflow-y: auto;
`;

const OpencodeProviderRowButton = styled.button<{
  $selected?: boolean;
  $subtle?: boolean;
}>`
  min-height: ${({ $subtle }) => ($subtle ? "30px" : "34px")};
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 8px;
  padding: 4px 8px;
  background: ${({ $selected }) => ($selected ? "var(--tide-selection)" : "transparent")};
  color: ${({ $subtle }) => ($subtle ? "var(--tide-muted)" : "var(--tide-text)")};
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--tide-selection);
  }
`;

const OpencodeProviderMethodButton = styled.button`
  min-height: 44px;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 8px;
  padding: 4px 8px;
  background: transparent;
  color: var(--tide-text);
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--tide-selection);
  }
`;

const OpencodeProviderMark = styled.span`
  width: 21px;
  height: 21px;
  display: grid;
  place-items: center;
  border: 1px solid var(--tide-line);
  border-radius: 6px;
  background: var(--tide-surface);
  color: var(--tide-muted);
  font-size: 10px;
  font-weight: 700;
`;

const OpencodeProviderBody = styled.span`
  min-width: 0;
  display: grid;
  gap: 1px;
`;

const OpencodeProviderName = styled.b<{ $subtle?: boolean }>`
  min-width: 0;
  overflow: hidden;
  color: ${({ $subtle }) => ($subtle ? "var(--tide-muted)" : "inherit")};
  font-size: ${({ $subtle }) => ($subtle ? "12px" : "13px")};
  font-weight: 560;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const OpencodeProviderDetail = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--tide-muted);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const OpencodeProviderMeta = styled.span`
  justify-self: end;
  max-width: 92px;
  overflow: hidden;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--tide-selection);
  color: var(--tide-muted);
  font-size: 11px;
  line-height: 17px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const OpencodeProviderSection = styled.div`
  margin: 9px 8px 3px;
  color: var(--tide-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

const OpencodeProviderEmpty = styled.div`
  padding: 8px;
  color: var(--tide-muted);
  font-size: 12px;
`;

const OpencodeProviderEffortGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
  padding: 0 8px 6px;
`;

const OpencodeProviderEffortButton = styled.button<{ $active?: boolean }>`
  min-width: 0;
  height: 28px;
  border: 1px solid var(--tide-line);
  border-radius: 7px;
  background: ${({ $active }) => ($active ? "var(--tide-selection)" : "transparent")};
  color: ${({ $active }) => ($active ? "var(--tide-text)" : "var(--tide-muted)")};
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-text);
  }
`;

const OpencodeProviderKeyForm = styled.form`
  display: grid;
  gap: 8px;
  padding: 8px;
`;

const OpencodeProviderKeyInput = styled.input`
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--tide-line);
  border-radius: 8px;
  background: var(--tide-surface);
  color: var(--tide-text);
  font: inherit;

  &:focus {
    outline: 2px solid var(--tide-line-strong);
    outline-offset: -1px;
  }
`;

const OpencodeProviderFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 6px;
`;

const OpencodeProviderFooterButton = styled.button<{ $primary?: boolean }>`
  height: 28px;
  padding: 0 10px;
  border: 1px solid ${({ $primary }) => ($primary ? "var(--tide-text)" : "var(--tide-line)")};
  border-radius: 7px;
  background: ${({ $primary }) => ($primary ? "var(--tide-text)" : "transparent")};
  color: ${({ $primary }) => ($primary ? "var(--tide-bg)" : "var(--tide-text)")};
  font: inherit;
  font-size: 12px;
  cursor: pointer;

  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
`;
