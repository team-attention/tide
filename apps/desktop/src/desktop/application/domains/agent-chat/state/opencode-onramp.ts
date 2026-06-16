import type { AgentChatChoiceSurfaceRowView, AgentChatChoiceSurfaceView, AgentChatOpencodeConnectVendorView } from "./types.ts";
import { cliModelOptionsForAgent } from "./agent-vocab.ts";

// State + view builder for the opencode vendor on-ramp (spec: opencode-vendor-onramp.md).
// opencode is a multi-vendor router; this owns the desktop's view of which vendors are
// signed in (from `opencode auth list`, surfaced on thread.listed) and opencode's
// environment, plus the "is opencode usable yet?" gate that decides whether the Model
// chip opens the normal model menu or this on-ramp. Local types mirror the contract
// DTOs (this domain stays isolated from shared/contracts, like the model catalog).

export interface OpencodeOnrampVendor {
  id: string;
  label: string;
  connected: boolean;
  method?: string;
  popular?: boolean;
  // Meaningful only when `connected`: false ⇒ a credential exists but opencode serves
  // no models for it (e.g. expired auth) ⇒ "Reconnect". Absent ⇒ treated as usable.
  usable?: boolean;
}

export interface OpencodeOnrampEnvironment {
  version?: string;
  testedWith?: string;
  executablePath?: string;
}

// Module-level so it survives New-Thread state resets, mirroring the model catalog.
let opencodeVendors: OpencodeOnrampVendor[] = [];
let opencodeEnvironment: OpencodeOnrampEnvironment | null = null;

export function setOpencodeVendors(vendors: OpencodeOnrampVendor[] | null): void {
  opencodeVendors = vendors ?? [];
}

export function getOpencodeVendors(): OpencodeOnrampVendor[] {
  return opencodeVendors;
}

export function setOpencodeEnvironment(environment: OpencodeOnrampEnvironment | null): void {
  opencodeEnvironment = environment;
}

export function getOpencodeEnvironment(): OpencodeOnrampEnvironment | null {
  return opencodeEnvironment;
}

// opencode is usable once at least one vendor is signed in AND not flagged unusable
// (a connected-but-expired credential serves no models), OR its model catalog has a
// concrete model (beyond the "opencode default" sentinel). When NOT usable, the Model
// chip opens the on-ramp instead of an empty model menu.
export function isOpencodeUsable(): boolean {
  if (opencodeVendors.some((vendor) => vendor.connected && vendor.usable !== false)) {
    return true;
  }
  return cliModelOptionsForAgent("opencode").some((model) => model.value !== "opencode default");
}

// Zen's free models are the `opencode/*` (vendor "opencode") rows in the catalog.
function zenFreeModelCount(): number {
  return cliModelOptionsForAgent("opencode").filter((model) => model.vendor === "opencode").length;
}

const MONOGRAMS: Record<string, string> = {
  openai: "O",
  anthropic: "A",
  google: "G",
  "github-copilot": "GH",
  groq: "gq",
  openrouter: "OR",
  xai: "x",
};

export function opencodeVendorMonogram(vendor: { id: string; label: string }): string {
  return MONOGRAMS[vendor.id] ?? vendor.label.slice(0, 2);
}

function vendorRowView(vendor: OpencodeOnrampVendor): AgentChatOpencodeConnectVendorView {
  return {
    rowId: `connect-vendor:${vendor.id}`,
    id: vendor.id,
    label: vendor.label,
    monogram: opencodeVendorMonogram(vendor),
    connected: vendor.connected,
    popular: vendor.popular ?? false,
    // Connected but serving no models (e.g. expired auth) ⇒ the panel offers Reconnect.
    needsReconnect: vendor.connected && vendor.usable === false,
  };
}

// Build the full "opencode_connect" choice surface: the structured panel data plus the
// generic action rows (the row list gates dispatch in selectAgentChatChoiceSurfaceRow).
// `manageMode` = opencode is already usable and the user opened the panel to ADD a
// vendor (so the panel offers "back to models").
export function buildOpencodeConnectSurface(manageMode: boolean): AgentChatChoiceSurfaceView {
  const vendors = opencodeVendors.length > 0 ? opencodeVendors : [];
  const vendorViews = vendors.map(vendorRowView);
  const rows: AgentChatChoiceSurfaceRowView[] = [
    row("use-free-model"),
    ...vendorViews.map((vendor) => row(vendor.rowId)),
    row("all-providers"),
  ];
  if (manageMode) {
    rows.push(row("back-to-models"));
  }
  return {
    surfaceKind: "opencode_connect",
    title: "Connect a model",
    sourceLabel: "opencode",
    rows,
    opencodeConnect: {
      version: opencodeEnvironment?.version,
      zenFreeCount: zenFreeModelCount(),
      connectedCount: vendors.filter((vendor) => vendor.connected).length,
      vendors: vendorViews,
      manageMode,
    },
  };
}

function row(rowId: string): AgentChatChoiceSurfaceRowView {
  return { rowId, label: rowId, icon: "", selected: false, danger: false, disabled: false };
}
