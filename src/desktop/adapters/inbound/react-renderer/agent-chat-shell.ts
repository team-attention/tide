import {
  createElement,
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { ArrowUp, ChevronDown, Mic, Plus, ShieldCheck } from "lucide-react";

import type {
  AgentChatBlockView,
  AgentChatChoiceSurfaceRowView,
  AgentChatChoiceSurfaceView,
  AgentChatContextItem,
  AgentChatComposerSurfaceKind,
  AgentChatShellViewModel,
} from "../../../application/domains/agent-chat/agent-chat-shell-state.ts";

export interface AgentChatShellProps {
  viewModel: AgentChatShellViewModel;
  showThreadHeader?: boolean;
  onDraftChange?: (draft: string) => void;
  onSubmit?: () => void;
  onComposerSurfaceChange?: (surface: AgentChatComposerSurfaceKind | null) => void;
  onChoiceSurfaceRowSelect?: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
  ) => void;
}

export function AgentChatShell(props: AgentChatShellProps): ReactElement {
  const viewModel = props.viewModel;
  const isNewThreadStart =
    viewModel.composer.mode === "start" &&
    viewModel.blocks.length === 0 &&
    viewModel.providerReadinessBlockers.length === 0 &&
    viewModel.prompt === null;

  if (isNewThreadStart) {
    return createElement(
      "main",
      {
        className: "agent-chat-shell agent-chat-shell--start",
        "data-chat-state": viewModel.chatState,
        "data-runtime-state": viewModel.runtimeState,
      },
      createNewThreadStartSurface(viewModel, {
        onDraftChange: props.onDraftChange,
        onSubmit: props.onSubmit,
        onComposerSurfaceChange: props.onComposerSurfaceChange,
        onChoiceSurfaceRowSelect: props.onChoiceSurfaceRowSelect,
      }),
    );
  }

  return createElement(
    "main",
    {
      className: `agent-chat-shell${props.showThreadHeader === false ? " agent-chat-shell--embedded" : ""}`,
      "data-chat-state": viewModel.chatState,
      "data-runtime-state": viewModel.runtimeState,
    },
    props.showThreadHeader === false ? null : createThreadHeader(viewModel),
    createAgentSession(viewModel.blocks),
    createComposerStack(viewModel, {
      onDraftChange: props.onDraftChange,
      onSubmit: props.onSubmit,
      onComposerSurfaceChange: props.onComposerSurfaceChange,
      onChoiceSurfaceRowSelect: props.onChoiceSurfaceRowSelect,
    }),
  );
}

function createNewThreadStartSurface(
  viewModel: AgentChatShellViewModel,
  handlers: {
    onDraftChange?: (draft: string) => void;
    onSubmit?: () => void;
    onComposerSurfaceChange?: (surface: AgentChatComposerSurfaceKind | null) => void;
    onChoiceSurfaceRowSelect?: (
      surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
      rowId: string,
    ) => void;
  },
): ReactElement {
  return createElement(
    "section",
    {
      className: "agent-chat-shell__start-surface",
      "aria-label": "New Thread Start",
    },
    createElement("h1", null, `What should we build in ${startSurfaceTarget(viewModel)}?`),
    viewModel.composer.activeSurface
      ? createChoiceSurface({
          key: `composer:${viewModel.composer.activeSurface.surfaceKind}`,
          surface: viewModel.composer.activeSurface,
          onRowSelect: handlers.onChoiceSurfaceRowSelect,
        })
      : null,
    createComposer(viewModel, handlers),
  );
}

function createThreadHeader(viewModel: AgentChatShellViewModel): ReactElement {
  const isFirstLaunch = viewModel.thread === null;

  return createElement(
    "header",
    {
      className: "agent-chat-shell__thread",
      "aria-label": "Thread",
      "data-thread-mode": isFirstLaunch ? "start" : "active",
    },
    createElement(
      "span",
      { className: "agent-chat-shell__eyebrow" },
      isFirstLaunch ? "Codex-style local agent workbench" : "Active Thread",
    ),
    createElement("h1", null, viewModel.thread?.title ?? "What should Tide work on?"),
    createElement(
      "dl",
      { className: "agent-chat-shell__state" },
      createDescription("Runtime", viewModel.runtimeState),
      createDescription("Chat", viewModel.chatState),
      viewModel.thread ? createDescription("Agent", viewModel.thread.agentLabel) : null,
    ),
    viewModel.errorMessage
      ? createElement("p", { role: "alert" }, viewModel.errorMessage)
      : null,
  );
}

function createProviderReadiness(
  viewModel: AgentChatShellViewModel,
): ReactElement[] {
  if (viewModel.providerReadinessBlockers.length === 0) {
    return [];
  }

  return [
    createChoiceSurface({
      key: "provider-readiness",
      surface: {
        surfaceKind: "provider_readiness",
        title: "Provider setup required",
        sourceLabel: "Provider Readiness",
        rows: viewModel.providerReadinessBlockers.flatMap((blocker) => [
          {
            rowId: blocker.kind,
            label: blocker.message,
            detail: blocker.scope,
            icon: "□",
          },
          ...(blocker.setup
            ? [
                {
                  rowId: `${blocker.kind}:setup`,
                  label: "Open provider setup",
                  detail: "preserve draft",
                  icon: "+",
                },
              ]
            : blocker.action
              ? [
                  {
                    rowId: `${blocker.kind}:${blocker.action}`,
                    label: blocker.action,
                    detail: "preserve draft",
                    icon: "+",
                  },
                ]
            : []),
        ]),
      },
      message: viewModel.providerReadinessBlockers.map((blocker) => blocker.message).join("\n"),
    }),
  ];
}

function createAgentSession(
  blocks: AgentChatBlockView[],
): ReactElement {
  return createElement(
    "section",
    {
      className: `agent-session${blocks.length > 0 ? " agent-session--has-turns" : ""}`,
      "aria-label": "Agent Session",
      "data-session-state": blocks.length === 0 ? "empty" : "turns",
    },
    blocks.length === 0 ? null : blocks.map(createAgentSessionTurn),
  );
}

function createAgentSessionTurn(block: AgentChatBlockView): ReactElement {
  const role = block.role === "user" ? "user" : block.role === "agent" ? "agent" : "event";

  return createElement(
    "article",
    {
      key: block.blockId,
      className: `agent-session-turn agent-session-turn--${role}`,
      "data-block-id": block.blockId,
      "data-block-kind": block.kind,
      "data-block-status": block.status,
      "data-block-role": role,
    },
    role === "event"
      ? createElement("span", { className: "agent-session-turn__label" }, block.title)
      : null,
    createElement("p", { className: "agent-session-turn__body" }, block.body),
    block.rawFallback && block.rawFallback !== block.body
      ? createElement("pre", { className: "agent-session-turn__raw" }, block.rawFallback)
      : null,
  );
}

function createComposer(
  viewModel: AgentChatShellViewModel,
  handlers: {
    onDraftChange?: (draft: string) => void;
    onSubmit?: () => void;
    onComposerSurfaceChange?: (surface: AgentChatComposerSurfaceKind | null) => void;
    onChoiceSurfaceRowSelect?: (
      surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
      rowId: string,
    ) => void;
  },
): ReactElement {
  const isStartComposer = viewModel.composer.mode === "start";

  return createElement(
    "form",
    {
      className: "composer-shell",
      "aria-label": "Composer",
      "data-composer-mode": viewModel.composer.mode,
      onSubmit: (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        handlers.onSubmit?.();
      },
    },
    isStartComposer
      ? null
      : createElement(
          "dl",
          { className: "composer-shell__context" },
          viewModel.composer.contextItems.map(createContextItem),
        ),
    createElement(
      "div",
      { className: "composer-shell__body" },
      createElement("textarea", {
        "aria-label": "Composer draft",
        className: "composer-shell__input",
        // One row at rest (CSS min-height sets the floor per mode); the input
        // grows with content via CSS field-sizing in Chromium.
        rows: 1,
        value: viewModel.composer.draft,
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) =>
          handlers.onDraftChange?.(event.currentTarget.value),
        placeholder: isStartComposer ? "Do anything" : "Ask for follow-up changes",
      }),
      isStartComposer
        ? createElement(
            "dl",
            { className: "composer-shell__start-context" },
            viewModel.composer.contextItems.map((item) => createContextChip(item, handlers)),
          )
        : null,
      createElement(
        "div",
        { className: "composer-shell__toolbar" },
        createElement(
          "button",
          {
            type: "button",
            className: "composer-shell__icon-button",
            title: "Composer options",
            "aria-label": "Composer options",
            onClick: () => handlers.onComposerSurfaceChange?.("composer_options"),
          },
          createElement(Plus, { size: 16, strokeWidth: 2.1, "aria-hidden": true }),
        ),
        createElement(
          "button",
          {
            type: "button",
            className: "composer-shell__choice-chip",
            title: "Permission",
            "aria-label": "Permission",
            onClick: () => handlers.onComposerSurfaceChange?.("permission_menu"),
          },
          // Figma: shield-check icon + label + chevron-down.
          createElement(ShieldCheck, { size: 14, strokeWidth: 1.9, className: "composer-shell__chip-icon", "aria-hidden": true }),
          createElement("span", null, viewModel.composer.permissionLabel),
          createElement(ChevronDown, { size: 13, strokeWidth: 1.9, className: "composer-shell__chip-chevron", "aria-hidden": true }),
        ),
        createElement("span", { className: "composer-shell__toolbar-spacer" }),
        createElement(
          "button",
          {
            type: "button",
            className: "composer-shell__choice-chip composer-shell__choice-chip--model",
            title: "Model",
            "aria-label": "Model",
            onClick: () => handlers.onComposerSurfaceChange?.("model_menu"),
          },
          // Figma: label + chevron-down (no leading icon).
          createElement("span", null, viewModel.composer.modelLabel),
          createElement(ChevronDown, { size: 13, strokeWidth: 1.9, className: "composer-shell__chip-chevron", "aria-hidden": true }),
        ),
        createElement(
          "button",
          {
            type: "button",
            className: "composer-shell__icon-button composer-shell__icon-button--mic",
            title: "Voice input",
            "aria-label": "Voice input",
          },
          createElement(Mic, { size: 15, strokeWidth: 2, "aria-hidden": true }),
        ),
        createElement(
          "button",
          {
            type: "submit",
            className: "composer-shell__send",
            title: viewModel.composer.submitLabel,
            "aria-label": viewModel.composer.submitLabel,
          },
          createElement(ArrowUp, { size: 17, strokeWidth: 2.4, "aria-hidden": true }),
          createElement("span", { className: "visually-hidden" }, viewModel.composer.submitLabel),
        ),
      ),
    ),
  );
}

function createComposerStack(
  viewModel: AgentChatShellViewModel,
  handlers: {
    onDraftChange?: (draft: string) => void;
    onSubmit?: () => void;
    onComposerSurfaceChange?: (surface: AgentChatComposerSurfaceKind | null) => void;
    onChoiceSurfaceRowSelect?: (
      surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
      rowId: string,
    ) => void;
  },
): ReactElement {
  return createElement(
    "div",
    { className: "agent-chat-shell__composer-stack" },
    viewModel.composer.activeSurface
      ? createChoiceSurface({
          key: `composer:${viewModel.composer.activeSurface.surfaceKind}`,
          surface: viewModel.composer.activeSurface,
          onRowSelect: handlers.onChoiceSurfaceRowSelect,
        })
      : null,
    ...createProviderReadiness(viewModel),
    viewModel.prompt
      ? createChoiceSurface({
          key: viewModel.prompt.promptId,
          surface: {
            surfaceKind: "prompt_state",
            title: choiceSurfaceTitle(viewModel.prompt.kind),
            sourceLabel: viewModel.prompt.kind === "question" ? "prompt.answer" : "Prompt State",
            rows: (viewModel.prompt.choices ?? []).map((choice, index) => ({
              rowId: choice.choiceId,
              label: choice.label,
              detail: index === 0 ? "Answer with selected option" : "Alternative answer",
              meta: choice.providerValue,
              icon: index === 0 ? "✓" : "",
            })),
          },
          message: viewModel.prompt.message,
          onRowSelect: handlers.onChoiceSurfaceRowSelect,
        })
      : null,
    createComposer(viewModel, handlers),
  );
}

function createChoiceSurface(input: {
  key: string;
  surface: AgentChatChoiceSurfaceView;
  message?: string;
  onRowSelect?: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
  ) => void;
}): ReactElement {
  return createElement(
    "section",
    {
      key: input.key,
      className: "choice-surface",
      "aria-label": "Choice Surface",
      "data-choice-surface": input.surface.surfaceKind,
      "data-choice-source": input.surface.sourceLabel,
    },
    createElement(
      "header",
      { className: "choice-surface__header" },
      createElement("span", { className: "choice-surface__header-icon", "aria-hidden": true }, "◇"),
      createElement("h2", null, input.surface.title),
      createElement("span", null, input.surface.sourceLabel),
    ),
    input.message
      ? createElement("p", { className: "choice-surface__message" }, input.message)
      : null,
    createChoiceRows(input.surface, input.onRowSelect),
  );
}

function createContextChip(
  item: AgentChatContextItem,
  handlers: {
    onComposerSurfaceChange?: (surface: AgentChatComposerSurfaceKind | null) => void;
  },
): ReactElement {
  return createElement(
    "button",
    {
      key: `${item.label}:${item.value}`,
      className: "composer-shell__context-chip",
      "data-context-kind": item.label.toLowerCase(),
      "data-agent-runtime-source": item.runtimeSourceKind,
      type: "button",
      onClick: () => handlers.onComposerSurfaceChange?.(surfaceForContextItem(item)),
    },
    createElement("span", { className: "composer-shell__chip-icon", "aria-hidden": true }, contextItemIcon(item)),
    createElement("span", { className: "visually-hidden" }, item.label),
    createElement("span", { className: "composer-shell__chip-label" }, item.value),
  );
}

function createChoiceRows(
  surface: AgentChatChoiceSurfaceView,
  onRowSelect?: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
  ) => void,
): ReactElement | null {
  const rows = surface.rows;
  if (rows.length === 0) {
    return null;
  }

  return createElement(
    "div",
    { className: "choice-surface__rows" },
    rows.map((row) =>
      createElement(
        "button",
        {
          key: row.rowId,
          type: "button",
          className: `choice-surface__row${row.danger ? " choice-surface__row--danger" : ""}`,
          "data-selected": row.selected ? "true" : "false",
          onClick: () => onRowSelect?.(surface.surfaceKind, row.rowId),
        },
        createElement("span", { className: "choice-surface__row-icon", "aria-hidden": true }, row.icon ?? ""),
        createElement("span", { className: "choice-surface__row-label" }, row.label),
        row.detail ? createElement("span", { className: "choice-surface__row-detail" }, row.detail) : null,
        row.meta ? createElement("span", { className: "choice-surface__row-meta" }, row.meta) : null,
      ),
    ),
  );
}

function choiceSurfaceTitle(kind: string): string {
  switch (kind) {
    case "question":
      return "Question from Agent";
    case "approval":
    case "permission":
      return "Permission required";
    case "command_picker":
      return "Command suggestions";
    default:
      return "Choose an option";
  }
}

function surfaceForContextItem(item: AgentChatContextItem): AgentChatComposerSurfaceKind {
  switch (item.label) {
    case "Agent":
      return "agent_menu";
    case "Project":
    case "Scratch":
      return "project_menu";
    case "Worktree":
      return "worktree_menu";
    case "Branch":
      return "branch_menu";
  }
}

function contextItemIcon(item: AgentChatContextItem): string {
  switch (item.label) {
    case "Agent":
      return "◆";
    case "Project":
      return "⌘";
    case "Scratch":
      return "□";
    case "Worktree":
      return "─";
    case "Branch":
      return "⌙";
  }
}

function createContextItem(item: AgentChatContextItem): ReactElement {
  return createDescription(item.label, item.value, `${item.label}:${item.value}`);
}

function startSurfaceTarget(viewModel: AgentChatShellViewModel): string {
  const item = viewModel.composer.contextItems.find(
    (contextItem) => contextItem.label === "Project" || contextItem.label === "Scratch",
  );

  return item?.value || "Tide";
}

function createDescription(
  term: string,
  value: ReactNode,
  key?: string,
): ReactElement {
  return createElement(
    "div",
    { key, className: "description-pair" },
    createElement("dt", null, term),
    createElement("dd", null, value),
  );
}
