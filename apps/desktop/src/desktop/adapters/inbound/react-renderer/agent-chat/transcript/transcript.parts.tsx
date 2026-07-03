import { css, keyframes, styled } from "styled-components";

export type TranscriptTurnRole = "agent" | "event" | "tool" | "user";

const caretBlink = keyframes`
  50% {
    opacity: 0;
  }
`;

const skeletonShimmer = keyframes`
  0% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0 50%;
  }
`;

export const TurnLabel = styled.span`
  color: var(--tide-muted);
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  letter-spacing: 0.01em;
`;

export const TurnBody = styled.p<{
  $attachments?: boolean;
  $markdown?: boolean;
  $media?: boolean;
  $userBubble?: boolean;
}>`
  min-width: 0;
  margin: 0;
  color: inherit;
  font-size: ${({ $attachments }) => ($attachments ? "14px" : "15px")};
  line-height: ${({ $userBubble }) => ($userBubble ? "1.55" : "1.68")};
  white-space: ${({ $markdown }) => ($markdown ? "normal" : "pre-wrap")};
  overflow-wrap: anywhere;
  word-break: break-word;
  -webkit-font-smoothing: antialiased;

  ${({ $userBubble }) =>
    $userBubble
      ? `
        max-width: 82%;
        width: fit-content;
        padding: 10px 14px;
        border-radius: 16px;
        background: var(--tide-selection);
        color: var(--tide-text);
      `
      : ""}

  ${({ $attachments, $userBubble }) =>
    $attachments
      ? `
        max-width: ${$userBubble ? "min(680px, 100%)" : "min(800px, 100%)"};
        width: ${$userBubble ? "fit-content" : "100%"};
      `
      : ""}

  ${({ $media }) =>
    $media
      ? `
        display: flex;
        flex-direction: column;
        gap: 8px;
      `
      : ""}

  ${({ $markdown }) =>
    $markdown
      ? `
        > :first-child {
          margin-top: 0;
        }

        > :last-child {
          margin-bottom: 0;
        }

        p {
          margin: 0 0 10px;
        }

        h1,
        h2,
        h3,
        h4 {
          margin: 16px 0 8px;
          font-weight: 620;
          line-height: 1.3;
        }

        h1 {
          font-size: 19px;
        }

        h2 {
          font-size: 17px;
        }

        h3 {
          font-size: 15.5px;
        }

        h4 {
          font-size: 15px;
        }

        ul,
        ol {
          margin: 0 0 10px;
          padding-left: 22px;
        }

        li {
          margin: 3px 0;
        }

        li > ul,
        li > ol {
          margin: 3px 0;
        }

        a {
          color: var(--tide-action);
          text-decoration: none;
        }

        a:hover {
          text-decoration: underline;
        }

        code {
          padding: 1px 5px;
          border-radius: 5px;
          background: var(--tide-selection);
          font: 13px/1.4 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        }

        pre {
          margin: 0 0 10px;
          padding: 10px 12px;
          border-radius: 8px;
          overflow: auto;
          background: var(--tide-selection);
        }

        .md-code {
          margin: 0 0 12px;
          border: 1px solid var(--tide-line);
          border-radius: 10px;
          overflow: hidden;
        }

        .md-code__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 5px 10px 5px 12px;
          border-bottom: 1px solid var(--tide-line);
          background: var(--tide-surface);
        }

        .md-code__lang {
          color: var(--tide-muted);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
          text-transform: lowercase;
        }

        .md-code__actions {
          display: inline-flex;
          align-items: center;
          gap: 2px;
        }

        .md-code__copy,
        .md-code__quote {
          padding: 2px 6px;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: var(--tide-muted);
          font: inherit;
          font-size: 11px;
          cursor: pointer;
        }

        .md-code__copy:hover,
        .md-code__quote:hover {
          background: var(--tide-selection);
          color: var(--tide-action);
        }

        .md-code__pre {
          margin: 0;
          border-radius: 0;
          background: var(--tide-bg);
        }

        pre code {
          padding: 0;
          background: none;
          font-size: 12.5px;
          line-height: 1.55;
        }

        blockquote {
          margin: 0 0 10px;
          padding-left: 12px;
          border-left: 3px solid var(--tide-line);
          color: var(--tide-muted);
        }

        strong {
          font-weight: 620;
        }

        hr {
          margin: 14px 0;
          border: 0;
          border-top: 1px solid var(--tide-line);
        }

        table {
          margin: 0 0 10px;
          border-collapse: collapse;
        }

        th,
        td {
          padding: 4px 10px;
          border: 1px solid var(--tide-line);
          text-align: left;
        }
      `
      : ""}

  ${({ $attachments }) =>
    $attachments
      ? `
        strong:first-child,
        p > strong {
          display: inline-block;
          color: var(--tide-muted);
          font-size: 12px;
          font-weight: 600;
        }

        blockquote {
          margin: 4px 0;
          padding-left: 10px;
          border-left: 2px solid var(--tide-line-strong, var(--tide-line));
          color: var(--tide-text);
        }
      `
      : ""}
`;

export const TranscriptTurn = styled.article<{
  $commentary?: boolean;
  $queued?: boolean;
  $role: TranscriptTurnRole;
  $toolResult?: boolean;
}>`
  min-width: 0;
  width: min(760px, calc(100% - 32px));
  align-self: center;
  display: ${({ $role }) => ($role === "user" ? "flex" : "grid")};
  justify-content: ${({ $role }) => ($role === "user" ? "flex-end" : "normal")};
  gap: ${({ $role }) => ($role === "tool" ? "3px" : $role === "event" ? "8px" : "4px")};
  position: relative;
  color: ${({ $commentary, $role }) =>
    $commentary
      ? "color-mix(in srgb, var(--tide-text) 78%, var(--tide-muted) 22%)"
      : $role === "agent"
        ? "var(--tide-text)"
        : "inherit"};
  opacity: ${({ $queued }) => ($queued ? 0.62 : 1)};
  margin-top: ${({ $toolResult }) => ($toolResult ? "-1px" : "0")};
  padding: ${({ $commentary, $role }) => {
    if ($role === "event") {
      return "10px 12px";
    }
    if ($commentary) {
      return "0 0 0 12px";
    }
    return "0";
  }};
  border: ${({ $commentary, $role }) => {
    if ($role === "event") {
      return "1px solid var(--tide-line)";
    }
    if ($commentary) {
      return "0";
    }
    return "0";
  }};
  border-left: ${({ $commentary }) =>
    $commentary ? "2px solid var(--tide-line-strong, var(--tide-line))" : "0"};
  border-radius: ${({ $role }) => ($role === "event" ? "14px" : "0")};
  background: ${({ $role }) => ($role === "event" ? "var(--tide-bg)" : "transparent")};
  box-shadow: ${({ $role }) =>
    $role === "event" ? "0 8px 9px -6px rgba(52, 48, 56, 0.12)" : "none"};
  max-width: ${({ $role }) => ($role === "event" ? "min(800px, 100%)" : "none")};

  ${({ $commentary }) =>
    $commentary
      ? `
        ${TurnLabel} {
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
      `
      : ""}

  &:hover [data-agent-turn-actions],
  [data-agent-turn-actions]:focus-within {
    opacity: 1;
    transform: none;
    pointer-events: auto;
  }
`;

export const AgentSessionViewport = styled.section<{ $hasTurns: boolean }>`
  --agent-session-bottom-buffer: 96px;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable both-edges;
  display: flex;
  flex-direction: column;
  justify-content: ${({ $hasTurns }) => ($hasTurns ? "flex-start" : "center")};
  align-items: center;
  gap: 14px;
  padding: ${({ $hasTurns }) => ($hasTurns ? "6px 0 var(--agent-session-bottom-buffer)" : "0")};
  scroll-padding-bottom: var(--agent-session-bottom-buffer);

  &::selection,
  *::selection {
    background: rgba(57, 112, 240, 0.30);
  }

  [data-theme="dark"] &::selection,
  [data-theme="dark"] & *::selection {
    background: rgba(96, 150, 255, 0.36);
  }

  &[data-chat-state="running"] [data-block-role="agent"][data-streaming-caret="active"] ${TurnBody}::after {
    content: "▍";
    margin-left: 1px;
    color: var(--tide-muted);
    animation: ${caretBlink} 1s steps(1) infinite;
  }
`;

export const TurnRawFallback = styled.pre`
  max-width: 100%;
  overflow: auto;
  margin: 4px 0 0;
  padding: 8px 10px;
  border-radius: 7px;
  color: var(--tide-text);
  background: var(--tide-selection);
  font: 12px/1.5 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
`;

export const TurnActions = styled.div`
  position: absolute;
  top: 100%;
  left: -4px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 1px;
  margin-top: -7px;
  padding: 2px;
  border: 1px solid var(--tide-line);
  border-radius: 9px;
  background: var(--tide-surface);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  opacity: 0;
  transform: translateY(-2px);
  transition: opacity 0.12s ease, transform 0.12s ease;
  pointer-events: none;
`;

export const TurnActionButton = styled.button`
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-text);
  }

  [data-turn-action-icon="check"] {
    display: none;
    color: var(--tide-success);
  }

  &[data-action-done="true"] [data-turn-action-icon="copy"] {
    display: none;
  }

  &[data-action-done="true"] [data-turn-action-icon="check"] {
    display: inline-flex;
  }

  &[data-action-done="true"] {
    color: var(--tide-success);
  }
`;

export const QueuedBadge = styled.span`
  margin-left: 8px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--tide-selection);
  color: var(--tide-muted);
  font-size: 11px;
  font-weight: 500;
`;

export const QueuedEditButton = styled.button`
  margin-left: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  padding: 3px;
  border: 1px solid var(--tide-line);
  border-radius: 7px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;
  transition: color 0.12s ease, border-color 0.12s ease, background 0.12s ease;

  &:hover {
    color: var(--tide-text);
    border-color: var(--tide-line-strong);
    background: var(--tide-selection);
  }
`;

export const MediaText = styled.p`
  margin: 0;
  white-space: pre-wrap;
`;

export const AttachedImageList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

export const AttachedImage = styled.img`
  display: block;
  max-width: 100%;
  max-height: 280px;
  border: 1px solid var(--tide-line);
  border-radius: 10px;
  object-fit: contain;
  background: var(--tide-bg);
`;

export const ToolName = styled.span`
  color: var(--tide-muted);
  font: 11.5px/1.4 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
`;

export const ToolBody = styled.pre`
  max-width: 100%;
  max-height: 220px;
  overflow: auto;
  margin: 2px 0 0;
  padding: 7px 9px;
  border-radius: 7px;
  color: var(--tide-text);
  background: var(--tide-selection);
  font: 12px/1.5 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap;
`;

export const FileChip = styled.button`
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin: 2px 0 0;
  padding: 5px 10px;
  border: 1px solid var(--tide-line);
  border-radius: 8px;
  background: var(--tide-bg);
  color: var(--tide-muted);
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover {
    border-color: var(--tide-line-strong);
    background: var(--tide-selection);
  }
`;

export const FileChipName = styled.span`
  color: var(--tide-text);
  font-size: 13px;
  font-weight: 540;
`;

export const FileChipDir = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--tide-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const TurnDiff = styled.div`
  margin: 2px 0 0;
  border: 1px solid var(--tide-line);
  border-radius: 7px;
  overflow: hidden;
`;

export const DiffStat = styled.div`
  display: flex;
  gap: 8px;
  padding: 4px 9px;
  border-bottom: 1px solid var(--tide-line);
  background: var(--tide-surface);
  font: 11px/1 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
`;

export const DiffStatValue = styled.span<{ $kind: "add" | "del" }>`
  color: ${({ $kind }) => ($kind === "add" ? "var(--tide-diff-add)" : "var(--tide-diff-del)")};
`;

export const DiffBody = styled.div`
  max-height: 260px;
  overflow: auto;
  font: 12px/1.5 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
`;

export const DiffLine = styled.div<{ $kind: "add" | "ctx" | "del" }>`
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  background: ${({ $kind }) => {
    if ($kind === "add") {
      return "color-mix(in srgb, var(--tide-diff-add) 14%, transparent)";
    }
    if ($kind === "del") {
      return "color-mix(in srgb, var(--tide-diff-del) 14%, transparent)";
    }
    return "transparent";
  }};
  white-space: pre-wrap;
  word-break: break-word;
`;

export const DiffLineSign = styled.span<{ $kind: "add" | "ctx" | "del" }>`
  color: ${({ $kind }) => {
    if ($kind === "add") {
      return "var(--tide-diff-add)";
    }
    if ($kind === "del") {
      return "var(--tide-diff-del)";
    }
    return "var(--tide-muted)";
  }};
  text-align: center;
  user-select: none;
`;

export const DiffLineText = styled.span`
  min-width: 0;
  padding-right: 8px;
`;

export const SessionSkeleton = styled.div`
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 12px 0;
`;

const skeletonBlockCss = css`
  background: linear-gradient(
    90deg,
    rgba(var(--tide-ink-rgb), 0.06) 25%,
    rgba(var(--tide-ink-rgb), 0.13) 37%,
    rgba(var(--tide-ink-rgb), 0.06) 63%
  );
  background-size: 400% 100%;
  animation: ${skeletonShimmer} 1.4s ease infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

export const SessionSkeletonBubble = styled.div`
  align-self: flex-end;
  width: 200px;
  max-width: 60%;
  height: 36px;
  border-radius: 16px;
  ${skeletonBlockCss}
`;

export const SessionSkeletonAgent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 11px;
  max-width: 80%;
`;

export const SessionSkeletonLine = styled.div`
  height: 13px;
  border-radius: 6px;
  ${skeletonBlockCss}
`;

export const SessionEmptyState = styled.div`
  min-height: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 24px;
  color: rgba(var(--tide-ink-rgb), 0.55);
  text-align: center;
`;

export const SessionEmptyIcon = styled.span`
  display: inline-flex;
  margin-bottom: 2px;
  color: rgba(var(--tide-ink-rgb), 0.32);
`;

export const SessionEmptyTitle = styled.p`
  margin: 0;
  color: rgba(var(--tide-ink-rgb), 0.7);
  font-size: 14px;
  font-weight: 600;
`;

export const SessionEmptyHint = styled.p`
  max-width: 280px;
  margin: 0;
  color: rgba(var(--tide-ink-rgb), 0.48);
  font-size: 12.5px;
  line-height: 1.5;
`;
