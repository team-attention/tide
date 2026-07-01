import { DEFAULT_PRODUCT_SHELL_LIST_SETTINGS, DEFAULT_PRODUCT_SHELL_WORKTREE_SETTINGS, isProductShellAgentIdentity } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { PreferredStartComposer, ProductShellListSettings, ProductShellPinnedItemRef, ProductShellUsageModelView, ProductShellWorktreeSettings } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { TideThemePreference } from "../../support/theme.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ChangeEvent, ReactElement } from "react";
import { createIconButton } from "../chrome/chrome.tsx";
import { getStoredPref, setStoredPref } from "../../support/ui-prefs-store.ts";
import { buildProvidersHubViewModel } from "../../../../../application/domains/agent-chat/state/providers-hub.ts";
import { X } from "lucide-react";
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
// next New Thread defaults to it instead of always codex/gpt-5.5.
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
  handlers: ProductShellHandlers,
): ReactElement {
  const usageWindowRows = usageByModel.filter((row) => (row.usage.rateLimits?.length ?? 0) > 0);
  return (
    <div className="settings-modal-backdrop" onMouseDown={handlers.onCloseSettings}>
      <div
        className="settings-modal"
        role="dialog"
        aria-label="Settings"
        onMouseDown={(event: { stopPropagation: () => void }) => event.stopPropagation()}
      >
        <header className="settings-modal__header">
          <h2>Settings</h2>
          {createIconButton(
            "Close Settings",
            <X size={16} strokeWidth={1.9} />,
            handlers.onCloseSettings,
            "settings-modal__close",
          )}
        </header>
        <section className="settings-modal__section">
          <h3 className="settings-modal__section-title">Appearance</h3>
          <div className="settings-theme" role="group" aria-label="Theme">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="settings-theme__option"
                data-active={theme === option.value ? "true" : "false"}
                aria-pressed={theme === option.value}
                title={option.hint}
                onClick={() => handlers.onThemeChange(option.value)}
              >
                <span className="settings-theme__label">{option.label}</span>
                <span className="settings-theme__hint">{option.hint}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="settings-modal__section">
          <h3 className="settings-modal__section-title">Worktrees</h3>
          <label className="settings-modal__field">
            <span className="settings-modal__label">Directory pattern</span>
            <input
              className="settings-modal__input"
              value={worktree.baseDirPattern}
              placeholder="{repo_root}.worktree/{branch}"
              aria-label="Worktree directory pattern"
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                handlers.onWorktreeSettingsChange({ baseDirPattern: event.currentTarget.value })
              }
            />
            <span className="settings-modal__hint">
              {"Use {repo_root} and {branch}. Empty = default sibling <repo>.worktree/<branch>."}
            </span>
          </label>
          <label className="settings-modal__field">
            <span className="settings-modal__label">Files to copy</span>
            <textarea
              className="settings-modal__textarea"
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
            <span className="settings-modal__hint">
              Repo-relative paths, one per line, copied into each new worktree.
            </span>
          </label>
        </section>
        <section className="settings-modal__section">
          <h3 className="settings-modal__section-title">Providers &amp; Models</h3>
          <div className="settings-providers" role="list" aria-label="Providers and models">
            {buildProvidersHubViewModel().map((agent) => {
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
                <div key={agent.agentId} className="settings-providers__row" role="listitem">
                  <span className="settings-providers__name">{agent.label}</span>
                  <span
                    className="settings-providers__status"
                    data-installed={agent.installed ? "true" : "false"}
                  >
                    {agent.installed ? "Installed" : "Not installed"}
                  </span>
                  <span className="settings-providers__summary">{summary}</span>
                </div>
              );
            })}
          </div>
          <span className="settings-modal__hint">
            Pick a vendor / model / effort per thread from the composer. New to opencode?
            The composer&apos;s <b>Connect a model</b> panel signs you in — it runs opencode&apos;s
            own <code>opencode auth login</code>, so terminal sign-ins carry over automatically.
          </span>
        </section>
        <section className="settings-modal__section">
          <h3 className="settings-modal__section-title">Usage</h3>
          <div className="settings-usage" role="list" aria-label="Provider window usage">
            {usageWindowRows.length > 0 ? (
              usageWindowRows.map((row) => (
                <div key={row.key} className="settings-usage__row" role="listitem">
                  <div className="settings-usage__identity">
                    <span className="settings-usage__agent">{row.agentLabel}</span>
                    <span className="settings-usage__model">{row.modelLabel}</span>
                  </div>
                  <SettingsUsageWindows row={row} />
                </div>
              ))
            ) : (
              <div className="settings-usage__empty">No provider window usage reported yet.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function SettingsUsageWindows({ row }: { row: ProductShellUsageModelView }): ReactElement {
  const windows = row.usage.rateLimits ?? [];
  return (
    <div className="settings-usage__windows" aria-label={`${row.agentLabel} quota windows`}>
      {windows.map((limit, index) => {
        const usedPercent = limit.usedPercent;
        return (
          <div
            key={`${limit.label}-${index}`}
            className="settings-usage-window"
            data-usage-tone={settingsUsageTone(usedPercent)}
            aria-label={`${settingsWindowLabel(limit.label)} ${limit.usedLabel} used${
              limit.resetLabel ? `, resets ${limit.resetLabel}` : ""
            }`}
          >
            <div className="settings-usage-window__head">
              <span className="settings-usage-window__name">{settingsWindowLabel(limit.label)}</span>
              <span className="settings-usage-window__value">{limit.usedLabel}</span>
            </div>
            <span className="settings-usage-window__bar" aria-hidden>
              <span
                className="settings-usage-window__bar-fill"
                style={{ width: `${Math.max(2, Math.min(100, usedPercent))}%` }}
              />
            </span>
            <div className="settings-usage-window__meta">
              <span>used</span>
              <span>{limit.resetLabel ? `Resets ${limit.resetLabel}` : "Reset unknown"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function settingsWindowLabel(label: string): string {
  const normalized = label.trim().toLowerCase();
  if (normalized === "weekly" || normalized === "1 week") {
    return "1 week window";
  }
  if (normalized.endsWith("window")) {
    return label;
  }
  return `${label} window`;
}

function settingsUsageTone(usedPercent: number): "ok" | "warn" | "critical" {
  if (usedPercent >= 90) {
    return "critical";
  }
  if (usedPercent >= 75) {
    return "warn";
  }
  return "ok";
}
