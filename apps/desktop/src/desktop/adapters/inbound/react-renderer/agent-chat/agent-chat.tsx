import type { AgentChatShellProps, AnchorRect } from "./support/types.ts";
import { createAgentSession } from "./transcript/transcript.tsx";
import { createChipPopover } from "./composer/context-chips.tsx";
import { attachImageFile } from "./composer/attachments.ts";
import { createNewThreadStartSurface } from "./start-surface/start-surface.tsx";
import { createThreadHeader } from "./thread-header/thread-header.tsx";
import { createComposerStack } from "./composer/composer.tsx";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactElement,
} from "react";

import {
  CornerDownRight,
} from "lucide-react";

import type {
  AgentChatChoiceSurfaceView,
  AgentChatComposerSurfaceKind,
} from "../../../../application/domains/agent-chat/agent-chat.ts";

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
    onOpencodeConnectApiKey: props.onOpencodeConnectApiKey,
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
        onOpencodeConnectApiKey: handlers.onOpencodeConnectApiKey,
        onClose: closeSurface,
      })
    : null;

  // Native file picker for the "Files and images" action: reads picked images as
  // base64 attachments (same path as paste). Hidden; triggered programmatically.
  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      multiple
      style={{ display: "none" }}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        const files = event.currentTarget.files;
        if (files && props.onAddAttachment) {
          for (const file of Array.from(files)) {
            attachImageFile(file, props.onAddAttachment);
          }
        }
        event.currentTarget.value = "";
      }}
    />
  );

  const lightbox =
    imagePreview === null ? null : (
      <div
        className="image-lightbox-backdrop"
        role="dialog"
        aria-label="Image preview"
        onClick={() => setImagePreview(null)}
      >
        <img className="image-lightbox__img" src={imagePreview} alt="Attachment preview" />
      </div>
    );

  if (isNewThreadStart) {
    return (
      <main
        className="agent-chat-shell agent-chat-shell--start"
        data-chat-state={viewModel.chatState}
        data-runtime-state={viewModel.runtimeState}
      >
        {createNewThreadStartSurface(viewModel, handlers)}
        {popover}
        {lightbox}
        {fileInput}
      </main>
    );
  }

  return (
    <main
      className={`agent-chat-shell${props.showThreadHeader === false ? " agent-chat-shell--embedded" : ""}`}
      data-chat-state={viewModel.chatState}
      data-runtime-state={viewModel.runtimeState}
    >
      {props.showThreadHeader === false ? null : createThreadHeader(viewModel)}
      {sessionView}
      {createComposerStack(viewModel, handlers)}
      {transcriptSel === null || props.onQuote === undefined ? null : (
        <button
          type="button"
          className="editor-selection-toolbar"
          style={{
            left: `${transcriptSel.x}px`,
            top: `${Math.max(transcriptSel.y - 36, 8)}px`,
          } as CSSProperties}
          onMouseDown={(event: { preventDefault: () => void }) => {
            event.preventDefault();
            props.onQuote?.(transcriptSel.text.trim());
            setTranscriptSel(null);
          }}
        >
          <CornerDownRight size={13} strokeWidth={1.9} aria-hidden />
          Add to chat
        </button>
      )}
      {popover}
      {lightbox}
      {fileInput}
    </main>
  );
}

// Decomposed into ./agent-chat/ (spec: navigable-source-structure). The chat shell
// component stays here; moved pieces are re-exported for path compatibility.
export { toolBodyText } from "./transcript/tool-log.tsx";
export { editDiffLines } from "./transcript/tool-diff.ts";
export type { AgentChatShellProps } from "./support/types.ts";
