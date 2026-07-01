import type { ProductShellLeftRailMenu, ProductShellLeftRailViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { MenuAnchorRect, ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { createColumnResizeHandle, createIconButton, createTrafficControls } from "../chrome/chrome.tsx";
import { createLeftRailContextMenuOverlay } from "./context-menu.tsx";
import { MessageSquarePlus, PanelLeftClose, Search, Settings, X } from "lucide-react";
import { createLeftNavRow } from "./section-header.tsx";
import { createRailSkeleton } from "./skeletons.tsx";
import { createPinnedSection } from "./pinned-section.tsx";
import { createThreadSection } from "./thread-section.tsx";
import { createProjectSection } from "./project-section.tsx";
import { AppUpdateButton } from "../support/app-update-pill.tsx";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export function createLeftRail(
  viewModel: ProductShellLeftRailViewModel,
  handlers: ProductShellHandlers,
  contextMenu: { menu: ProductShellLeftRailMenu | null; anchor: MenuAnchorRect | null },
): ReactElement {
  return (
    <aside className="left-rail" aria-label="Left Rail" data-column="left-rail">
      {createColumnResizeHandle("left", "right", handlers)}
      {contextMenu.menu
        ? createLeftRailContextMenuOverlay(
            contextMenu.menu,
            contextMenu.anchor ?? { left: 12, top: 120, bottom: 150, right: 256 },
            () => handlers.onLeftRailMenuOpen(null),
            handlers,
            viewModel.listSettings,
          )
        : null}
      <header className="left-rail__top-row column-top-row" aria-label="Left Rail Top Row">
        {createTrafficControls()}
        {createIconButton(
          "Close Left Rail",
          <PanelLeftClose size={15} strokeWidth={1.9} />,
          handlers.onLeftRailToggle,
          "top-row-button",
        )}
        <AppUpdateButton />
      </header>
      <nav className="left-rail__nav" aria-label="Left Rail actions">
        {createLeftNavRow("New thread", <MessageSquarePlus size={16} strokeWidth={1.9} />, handlers.onNewThread)}
        <div className="left-rail-search">
          <Search size={15} strokeWidth={1.9} aria-hidden />
          <input
            className="left-rail-search__input"
            type="search"
            aria-label="Search threads"
            placeholder="Search threads"
            value={viewModel.searchQuery}
            onFocus={() => {
              if (!viewModel.searchActive) {
                handlers.onSearchToggle();
              }
            }}
            onChange={(event: { currentTarget: { value: string } }) =>
              handlers.onSearchQueryChange(event.currentTarget.value)
            }
            onKeyDown={(event: { key: string; currentTarget: { blur: () => void } }) => {
              if (event.key === "Escape") {
                if (viewModel.searchQuery.length > 0) {
                  handlers.onSearchQueryChange("");
                  return;
                }
                if (viewModel.searchActive) {
                  handlers.onSearchToggle();
                }
                event.currentTarget.blur();
              }
            }}
          />
          {viewModel.searchQuery.length > 0 ? (
            <button
              className="left-rail-search__clear"
              type="button"
              aria-label="Clear thread search"
              onClick={() => handlers.onSearchQueryChange("")}
            >
              <X size={13} strokeWidth={2} aria-hidden />
            </button>
          ) : null}
        </div>
      </nav>
      <div className="left-rail__sections">
        {!viewModel.threadsLoaded ? (
          createRailSkeleton()
        ) : viewModel.listSettings.groupBy === "thread" ? (
          <>
            {/* Thread mode surfaces pinned THREADS only (no project groups); the flat
                list then excludes them to avoid dupes. */}
            {createPinnedSection(
              viewModel.pinnedItems.filter((item) => item.kind === "thread"),
              handlers,
            )}
            {createThreadSection(
              "Threads",
              viewModel.flatThreads.filter((thread) => !thread.pinned),
              handlers,
            )}
          </>
        ) : (
          <>
            {createPinnedSection(viewModel.pinnedItems, handlers)}
            {createProjectSection(viewModel.projectGroups, handlers)}
            {createThreadSection("Chats", viewModel.scratchThreads, handlers)}
          </>
        )}
      </div>
      <div className="left-rail__footer">
        {createLeftNavRow("Settings", <Settings size={16} strokeWidth={1.9} />, handlers.onOpenSettings)}
      </div>
    </aside>
  );
}
