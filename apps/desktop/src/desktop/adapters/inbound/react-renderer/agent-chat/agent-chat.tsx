import type { AgentChatShellProps, AnchorRect } from "./support/types.ts";
import { createAgentSession } from "./transcript/transcript.tsx";
import { createChipPopover } from "./composer/context-chips.tsx";
import { attachImageFile } from "./composer/attachments.ts";
import { createNewThreadStartSurface } from "./start-surface/start-surface.tsx";
import { createThreadHeader } from "./thread-header/thread-header.tsx";
import { createComposerStack } from "./composer/composer.tsx";
import { GoalChecklistPanel } from "./goal-checklist/goal-checklist-panel.tsx";
import {
  InPaneFindBar,
  useDomTextFind,
  useInPaneFindState,
  usePaneFindIntent,
} from "../support/in-pane-find.tsx";
import {
  useCallback,
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
  const shellRef = useRef<HTMLElement | null>(null);
  const sessionRef = useRef<HTMLElement | null>(null);
  const transcriptFind = useInPaneFindState();
  // "Add to chat" (a workbench/transcript selection → a context chip) should drop the
  // cursor straight into the NEWLY ADDED chip's comment field, so the user can note what
  // they want about that selection without an extra click. A chip is always appended, so
  // the new one is last; focus it by its id. Only fire on an INCREASE within the SAME
  // thread — chips grow only through an explicit add, so this never steals focus on load
  // or while editing an existing chip's comment. The shell is REUSED across thread
  // switches (not remounted), so the count ref must be re-baselined when the thread
  // changes, or opening a thread whose composer holds chips would read as an "add".
  const threadId = viewModel.thread?.threadId;
  const isNewThreadStart =
    viewModel.composer.mode === "start" &&
    viewModel.blocks.length === 0 &&
    viewModel.providerReadinessBlockers.length === 0 &&
    viewModel.prompt === null;
  const chips = viewModel.composer.contextChips;
  const chipCount = chips.length;
  const lastChipId = chipCount > 0 ? chips[chipCount - 1].id : null;
  const prevChipCountRef = useRef(chipCount);
  const prevThreadIdRef = useRef(threadId);
  useEffect(() => {
    const threadChanged = threadId !== prevThreadIdRef.current;
    prevThreadIdRef.current = threadId;
    if (threadChanged) {
      prevChipCountRef.current = chipCount;
      return;
    }
    if (chipCount > prevChipCountRef.current && lastChipId !== null) {
      // Match by dataset rather than a built selector so any id value is handled safely.
      Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea[data-chip-comment-id]"))
        .find((el) => el.dataset.chipCommentId === lastChipId)
        ?.focus();
    }
    prevChipCountRef.current = chipCount;
  }, [chipCount, lastChipId, threadId]);
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
  const transcriptMatchCount = useDomTextFind({
    rootRef: sessionRef,
    open: transcriptFind.open && !isNewThreadStart,
    query: transcriptFind.query,
    activeIndex: transcriptFind.activeIndex,
    refreshKey: viewModel.blocks,
    onActiveIndexChange: transcriptFind.setActiveIndex,
  });
  usePaneFindIntent(shellRef, {
    enabled: !isNewThreadStart,
    open: transcriptFind.open,
    onOpen: transcriptFind.openFind,
    onClose: transcriptFind.closeFind,
    onNext: () => transcriptFind.next(transcriptMatchCount),
    onPrevious: () => transcriptFind.previous(transcriptMatchCount),
  });
  // Hidden <input type=file> for the "Files and images" composer-menu action.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Sticky auto-scroll: keep the transcript pinned to the bottom as content
  // streams in / new turns arrive, but ONLY while the user is already near the
  // bottom — if they scroll up to read history, don't yank them back down.
  // (`threadId` is derived above, by the chip-focus effect.)
  const stickToBottomRef = useRef(true);
  // The bug: a fast (even collapsed) reasoning stream re-pinned the transcript to the
  // bottom on every token, so the user couldn't scroll up. Fix: a USER wheel-up detaches
  // immediately (race-free — the auto-scroll never fires a wheel event, so it can't be
  // confused with streaming), and we only re-attach when the user returns to the bottom.
  // `programmaticScrollRef` keeps the auto-scroll's own scroll from re-arming stickiness;
  // `lastScrollTop` also detaches a scrollbar drag-up (no wheel event).
  const programmaticScrollRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const scrollToBottom = useCallback(() => {
    const el = sessionRef.current;
    if (el === null) {
      return;
    }
    const target = el.scrollHeight - el.clientHeight;
    if (Math.abs(el.scrollTop - target) > 1) {
      programmaticScrollRef.current = true;
      el.scrollTop = target;
    }
    lastScrollTopRef.current = el.scrollTop;
  }, []);
  // On entering a thread, jump to the most recent message and re-arm stickiness.
  useEffect(() => {
    stickToBottomRef.current = true;
    scrollToBottom();
  }, [threadId, scrollToBottom]);
  useEffect(() => {
    const el = sessionRef.current;
    if (el === null) {
      return undefined;
    }
    // Wheel/trackpad UP = the user wants to read history → stop following the stream.
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        stickToBottomRef.current = false;
      }
    };
    const onScroll = () => {
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false;
        lastScrollTopRef.current = el.scrollTop;
        return;
      }
      if (el.scrollTop < lastScrollTopRef.current - 1) {
        stickToBottomRef.current = false; // user dragged the scrollbar up
      } else if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) {
        stickToBottomRef.current = true; // user returned to the bottom
      }
      lastScrollTopRef.current = el.scrollTop;
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scroll", onScroll);
    };
    // Re-bind when the thread (hence the .agent-session element) changes — the session
    // only mounts once a thread exists, so a []-deps effect would miss it on the
    // start → first-thread transition and never attach the listeners.
  }, [threadId]);
  // As new content lands (streaming chunks, a new turn, the working indicator),
  // follow it to the bottom only while still stuck.
  useEffect(() => {
    if (stickToBottomRef.current) {
      scrollToBottom();
    }
  }, [viewModel.blocks, viewModel.runtimeState, scrollToBottom]);
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
    onChoiceSurfaceInputSubmit: props.onChoiceSurfaceInputSubmit,
    onAnswerPromptText: props.onAnswerPromptText,
    onAnswerPromptSteps: props.onAnswerPromptSteps,
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
        onInputSubmit: handlers.onChoiceSurfaceInputSubmit,
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
        ref={shellRef}
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
      ref={shellRef}
      className={`agent-chat-shell${props.showThreadHeader === false ? " agent-chat-shell--embedded" : ""}`}
      data-chat-state={viewModel.chatState}
      data-runtime-state={viewModel.runtimeState}
    >
      {props.showThreadHeader === false ? null : createThreadHeader(viewModel)}
      {viewModel.thread === null ? null : (
        <GoalChecklistPanel
          goal={viewModel.thread.goal}
          checklist={viewModel.checklist}
          onSetGoal={props.onSetGoal}
        />
      )}
      <div className="agent-chat-shell__session-region">
        {transcriptFind.open ? (
          <InPaneFindBar
            query={transcriptFind.query}
            matchCount={transcriptMatchCount}
            activeIndex={transcriptFind.activeIndex}
            placeholder="Find in session"
            onQueryChange={transcriptFind.setQuery}
            onNext={() => transcriptFind.next(transcriptMatchCount)}
            onPrevious={() => transcriptFind.previous(transcriptMatchCount)}
            onClose={transcriptFind.closeFind}
          />
        ) : null}
        {sessionView}
      </div>
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
