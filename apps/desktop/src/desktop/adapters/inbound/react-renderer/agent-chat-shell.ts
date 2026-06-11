import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import MarkdownIt from "markdown-it";
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Copy,
  CornerDownRight,
  FileText,
  Folder,
  FolderGit2,
  Globe,
  FolderPlus,
  GitBranch,
  Layers,
  MessageSquareDashed,
  Mic,
  PanelsTopLeft,
  Paperclip,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Wrench,
  X,
} from "lucide-react";

import { fileIconFor } from "./file-icons.ts";
import { guessLanguage, highlightToHtml } from "./code-highlight.ts";
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
  onInterrupt?: () => void;
  // Edit the queued (not-yet-sent) message: pull it back into the Composer.
  onEditQueued?: (index: number) => void;
  onRemoveQueued?: (index: number) => void;
  // Resend a prompt (retry an answer): submits the given text as a new turn.
  onResend?: (text: string) => void;
  onQuote?: (text: string) => void;
  onComposerSurfaceChange?: (surface: AgentChatComposerSurfaceKind | null) => void;
  onChoiceSurfaceRowSelect?: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
  ) => void;
  onAnswerPromptText?: (value: string) => void;
  // Opens a file (from a Read tool's file chip) in the Workbench editor.
  onOpenFile?: (path: string) => void;
  // Opens an http(s) link (clicked in a chat message) in the in-app Browser
  // Pane — never the top-level window.
  onOpenBrowserPane?: (url: string) => void;
  // A pasted image attachment: name, mediaType, and base64 of the image bytes.
  onAddAttachment?: (attachment: {
    name: string;
    mediaType: string;
    dataBase64: string;
  }) => void;
  onRemoveAttachment?: (attachmentId: string) => void;
  onRemoveContextChip?: (id: string) => void;
  onSetContextChipComment?: (id: string, comment: string) => void;
}

// A chip's screen rectangle, captured when it is clicked so the dropdown can
// anchor to it (open below, or above if the chip is in the lower half).
interface AnchorRect {
  left: number;
  top: number;
  bottom: number;
}

export function AgentChatShell(props: AgentChatShellProps): ReactElement {
  const viewModel = props.viewModel;
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  // A pasted-image attachment enlarged into a lightbox (its data: URL), or null.
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const sessionRef = useRef<HTMLElement | null>(null);
  // Floating "Add to chat" for a drag-selection inside the transcript — quoting
  // any part of the conversation into the composer as a message chip.
  const [transcriptSel, setTranscriptSel] = useState<{ x: number; y: number; text: string } | null>(null);
  useEffect(() => {
    const onUp = () => {
      const sel = window.getSelection();
      const text = sel ? sel.toString() : "";
      const root = sessionRef.current;
      if (text.trim().length > 0 && sel !== null && root !== null && root.contains(sel.anchorNode)) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        setTranscriptSel({ x: rect.left, y: rect.top, text });
      } else {
        setTranscriptSel(null);
      }
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []);
  // Memoize the transcript so that showing/hiding the "Add to chat" toolbar
  // (a transcriptSel state change) does NOT re-render the transcript subtree.
  // Re-rendering it rebuilt the message DOM and COLLAPSED the user's drag
  // selection the instant they released the mouse (the highlight vanished while
  // the toolbar appeared). A stable element reference makes React skip the
  // subtree, so the native selection survives. Deps exclude transcriptSel.
  const sessionView = useMemo(
    () =>
      createAgentSession(
        viewModel.blocks,
        viewModel.chatState,
        viewModel.queuedInputs,
        props.onOpenFile,
        sessionRef,
        viewModel.thread?.runtimeStartedAt,
        props.onEditQueued,
        props.onResend,
        props.onQuote,
        props.onOpenBrowserPane,
      ),
    [
      viewModel.blocks,
      viewModel.chatState,
      viewModel.queuedInputs,
      props.onOpenFile,
      viewModel.thread?.runtimeStartedAt,
      props.onEditQueued,
      props.onResend,
      props.onQuote,
      props.onOpenBrowserPane,
    ],
  );
  // Hidden <input type=file> for the "Files and images" composer-menu action.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Sticky auto-scroll: keep the transcript pinned to the bottom as content
  // streams in / new turns arrive, but ONLY while the user is already near the
  // bottom — if they scroll up to read history, don't yank them back down.
  const threadId = viewModel.thread?.threadId;
  const stickToBottomRef = useRef(true);
  // On entering a thread, jump to the most recent message and re-arm stickiness.
  useEffect(() => {
    const el = sessionRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    stickToBottomRef.current = true;
  }, [threadId]);
  // Track whether the user is pinned to the bottom (within a small threshold).
  useEffect(() => {
    const el = sessionRef.current;
    if (el === null) {
      return undefined;
    }
    const onScroll = () => {
      stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  // As new content lands (streaming chunks, a new turn, the working indicator),
  // follow it to the bottom when stuck.
  useEffect(() => {
    if (!stickToBottomRef.current) {
      return;
    }
    const el = sessionRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [viewModel.blocks, viewModel.runtimeState]);
  // Escape dismisses the active chip/command popover and the image lightbox — the
  // expected keyboard companion to the outside-click backdrop. Only listens while
  // something is open, so it never swallows Escape from the rest of the app.
  const hasActiveSurface = viewModel.composer.activeSurface != null;
  useEffect(() => {
    if (!hasActiveSurface && imagePreview === null) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (imagePreview !== null) {
        setImagePreview(null);
      }
      if (hasActiveSurface) {
        props.onComposerSurfaceChange?.(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasActiveSurface, imagePreview, props.onComposerSurfaceChange]);
  const isNewThreadStart =
    viewModel.composer.mode === "start" &&
    viewModel.blocks.length === 0 &&
    viewModel.providerReadinessBlockers.length === 0 &&
    viewModel.prompt === null;

  // Chips open their dropdown anchored to themselves: capture the chip rect and
  // then flip the surface open. Closing routes through the same surface change.
  const openSurface = (kind: AgentChatComposerSurfaceKind, rect: AnchorRect) => {
    setAnchor(rect);
    props.onComposerSurfaceChange?.(kind);
  };
  const closeSurface = () => props.onComposerSurfaceChange?.(null);

  const handlers = {
    onDraftChange: props.onDraftChange,
    onSubmit: props.onSubmit,
    onInterrupt: props.onInterrupt,
    onEditQueued: props.onEditQueued,
    onRemoveQueued: props.onRemoveQueued,
    onComposerSurfaceChange: props.onComposerSurfaceChange,
    onOpenSurface: openSurface,
    // Intercept the "Files and images" composer-menu row to open a native file
    // picker locally; everything else routes to the product shell as before.
    onChoiceSurfaceRowSelect: (
      surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
      rowId: string,
    ) => {
      if (surfaceKind === "composer_options" && rowId === "files-images") {
        props.onComposerSurfaceChange?.(null);
        fileInputRef.current?.click();
        return;
      }
      props.onChoiceSurfaceRowSelect?.(surfaceKind, rowId);
    },
    onAnswerPromptText: props.onAnswerPromptText,
    onAddAttachment: props.onAddAttachment,
    onRemoveAttachment: props.onRemoveAttachment,
    onRemoveContextChip: props.onRemoveContextChip,
    onSetContextChipComment: props.onSetContextChipComment,
    onPreviewAttachment: (previewUrl: string) => setImagePreview(previewUrl),
    inputRef: composerInputRef,
  };

  // The chip dropdown is a fixed-position popover anchored to its chip — never
  // an in-flow card that pushes the composer down. When opened without a chip
  // rect (programmatically / in tests), fall back to a sensible position.
  const fallbackTop = (typeof window === "undefined" ? 800 : window.innerHeight) - 180;
  // Slash (/) command suggestions anchor to the composer input (they aren't
  // opened from a chip), opening upward just above it. Chip surfaces keep their
  // captured chip rect.
  const inputRect =
    viewModel.composer.activeSurface?.surfaceKind === "command_suggestions"
      ? composerInputRef.current?.getBoundingClientRect()
      : undefined;
  const popoverAnchor: AnchorRect = inputRect
    ? { left: inputRect.left, top: inputRect.top, bottom: inputRect.bottom }
    : anchor ?? { left: 120, top: fallbackTop, bottom: fallbackTop + 30 };
  const popover = viewModel.composer.activeSurface
    ? createChipPopover({
        surface: viewModel.composer.activeSurface,
        anchor: popoverAnchor,
        // Use the intercepting handler so "Files and images" opens the picker.
        onRowSelect: handlers.onChoiceSurfaceRowSelect,
        onClose: closeSurface,
      })
    : null;

  // Native file picker for the "Files and images" action: reads picked images as
  // base64 attachments (same path as paste). Hidden; triggered programmatically.
  const fileInput = createElement("input", {
    ref: fileInputRef,
    type: "file",
    accept: "image/*",
    multiple: true,
    style: { display: "none" },
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.currentTarget.files;
      if (files && props.onAddAttachment) {
        for (const file of Array.from(files)) {
          attachImageFile(file, props.onAddAttachment);
        }
      }
      event.currentTarget.value = "";
    },
  });

  const lightbox =
    imagePreview === null
      ? null
      : createElement(
          "div",
          {
            className: "image-lightbox-backdrop",
            role: "dialog",
            "aria-label": "Image preview",
            onClick: () => setImagePreview(null),
          },
          createElement("img", {
            className: "image-lightbox__img",
            src: imagePreview,
            alt: "Attachment preview",
          }),
        );

  if (isNewThreadStart) {
    return createElement(
      "main",
      {
        className: "agent-chat-shell agent-chat-shell--start",
        "data-chat-state": viewModel.chatState,
        "data-runtime-state": viewModel.runtimeState,
      },
      createNewThreadStartSurface(viewModel, handlers),
      popover,
      lightbox,
      fileInput,
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
    sessionView,
    createComposerStack(viewModel, handlers),
    transcriptSel === null || props.onQuote === undefined
      ? null
      : createElement(
          "button",
          {
            type: "button",
            className: "editor-selection-toolbar",
            style: {
              left: `${transcriptSel.x}px`,
              top: `${Math.max(transcriptSel.y - 36, 8)}px`,
            } as CSSProperties,
            onMouseDown: (event: { preventDefault: () => void }) => {
              event.preventDefault();
              props.onQuote?.(transcriptSel.text.trim());
              setTranscriptSel(null);
            },
          },
          createElement(CornerDownRight, { size: 13, strokeWidth: 1.9, "aria-hidden": true }),
          "Add to chat",
        ),
    popover,
    lightbox,
    fileInput,
  );
}

// Renders the active chip dropdown as a fixed popover anchored to the chip,
// behind a transparent full-viewport backdrop that closes it on outside click.
function createChipPopover(input: {
  surface: AgentChatChoiceSurfaceView;
  anchor: AnchorRect;
  onRowSelect?: (surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"], rowId: string) => void;
  onClose: () => void;
}): ReactElement {
  const gap = 6;
  const viewportH = typeof window === "undefined" ? 900 : window.innerHeight;
  const viewportW = typeof window === "undefined" ? 1200 : window.innerWidth;
  const openUp = input.anchor.top > viewportH / 2;
  const margin = 12;
  // Cap the popover to the space actually available on the side it opens toward,
  // so the scroll region spans the whole list instead of running past a viewport
  // edge where the far rows become unreachable.
  const available = openUp
    ? input.anchor.top - gap - margin
    : viewportH - input.anchor.bottom - gap - margin;
  const style: Record<string, string> = {
    position: "fixed",
    left: `${Math.max(8, Math.min(input.anchor.left, viewportW - 396))}px`,
    zIndex: "60",
    maxHeight: `${Math.max(160, available)}px`,
  };
  if (openUp) {
    style.bottom = `${viewportH - input.anchor.top + gap}px`;
  } else {
    style.top = `${input.anchor.bottom + gap}px`;
  }
  return createElement(
    "div",
    {
      className: "chip-popover-backdrop",
      onMouseDown: input.onClose,
    },
    createElement(
      "div",
      {
        className: "chip-popover",
        style: style as unknown as CSSProperties,
        onMouseDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
      },
      createChoiceSurface({
        key: `popover:${input.surface.surfaceKind}`,
        surface: input.surface,
        onRowSelect: input.onRowSelect,
      }),
    ),
  );
}

// Read any image/* items from a clipboard paste and hand them to the composer
// as base64 attachments. Non-image pastes fall through to the default (text).
function handleComposerPaste(
  event: ClipboardEvent,
  onAddAttachment?: (attachment: {
    name: string;
    mediaType: string;
    dataBase64: string;
  }) => void,
): void {
  if (onAddAttachment === undefined) {
    return;
  }
  const items = event.clipboardData?.items;
  if (items === undefined) {
    return;
  }
  const images: File[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file !== null) {
        images.push(file);
      }
    }
  }
  if (images.length === 0) {
    return;
  }
  // Pasting an image should attach it, not insert the OS clipboard text path.
  event.preventDefault();
  for (const file of images) {
    attachImageFile(file, onAddAttachment);
  }
}

// Reads an image File as base64 and adds it as a composer attachment. Shared by
// the paste handler and the "Files and images" picker.
function attachImageFile(
  file: File,
  onAddAttachment: (attachment: { name: string; mediaType: string; dataBase64: string }) => void,
): void {
  const reader = new FileReader();
  reader.onload = () => {
    const result = reader.result;
    if (typeof result !== "string") {
      return;
    }
    const base64 = result.includes(",") ? result.slice(result.indexOf(",") + 1) : result;
    onAddAttachment({
      name: file.name.length > 0 ? file.name : "pasted-image.png",
      mediaType: file.type.length > 0 ? file.type : "image/png",
      dataBase64: base64,
    });
  };
  reader.readAsDataURL(file);
}

function contextChipIcon(kind: string): typeof FileText {
  switch (kind) {
    case "terminal":
      return Terminal;
    case "browser":
      return Globe;
    case "message":
      return CornerDownRight;
    default:
      return FileText;
  }
}

interface ComposerHandlers {
  onDraftChange?: (draft: string) => void;
  onSubmit?: () => void;
  onInterrupt?: () => void;
  onEditQueued?: (index: number) => void;
  onRemoveQueued?: (index: number) => void;
  onRemoveContextChip?: (id: string) => void;
  onSetContextChipComment?: (id: string, comment: string) => void;
  onComposerSurfaceChange?: (surface: AgentChatComposerSurfaceKind | null) => void;
  onOpenSurface?: (surface: AgentChatComposerSurfaceKind, rect: AnchorRect) => void;
  onChoiceSurfaceRowSelect?: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
  ) => void;
  onAnswerPromptText?: (value: string) => void;
  onAddAttachment?: (attachment: {
    name: string;
    mediaType: string;
    dataBase64: string;
  }) => void;
  onRemoveAttachment?: (attachmentId: string) => void;
  onPreviewAttachment?: (previewUrl: string) => void;
  // The composer textarea, so slash (/) command suggestions can anchor to it.
  inputRef?: { current: HTMLTextAreaElement | null };
}

function createNewThreadStartSurface(
  viewModel: AgentChatShellViewModel,
  handlers: ComposerHandlers,
): ReactElement {
  return createElement(
    "section",
    {
      className: "agent-chat-shell__start-surface",
      "aria-label": "New Thread Start",
    },
    createElement("h1", null, `What should we build in ${startSurfaceTarget(viewModel)}?`),
    // The chip dropdown is rendered as an anchored popover by AgentChatShell, not
    // here in flow — so it no longer pushes the composer down.
    createComposer(viewModel, handlers),
  );
}

// Extracts a chip's anchor rect from a click event for popover positioning.
function chipAnchorFromEvent(event: { currentTarget: HTMLElement }): AnchorRect {
  const rect = event.currentTarget.getBoundingClientRect();
  return { left: rect.left, top: rect.top, bottom: rect.bottom };
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
  onRowSelect?: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
  ) => void,
): ReactElement[] {
  if (viewModel.providerReadinessBlockers.length === 0) {
    return [];
  }

  return [
    createChoiceSurface({
      key: "provider-readiness",
      onRowSelect,
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
          // The directory-trust blocker gets a one-click in-app trust action that
          // writes the provider's own trust config (no terminal drop). While the
          // grant is in flight the row shows it is working (re-clicks are ignored).
          ...(blocker.kind === "directory_trust_required"
            ? [
                viewModel.providerReadinessActionPending
                  ? {
                      rowId: "directory_trust_required:trust",
                      label: "Trusting this folder…",
                      detail: "writing workspace trust",
                      icon: "⋯",
                    }
                  : {
                      rowId: "directory_trust_required:trust",
                      label: "Trust this folder",
                      detail: "lets this agent run here — one click, nothing else changes",
                      icon: "✓",
                    },
              ]
            : []),
          ...(blocker.setup
            ? [
                {
                  rowId: `${blocker.kind}:setup`,
                  label: "Set up in the provider terminal instead",
                  detail: "opens the provider's own setup; your draft is kept",
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

// Optimistic just-sent user row, shown until the backend's real user block arrives.
// The "대기 중" (waiting) badge only appears when the agent is genuinely busy and the
// message is actually queued behind the live turn — never on an idle send, which goes
// straight through.
function createQueuedInputRow(queuedInput: string, queued: boolean, index = 0): ReactElement {
  const hasAttachments = queuedInput.includes("**↳ ");
  return createElement(
    "article",
    {
      key: `queued-${index}`,
      className: queued
        ? "agent-session-turn agent-session-turn--user agent-session-turn--queued"
        : "agent-session-turn agent-session-turn--user",
      "data-block-role": "user",
      ...(queued ? { "data-queued": true } : {}),
    },
    createElement(
      "span",
      { className: "agent-session-turn__label" },
      "You",
      queued
        ? createElement("span", { className: "agent-session-turn__queued-badge" }, "대기 중")
        : null,
      // Edit the queued message before it runs (only while genuinely queued).
      // Handled by the Agent Session's delegated onClick via [data-edit-queued].
      queued
        ? createElement(
            "button",
            {
              type: "button",
              className: "agent-session-turn__edit",
              "data-edit-queued": true,
              "aria-label": "Edit queued message",
              title: "Edit queued message",
            },
            "수정",
          )
        : null,
    ),
    hasAttachments
      ? renderUserAttachmentBody(queuedInput)
      : createElement("p", { className: "agent-session-turn__body" }, queuedInput),
  );
}

function createAgentSession(
  blocks: AgentChatBlockView[],
  chatState: AgentChatShellViewModel["chatState"],
  queuedInputs: string[],
  onOpenFile?: (path: string) => void,
  sessionRef?: { current: HTMLElement | null },
  runtimeStartedAt?: string,
  onEditQueued?: (index: number) => void,
  onResend?: (text: string) => void,
  onQuote?: (text: string) => void,
  onOpenBrowserPane?: (url: string) => void,
): ReactElement {
  // Show a live "working" indicator only until the agent produces its block:
  // a streaming block carries its own caret, and a complete block means the turn
  // is done — so the indicator never lingers after the answer (even if the
  // backend runtime state is slow to flip).
  const lastBlock = blocks[blocks.length - 1];
  const lastIsAgent = lastBlock?.role === "agent";
  const working = chatState === "running" && !lastIsAgent;

  return createElement(
    "section",
    {
      ref: sessionRef,
      className: `agent-session${blocks.length > 0 ? " agent-session--has-turns" : ""}`,
      "aria-label": "Agent Session",
      "data-session-state": blocks.length === 0 ? "empty" : "turns",
      // Event-delegated clicks: Copy a code block, or open a file chip.
      onClick: (event: { target: EventTarget | null; preventDefault: () => void }) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target === null) {
          return;
        }
        const copyButton = target.closest(".md-code__copy");
        if (copyButton) {
          const pre = copyButton.closest(".md-code")?.querySelector("pre");
          void navigator.clipboard?.writeText(pre?.textContent ?? "");
          return;
        }
        // Add a specific code block to the composer as a quoted chip (reply to it).
        const quoteCode = onQuote ? target.closest(".md-code__quote") : null;
        if (quoteCode) {
          const pre = quoteCode.closest(".md-code")?.querySelector("pre");
          const text = pre?.textContent ?? "";
          if (text.trim().length > 0) {
            onQuote?.(text.trim());
          }
          return;
        }
        // Copy a whole agent answer (hover action). Flash the button to confirm.
        const copyAnswer = target.closest(".agent-turn-actions__btn--copy");
        if (copyAnswer) {
          const body = copyAnswer
            .closest(".agent-session-turn")
            ?.querySelector(".agent-session-turn__body");
          void navigator.clipboard?.writeText(body?.textContent ?? "");
          copyAnswer.classList.add("agent-turn-actions__btn--done");
          window.setTimeout(() => copyAnswer.classList.remove("agent-turn-actions__btn--done"), 1400);
          return;
        }
        // Quote an answer into the composer as a content chip.
        const quoteAnswer = onQuote ? target.closest(".agent-turn-actions__btn--quote") : null;
        if (quoteAnswer) {
          const text = quoteAnswer
            .closest(".agent-session-turn")
            ?.querySelector(".agent-session-turn__body")?.textContent ?? "";
          if (text.trim().length > 0) {
            onQuote?.(text.trim());
          }
          return;
        }
        // Retry an answer: resend the user prompt that preceded it as a new turn.
        const retryAnswer = onResend ? target.closest(".agent-turn-actions__btn--retry") : null;
        if (retryAnswer) {
          let node = retryAnswer.closest(".agent-session-turn")?.previousElementSibling ?? null;
          while (node && node.getAttribute("data-block-role") !== "user") {
            node = node.previousElementSibling;
          }
          const prompt = node?.querySelector(".agent-session-turn__body")?.textContent ?? "";
          if (prompt.trim().length > 0) {
            onResend?.(prompt);
          }
          return;
        }
        const editQueued = onEditQueued ? target.closest("[data-edit-queued]") : null;
        if (editQueued) {
          event.preventDefault();
          onEditQueued?.(Number(editQueued.getAttribute("data-queued-index")) || 0);
          return;
        }
        // An http(s) link in chat opens in the in-app Browser Pane, never the
        // top-level window (which would replace the whole app).
        const browserUrl = onOpenBrowserPane
          ? target.closest("[data-open-browser-link]")?.getAttribute("data-open-browser-link")
          : null;
        if (browserUrl) {
          event.preventDefault();
          onOpenBrowserPane?.(browserUrl);
          return;
        }
        const path = onOpenFile ? target.closest("[data-open-file]")?.getAttribute("data-open-file") : null;
        if (path) {
          // file-open links render as <a href="#"> — stop the anchor navigation.
          event.preventDefault();
          onOpenFile?.(path);
        }
      },
    },
    blocks.length === 0
      ? chatState === "hydrating"
        ? createAgentSessionSkeleton()
        : // A loaded, idle thread with no messages (e.g. an agent that produced
          // nothing) shows a placeholder instead of a blank void. But once a message
          // is submitted it shows as the optimistic/queued "You" row below — there IS
          // content, so the "No messages here" placeholder must not render alongside it.
          chatState === "ready" && queuedInputs.length === 0
          ? createAgentSessionEmptyPlaceholder()
          : null
      : groupSessionItems(blocks).map(renderSessionItem),
    working ? createElement(AgentWorkingIndicator, { runtimeStartedAt }) : null,
    // An optimistic just-sent message (idle send) still shows in the transcript
    // until its real block arrives. Messages QUEUED behind a live turn dock to the
    // Composer instead (Codex-style "steer"), so they aren't done here.
    chatState !== "running"
      ? queuedInputs.map((queued, index) => createQueuedInputRow(queued, false, index))
      : null,
  );
}

// Skeleton shown while an opened thread is loading its blocks from the backend, so
// switching into a thread feels responsive instead of flashing blank.
function createAgentSessionSkeleton(): ReactElement {
  const line = (width: string, key: string) =>
    createElement("div", {
      key,
      className: "agent-skeleton__line",
      style: { width },
    });
  return createElement(
    "div",
    {
      className: "agent-session-skeleton",
      "aria-label": "Loading thread",
      "aria-busy": "true",
    },
    createElement("div", { className: "agent-skeleton__bubble" }),
    createElement(
      "div",
      { className: "agent-skeleton__agent" },
      line("92%", "l1"),
      line("78%", "l2"),
      line("85%", "l3"),
      line("40%", "l4"),
    ),
  );
}

// Empty state for a loaded thread that has no messages to show (e.g. an agent that
// produced nothing, or a session that ended before any output) — better than a void.
function createAgentSessionEmptyPlaceholder(): ReactElement {
  return createElement(
    "div",
    { className: "agent-session-empty", "aria-label": "No messages" },
    createElement(MessageSquareDashed, {
      size: 26,
      strokeWidth: 1.5,
      className: "agent-session-empty__icon",
    }),
    createElement("p", { className: "agent-session-empty__title" }, "No messages here"),
    createElement(
      "p",
      { className: "agent-session-empty__hint" },
      "This thread has no output yet. Send a message below to start.",
    ),
  );
}

type SessionRenderItem =
  | { kind: "block"; block: AgentChatBlockView }
  | { kind: "toolGroup"; key: string; blocks: AgentChatBlockView[] };

// Consecutive tool blocks collapse into one Codex-style activity summary; other
// blocks render as their own turn.
function groupSessionItems(blocks: AgentChatBlockView[]): SessionRenderItem[] {
  const items: SessionRenderItem[] = [];
  let group: { kind: "toolGroup"; key: string; blocks: AgentChatBlockView[] } | null = null;
  for (const block of blocks) {
    if (block.role === "tool") {
      if (group === null) {
        group = { kind: "toolGroup", key: `tools-${block.blockId}`, blocks: [block] };
        items.push(group);
      } else {
        group.blocks.push(block);
      }
    } else {
      group = null;
      items.push({ kind: "block", block });
    }
  }
  return items;
}

function renderSessionItem(item: SessionRenderItem): ReactElement | null {
  if (item.kind === "toolGroup") {
    return createElement(ToolActivityGroup, { key: item.key, blocks: item.blocks });
  }
  if (item.block.role === "reasoning" || item.block.kind === "reasoning") {
    return createElement(ReasoningTurn, { key: item.block.blockId, block: item.block });
  }
  return createAgentSessionTurn(item.block);
}

// Reasoning/thinking renders as a quiet, collapsible disclosure — secondary to the
// answer, like the Codex/Claude apps. It expands live while streaming so the user
// can watch the model think, then collapses once the turn is complete.
function ReasoningTurn({ block }: { block: AgentChatBlockView }): ReactElement {
  const streaming = block.status === "streaming" || block.status === "pending";
  const [expanded, setExpanded] = useState(streaming);
  // Follow the live stream open, but stop forcing it once the user has toggled.
  const userToggled = useRef(false);
  useEffect(() => {
    if (!userToggled.current) {
      setExpanded(streaming);
    }
  }, [streaming]);
  const label = block.title && block.title.trim().length > 0 ? block.title : "Thinking";
  return createElement(
    "div",
    {
      className: `agent-reasoning${expanded ? " agent-reasoning--expanded" : ""}${
        streaming ? " agent-reasoning--streaming" : ""
      }`,
      "data-block-id": block.blockId,
      "data-block-role": "reasoning",
    },
    createElement(
      "button",
      {
        type: "button",
        className: "agent-reasoning__summary",
        "aria-expanded": expanded,
        onClick: () => {
          userToggled.current = true;
          setExpanded((value) => !value);
        },
      },
      createElement(Sparkles, { size: 13, strokeWidth: 1.9, className: "agent-reasoning__icon", "aria-hidden": true }),
      createElement("span", { className: "agent-reasoning__label" }, label),
      createElement(ChevronDown, { size: 13, strokeWidth: 1.9, className: "agent-reasoning__chevron", "aria-hidden": true }),
    ),
    expanded
      ? createElement("div", {
          className: "agent-reasoning__body",
          dangerouslySetInnerHTML: { __html: markdown.render(block.body) },
        })
      : null,
  );
}

// Live working indicator with an elapsed timer, so a long turn reads as active
// progress (like "Working… 12s") rather than a static spinner.
function AgentWorkingIndicator({
  runtimeStartedAt,
}: {
  runtimeStartedAt?: string;
}): ReactElement {
  // Base elapsed on when the turn actually started (from the backend), so the timer
  // is correct even after reopening a running thread. Fall back to mount time only
  // when the backend hasn't reported a start (e.g. an optimistic local turn).
  // Memoize so an undefined runtimeStartedAt doesn't re-anchor to Date.now() every
  // render (the mount-time fallback must stay stable for one turn).
  const startedMs = useMemo(() => {
    const parsed = runtimeStartedAt ? Date.parse(runtimeStartedAt) : NaN;
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }, [runtimeStartedAt]);
  // The interval only forces a re-render each second; the elapsed value is derived
  // straight from the injected start time every render, so switching threads shows
  // the new turn's elapsed immediately (no stale state to wait out).
  const [, forceTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
  return createElement(
    "article",
    {
      className: "agent-session-turn agent-session-turn--agent agent-session-turn--working",
      "data-block-role": "agent",
      "data-working": true,
      "aria-live": "polite",
    },
    createElement("span", { className: "agent-session-turn__label" }, "Agent"),
    createElement(
      "span",
      { className: "agent-session-working" },
      createElement("span", { className: "agent-session-working__dot" }),
      createElement("span", { className: "agent-session-working__dot" }),
      createElement("span", { className: "agent-session-working__dot" }),
      createElement(
        "span",
        { className: "agent-session-working__text" },
        seconds > 0 ? `Working… ${seconds}s` : "Working…",
      ),
    ),
  );
}

// Agent answers are markdown (headings, lists, code, links, bold). Render them
// with markdown-it (html:false escapes raw HTML, so this is injection-safe for
// provider text); linkify makes bare URLs clickable, breaks honors soft breaks.
const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

// Agents often link to repo files as [name](file:///abs/path). markdown-it blocks
// file: links by default; allow them and render them as Workbench file-open links
// (the same data-open-file the tool chips use) instead of navigating anchors.
const defaultValidateLink = markdown.validateLink.bind(markdown);
markdown.validateLink = (url: string) =>
  url.startsWith("file://") || defaultValidateLink(url);

markdown.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  const token = tokens[index];
  const href = token.attrGet("href");
  if (href && href.startsWith("file://")) {
    token.attrSet("data-open-file", decodeURIComponent(href.slice("file://".length)));
    token.attrSet("class", "md-file-link");
    token.attrSet("href", "#");
  } else if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
    // Open in the in-app Browser Pane (the session click delegation handles it),
    // NOT the top-level window. The real href is kept so right-click still works
    // and the main-process navigation guard remains a backstop.
    token.attrSet("data-open-browser-link", href);
    token.attrSet("class", "md-ext-link");
  }
  return self.renderToken(tokens, index, options);
};

// Codex-style fenced code blocks: a header with the language label + a Copy
// button, then the syntax-highlighted code. Copy is handled by event delegation
// on the session (reads the <pre> text).
markdown.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index];
  const info = token.info.trim().split(/\s+/)[0] ?? "";
  const lang = info || guessLanguage(token.content) || "";
  const label = lang || "code";
  const codeHtml = highlightToHtml(token.content, lang || undefined);
  return (
    `<div class="md-code">` +
    `<div class="md-code__header"><span class="md-code__lang">${escapeAttr(label)}</span>` +
    `<span class="md-code__actions">` +
    `<button type="button" class="md-code__quote" data-quote-code aria-label="Add code to chat">Add to chat</button>` +
    `<button type="button" class="md-code__copy" data-copy aria-label="Copy code">Copy</button>` +
    `</span></div>` +
    `<pre class="md-code__pre"><code>${codeHtml}</code></pre>` +
    `</div>`
  );
};

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderAgentMarkdown(body: string): ReactElement {
  return createElement("div", {
    className: "agent-session-turn__body agent-session-turn__body--md",
    dangerouslySetInnerHTML: { __html: markdown.render(body) },
  });
}

// A user message that carries attached regions (each formatted as `**↳ label**`
// + note + content) renders as markdown so the labels, quoted notes, and code
// blocks read as structured attachments instead of raw asterisks/backticks.
function renderUserAttachmentBody(body: string): ReactElement {
  return createElement("div", {
    className:
      "agent-session-turn__body agent-session-turn__body--md agent-session-turn__body--attachments",
    dangerouslySetInnerHTML: { __html: markdown.render(body) },
  });
}

// A pasted/attached image rides the message as a `[Attached image: <abs path>]`
// line (the agent needs the path to read the file). In the USER's transcript we
// render it as a thumbnail instead of the raw path, and drop the path text from
// the visible message — keep the picture, hide the plumbing.
const ATTACHED_IMAGE_RE = /\[Attached image:\s*([^\]]+?)\]/g;
function renderUserBody(body: string): ReactElement {
  const images: string[] = [];
  let match: RegExpExecArray | null;
  ATTACHED_IMAGE_RE.lastIndex = 0;
  while ((match = ATTACHED_IMAGE_RE.exec(body)) !== null) {
    const path = match[1].trim();
    if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path)) {
      images.push(path);
    }
  }
  const text = body.replace(ATTACHED_IMAGE_RE, "").trim();
  if (images.length === 0) {
    return text.includes("**↳ ")
      ? renderUserAttachmentBody(body)
      : createElement("p", { className: "agent-session-turn__body" }, body);
  }
  // Image(s) present → a media bubble: the (path-free) text, then thumbnails.
  return createElement(
    "div",
    { className: "agent-session-turn__body agent-session-turn__body--media" },
    text.length > 0
      ? createElement("p", { className: "agent-session-turn__media-text" }, text)
      : null,
    createElement(
      "div",
      { className: "agent-session-turn__images" },
      ...images.map((path, index) =>
        createElement("img", {
          key: `att-${index}`,
          className: "agent-session-turn__image",
          src: `file://${encodeURI(path)}`,
          alt: "Attached image",
          loading: "lazy",
          draggable: false,
        }),
      ),
    ),
  );
}

function createAgentSessionTurn(block: AgentChatBlockView): ReactElement | null {
  if (block.role === "tool") {
    return createToolLogTurn(block);
  }
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
    // Codex-style: the user turn is a right-aligned bubble (no label needed),
    // the agent answer is flat prose (the text is the hero), and structured
    // events keep a small muted label.
    role === "event"
      ? createElement("span", { className: "agent-session-turn__label" }, block.title)
      : null,
    role === "agent"
      ? renderAgentMarkdown(block.body)
      : role === "user"
        ? renderUserBody(block.body)
        : createElement("p", { className: "agent-session-turn__body" }, block.body),
    // Prompt blocks are historical markers for an interactive card; their raw
    // fallback is the hook's JSON payload — runtime transport, not content.
    block.rawFallback && block.rawFallback !== block.body && !block.kind.endsWith("_prompt")
      ? createElement("pre", { className: "agent-session-turn__raw" }, block.rawFallback)
      : null,
    // Hover actions on a completed agent answer: copy the answer, or retry the
    // prompt. Click handling is event-delegated on the session container.
    role === "agent" && block.status !== "streaming" && block.status !== "pending" && block.body.trim().length > 0
      ? createAgentTurnActions()
      : null,
  );
}

function createAgentTurnActions(): ReactElement {
  return createElement(
    "div",
    { className: "agent-turn-actions", "aria-hidden": false },
    createElement(
      "button",
      {
        type: "button",
        className: "agent-turn-actions__btn agent-turn-actions__btn--copy",
        title: "Copy answer",
        "aria-label": "Copy answer",
      },
      createElement(Copy, { size: 13, strokeWidth: 1.8, className: "agent-turn-actions__icon agent-turn-actions__icon--copy", "aria-hidden": true }),
      createElement(Check, { size: 13, strokeWidth: 2, className: "agent-turn-actions__icon agent-turn-actions__icon--check", "aria-hidden": true }),
    ),
    createElement(
      "button",
      {
        type: "button",
        className: "agent-turn-actions__btn agent-turn-actions__btn--quote",
        title: "Quote in chat",
        "aria-label": "Quote this message in the composer",
      },
      createElement(CornerDownRight, { size: 13, strokeWidth: 1.8, className: "agent-turn-actions__icon", "aria-hidden": true }),
    ),
    createElement(
      "button",
      {
        type: "button",
        className: "agent-turn-actions__btn agent-turn-actions__btn--retry",
        title: "Retry",
        "aria-label": "Retry this prompt",
      },
      createElement(RotateCcw, { size: 13, strokeWidth: 1.8, className: "agent-turn-actions__icon", "aria-hidden": true }),
    ),
  );
}

// A provider tool call/result renders as a compact log entry: a small header
// with the result/call marker and provider-native tool name, then the bounded
// args/output in a monospace body — visually distinct from message turns.
function createToolLogTurn(block: AgentChatBlockView): ReactElement | null {
  const isResult = block.kind === "tool_result";
  const body = renderToolBody(block);
  // Drop empty tool entries (e.g. a "← Read" result with no captured output) —
  // a lone header marker is noise.
  if (body === null) {
    return null;
  }
  return createElement(
    "article",
    {
      key: block.blockId,
      className: `agent-session-turn agent-session-turn--tool agent-session-turn--tool-${
        isResult ? "result" : "call"
      }`,
      "data-block-id": block.blockId,
      "data-block-kind": block.kind,
      "data-block-status": block.status,
      "data-block-role": "tool",
    },
    // A call shows a quiet tool-name label; a result drops the (repeated) label
    // and just shows its output flowing under the call. No arrow markers.
    isResult
      ? null
      : createElement("span", { className: "agent-session-turn__tool-name" }, block.title),
    body,
  );
}

function renderToolBody(block: AgentChatBlockView): ReactNode {
  if (block.body.length === 0) {
    return null;
  }
  // Read/view file calls render as a file chip (icon + name + dir), not raw
  // file_path/offset/limit args.
  if (block.kind === "tool_call" && categorizeTool(block.title) === "read") {
    const path = readToolFilePath(block.body);
    if (path !== undefined) {
      return renderFileChip(path);
    }
  }
  // Edits render as a +/- diff (Codex/Claude-app style) when we can derive one.
  const diff = block.kind === "tool_call" ? editDiffLines(block.title, block.body) : null;
  if (diff !== null && diff.length > 0) {
    const adds = diff.filter((line) => line.kind === "add").length;
    const dels = diff.filter((line) => line.kind === "del").length;
    // One language for the whole diff so every line (incl. continuations) is
    // highlighted consistently.
    const diffLang = guessLanguage(diff.map((line) => line.text).join("\n"));
    return createElement(
      "div",
      { className: "agent-session-turn__diff" },
      createElement(
        "div",
        { className: "agent-session-turn__diff-stat" },
        adds > 0 ? createElement("span", { className: "diff-stat--add" }, `+${adds}`) : null,
        dels > 0 ? createElement("span", { className: "diff-stat--del" }, `-${dels}`) : null,
      ),
      createElement(
        "div",
        { className: "agent-session-turn__diff-body" },
        diff.map((line, index) =>
          createElement(
            "div",
            { key: index, className: `diff-line diff-line--${line.kind}` },
            createElement(
              "span",
              { className: "diff-line__sign", "aria-hidden": true },
              line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ",
            ),
            createElement("span", {
              className: "diff-line__text",
              dangerouslySetInnerHTML: { __html: highlightToHtml(line.text, diffLang) },
            }),
          ),
        ),
      ),
    );
  }
  return createElement("pre", {
    className: "agent-session-turn__tool-body",
    dangerouslySetInnerHTML: { __html: highlightToHtml(toolBodyText(block.title, block.body)) },
  });
}

// Tool args arrive as a JSON string (e.g. {"command":"cd …\npkill …"}), which
// renders with ugly escaped \n / \". Extract the meaningful payload: the shell
// command for run tools, otherwise pretty-print the args object.
export function toolBodyText(toolName: string, body: string): string {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return body;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Bounded args may be truncated past valid JSON; show as-is.
    return body;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return body;
  }
  const record = parsed as Record<string, unknown>;
  const command = record.command ?? record.cmd ?? record.CommandLine;
  if (typeof command === "string") {
    return command;
  }
  if (Array.isArray(command)) {
    return command.map((part) => String(part)).join(" ");
  }
  // Edit/write/patch tools carry the file content as a string field. Show it with
  // REAL newlines (optionally headed by the path) instead of an escaped blob —
  // JSON.stringify would re-escape \n/\" inside those string values.
  const path = pickStringField(record, ["file_path", "filePath", "path", "AbsolutePath", "TargetFile"]);
  const content = pickStringField(record, [
    "new_string", "newString", "content", "file_text", "contents", "text", "code", "patch", "diff", "body",
  ]);
  if (content !== undefined) {
    return path !== undefined ? `${path}\n\n${content}` : content;
  }
  // Otherwise render key: value lines (multiline values kept raw, not escaped).
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return body;
  }
  return entries
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n");
}

interface DiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
}

// Builds a +/- diff for an edit tool from its JSON args, so edits render like a
// real diff instead of a wall of new text. Returns null for non-edit tools or
// args too large to diff cheaply.
export function editDiffLines(toolName: string, body: string): DiffLine[] | null {
  const trimmed = body.trim();
  // codex apply_patch: the body is (or contains) a unified-ish patch already.
  if ((/patch/i.test(toolName) || trimmed.includes("*** ")) && trimmed.includes("\n")) {
    return parsePatchLines(trimmed);
  }
  if (!trimmed.startsWith("{")) {
    return null;
  }
  let record: Record<string, unknown>;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null) return null;
    record = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const patch = pickStringField(record, ["patch", "diff"]);
  if (patch !== undefined) {
    return parsePatchLines(patch);
  }
  const oldText = pickStringField(record, ["old_string", "oldString", "old"]);
  const newText = pickStringField(record, ["new_string", "newString", "new"]);
  if (oldText !== undefined && newText !== undefined) {
    return lineDiff(oldText, newText);
  }
  // Write/create: all-additions.
  const content = pickStringField(record, ["content", "file_text", "contents"]);
  if (content !== undefined && pickStringField(record, ["file_path", "filePath", "path"]) !== undefined) {
    return content.split("\n").map((text) => ({ kind: "add" as const, text }));
  }
  return null;
}

function parsePatchLines(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("@@") || raw.startsWith("*** ")) {
      continue;
    }
    if (raw.startsWith("+")) lines.push({ kind: "add", text: raw.slice(1) });
    else if (raw.startsWith("-")) lines.push({ kind: "del", text: raw.slice(1) });
    else lines.push({ kind: "ctx", text: raw.startsWith(" ") ? raw.slice(1) : raw });
  }
  return lines;
}

// LCS line diff. Bounded: very large inputs fall back to null (plain render).
function lineDiff(oldText: string, newText: string): DiffLine[] | null {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  if (a.length > 600 || b.length > 600) {
    return null;
  }
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: "ctx", text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", text: a[i] });
      i += 1;
    } else {
      out.push({ kind: "add", text: b[j] });
      j += 1;
    }
  }
  while (i < m) out.push({ kind: "del", text: a[i++] });
  while (j < n) out.push({ kind: "add", text: b[j++] });
  return out;
}

// The file path a read/view tool targets (e.g. {"file_path":"…"} or DirectoryPath).
function readToolFilePath(body: string): string | undefined {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }
  try {
    const record = JSON.parse(trimmed) as Record<string, unknown>;
    return pickStringField(record, [
      "file_path", "filePath", "path", "AbsolutePath", "TargetFile", "DirectoryPath", "abs_path",
    ]);
  } catch {
    return undefined;
  }
}

// A compact file reference chip: filetype icon + filename + directory.
function renderFileChip(path: string): ReactElement {
  const slash = path.lastIndexOf("/");
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dir = slash === -1 ? "" : path.slice(0, slash);
  return createElement(
    "button",
    {
      type: "button",
      className: "agent-session-turn__file-chip",
      "data-open-file": path,
      title: `Open ${name} in the Workbench`,
    },
    createElement(fileIconFor(name), { size: 14, strokeWidth: 1.85, "aria-hidden": true }),
    createElement("span", { className: "agent-session-turn__file-chip-name" }, name),
    dir.length > 0
      ? createElement("span", { className: "agent-session-turn__file-chip-dir" }, dir)
      : null,
  );
}

function pickStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

// A run of tool calls/results renders as ONE muted Codex-style summary line
// ("Edited 1 file, ran 2 commands"), expandable to the individual tool entries.
function ToolActivityGroup({ blocks }: { blocks: AgentChatBlockView[] }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeToolActivity(blocks);
  return createElement(
    "article",
    {
      className: `agent-session-tools${expanded ? " agent-session-tools--expanded" : ""}`,
      "data-block-role": "tool",
      "data-tool-count": blocks.length,
    },
    createElement(
      "button",
      {
        type: "button",
        className: "agent-session-tools__summary",
        "aria-expanded": expanded,
        onClick: () => setExpanded((value) => !value),
      },
      createElement(Wrench, { className: "agent-session-tools__icon", size: 14, "aria-hidden": true }),
      createElement("span", { className: "agent-session-tools__summary-text" }, summary),
      createElement(ChevronDown, { className: "agent-session-tools__chevron", size: 13, "aria-hidden": true }),
    ),
    createFilesChangedList(blocks),
    expanded
      ? createElement(
          "div",
          { className: "agent-session-tools__detail" },
          blocks.map(createToolLogTurn),
        )
      : null,
  );
}

// Codex-style "files changed" list: the distinct files edited by this tool group.
function createFilesChangedList(blocks: AgentChatBlockView[]): ReactElement | null {
  const paths = distinctEditedPaths(blocks);
  if (paths.length === 0) {
    return null;
  }
  return createElement(
    "div",
    { className: "agent-session-tools__files" },
    paths.map((path) => {
      const slash = path.lastIndexOf("/");
      const name = slash === -1 ? path : path.slice(slash + 1);
      const dir = slash === -1 ? "" : path.slice(0, slash);
      return createElement(
        "button",
        {
          key: path,
          type: "button",
          className: "agent-session-tools__file",
          "data-open-file": path,
          title: `Open ${name} in the Workbench`,
        },
        createElement(fileIconFor(name), { className: "agent-session-tools__file-icon", size: 13, "aria-hidden": true }),
        createElement("span", { className: "agent-session-tools__file-name" }, name),
        dir.length > 0
          ? createElement("span", { className: "agent-session-tools__file-dir" }, dir)
          : null,
      );
    }),
  );
}

function distinctEditedPaths(blocks: AgentChatBlockView[]): string[] {
  const seen = new Set<string>();
  for (const block of blocks) {
    if (block.kind !== "tool_call" || categorizeTool(block.title) !== "edit") continue;
    for (const path of editedPathsFromArgs(block.title, block.body)) {
      seen.add(path);
    }
  }
  return [...seen];
}

// Best-effort extraction of edited file paths from a tool call's bounded args.
function editedPathsFromArgs(toolName: string, body: string): string[] {
  // codex apply_patch carries `*** Update/Add/Delete File: <path>` headers.
  if (/patch/i.test(toolName) || body.includes("*** ")) {
    const paths: string[] = [];
    const re = /\*\*\* (?:Update|Add|Delete) File: (.+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(body)) !== null) {
      paths.push(match[1].trim());
    }
    if (paths.length > 0) return paths;
  }
  // claude/antigravity edit tools carry a JSON args object with a path field.
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const path =
        firstString(parsed.file_path) ??
        firstString(parsed.filePath) ??
        firstString(parsed.AbsolutePath) ??
        firstString(parsed.path) ??
        firstString(parsed.TargetFile);
      if (path !== undefined) return [path];
    } catch {
      // Bounded args may be truncated past valid JSON; skip rather than guess.
    }
  }
  return [];
}

function firstString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

type ToolCategory = "edit" | "run" | "search" | "read" | "other";

function categorizeTool(name: string): ToolCategory {
  const lower = name.toLowerCase();
  if (/patch|edit|write|apply|create|str_replace/.test(lower)) return "edit";
  if (/grep|glob|search|find|ripgrep/.test(lower)) return "search";
  if (/exec|run|bash|shell|command/.test(lower)) return "run";
  if (/view|read|list|cat|dir|\bls\b/.test(lower)) return "read";
  return "other";
}

// Aggregates the group's tool_call blocks into a Codex-style summary phrase.
function summarizeToolActivity(blocks: AgentChatBlockView[]): string {
  const counts: Record<ToolCategory, number> = { edit: 0, read: 0, search: 0, run: 0, other: 0 };
  let calls = 0;
  for (const block of blocks) {
    if (block.kind !== "tool_call") continue;
    calls += 1;
    counts[categorizeTool(block.title)] += 1;
  }
  // If a group somehow carries only results, fall back to counting them.
  if (calls === 0) {
    counts.other = blocks.length;
  }
  const parts: string[] = [];
  const plural = (n: number, singular: string) => `${n} ${singular}${n === 1 ? "" : "s"}`;
  if (counts.edit > 0) parts.push(`edited ${plural(counts.edit, "file")}`);
  if (counts.read > 0) parts.push(`read ${plural(counts.read, "file")}`);
  if (counts.search > 0) parts.push(plural(counts.search, "search").replace("searchs", "searches"));
  if (counts.run > 0) parts.push(`ran ${plural(counts.run, "command")}`);
  if (counts.other > 0) parts.push(plural(counts.other, "tool call"));
  const joined = parts.join(", ");
  return joined.length === 0 ? "Tool activity" : joined.charAt(0).toUpperCase() + joined.slice(1);
}

function createComposer(
  viewModel: AgentChatShellViewModel,
  handlers: ComposerHandlers,
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
    createElement(
      "div",
      { className: "composer-shell__body" },
      createElement("textarea", {
        "aria-label": "Composer draft",
        className: "composer-shell__input",
        ref: handlers.inputRef,
        // One row at rest (CSS min-height sets the floor per mode); the input
        // grows with content via CSS field-sizing in Chromium.
        rows: 1,
        value: viewModel.composer.draft,
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) =>
          handlers.onDraftChange?.(event.currentTarget.value),
        // Enter sends; Shift+Enter inserts a newline. Never submit mid-IME
        // composition (Korean/Japanese candidate selection) — that Enter commits
        // the candidate, not the message. `isComposing`/keyCode 229 guard it.
        onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            event.keyCode !== 229
          ) {
            event.preventDefault();
            handlers.onSubmit?.();
          }
        },
        onPaste: (event: ClipboardEvent) =>
          handleComposerPaste(event, handlers.onAddAttachment),
        placeholder: isStartComposer ? "Do anything" : "Ask for follow-up changes",
      }),
      viewModel.composer.attachments.length > 0
        ? createElement(
            "div",
            { className: "composer-shell__attachments" },
            viewModel.composer.attachments.map((attachment) =>
              createElement(
                "div",
                { key: attachment.id, className: "composer-shell__attachment" },
                createElement(
                  "button",
                  {
                    type: "button",
                    className: "composer-shell__attachment-open",
                    title: "Preview image",
                    "aria-label": `Preview ${attachment.name}`,
                    onClick: () => handlers.onPreviewAttachment?.(attachment.previewUrl),
                  },
                  createElement("img", {
                    className: "composer-shell__attachment-thumb",
                    src: attachment.previewUrl,
                    alt: attachment.name,
                  }),
                ),
                createElement(
                  "button",
                  {
                    type: "button",
                    className: "composer-shell__attachment-remove",
                    title: "Remove attachment",
                    "aria-label": `Remove ${attachment.name}`,
                    onClick: () => handlers.onRemoveAttachment?.(attachment.id),
                  },
                  createElement(X, { size: 12, strokeWidth: 2.2, "aria-hidden": true }),
                ),
              ),
            ),
          )
        : null,
      viewModel.composer.contextChips.length > 0
        ? createElement(
            "div",
            { className: "composer-shell__chips" },
            viewModel.composer.contextChips.map((chip) =>
              createElement(
                "div",
                { key: chip.id, className: `composer-chip-card composer-chip-card--${chip.kind}` },
                createElement(
                  "div",
                  { className: "composer-chip-card__head" },
                  createElement(contextChipIcon(chip.kind), {
                    size: 13,
                    strokeWidth: 1.9,
                    className: "composer-chip-card__icon",
                    "aria-hidden": true,
                  }),
                  createElement("span", { className: "composer-chip-card__label" }, chip.label),
                  createElement("span", { className: "composer-chip-card__kind" }, chip.kind),
                  createElement(
                    "button",
                    {
                      type: "button",
                      className: "composer-chip-card__remove",
                      title: "Remove",
                      "aria-label": `Remove ${chip.label}`,
                      onClick: () => handlers.onRemoveContextChip?.(chip.id),
                    },
                    createElement(X, { size: 15, strokeWidth: 2.2, "aria-hidden": true }),
                  ),
                ),
                createElement("textarea", {
                  className: "composer-chip-card__comment",
                  placeholder: "Comment on this selection… (Enter to send, Shift+Enter for newline)",
                  value: chip.comment,
                  rows: 1,
                  spellCheck: false,
                  "aria-label": `Comment for ${chip.label}`,
                  onChange: (event: ChangeEvent<HTMLTextAreaElement>) =>
                    handlers.onSetContextChipComment?.(chip.id, event.currentTarget.value),
                  // Match the composer: Enter sends, Shift+Enter inserts a newline.
                  onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      handlers.onSubmit?.();
                    }
                  },
                }),
              ),
            ),
          )
        : null,
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
            onClick: (event: { currentTarget: HTMLElement }) =>
              handlers.onOpenSurface?.("composer_options", chipAnchorFromEvent(event)),
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
            onClick: (event: { currentTarget: HTMLElement }) =>
              handlers.onOpenSurface?.("permission_menu", chipAnchorFromEvent(event)),
          },
          // Figma: shield-check icon + label + chevron-down.
          createElement(ShieldCheck, { size: 14, strokeWidth: 1.9, className: "composer-shell__chip-icon", "aria-hidden": true }),
          createElement("span", { className: "composer-shell__chip-label" }, viewModel.composer.permissionLabel),
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
            onClick: (event: { currentTarget: HTMLElement }) =>
              handlers.onOpenSurface?.("model_menu", chipAnchorFromEvent(event)),
          },
          // Figma: label + chevron-down (no leading icon).
          createElement("span", { className: "composer-shell__chip-label" }, viewModel.composer.modelLabel),
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
        // While the agent runs with an EMPTY composer, the button is Stop (interrupt).
        // Start typing a follow-up and it becomes Send so you can queue it. Interrupt
        // while a draft/queue exists lives on the queued rows instead (createQueuedSteerStack).
        viewModel.chatState === "running" && viewModel.composer.draft.trim().length === 0
          ? createComposerStopButton(handlers.onInterrupt)
          : createComposerSendButton(viewModel.composer.submitLabel),
      ),
    ),
  );
}

// Submit button: queues the draft (mid-run) or starts the turn (idle).
function createComposerSendButton(label: string): ReactElement {
  return createElement(
    "button",
    { key: "send", type: "submit", className: "composer-shell__send", title: label, "aria-label": label },
    createElement(ArrowUp, { size: 17, strokeWidth: 2.4, "aria-hidden": true }),
    createElement("span", { className: "visually-hidden" }, label),
  );
}

// Stop button: interrupts the live turn (a queued follow-up then runs next).
function createComposerStopButton(onInterrupt?: () => void): ReactElement {
  return createElement(
    "button",
    {
      key: "stop",
      type: "button",
      className: "composer-shell__send composer-shell__send--stop",
      title: "Interrupt",
      "aria-label": "Interrupt",
      onClick: () => onInterrupt?.(),
    },
    createElement(Square, { size: 13, strokeWidth: 0, fill: "currentColor", "aria-hidden": true }),
    createElement("span", { className: "visually-hidden" }, "Interrupt"),
  );
}

function createComposerStack(
  viewModel: AgentChatShellViewModel,
  handlers: ComposerHandlers,
): ReactElement {
  return createElement(
    "div",
    { className: "agent-chat-shell__composer-stack" },
    // composer.activeSurface (chip dropdown) is rendered as an anchored popover
    // by AgentChatShell. Provider readiness and prompt cards remain in flow.
    ...createProviderReadiness(viewModel, handlers.onChoiceSurfaceRowSelect),
    viewModel.prompt
      ? createElement(PromptCard, {
          key: viewModel.prompt.promptId,
          prompt: viewModel.prompt,
          onSelectChoice: (choiceId: string) =>
            handlers.onChoiceSurfaceRowSelect?.("prompt_state", choiceId),
          onAnswerText: (value: string) => handlers.onAnswerPromptText?.(value),
        })
      : null,
    viewModel.usage ? createUsageMeter(viewModel.usage) : null,
    // Messages queued behind a live turn dock here, atop the Composer (Codex-style
    // "steer"): a FIFO stack, each visible as pending and editable before it runs.
    viewModel.queuedInputs.length > 0 && viewModel.chatState === "running"
      ? createQueuedSteerStack(
          viewModel.queuedInputs,
          handlers.onEditQueued,
          handlers.onInterrupt,
          handlers.onRemoveQueued,
        )
      : null,
    createComposer(viewModel, handlers),
  );
}

// The pending "steer" messages docked to the top of the Composer while a turn is
// live: a FIFO stack of queued follow-ups. Each row carries three controls —
// 인터럽트 (cut the live turn so the queue runs now), 수정 (pull it back into the
// Composer to edit), and 삭제 (discard it). The stack is height-capped and scrolls
// (CSS), so a long queue never pushes the Composer off-screen.
function createQueuedSteerStack(
  queuedInputs: string[],
  onEditQueued?: (index: number) => void,
  onInterrupt?: () => void,
  onRemoveQueued?: (index: number) => void,
): ReactElement {
  return createElement(
    "div",
    { className: "composer-steer-stack" },
    ...queuedInputs.map((queuedInput, index) =>
      createElement(
        "div",
        { key: `steer-${index}`, className: "composer-steer", "data-queued": true },
        createElement(CornerDownRight, {
          size: 13,
          strokeWidth: 1.9,
          className: "composer-steer__icon",
          "aria-hidden": true,
        }),
        createElement("span", { className: "composer-steer__badge" }, "대기 중"),
        createElement("span", { className: "composer-steer__text" }, queuedInput),
        createElement(
          "span",
          { className: "composer-steer__actions" },
          // 인터럽트: cut the live turn so the queue runs now.
          createElement(
            "button",
            {
              type: "button",
              className: "composer-steer__interrupt",
              "aria-label": "Interrupt the current turn and run the queue",
              title: "끊고 실행 (인터럽트)",
              onClick: () => onInterrupt?.(),
            },
            createElement(Square, { size: 11, strokeWidth: 0, fill: "currentColor", "aria-hidden": true }),
          ),
          // 수정: pull this message back into the Composer to edit.
          createElement(
            "button",
            {
              type: "button",
              className: "composer-steer__edit",
              "aria-label": "Edit queued message",
              title: "수정",
              onClick: () => onEditQueued?.(index),
            },
            "수정",
          ),
          // 삭제: discard this queued message.
          createElement(
            "button",
            {
              type: "button",
              className: "composer-steer__delete",
              "aria-label": "Delete queued message",
              title: "삭제",
              onClick: () => onRemoveQueued?.(index),
            },
            createElement(Trash2, { size: 13, strokeWidth: 1.9, "aria-hidden": true }),
          ),
        ),
      ),
    ),
  );
}

// A unified, pretty prompt card for any agent's question / approval / choice /
// permission request: the message, selectable options (with their provider
// values), an "Other" free-text reply, and Skip / Submit. Replaces the generic
// menu-style rendering so every provider's prompt looks the same.
function PromptCard(props: {
  prompt: NonNullable<AgentChatShellViewModel["prompt"]>;
  onSelectChoice: (choiceId: string) => void;
  onAnswerText: (value: string) => void;
}): ReactElement {
  const choices = props.prompt.choices ?? [];
  const hasChoices = choices.length > 0;
  const [selectedId, setSelectedId] = useState<string | null>(
    props.prompt.defaultChoiceId ?? null,
  );
  const [otherActive, setOtherActive] = useState(!hasChoices);
  const [otherText, setOtherText] = useState("");
  const canSubmit = otherActive ? otherText.trim().length > 0 : selectedId !== null;
  const submit = () => {
    if (otherActive) {
      if (otherText.trim().length > 0) {
        props.onAnswerText(otherText.trim());
      }
      return;
    }
    if (selectedId !== null) {
      props.onSelectChoice(selectedId);
    }
  };
  // Keyboard: ↑/↓ move between options (incl. "Other…"), ⌘/Ctrl+Enter submits from
  // anywhere in the card (including the free-text field). The composer's own keys
  // are never hijacked. Mirrors the "⌘↵" hint on the Submit button.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inEditable =
        target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
      if (inEditable && target?.closest(".prompt-card") === null) {
        return;
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submit();
        return;
      }
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !inEditable) {
        const ids = [...choices.map((choice) => choice.choiceId), ...(hasChoices ? ["__other"] : [])];
        if (ids.length === 0) {
          return;
        }
        event.preventDefault();
        const current = otherActive
          ? ids.indexOf("__other")
          : selectedId !== null
          ? ids.indexOf(selectedId)
          : -1;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex =
          current < 0 ? (delta > 0 ? 0 : ids.length - 1) : (current + delta + ids.length) % ids.length;
        const nextId = ids[nextIndex];
        if (nextId === "__other") {
          setOtherActive(true);
          setSelectedId(null);
        } else {
          setOtherActive(false);
          setSelectedId(nextId);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [choices, hasChoices, otherActive, selectedId, otherText, props]);
  const kindLabel =
    props.prompt.kind === "approval"
      ? "Approval needed"
      : props.prompt.kind === "permission"
      ? "Permission needed"
      : props.prompt.kind === "choice"
      ? "Choose an option"
      : "Question";
  const option = (
    key: string,
    label: string,
    detail: string | undefined,
    selected: boolean,
    onClick: () => void,
  ) =>
    createElement(
      "button",
      {
        key,
        type: "button",
        className: "prompt-card__option",
        "data-selected": selected ? "true" : "false",
        onClick,
      },
      createElement("span", { className: "prompt-card__radio", "aria-hidden": true }),
      createElement("span", { className: "prompt-card__option-label" }, label),
      detail ? createElement("span", { className: "prompt-card__option-value" }, detail) : null,
    );
  return createElement(
    "div",
    { className: "prompt-card", role: "group", "aria-label": "Agent prompt" },
    createElement(
      "div",
      { className: "prompt-card__head" },
      createElement("span", { className: "prompt-card__kind" }, kindLabel),
      createElement("p", { className: "prompt-card__message" }, props.prompt.message),
    ),
    createElement(
      "div",
      { className: "prompt-card__options" },
      ...choices.map((choice) =>
        option(
          choice.choiceId,
          choice.label,
          choice.providerValue && choice.providerValue !== choice.label ? choice.providerValue : undefined,
          !otherActive && selectedId === choice.choiceId,
          () => {
            setOtherActive(false);
            setSelectedId(choice.choiceId);
          },
        ),
      ),
      hasChoices
        ? option("__other", "Other…", undefined, otherActive, () => {
            setOtherActive(true);
            setSelectedId(null);
          })
        : null,
      otherActive
        ? createElement("textarea", {
            className: "prompt-card__other",
            placeholder: hasChoices ? "Type a custom reply…" : "Type your reply…",
            value: otherText,
            rows: hasChoices ? 2 : 3,
            autoFocus: true,
            spellCheck: false,
            "aria-label": "Custom reply",
            onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setOtherText(event.currentTarget.value),
            onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            },
          })
        : null,
    ),
    createElement(
      "div",
      { className: "prompt-card__actions" },
      createElement(
        "button",
        { type: "button", className: "prompt-card__skip", onClick: () => props.onAnswerText("") },
        "Skip",
      ),
      createElement(
        "button",
        {
          type: "button",
          className: "prompt-card__submit",
          disabled: !canSubmit,
          onClick: submit,
        },
        "Submit",
        createElement("span", { className: "prompt-card__submit-kbd" }, "⌘↵"),
      ),
    ),
  );
}

// A quiet context/token usage chip above the composer (Codex-app style): an
// optional thin context-window meter, then the percent + token labels. Shown
// only when the provider has reported usage for the active thread.
function createUsageMeter(usage: NonNullable<AgentChatShellViewModel["usage"]>): ReactElement {
  const parts: ReactNode[] = [];
  if (usage.contextUsedPercent !== undefined) {
    parts.push(
      createElement(
        "span",
        { key: "bar", className: "agent-usage__bar", "aria-hidden": true },
        createElement("span", {
          className: "agent-usage__bar-fill",
          style: { width: `${Math.max(2, Math.min(100, usage.contextUsedPercent))}%` },
        }),
      ),
    );
  }
  const text = [
    usage.contextPercentLabel ? `${usage.contextPercentLabel} context` : undefined,
    usage.tokensLabel,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" · ");
  parts.push(createElement("span", { key: "text", className: "agent-usage__text" }, text));
  return createElement(
    "div",
    { className: "agent-usage", "aria-label": "Context usage" },
    ...parts,
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
  handlers: ComposerHandlers,
): ReactElement {
  return createElement(
    "button",
    {
      key: `${item.label}:${item.value}`,
      className: "composer-shell__context-chip",
      "data-context-kind": item.label.toLowerCase(),
      "data-agent-runtime-source": item.runtimeSourceKind,
      type: "button",
      onClick: (event: { currentTarget: HTMLElement }) =>
        handlers.onOpenSurface?.(surfaceForContextItem(item), chipAnchorFromEvent(event)),
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
    rows.map((row) => {
      const rowButton = createElement(
        "button",
        {
          key: row.rowId,
          type: "button",
          className: `choice-surface__row${row.danger ? " choice-surface__row--danger" : ""}${
            row.disabled ? " choice-surface__row--disabled" : ""
          }`,
          "data-selected": row.selected ? "true" : "false",
          disabled: row.disabled === true,
          "aria-disabled": row.disabled === true,
          onClick: row.disabled ? undefined : () => onRowSelect?.(surface.surfaceKind, row.rowId),
        },
        createElement("span", { className: "choice-surface__row-icon", "aria-hidden": true }, choiceRowIcon(row.icon)),
        createElement("span", { className: "choice-surface__row-label" }, row.label),
        row.detail ? createElement("span", { className: "choice-surface__row-detail" }, row.detail) : null,
        row.meta ? createElement("span", { className: "choice-surface__row-meta" }, row.meta) : null,
      );
      // A trailing affordance (e.g. delete a worktree) routes through the same
      // row-select callback with its own rowId; can't nest in the row button, so
      // wrap both in a row container. Rows without an action stay a bare button.
      if (row.action === undefined) {
        return rowButton;
      }
      const action = row.action;
      return createElement(
        "div",
        { key: row.rowId, className: "choice-surface__row-wrap" },
        rowButton,
        createElement(
          "button",
          {
            type: "button",
            className: "choice-surface__row-action",
            "aria-label": action.label,
            title: action.label,
            onClick: () => onRowSelect?.(surface.surfaceKind, action.rowId),
          },
          choiceRowIcon(action.icon),
        ),
      );
    }),
  );
}

// Choice-surface rows carry a semantic icon key (e.g. "folder", "check") which
// the renderer maps to a lucide icon. Unknown values render as the literal glyph
// (legacy menus still pass glyph strings until they migrate to keys).
// Two-letter provider monogram (Codex/Claude both start with C, hence distinct
// 2-char codes). Mirrors agentMonogram() in tide-product-shell.
function agentMonogramFor(agentId: string): string {
  switch (agentId) {
    case "claude":
      return "Cl";
    case "gemini":
      return "Ge";
    case "opencode":
      return "Oc";
    case "antigravity":
      return "Ag";
    case "openai_api":
      return "AI";
    default:
      return "Co";
  }
}

function choiceRowIcon(icon: string | undefined): ReactNode {
  if (icon === undefined || icon === "") {
    return null;
  }
  // Per-agent identity monogram badge (same mark used in Thread rows and the
  // composer agent chip), keyed as "identity:<agentId>".
  if (icon.startsWith("identity:")) {
    const agentId = icon.slice("identity:".length) || "codex";
    return createElement(
      "span",
      { className: `agent-identity-icon agent-identity-icon--${agentId}`, "aria-hidden": true },
      agentMonogramFor(agentId),
    );
  }
  const lucide: Record<string, ReactNode> = {
    check: createElement(Check, { size: 15, strokeWidth: 2 }),
    folder: createElement(Folder, { size: 15, strokeWidth: 1.85 }),
    "folder-plus": createElement(FolderPlus, { size: 15, strokeWidth: 1.85 }),
    scratch: createElement(FileText, { size: 15, strokeWidth: 1.85 }),
    branch: createElement(GitBranch, { size: 15, strokeWidth: 1.85 }),
    plus: createElement(Plus, { size: 15, strokeWidth: 2 }),
    source: createElement(Layers, { size: 15, strokeWidth: 1.85 }),
    agent: createElement(Bot, { size: 15, strokeWidth: 1.85 }),
    attach: createElement(Paperclip, { size: 15, strokeWidth: 1.85 }),
    file: createElement(FileText, { size: 15, strokeWidth: 1.85 }),
    panel: createElement(PanelsTopLeft, { size: 15, strokeWidth: 1.85 }),
    tool: createElement(Wrench, { size: 15, strokeWidth: 1.85 }),
    trash: createElement(Trash2, { size: 14, strokeWidth: 1.85 }),
  };
  // Unknown values render nothing rather than leaking a stray glyph string.
  return lucide[icon] ?? null;
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

function contextItemIcon(item: AgentChatContextItem): ReactNode {
  const props = { size: 13, strokeWidth: 1.85, "aria-hidden": true } as const;
  switch (item.label) {
    case "Agent":
      // Use the same per-agent identity monogram badge shown in Thread rows.
      return createElement(
        "span",
        {
          className: `agent-identity-icon agent-identity-icon--${item.agentId ?? "codex"}`,
          "aria-hidden": true,
        },
        agentMonogramFor(item.agentId ?? "codex"),
      );
    case "Project":
      return createElement(Folder, props);
    case "Scratch":
      return createElement(FileText, props);
    case "Worktree":
      return createElement(FolderGit2, props);
    case "Branch":
      return createElement(GitBranch, props);
  }
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
