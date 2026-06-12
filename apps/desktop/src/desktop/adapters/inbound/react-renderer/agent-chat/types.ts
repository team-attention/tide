import type { AgentChatChoiceSurfaceView, AgentChatComposerSurfaceKind, AgentChatShellViewModel } from "../../../../application/domains/agent-chat/agent-chat-shell-state.ts";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

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
export interface AnchorRect {
  left: number;
  top: number;
  bottom: number;
}

export interface ComposerHandlers {
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
