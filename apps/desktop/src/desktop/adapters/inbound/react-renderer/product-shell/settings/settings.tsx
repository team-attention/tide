import { DEFAULT_PRODUCT_SHELL_LIST_SETTINGS, DEFAULT_PRODUCT_SHELL_WORKTREE_SETTINGS } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { PreferredStartComposer, ProductShellListSettings, ProductShellWorktreeSettings } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { TideThemePreference } from "../../support/theme.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ChangeEvent, ReactElement } from "react";
import { createIconButton } from "../chrome/chrome.tsx";
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
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_PRODUCT_SHELL_LIST_SETTINGS };
  }
  try {
    const raw = localStorage.getItem(LIST_SETTINGS_STORAGE_KEY);
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
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(
      LIST_SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...settings, schema: LIST_SETTINGS_SCHEMA }),
    );
  } catch {
    // Best-effort; ignore quota/serialization errors.
  }
}

const WORKTREE_SETTINGS_STORAGE_KEY = "tide.worktreeSettings";

const START_COMPOSER_STORAGE_KEY = "tide.startComposerDefaults";

// Remembers the agent + model the user last chose in the Start Composer, so the
// next New Thread defaults to it instead of always codex/gpt-5.5.
export function loadPreferredStartComposer(): PreferredStartComposer | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    const raw = localStorage.getItem(START_COMPOSER_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PreferredStartComposer>;
    const agentId = parsed.agentId;
    if (agentId !== "codex" && agentId !== "claude" && agentId !== "openai_api") {
      return null;
    }
    return {
      agentId,
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      permission: typeof parsed.permission === "string" ? parsed.permission : undefined,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
    };
  } catch {
    return null;
  }
}

export function persistPreferredStartComposer(defaults: PreferredStartComposer): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(START_COMPOSER_STORAGE_KEY, JSON.stringify(defaults));
  } catch {
    // Best-effort.
  }
}

export function loadWorktreeSettings(): ProductShellWorktreeSettings {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_PRODUCT_SHELL_WORKTREE_SETTINGS };
  }
  try {
    const raw = localStorage.getItem(WORKTREE_SETTINGS_STORAGE_KEY);
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
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(WORKTREE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
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
  handlers: ProductShellHandlers,
): ReactElement {
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
              const summary = agent.installed
                ? agent.multiVendor
                  ? `${vendors.size} vendor${vendors.size === 1 ? "" : "s"} · ${concreteModels.length} models`
                  : `${concreteModels.length} models`
                : "Run its CLI to install";
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
            Pick a vendor / model / effort per thread from the composer. opencode adds
            vendors via <code>opencode auth login</code>.
          </span>
        </section>
      </div>
    </div>
  );
}
