import type { ProductShellHandlers } from "../types.ts";
import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { createIconButton, menuAnchorFromEvent } from "../chrome.ts";
import { Check, ChevronRight, Plus, SlidersHorizontal } from "lucide-react";
import type { ProductShellListSettings } from "../../../../../application/domains/product-shell/product-shell-state.ts";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// A single icon button (sits inline at the right of the Search row) that opens
// the list-display settings dropdown (group + sort). See
// docs_v2/specs/thread-list-display-settings.md.
export function createListSettingsButton(handlers: ProductShellHandlers): ReactElement {
  return createElement(
    "button",
    {
      type: "button",
      className: "list-settings-bar__button",
      title: "List display settings",
      "aria-label": "List display settings",
      onClick: (event: { currentTarget: HTMLElement }) =>
        handlers.onLeftRailMenuOpen({ kind: "list_settings" }, menuAnchorFromEvent(event)),
    },
    createElement(SlidersHorizontal, { size: 15, strokeWidth: 1.9, "aria-hidden": true }),
  );
}

// The list-display settings dropdown content (Group by / Sort by), rendered in
// the shared Left Rail menu overlay with a check on the active option.
export function createListSettingsMenu(
  settings: ProductShellListSettings,
  handlers: ProductShellHandlers,
): ReactElement {
  const close = () => handlers.onLeftRailMenuOpen(null);
  const optionRow = (
    label: string,
    selected: boolean,
    onPick: () => void,
  ): ReactElement =>
    createElement(
      "button",
      {
        key: label,
        type: "button",
        className: "left-rail-context-menu__item",
        onClick: () => {
          onPick();
          close();
        },
      },
      createElement(
        "span",
        { className: "left-rail-context-menu__icon", "aria-hidden": true },
        selected ? createElement(Check, { size: 14, strokeWidth: 2 }) : null,
      ),
      createElement("span", null, label),
    );

  const sectionLabel = (text: string): ReactElement =>
    createElement("div", { key: `label-${text}`, className: "left-rail-context-menu__label" }, text);

  return createElement(
    "div",
    { className: "left-rail-context-menu left-rail-context-menu--list_settings" },
    sectionLabel("Group by"),
    optionRow("By project", settings.groupBy === "project", () =>
      handlers.onListSettingsChange({ groupBy: "project" }),
    ),
    optionRow("By thread", settings.groupBy === "thread", () =>
      handlers.onListSettingsChange({ groupBy: "thread" }),
    ),
    sectionLabel("Sort by"),
    optionRow("Recent activity", settings.sortBy === "recent", () =>
      handlers.onListSettingsChange({ sortBy: "recent" }),
    ),
    optionRow("Created", settings.sortBy === "created", () =>
      handlers.onListSettingsChange({ sortBy: "created" }),
    ),
    optionRow("Name", settings.sortBy === "name", () =>
      handlers.onListSettingsChange({ sortBy: "name" }),
    ),
    // Worktree grouping only applies to project mode (no project groups in thread mode).
    ...(settings.groupBy === "project"
      ? [
          sectionLabel("Worktrees"),
          optionRow("Group under repo", settings.groupWorktreesByRepo, () =>
            handlers.onListSettingsChange({
              groupWorktreesByRepo: !settings.groupWorktreesByRepo,
            }),
          ),
        ]
      : []),
    sectionLabel("Sessions"),
    // Off by default: the list shows only Threads started in Tide. On reveals
    // External Sessions (agent history Tide did not start).
    optionRow("Show external sessions", settings.showExternalSessions, () =>
      handlers.onListSettingsChange({
        showExternalSessions: !settings.showExternalSessions,
      }),
    ),
  );
}

export function createLeftNavRow(label: string, icon: ReactNode, onClick?: () => void): ReactElement {
  return createElement(
    "button",
    { className: "left-rail-nav-row", type: "button", onClick },
    icon,
    createElement("span", null, label),
  );
}

export function createSectionHeader(
  title: string,
  itemCount: number,
  collapsed: boolean,
  onToggle: () => void,
  action?: { label: string; onClick: () => void },
): ReactElement {
  // Collapsible only when there are items below; otherwise a static label.
  const toggle =
    itemCount === 0
      ? createElement("span", { className: "left-rail-section__title" }, title)
      : createElement(
          "button",
          {
            type: "button",
            className: `left-rail-section__toggle${collapsed ? " left-rail-section__toggle--collapsed" : ""}`,
            "aria-expanded": !collapsed,
            onClick: onToggle,
          },
          createElement(ChevronRight, {
            size: 12,
            strokeWidth: 2.2,
            className: "left-rail-section__chevron",
            "aria-hidden": true,
          }),
          createElement("span", { className: "left-rail-section__title" }, title),
        );
  return createElement(
    "div",
    { className: "left-rail-section__header" },
    toggle,
    action
      ? createIconButton(
          action.label,
          createElement(Plus, { size: 15, strokeWidth: 2 }),
          action.onClick,
          "left-rail-section__action",
        )
      : null,
  );
}
