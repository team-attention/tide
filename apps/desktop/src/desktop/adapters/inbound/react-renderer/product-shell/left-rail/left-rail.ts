import type { ProductShellLeftRailMenu, ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { MenuAnchorRect, ProductShellHandlers } from "../support/types.ts";
import { createElement } from "react";
import type { ReactElement } from "react";
import { createColumnResizeHandle, createIconButton, createTrafficControls } from "../chrome/chrome.ts";
import { createLeftRailContextMenuOverlay } from "./context-menu.ts";
import { MessageSquarePlus, PanelLeftClose, Search, Settings } from "lucide-react";
import { createLeftNavRow, createListSettingsButton } from "./section-header.ts";
import { createRailSkeleton } from "./skeletons.ts";
import { createPinnedSection } from "./pinned-section.ts";
import { createThreadSection } from "./thread-section.ts";
import { createProjectSection } from "./project-section.ts";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export function createLeftRail(
  viewModel: ProductShellViewModel,
  handlers: ProductShellHandlers,
  contextMenu: { menu: ProductShellLeftRailMenu | null; anchor: MenuAnchorRect | null },
): ReactElement {
  return createElement(
    "aside",
    { className: "left-rail", "aria-label": "Left Rail", "data-column": "left-rail" },
    createColumnResizeHandle("left", "right", handlers),
    contextMenu.menu
      ? createLeftRailContextMenuOverlay(
          contextMenu.menu,
          contextMenu.anchor ?? { left: 12, top: 120, bottom: 150, right: 256 },
          () => handlers.onLeftRailMenuOpen(null),
          handlers,
          viewModel.listSettings,
        )
      : null,
    createElement(
      "header",
      { className: "left-rail__top-row column-top-row", "aria-label": "Left Rail Top Row" },
      createTrafficControls(),
      createIconButton(
        "Close Left Rail",
        createElement(PanelLeftClose, { size: 15, strokeWidth: 1.9 }),
        handlers.onLeftRailToggle,
        "top-row-button",
      ),
    ),
    createElement(
      "nav",
      { className: "left-rail__nav", "aria-label": "Left Rail actions" },
      createLeftNavRow("New thread", createElement(MessageSquarePlus, { size: 16, strokeWidth: 1.9 }), handlers.onNewThread),
      createElement(
        "div",
        { className: "left-rail__search-row" },
        viewModel.searchActive
          ? createElement(
              "div",
              { className: "left-rail-search" },
              createElement(Search, { size: 16, strokeWidth: 1.9, "aria-hidden": true }),
              createElement("input", {
                className: "left-rail-search__input",
                type: "search",
                "aria-label": "Search threads",
                placeholder: "Search",
                autoFocus: true,
                value: viewModel.searchQuery,
                onChange: (event: { currentTarget: { value: string } }) =>
                  handlers.onSearchQueryChange(event.currentTarget.value),
                onKeyDown: (event: { key: string }) => {
                  if (event.key === "Escape") {
                    handlers.onSearchToggle();
                  }
                },
              }),
            )
          : createLeftNavRow("Search", createElement(Search, { size: 16, strokeWidth: 1.9 }), handlers.onSearchToggle),
        createListSettingsButton(handlers),
      ),
    ),
    createElement(
      "div",
      { className: "left-rail__sections" },
      ...(!viewModel.threadsLoaded
        ? [createRailSkeleton()]
        : viewModel.listSettings.groupBy === "thread"
        ? [
            // Thread mode still surfaces pinned threads in a Pinned section (no
            // project groups); the flat list then excludes them to avoid dupes.
            createPinnedSection([], viewModel.pinnedThreads, handlers),
            createThreadSection(
              "Threads",
              viewModel.flatThreads.filter((thread) => !thread.pinned),
              handlers,
            ),
          ]
        : [
            createPinnedSection(viewModel.pinnedProjects, viewModel.pinnedThreads, handlers),
            createProjectSection(viewModel.projectGroups, handlers),
            createThreadSection("Scratch", viewModel.scratchThreads, handlers),
          ]),
    ),
    createElement(
      "div",
      { className: "left-rail__footer" },
      createLeftNavRow(
        "Settings",
        createElement(Settings, { size: 16, strokeWidth: 1.9 }),
        handlers.onOpenSettings,
      ),
    ),
  );
}
