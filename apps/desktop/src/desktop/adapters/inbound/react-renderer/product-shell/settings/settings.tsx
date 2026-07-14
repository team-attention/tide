import { DEFAULT_PRODUCT_SHELL_LIST_SETTINGS, DEFAULT_PRODUCT_SHELL_WORKTREE_SETTINGS, isProductShellAgentIdentity } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { PreferredStartComposer, ProductShellListSettings, ProductShellPinnedItemRef, ProductShellUsageModelView, ProductShellViewModel, ProductShellWorktreeSettings } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { TideThemePreference } from "../../support/theme.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ChangeEvent, ReactElement } from "react";
import { getStoredPref, setStoredPref } from "../../support/ui-prefs-store.ts";
import { buildProvidersHubViewModel } from "../../../../../application/domains/agent-chat/state/providers-hub.ts";
import { X } from "lucide-react";
import { styled } from "styled-components";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export const LIST_SETTINGS_STORAGE_KEY = "tide.listSettings";

// Bumped when a default flips and existing stores should adopt it once. Schema 2
// turns "group worktrees by repo" on by default (worktree-start-experience).
const LIST_SETTINGS_SCHEMA = 2;

// List-display settings are a renderer-local pref (no backend contract); persist
// them in localStorage so the grouping/sort choice survives reloads.
export function loadListSettings(): ProductShellListSettings {
  try {
    const raw = getStoredPref(LIST_SETTINGS_STORAGE_KEY);
    if (raw === null) {
      return { ...DEFAULT_PRODUCT_SHELL_LIST_SETTINGS };
    }
    const { schema, ...parsed } = JSON.parse(raw) as Partial<ProductShellListSettings> & {
      schema?: number;
    };
    const merged = { ...DEFAULT_PRODUCT_SHELL_LIST_SETTINGS, ...parsed };
    // One-time migration: pre-schema-2 stores predate the worktrees-by-repo
    // default, so adopt the new default once. A later user toggle persists
    // schema 2, after which an explicit off choice sticks.
    if ((schema ?? 1) < LIST_SETTINGS_SCHEMA) {
      merged.groupWorktreesByRepo = DEFAULT_PRODUCT_SHELL_LIST_SETTINGS.groupWorktreesByRepo;
    }
    return merged;
  } catch {
    return { ...DEFAULT_PRODUCT_SHELL_LIST_SETTINGS };
  }
}

export function persistListSettings(settings: ProductShellListSettings): void {
  try {
    setStoredPref(
      LIST_SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...settings, schema: LIST_SETTINGS_SCHEMA }),
    );
  } catch {
    // Best-effort; ignore quota/serialization errors.
  }
}

const RAIL_ORDER_STORAGE_KEY = "tide.railOrder";

export interface ProductShellRailOrder {
  pinnedItemOrder: ProductShellPinnedItemRef[];
  projectOrder: string[];
}

// The Left Rail's manual order (pinned items + project folders) is a renderer-local
// pref; persist it so a drag-reorder survives reloads. Spec: left-rail-manual-ordering.
export function loadRailOrder(): ProductShellRailOrder {
  try {
    const raw = getStoredPref(RAIL_ORDER_STORAGE_KEY);
    if (raw === null) {
      return { pinnedItemOrder: [], projectOrder: [] };
    }
    const parsed = JSON.parse(raw) as Partial<ProductShellRailOrder>;
    return {
      pinnedItemOrder: Array.isArray(parsed.pinnedItemOrder) ? parsed.pinnedItemOrder : [],
      projectOrder: Array.isArray(parsed.projectOrder) ? parsed.projectOrder : [],
    };
  } catch {
    return { pinnedItemOrder: [], projectOrder: [] };
  }
}

export function persistRailOrder(order: ProductShellRailOrder): void {
  try {
    setStoredPref(RAIL_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Best-effort; ignore quota/serialization errors.
  }
}

const WORKTREE_SETTINGS_STORAGE_KEY = "tide.worktreeSettings";

const START_COMPOSER_STORAGE_KEY = "tide.startComposerDefaults";

// Remembers the agent + model the user last chose in the Start Composer, so the
// next New Thread defaults to it instead of the built-in Codex default.
export function loadPreferredStartComposer(): PreferredStartComposer | null {
  try {
    const raw = getStoredPref(START_COMPOSER_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PreferredStartComposer>;
    const agentId = parsed.agentId;
    if (!isProductShellAgentIdentity(agentId)) {
      return null;
    }
    return {
      agentId,
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      permission: typeof parsed.permission === "string" ? parsed.permission : undefined,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
      worktree: typeof parsed.worktree === "string" ? parsed.worktree : undefined,
    };
  } catch {
    return null;
  }
}

export function persistPreferredStartComposer(defaults: PreferredStartComposer): void {
  try {
    setStoredPref(START_COMPOSER_STORAGE_KEY, JSON.stringify(defaults));
  } catch {
    // Best-effort.
  }
}

export function loadWorktreeSettings(): ProductShellWorktreeSettings {
  try {
    const raw = getStoredPref(WORKTREE_SETTINGS_STORAGE_KEY);
    if (raw === null) {
      return { ...DEFAULT_PRODUCT_SHELL_WORKTREE_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<ProductShellWorktreeSettings>;
    return {
      baseDirPattern:
        typeof parsed.baseDirPattern === "string" ? parsed.baseDirPattern : "",
      copyFiles: Array.isArray(parsed.copyFiles)
        ? parsed.copyFiles.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
  } catch {
    return { ...DEFAULT_PRODUCT_SHELL_WORKTREE_SETTINGS };
  }
}

export function persistWorktreeSettings(settings: ProductShellWorktreeSettings): void {
  try {
    setStoredPref(WORKTREE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Best-effort.
  }
}

// App Settings modal (centered overlay). Currently hosts worktree creation
// options: the directory pattern and files to copy into a new worktree.
// See docs_v2/specs/worktree-creation.md.
const THEME_OPTIONS: { value: TideThemePreference; label: string; hint: string }[] = [
  { value: "light", label: "Light", hint: "Always light" },
  { value: "dark", label: "Dark", hint: "Always dark" },
  { value: "auto", label: "Auto", hint: "Follow the system (changes by time of day)" },
];

export function createSettingsModal(
  worktree: ProductShellWorktreeSettings,
  theme: TideThemePreference,
  usageByModel: ProductShellUsageModelView[],
  providerInventory: ProductShellViewModel["providerInventory"],
  providerCatalogs: ProductShellViewModel["providerCatalogs"],
  handlers: ProductShellHandlers,
): ReactElement {
  const usageRows = usageByModel;
  const providerRows = buildProvidersHubViewModel({ providerInventory, providerCatalogs });
  return (
    <SettingsBackdrop onMouseDown={handlers.onCloseSettings}>
      <SettingsDialog
        role="dialog"
        aria-label="Settings"
        data-settings-modal="true"
        onMouseDown={(event: { stopPropagation: () => void }) => event.stopPropagation()}
      >
        <SettingsHeader>
          <SettingsTitle>Settings</SettingsTitle>
          <SettingsCloseButton
            type="button"
            aria-label="Close Settings"
            title="Close Settings"
            onClick={handlers.onCloseSettings}
          >
            <X size={16} strokeWidth={1.9} />
          </SettingsCloseButton>
        </SettingsHeader>
        <SettingsSection>
          <SettingsSectionTitle>Appearance</SettingsSectionTitle>
          <ThemePreferenceGroup role="group" aria-label="Theme">
            {THEME_OPTIONS.map((option) => (
              <ThemePreferenceOption
                key={option.value}
                type="button"
                data-active={theme === option.value ? "true" : "false"}
                aria-pressed={theme === option.value}
                title={option.hint}
                onClick={() => handlers.onThemeChange(option.value)}
              >
                <ThemePreferenceLabel>{option.label}</ThemePreferenceLabel>
                <ThemePreferenceHint>{option.hint}</ThemePreferenceHint>
              </ThemePreferenceOption>
            ))}
          </ThemePreferenceGroup>
        </SettingsSection>
        <SettingsSection>
          <SettingsSectionTitle>Worktrees</SettingsSectionTitle>
          <SettingsField>
            <SettingsFieldLabel>Directory pattern</SettingsFieldLabel>
            <SettingsTextInput
              value={worktree.baseDirPattern}
              placeholder="{repo_root}.worktree/{branch}"
              aria-label="Worktree directory pattern"
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                handlers.onWorktreeSettingsChange({ baseDirPattern: event.currentTarget.value })
              }
            />
            <SettingsHint>
              {"Use {repo_root} and {branch}. Empty = default sibling <repo>.worktree/<branch>."}
            </SettingsHint>
          </SettingsField>
          <SettingsField>
            <SettingsFieldLabel>Files to copy</SettingsFieldLabel>
            <SettingsTextarea
              value={worktree.copyFiles.join("\n")}
              placeholder={".env\n.env.local"}
              rows={4}
              aria-label="Files to copy into new worktrees"
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                handlers.onWorktreeSettingsChange({
                  copyFiles: event.currentTarget.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0),
                })
              }
            />
            <SettingsHint>
              Repo-relative paths, one per line, copied into each new worktree.
            </SettingsHint>
          </SettingsField>
        </SettingsSection>
        <SettingsSection>
          <SettingsSectionTitle>Providers &amp; Models</SettingsSectionTitle>
          <ProviderStatusList role="list" aria-label="Providers and models">
            {providerRows.map((agent) => {
              const concreteModels = agent.models.filter((model) => !model.value.endsWith(" default"));
              const vendors = new Set(
                concreteModels.map((model) => model.vendor).filter((vendor): vendor is string => vendor !== undefined),
              );
              const summary = !agent.installed
                ? "Run its CLI to install"
                : agent.connectedVendors !== undefined
                  ? `${agent.connectedVendors} vendor${agent.connectedVendors === 1 ? "" : "s"} signed in · ${concreteModels.length} models${
                      agent.version ? ` · v${agent.version}` : ""
                    }`
                  : agent.multiVendor
                    ? `${vendors.size} vendor${vendors.size === 1 ? "" : "s"} · ${concreteModels.length} models`
                    : `${concreteModels.length} models`;
              return (
                <ProviderStatusRow key={agent.agentId} role="listitem">
                  <ProviderName>{agent.label}</ProviderName>
                  <ProviderInstallStatus
                    data-installed={agent.installed ? "true" : "false"}
                  >
                    {agent.installed ? "Installed" : "Not installed"}
                  </ProviderInstallStatus>
                  <ProviderSummary>{summary}</ProviderSummary>
                </ProviderStatusRow>
              );
            })}
          </ProviderStatusList>
          <SettingsHint>
            Pick a vendor / model / effort per thread from the composer. New to opencode?
            The composer&apos;s <b>Connect a model</b> panel signs you in — it runs opencode&apos;s
            own <code>opencode auth login</code>, so terminal sign-ins carry over automatically.
          </SettingsHint>
        </SettingsSection>
        <SettingsSection>
          <SettingsSectionTitle>Usage remaining</SettingsSectionTitle>
          <UsageRemainingList role="list" aria-label="Usage remaining">
            {usageRows.length > 0 ? (
              usageRows.map((row) => (
                <UsageRemainingRow key={row.key} role="listitem">
                  <UsageIdentity>
                    <UsageAgent>{row.agentLabel}</UsageAgent>
                    <UsageModel>{row.modelLabel}</UsageModel>
                  </UsageIdentity>
                  <SettingsUsageDetails row={row} />
                </UsageRemainingRow>
              ))
            ) : (
              <UsageEmptyState>No usage reported yet.</UsageEmptyState>
            )}
          </UsageRemainingList>
        </SettingsSection>
      </SettingsDialog>
    </SettingsBackdrop>
  );
}

function SettingsUsageDetails({ row }: { row: ProductShellUsageModelView }): ReactElement {
  const windows = row.usage.rateLimits ?? [];
  return (
    <UsageDetails aria-label={`${row.agentLabel} usage remaining`}>
      {windows.map((limit, index) => (
        <SettingsUsageLine
          key={`${limit.label}-${index}`}
          label={settingsWindowLabel(limit.label)}
          value={limit.remainingLabel}
          detail={limit.resetLabel ?? "Reset unknown"}
        />
      ))}
    </UsageDetails>
  );
}

function SettingsUsageLine({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}): ReactElement {
  return (
    <UsageLine
      aria-label={`${label} ${value}${detail ? ` ${detail}` : ""}`}
    >
      <UsageLineLabel>{label}</UsageLineLabel>
      <UsageLineValue>{value}</UsageLineValue>
      {detail ? <UsageLineDetail>{detail}</UsageLineDetail> : null}
    </UsageLine>
  );
}

function settingsWindowLabel(label: string): string {
  const normalized = label.trim().toLowerCase();
  if (normalized === "weekly" || normalized === "1 week") {
    return "Weekly";
  }
  if (normalized.endsWith("window")) {
    return label.replace(/\s*window\s*$/i, "");
  }
  return label;
}

const SettingsBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.28);
  animation: tide-overlay-in 0.12s ease;
`;

const SettingsDialog = styled.div`
  width: min(660px, calc(100vw - 48px));
  max-height: calc(100vh - 96px);
  overflow-y: auto;
  padding: 18px 20px 22px;
  border: 1px solid var(--tide-line);
  border-radius: 10px;
  background: var(--tide-surface, #fff);
  box-shadow: 0 14px 38px rgba(0, 0, 0, 0.16);
  animation: tide-modal-in 0.16s ease;
`;

const SettingsHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
`;

const SettingsTitle = styled.h2`
  margin: 0;
  font-size: 16px;
  font-weight: 670;
`;

const SettingsCloseButton = styled.button`
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;

  &:hover {
    background: color-mix(in srgb, var(--tide-muted) 14%, transparent);
    color: var(--tide-text);
  }
`;

const SettingsSection = styled.section`
  padding-top: 2px;

  & + & {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid color-mix(in srgb, var(--tide-line) 70%, transparent);
  }
`;

const SettingsSectionTitle = styled.h3`
  margin: 0 0 10px;
  color: var(--tide-muted);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0;
  text-transform: uppercase;
`;

const SettingsField = styled.label`
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 16px;
`;

const SettingsFieldLabel = styled.span`
  color: var(--tide-text);
  font-size: 13px;
  font-weight: 550;
`;

const settingsTextControl = `
  width: 100%;
  padding: 7px 9px;
  border: 1px solid var(--tide-line);
  border-radius: 8px;
  outline: none;
  resize: vertical;
  background: transparent;
  color: var(--tide-text);
  font-family: var(--tide-mono, ui-monospace, monospace);
  font-size: 13px;

  &:focus {
    border-color: color-mix(in srgb, var(--tide-action) 55%, var(--tide-line));
  }
`;

const SettingsTextInput = styled.input`
  ${settingsTextControl}
`;

const SettingsTextarea = styled.textarea`
  ${settingsTextControl}
`;

const SettingsHint = styled.span`
  color: var(--tide-muted);
  font-size: 11.5px;
`;

const ThemePreferenceGroup = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 0;

  @media (max-width: 720px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const ThemePreferenceOption = styled.button`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 10px 11px;
  border: 1px solid var(--tide-line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--tide-bg) 42%, transparent);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease;

  &:hover {
    background: color-mix(in srgb, var(--tide-selection) 88%, transparent);
  }

  &[data-active="true"] {
    border-color: color-mix(in srgb, var(--tide-action) 48%, var(--tide-line));
    background: color-mix(in srgb, var(--tide-selection) 82%, var(--tide-bg));
  }
`;

const ThemePreferenceLabel = styled.span`
  color: var(--tide-text);
  font-size: 13px;
  font-weight: 600;
`;

const ThemePreferenceHint = styled.span`
  color: var(--tide-muted);
  font-size: 11px;
  line-height: 1.35;
`;

const ProviderStatusList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
  margin-bottom: 10px;
  border: 1px solid color-mix(in srgb, var(--tide-line) 84%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--tide-bg) 34%, transparent);
`;

const ProviderStatusRow = styled.div`
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-top: 1px solid color-mix(in srgb, var(--tide-line) 72%, transparent);
  background: transparent;

  &:first-child {
    border-top: 0;
  }

  @media (max-width: 720px) {
    grid-template-columns: minmax(0, 1fr) auto;
  }
`;

const ProviderName = styled.span`
  color: var(--tide-text);
  font-size: 13px;
  font-weight: 600;
`;

const ProviderInstallStatus = styled.span`
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--tide-muted) 16%, transparent);
  color: var(--tide-muted);
  font-size: 11px;
  font-weight: 600;

  &[data-installed="true"] {
    background: color-mix(in srgb, #1a8f4a 16%, transparent);
    color: color-mix(in srgb, var(--tide-text) 80%, #1a8f4a);
  }
`;

const ProviderSummary = styled.span`
  color: var(--tide-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;

  @media (max-width: 720px) {
    grid-column: 1 / -1;
  }
`;

const UsageRemainingList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
  margin-bottom: 8px;
  border: 1px solid color-mix(in srgb, var(--tide-line) 84%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--tide-bg) 34%, transparent);
`;

const UsageRemainingRow = styled.div`
  display: grid;
  grid-template-columns: minmax(148px, 0.36fr) minmax(0, 1fr);
  align-items: start;
  gap: 16px;
  padding: 9px 10px 10px;
  border-top: 1px solid color-mix(in srgb, var(--tide-line) 72%, transparent);
  background: transparent;

  &:first-child {
    border-top: 0;
  }

  @media (max-width: 720px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const UsageIdentity = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const UsageAgent = styled.span`
  color: var(--tide-muted);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0;
  text-transform: uppercase;
`;

const UsageModel = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--tide-text);
  font-size: 13px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const UsageDetails = styled.div`
  min-width: 0;
  display: grid;
  gap: 4px;
`;

const UsageLine = styled.div`
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 52px minmax(58px, max-content);
  align-items: baseline;
  gap: 12px;

  @media (max-width: 720px) {
    grid-template-columns: minmax(0, 1fr);
    gap: 3px;
  }
`;

const UsageLineLabel = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--tide-text);
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const UsageLineValue = styled.span`
  color: var(--tide-text);
  font-size: 13.5px;
  font-weight: 680;
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;

  @media (max-width: 720px) {
    text-align: left;
  }
`;

const UsageLineDetail = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--tide-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;

  @media (max-width: 720px) {
    text-align: left;
  }
`;

const UsageEmptyState = styled.div`
  padding: 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--tide-muted);
  font-size: 12.5px;
`;
