import type { AgentChatChoiceSurfaceView } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { ReactElement } from "react";
import { useState } from "react";
import { Check, ExternalLink, KeyRound } from "lucide-react";
// The rich "Connect a model" on-ramp panel for opencode (spec: opencode-vendor-onramp.md).
// Stateful so it can host the per-vendor method sheet + the in-app API-key field
// without leaking a sensitive key into the global store. The API-key path is the
// "정석" one: the field value is handed to onConnectApiKey, which the backend PUTs to
// opencode's own server. The browser/OAuth path reuses the row-select → Setup Surface
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
      <section className="oc-connect" aria-label={`Connect ${sheetVendor.label}`} data-choice-surface="opencode_connect">
        <header className="oc-connect__head">
          <span className="oc-tile__m" aria-hidden style={{ width: 24, height: 24 }}>{sheetVendor.monogram}</span>
          <h2 className="oc-connect__title">Connect {sheetVendor.label}</h2>
        </header>

        {keyMode ? (
          <>
            <p className="oc-connect__sub">
              Paste your {sheetVendor.label} API key. Stored by <b>opencode</b>, never by Tide.
            </p>
            <input
              className="oc-keyfield"
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
            <div className="oc-sheet__foot">
              <button type="button" className="oc-back" onClick={() => setKeyMode(false)}>‹ Back</button>
              <button
                type="button"
                className="oc-connect-btn"
                disabled={keyDraft.trim().length === 0}
                onClick={() => {
                  props.onConnectApiKey?.(sheetVendor.id, keyDraft.trim());
                  closeSheet();
                }}
              >
                Connect
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="oc-connect__sub">How do you want to sign in?</p>
            <button
              type="button"
              className="oc-method"
              onClick={() => {
                // opencode's own browser/SSO flow, in the embedded Setup Surface.
                select(`connect-vendor:${sheetVendor.id}`);
                closeSheet();
              }}
            >
              <ExternalLink className="oc-method__i" size={16} strokeWidth={1.9} aria-hidden />
              <span className="oc-method__b">
                <b>Sign in with browser</b>
                <span>opencode opens its sign-in in a terminal</span>
              </span>
            </button>
            <button type="button" className="oc-method" onClick={() => setKeyMode(true)}>
              <KeyRound className="oc-method__i" size={16} strokeWidth={1.9} aria-hidden />
              <span className="oc-method__b">
                <b>Paste an API key</b>
                <span>enter a key right here</span>
              </span>
            </button>
            <button type="button" className="oc-back" onClick={closeSheet}>‹ Back to vendors</button>
          </>
        )}
      </section>
    );
  }

  // ── Default view: vendor grid (Zen is a tile in it, not a hero) ────────────
  return (
    <section className="oc-connect" aria-label="Connect a model" data-choice-surface="opencode_connect">
      <header className="oc-connect__head">
        <h2 className="oc-connect__title">Connect a model</h2>
        {data?.version ? <span className="oc-connect__ver">opencode {data.version}</span> : null}
      </header>

      <div className="oc-connect__ghead">{data?.manageMode ? "Add a vendor" : "Vendors"}</div>
      <div className="oc-grid">
        {data?.manageMode ? null : (
          // OpenCode Zen sits in the grid at the same level as the vendors — a "Free"
          // (ready) tile, not a hero card. Clicking it uses a free model.
          <button type="button" className="oc-tile" data-free="true" onClick={() => select("use-free-model")}>
            <span className="oc-tile__m" aria-hidden>Z</span>
            <span className="oc-tile__b">
              <span className="oc-tile__n">OpenCode Zen</span>
              <span className="oc-tile__s">
                {data && data.zenFreeCount > 0 ? `Free · ${data.zenFreeCount} models` : "Free models"}
              </span>
            </span>
          </button>
        )}
        {vendors.map((vendor) => {
          // A connected vendor whose auth no longer serves models (e.g. expired token)
          // is clickable again to re-run the sign-in — "Reconnect" instead of a
          // misleading green "Connected" (spec: opencode-vendor-reconnect.md).
          const settled = vendor.connected && !vendor.needsReconnect;
          return (
            <button
              key={vendor.id}
              type="button"
              className="oc-tile"
              data-connected={settled ? "true" : "false"}
              data-reconnect={vendor.needsReconnect ? "true" : undefined}
              disabled={settled}
              onClick={settled ? undefined : () => setSheetVendorId(vendor.id)}
            >
              <span className="oc-tile__m" aria-hidden>{vendor.monogram}</span>
              <span className="oc-tile__b">
                <span className="oc-tile__n">{vendor.label}</span>
                <span className="oc-tile__s">
                  {vendor.needsReconnect ? "Reconnect" : vendor.connected ? "Connected" : "Connect"}
                </span>
              </span>
              {settled ? <Check className="oc-tile__chk" size={14} strokeWidth={2.4} aria-hidden /> : null}
            </button>
          );
        })}
        <button type="button" className="oc-tile oc-tile--add" onClick={() => select("all-providers")}>
          <span className="oc-tile__m" aria-hidden>+</span>
          <span className="oc-tile__b">
            <span className="oc-tile__n">All providers…</span>
            <span className="oc-tile__s">Qwen · Kimi · more</span>
          </span>
        </button>
      </div>

      {data?.manageMode ? (
        <button type="button" className="oc-back" onClick={() => select("back-to-models")}>
          ‹ Back to models
        </button>
      ) : null}
    </section>
  );
}
