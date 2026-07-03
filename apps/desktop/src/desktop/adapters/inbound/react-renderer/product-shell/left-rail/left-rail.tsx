import type { ProductShellLeftRailMenu, ProductShellLeftRailViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { MenuAnchorRect, ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { styled } from "styled-components";
import { createColumnResizeHandle, createTrafficControls } from "../chrome/chrome.tsx";
import { createLeftRailContextMenuOverlay } from "./context-menu.tsx";
import { MessageSquarePlus, PanelLeftClose, Search, Settings, X } from "lucide-react";
import { createLeftNavRow } from "./section-header.tsx";
import { createRailSkeleton } from "./skeletons.tsx";
import { createPinnedSection } from "./pinned-section.tsx";
import { createThreadSection } from "./thread-section.tsx";
import { createProjectSection } from "./project-section.tsx";
import { AppUpdateButton } from "../support/app-update-pill.tsx";
import { ColumnTopRow, TopRowButton } from "../support/column-top-row.parts.tsx";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export function createLeftRail(
  viewModel: ProductShellLeftRailViewModel,
  handlers: ProductShellHandlers,
  contextMenu: { menu: ProductShellLeftRailMenu | null; anchor: MenuAnchorRect | null },
): ReactElement {
  return (
    <LeftRailColumn aria-label="Left Rail" data-column="left-rail">
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
      <LeftRailTopRow aria-label="Left Rail Top Row">
        {createTrafficControls()}
        <TopRowButton type="button" title="Close Left Rail" aria-label="Close Left Rail" onClick={handlers.onLeftRailToggle}>
          <PanelLeftClose size={15} strokeWidth={1.9} aria-hidden />
        </TopRowButton>
        <AppUpdateButton />
      </LeftRailTopRow>
      <LeftRailNav aria-label="Left Rail actions">
        {createLeftNavRow("New thread", <MessageSquarePlus size={16} strokeWidth={1.9} />, handlers.onNewThread)}
        <LeftRailSearch>
          <Search size={15} strokeWidth={1.9} aria-hidden />
          <LeftRailSearchInput
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
            <LeftRailSearchClear
              type="button"
              aria-label="Clear thread search"
              onMouseDown={(event: { preventDefault: () => void }) => event.preventDefault()}
              onClick={() => handlers.onSearchQueryChange("")}
            >
              <X size={13} strokeWidth={2} aria-hidden />
            </LeftRailSearchClear>
          ) : null}
        </LeftRailSearch>
      </LeftRailNav>
      <LeftRailSections>
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
      </LeftRailSections>
      <LeftRailFooter>
        {createLeftNavRow("Settings", <Settings size={16} strokeWidth={1.9} />, handlers.onOpenSettings)}
      </LeftRailFooter>
    </LeftRailColumn>
  );
}

const LeftRailColumn = styled.aside`
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 18px;
  border-right: 1px solid var(--tide-line);
  background: var(--tide-surface);
`;

const LeftRailTopRow = styled(ColumnTopRow)`
  justify-content: flex-start;
  gap: 18px;
  padding: 0 10px 0 16px;
  background: var(--tide-surface);

  .tide-fullscreen & {
    padding-left: 12px;
  }
`;

const LeftRailNav = styled.nav`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 10px;
`;

const LeftRailSections = styled.div`
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const LeftRailFooter = styled.div`
  flex: 0 0 auto;
  padding: 0 10px 6px;
`;

const LeftRailSearch = styled.div`
  width: 100%;
  height: 30px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 8px;
  padding: 0 8px;
  background: color-mix(in srgb, var(--tide-selection) 58%, transparent);
  color: var(--tide-muted);
  transition: background-color 0.12s ease, box-shadow 0.12s ease;

  &:hover,
  &:focus-within {
    background: var(--tide-selection);
  }

  &:focus-within {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tide-action) 18%, transparent);
  }
`;

const LeftRailSearchInput = styled.input`
  min-width: 0;
  flex: 1 1 auto;
  border: 0;
  background: transparent;
  color: var(--tide-text);
  font: inherit;

  &::placeholder {
    color: var(--tide-muted);
  }

  &:focus {
    outline: none;
  }
`;

const LeftRailSearchClear = styled.button`
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, var(--tide-muted) 14%, transparent);
    color: var(--tide-text);
  }
`;
