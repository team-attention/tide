import type { AgentChatChoiceSurfaceView } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { ReactElement } from "react";
import { useState } from "react";
import { styled } from "styled-components";
import { Check, ExternalLink, KeyRound } from "lucide-react";
// The rich "Connect a model" on-ramp panel for opencode (spec: opencode-vendor-onramp.md).
// Stateful so it can host the per-vendor method sheet + the in-app API-key field
// without leaking a sensitive key into the global store. The API-key path is the
// canonical one: the field value is handed to onConnectApiKey, which the backend PUTs to
// opencode's own server. The browser/OAuth path reuses the row-select → readiness terminal
// terminal (opencode opens the browser). The grid actions still route via onRowSelect.

export function OpencodeConnectPanel(props: {
  surface: AgentChatChoiceSurfaceView;
  onRowSelect?: (surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"], rowId: string) => void;
  onConnectApiKey?: (vendorId: string, key: string) => void;
}): ReactElement {
  const data = props.surface.opencodeConnect;
  const vendors = data?.vendors ?? [];
  const select = (rowId: string) => props.onRowSelect?.("opencode_connect", rowId);

  const [sheetVendorId, setSheetVendorId] = useState<string | null>(null);
  const [keyMode, setKeyMode] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");

  const sheetVendor = vendors.find((vendor) => vendor.id === sheetVendorId);
  const closeSheet = () => {
    setSheetVendorId(null);
    setKeyMode(false);
    setKeyDraft("");
  };

  // ── Per-vendor method sheet (browser vs API key) ──────────────────────────
  if (sheetVendor) {
    return (
      <OpencodeConnectSurface aria-label={`Connect ${sheetVendor.label}`} data-choice-surface="opencode_connect">
        <OpencodeConnectHeader>
          <VendorMonogram $compact aria-hidden>{sheetVendor.monogram}</VendorMonogram>
          <OpencodeConnectTitle>Connect {sheetVendor.label}</OpencodeConnectTitle>
        </OpencodeConnectHeader>

        {keyMode ? (
          <>
            <OpencodeConnectDescription>
              Paste your {sheetVendor.label} API key. Stored by <b>opencode</b>, never by Tide.
            </OpencodeConnectDescription>
            <ApiKeyField
              type="password"
              autoFocus
              spellCheck={false}
              placeholder="sk-…"
              value={keyDraft}
              aria-label={`${sheetVendor.label} API key`}
              onChange={(event) => setKeyDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && keyDraft.trim().length > 0) {
                  props.onConnectApiKey?.(sheetVendor.id, keyDraft.trim());
                  closeSheet();
                }
              }}
            />
            <MethodSheetFooter>
              <BackButton type="button" onClick={() => setKeyMode(false)}>‹ Back</BackButton>
              <ConnectButton
                type="button"
                disabled={keyDraft.trim().length === 0}
                onClick={() => {
                  props.onConnectApiKey?.(sheetVendor.id, keyDraft.trim());
                  closeSheet();
                }}
              >
                Connect
              </ConnectButton>
            </MethodSheetFooter>
          </>
        ) : (
          <>
            <OpencodeConnectDescription>How do you want to sign in?</OpencodeConnectDescription>
            <ConnectMethodButton
              type="button"
              onClick={() => {
                // opencode's own browser/SSO flow, in the embedded readiness terminal.
                select(`connect-vendor:${sheetVendor.id}`);
                closeSheet();
              }}
            >
              <ExternalLink size={16} strokeWidth={1.9} aria-hidden />
              <ConnectMethodBody>
                <b>Sign in with browser</b>
                <span>opencode opens its sign-in in a terminal</span>
              </ConnectMethodBody>
            </ConnectMethodButton>
            <ConnectMethodButton type="button" onClick={() => setKeyMode(true)}>
              <KeyRound size={16} strokeWidth={1.9} aria-hidden />
              <ConnectMethodBody>
                <b>Paste an API key</b>
                <span>enter a key right here</span>
              </ConnectMethodBody>
            </ConnectMethodButton>
            <BackButton type="button" onClick={closeSheet}>‹ Back to vendors</BackButton>
          </>
        )}
      </OpencodeConnectSurface>
    );
  }

  // ── Default view: vendor grid (Zen is a tile in it, not a hero) ────────────
  return (
    <OpencodeConnectSurface aria-label="Connect a model" data-choice-surface="opencode_connect">
      <OpencodeConnectHeader>
        <OpencodeConnectTitle>Connect a model</OpencodeConnectTitle>
        {data?.version ? <OpencodeVersionPill>opencode {data.version}</OpencodeVersionPill> : null}
      </OpencodeConnectHeader>

      <VendorGroupLabel>{data?.manageMode ? "Add a vendor" : "Vendors"}</VendorGroupLabel>
      <VendorGrid>
        {data?.manageMode ? null : (
          // OpenCode Zen sits in the grid at the same level as the vendors — a "Free"
          // (ready) tile, not a hero card. Clicking it uses a free model.
          <VendorTile
            type="button"
            $free
            data-free="true"
            data-opencode-vendor-tile="true"
            onClick={() => select("use-free-model")}
          >
            <VendorMonogram aria-hidden>Z</VendorMonogram>
            <VendorTileBody>
              <VendorTileName>OpenCode Zen</VendorTileName>
              <VendorTileStatus $state="ok">
                {data && data.zenFreeCount > 0 ? `Free · ${data.zenFreeCount} models` : "Free models"}
              </VendorTileStatus>
            </VendorTileBody>
          </VendorTile>
        )}
        {vendors.map((vendor) => {
          // A connected vendor whose auth no longer serves models (e.g. expired token)
          // is clickable again to re-run the sign-in — "Reconnect" instead of a
          // misleading green "Connected" (spec: opencode-vendor-reconnect.md).
          const settled = vendor.connected && !vendor.needsReconnect;
          return (
            <VendorTile
              key={vendor.id}
              type="button"
              $connected={settled}
              $reconnect={vendor.needsReconnect}
              data-connected={settled ? "true" : "false"}
              data-reconnect={vendor.needsReconnect ? "true" : undefined}
              data-opencode-vendor-tile="true"
              disabled={settled}
              onClick={settled ? undefined : () => setSheetVendorId(vendor.id)}
            >
              <VendorMonogram aria-hidden>{vendor.monogram}</VendorMonogram>
              <VendorTileBody>
                <VendorTileName>{vendor.label}</VendorTileName>
                <VendorTileStatus $state={vendor.needsReconnect ? "warn" : settled ? "ok" : "muted"}>
                  {vendor.needsReconnect ? "Reconnect" : vendor.connected ? "Connected" : "Connect"}
                </VendorTileStatus>
              </VendorTileBody>
              {settled ? <VendorConnectedIcon size={14} strokeWidth={2.4} aria-hidden /> : null}
            </VendorTile>
          );
        })}
        <VendorTile type="button" $add onClick={() => select("all-providers")} data-opencode-vendor-tile="true">
          <VendorMonogram $add aria-hidden>+</VendorMonogram>
          <VendorTileBody>
            <VendorTileName>All providers…</VendorTileName>
            <VendorTileStatus $state="muted">Qwen · Kimi · more</VendorTileStatus>
          </VendorTileBody>
        </VendorTile>
      </VendorGrid>

      {data?.manageMode ? (
        <BackButton type="button" onClick={() => select("back-to-models")}>
          ‹ Back to models
        </BackButton>
      ) : null}
    </OpencodeConnectSurface>
  );
}

const OpencodeConnectSurface = styled.section`
  --oc-ok: var(--tide-diff-add);
  --oc-warn: var(--tide-warn);
  display: flex;
  flex-direction: column;
  width: 384px;
  max-width: 100%;
  max-height: 100%;
  overflow-y: auto;
  padding: 14px;
  border: 1px solid var(--tide-line);
  border-radius: 12px;
  background: var(--tide-bg);
  box-shadow: var(--tide-shadow-popover);
  transform-origin: top;
  animation: tide-pop-in 0.13s ease;
`;

const OpencodeConnectHeader = styled.header`
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 2px;
`;

const OpencodeConnectTitle = styled.h2`
  margin: 0;
  flex: 1 1 auto;
  color: var(--tide-text);
  font-size: 14.5px;
  font-weight: 650;
  letter-spacing: 0;
`;

const OpencodeVersionPill = styled.span`
  flex: 0 0 auto;
  padding: 2px 9px;
  border: 1px solid var(--tide-line);
  border-radius: 999px;
  color: var(--tide-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`;

const OpencodeConnectDescription = styled.p`
  margin: 8px 2px 13px;
  color: var(--tide-muted);
  font-size: 12.5px;

  b {
    color: var(--tide-text);
    font-weight: 600;
  }
`;

const VendorGroupLabel = styled.div`
  margin: 13px 4px 9px;
  color: var(--tide-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const VendorGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
`;

const VendorTile = styled.button<{
  $add?: boolean;
  $connected?: boolean;
  $free?: boolean;
  $reconnect?: boolean;
}>`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: 1px ${({ $add }) => ($add ? "dashed" : "solid")}
    ${({ $connected, $free, $reconnect }) => {
      if ($reconnect) {
        return "color-mix(in srgb, var(--oc-warn) 38%, var(--tide-line))";
      }
      if ($connected || $free) {
        return "color-mix(in srgb, var(--oc-ok) 32%, var(--tide-line))";
      }
      return "var(--tide-line)";
    }};
  border-radius: 10px;
  background: color-mix(in srgb, var(--tide-muted) 5%, transparent);
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: background-color 0.12s ease, border-color 0.12s ease;

  &:hover {
    border-color: var(--tide-line-strong);
    background: var(--tide-hover);
  }
`;

const VendorMonogram = styled.span<{ $add?: boolean; $compact?: boolean }>`
  width: ${({ $compact }) => ($compact ? "24px" : "26px")};
  height: ${({ $compact }) => ($compact ? "24px" : "26px")};
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border: ${({ $add }) => ($add ? "1px dashed var(--tide-line-strong)" : "0")};
  border-radius: 7px;
  background: ${({ $add }) => ($add ? "transparent" : "var(--tide-selection)")};
  color: ${({ $add }) => ($add ? "var(--tide-muted)" : "var(--tide-text)")};
  font-size: 12px;
  font-weight: 700;

  ${VendorTile}[data-connected="true"] &,
  ${VendorTile}[data-free="true"] & {
    background: color-mix(in srgb, var(--oc-ok) 15%, var(--tide-selection));
  }

  ${VendorTile}[data-reconnect="true"] & {
    background: color-mix(in srgb, var(--oc-warn) 16%, var(--tide-selection));
  }
`;

const VendorTileBody = styled.span`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

const VendorTileName = styled.span`
  overflow: hidden;
  color: var(--tide-text);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const VendorTileStatus = styled.span<{ $state: "muted" | "ok" | "warn" }>`
  color: ${({ $state }) => {
    if ($state === "ok") {
      return "var(--oc-ok)";
    }
    if ($state === "warn") {
      return "var(--oc-warn)";
    }
    return "var(--tide-muted)";
  }};
  font-size: 11px;
  font-weight: ${({ $state }) => ($state === "muted" ? 400 : 600)};
`;

const VendorConnectedIcon = styled(Check)`
  margin-left: auto;
  flex: 0 0 auto;
  color: var(--oc-ok);
`;

const BackButton = styled.button`
  align-self: flex-start;
  margin: 11px 2px 0;
  border: 0;
  background: none;
  color: var(--tide-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;

  &:hover {
    color: var(--tide-text);
  }
`;

const ConnectMethodButton = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 11px;
  margin-bottom: 8px;
  padding: 11px 12px;
  border: 1px solid var(--tide-line);
  border-radius: 10px;
  background: color-mix(in srgb, var(--tide-muted) 5%, transparent);
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: background-color 0.12s ease, border-color 0.12s ease;

  &:hover {
    border-color: var(--tide-line-strong);
    background: var(--tide-hover);
  }

  > svg {
    flex: 0 0 auto;
    color: var(--tide-muted);
  }
`;

const ConnectMethodBody = styled.span`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;

  b {
    color: var(--tide-text);
    font-size: 13px;
    font-weight: 600;
  }

  span {
    color: var(--tide-muted);
    font-size: 11.5px;
  }
`;

const ApiKeyField = styled.input`
  width: 100%;
  padding: 10px 12px;
  border: 1.5px solid var(--tide-action);
  border-radius: 9px;
  background: var(--tide-surface);
  color: var(--tide-text);
  font: inherit;
  font-size: 13px;
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--tide-action) 14%, transparent);

  &::placeholder {
    color: var(--tide-muted);
  }
`;

const MethodSheetFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 13px;

  ${BackButton} {
    margin: 0;
  }
`;

const ConnectButton = styled.button`
  padding: 8px 16px;
  border: 0;
  border-radius: 8px;
  background: var(--tide-action);
  color: var(--tide-on-action);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }
`;
