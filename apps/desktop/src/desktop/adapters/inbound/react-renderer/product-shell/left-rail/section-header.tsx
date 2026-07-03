import type { ProductShellHandlers } from "../support/types.ts";
import type { ReactElement, ReactNode } from "react";
import { styled } from "styled-components";
import { menuAnchorFromEvent } from "../chrome/chrome.tsx";
import { Check, ChevronRight, Plus, SlidersHorizontal } from "lucide-react";
import type { ProductShellListSettings } from "../../../../../application/domains/product-shell/product-shell.ts";
import {
  FloatingMenuIcon,
  FloatingMenuItem,
  FloatingMenuSectionLabel,
  FloatingMenuSurface,
} from "../support/floating-menu.parts.tsx";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// A single icon button (sits inline at the right of the Search row) that opens
// the list-display settings dropdown (group + sort). See
// docs_v2/specs/thread-list-display-settings.md.
export function createListSettingsButton(handlers: ProductShellHandlers): ReactElement {
  return (
    <ListSettingsTrigger
      type="button"
      title="List display settings"
      aria-label="List display settings"
      data-list-settings-button
      onClick={(event: { currentTarget: HTMLElement }) =>
        handlers.onLeftRailMenuOpen({ kind: "list_settings" }, menuAnchorFromEvent(event))
      }
    >
      <SlidersHorizontal size={15} strokeWidth={1.9} aria-hidden />
    </ListSettingsTrigger>
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
  ): ReactElement => (
    <FloatingMenuItem
      key={label}
      type="button"
      data-left-rail-menu-item={label}
      onClick={() => {
        onPick();
        close();
      }}
    >
      <FloatingMenuIcon aria-hidden>
        {selected ? <Check size={14} strokeWidth={2} /> : null}
      </FloatingMenuIcon>
      <span>{label}</span>
    </FloatingMenuItem>
  );

  const sectionLabel = (text: string): ReactElement => (
    <FloatingMenuSectionLabel key={`label-${text}`}>
      {text}
    </FloatingMenuSectionLabel>
  );

  return (
    <FloatingMenuSurface $kind="list_settings" data-left-rail-menu-kind="list_settings">
      {sectionLabel("Group by")}
      {optionRow("By project", settings.groupBy === "project", () =>
        handlers.onListSettingsChange({ groupBy: "project" }),
      )}
      {optionRow("By thread", settings.groupBy === "thread", () =>
        handlers.onListSettingsChange({ groupBy: "thread" }),
      )}
      {sectionLabel("Sort by")}
      {optionRow("Recent activity", settings.sortBy === "recent", () =>
        handlers.onListSettingsChange({ sortBy: "recent" }),
      )}
      {optionRow("Created", settings.sortBy === "created", () =>
        handlers.onListSettingsChange({ sortBy: "created" }),
      )}
      {optionRow("Name", settings.sortBy === "name", () =>
        handlers.onListSettingsChange({ sortBy: "name" }),
      )}
      {/* Worktree grouping only applies to project mode (no project groups in thread mode). */}
      {settings.groupBy === "project" ? (
        <>
          {sectionLabel("Worktrees")}
          {optionRow("Group under repo", settings.groupWorktreesByRepo, () =>
            handlers.onListSettingsChange({ groupWorktreesByRepo: !settings.groupWorktreesByRepo }),
          )}
        </>
      ) : null}
      {sectionLabel("Sessions")}
      {/* Off by default: the list shows only Threads started in Tide. On reveals
          External Sessions (agent history Tide did not start). */}
      {optionRow("Show external sessions", settings.showExternalSessions, () =>
        handlers.onListSettingsChange({ showExternalSessions: !settings.showExternalSessions }),
      )}
    </FloatingMenuSurface>
  );
}

export function createLeftNavRow(label: string, icon: ReactNode, onClick?: () => void): ReactElement {
  return (
    <LeftRailNavRow type="button" data-left-nav-row={leftRailNavRowKey(label)} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </LeftRailNavRow>
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
    itemCount === 0 ? (
      <SectionTitle>{title}</SectionTitle>
    ) : (
      <SectionToggle
        type="button"
        aria-expanded={!collapsed}
        data-left-rail-section-toggle={title}
        $collapsed={collapsed}
        onClick={onToggle}
      >
        <SectionChevron size={12} strokeWidth={2.2} $collapsed={collapsed} aria-hidden />
        <SectionTitle>{title}</SectionTitle>
      </SectionToggle>
    );
  return (
    <LeftRailSectionHeader>
      {toggle}
      {action ? (
        <SectionActionButton
          type="button"
          title={action.label}
          aria-label={action.label}
          onClick={action.onClick}
        >
          <Plus size={15} strokeWidth={2} aria-hidden />
        </SectionActionButton>
      ) : null}
    </LeftRailSectionHeader>
  );
}

function leftRailNavRowKey(label: string): string {
  return label.toLowerCase().replace(/\s+/g, "-");
}

export const LeftRailSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 10px;
`;

export const LeftRailSectionBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

export const LeftRailCollapsible = styled.div`
  display: grid;
  grid-template-rows: 0fr;

  &[data-expanded="true"] {
    grid-template-rows: 1fr;
  }

  @media (prefers-reduced-motion: no-preference) {
    transition: grid-template-rows 0.2s ease;
  }
`;

export const LeftRailCollapsibleInner = styled.div`
  min-height: 0;
  overflow: hidden;
`;

const ListSettingsTrigger = styled.button`
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  padding: 0;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, var(--tide-muted) 14%, transparent);
    color: var(--tide-text);
  }
`;

const LeftRailNavRow = styled.button`
  width: 100%;
  height: 30px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0;
  border-radius: 8px;
  padding: 0 8px;
  background: transparent;
  color: var(--tide-text);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;

  &:hover {
    background: var(--tide-selection);
  }
`;

const LeftRailSectionHeader = styled.div`
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 0 8px;
`;

const SectionToggle = styled.button<{ $collapsed: boolean }>`
  min-width: 0;
  flex: 1 1 auto;
  align-self: stretch;
  display: flex;
  align-items: center;
  gap: 4px;
  border: 0;
  border-radius: 6px;
  margin-left: -6px;
  padding: 0 6px;
  background: none;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease;

  &:hover {
    background: var(--tide-selection);
  }
`;

const SectionChevron = styled(ChevronRight)<{ $collapsed: boolean }>`
  flex-shrink: 0;
  color: var(--tide-muted);
  transform: ${({ $collapsed }) => ($collapsed ? "rotate(0deg)" : "rotate(90deg)")};

  @media (prefers-reduced-motion: no-preference) {
    transition: transform 0.18s ease;
  }
`;

const SectionTitle = styled.span`
  color: var(--tide-muted);
  font-size: 12px;
  font-weight: 520;
`;

const SectionActionButton = styled.button`
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;
  opacity: 0;
  transition: background-color 0.12s ease, color 0.12s ease, opacity 0.12s ease;

  ${LeftRailSection}:hover & {
    opacity: 1;
  }

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-action);
  }
`;
