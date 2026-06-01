import {
  createElement,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CSSProperties,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import MarkdownIt from "markdown-it";
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  FileText,
  Folder,
  FolderGit2,
  FolderPlus,
  GitBranch,
  Layers,
  Mic,
  PanelsTopLeft,
  Paperclip,
  Plus,
  ShieldCheck,
  Square,
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
  onComposerSurfaceChange?: (surface: AgentChatComposerSurfaceKind | null) => void;
  onChoiceSurfaceRowSelect?: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
  ) => void;
  // Opens a file (from a Read tool's file chip) in the Workbench editor.
  onOpenFile?: (path: string) => void;
  // A pasted image attachment: name, mediaType, and base64 of the image bytes.
  onAddAttachment?: (attachment: {
    name: string;
    mediaType: string;
    dataBase64: string;
  }) => void;
  onRemoveAttachment?: (attachmentId: string) => void;
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
  // On entering a thread, jump to the most recent message (not the top).
  const threadId = viewModel.thread?.threadId;
  useEffect(() => {
    const el = sessionRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [threadId]);
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
    onComposerSurfaceChange: props.onComposerSurfaceChange,
    onOpenSurface: openSurface,
    onChoiceSurfaceRowSelect: props.onChoiceSurfaceRowSelect,
    onAddAttachment: props.onAddAttachment,
    onRemoveAttachment: props.onRemoveAttachment,
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
        onRowSelect: props.onChoiceSurfaceRowSelect,
        onClose: closeSurface,
      })
    : null;

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
    createAgentSession(viewModel.blocks, viewModel.chatState, viewModel.queuedInput, props.onOpenFile, sessionRef),
    createComposerStack(viewModel, handlers),
    popover,
    lightbox,
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
}

interface ComposerHandlers {
  onDraftChange?: (draft: string) => void;
  onSubmit?: () => void;
  onInterrupt?: () => void;
  onComposerSurfaceChange?: (surface: AgentChatComposerSurfaceKind | null) => void;
  onOpenSurface?: (surface: AgentChatComposerSurfaceKind, rect: AnchorRect) => void;
  onChoiceSurfaceRowSelect?: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
  ) => void;
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
          // writes the provider's own trust config (no terminal drop).
          ...(blocker.kind === "directory_trust_required"
            ? [
                {
                  rowId: "directory_trust_required:trust",
                  label: "Trust this folder",
                  detail: "grant workspace trust",
                  icon: "✓",
                },
              ]
            : []),
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

function createQueuedInputRow(queuedInput: string): ReactElement {
  return createElement(
    "article",
    {
      className: "agent-session-turn agent-session-turn--user agent-session-turn--queued",
      "data-block-role": "user",
      "data-queued": true,
    },
    createElement(
      "span",
      { className: "agent-session-turn__label" },
      "You",
      createElement("span", { className: "agent-session-turn__queued-badge" }, "대기 중"),
    ),
    createElement("p", { className: "agent-session-turn__body" }, queuedInput),
  );
}

function createAgentSession(
  blocks: AgentChatBlockView[],
  chatState: AgentChatShellViewModel["chatState"],
  queuedInput: string | null,
  onOpenFile?: (path: string) => void,
  sessionRef?: { current: HTMLElement | null },
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
      onClick: (event: { target: EventTarget | null }) => {
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
        const path = onOpenFile ? target.closest("[data-open-file]")?.getAttribute("data-open-file") : null;
        if (path) {
          onOpenFile?.(path);
        }
      },
    },
    blocks.length === 0 ? null : groupSessionItems(blocks).map(renderSessionItem),
    working ? createElement(AgentWorkingIndicator) : null,
    queuedInput !== null ? createQueuedInputRow(queuedInput) : null,
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
  return item.kind === "toolGroup"
    ? createElement(ToolActivityGroup, { key: item.key, blocks: item.blocks })
    : createAgentSessionTurn(item.block);
}

// Live working indicator with an elapsed timer, so a long turn reads as active
// progress (like "Working… 12s") rather than a static spinner.
function AgentWorkingIndicator(): ReactElement {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);
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
    `<button type="button" class="md-code__copy" data-copy aria-label="Copy code">Copy</button></div>` +
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
      : createElement("p", { className: "agent-session-turn__body" }, block.body),
    block.rawFallback && block.rawFallback !== block.body
      ? createElement("pre", { className: "agent-session-turn__raw" }, block.rawFallback)
      : null,
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
            onClick: (event: { currentTarget: HTMLElement }) =>
              handlers.onOpenSurface?.("model_menu", chipAnchorFromEvent(event)),
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
        viewModel.chatState === "running"
          ? createElement(
              "button",
              {
                type: "button",
                className: "composer-shell__send composer-shell__send--stop",
                title: "Interrupt",
                "aria-label": "Interrupt",
                onClick: () => handlers.onInterrupt?.(),
              },
              createElement(Square, { size: 13, strokeWidth: 0, fill: "currentColor", "aria-hidden": true }),
              createElement("span", { className: "visually-hidden" }, "Interrupt"),
            )
          : createElement(
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
  handlers: ComposerHandlers,
): ReactElement {
  return createElement(
    "div",
    { className: "agent-chat-shell__composer-stack" },
    // composer.activeSurface (chip dropdown) is rendered as an anchored popover
    // by AgentChatShell. Provider readiness and prompt cards remain in flow.
    ...createProviderReadiness(viewModel, handlers.onChoiceSurfaceRowSelect),
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
        createElement("span", { className: "choice-surface__row-icon", "aria-hidden": true }, choiceRowIcon(row.icon)),
        createElement("span", { className: "choice-surface__row-label" }, row.label),
        row.detail ? createElement("span", { className: "choice-surface__row-detail" }, row.detail) : null,
        row.meta ? createElement("span", { className: "choice-surface__row-meta" }, row.meta) : null,
      ),
    ),
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
