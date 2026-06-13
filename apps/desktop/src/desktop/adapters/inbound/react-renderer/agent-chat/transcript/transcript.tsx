import type { AgentChatBlockView, AgentChatShellViewModel } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { ReactElement } from "react";
import { AgentWorkingIndicator } from "./working-indicator.tsx";
import { createQueuedInputRow } from "../composer/steer-queue.tsx";
import { MessageSquareDashed } from "lucide-react";
import { ToolActivityGroup } from "./tool-log.tsx";
import { ReasoningTurn } from "./reasoning.tsx";
import { AgentSessionTurn } from "./agent-turn.tsx";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

export function createAgentSession(
  blocks: AgentChatBlockView[],
  chatState: AgentChatShellViewModel["chatState"],
  queuedInputs: string[],
  onOpenFile?: (path: string) => void,
  sessionRef?: { current: HTMLElement | null },
  runtimeStartedAt?: string,
  onEditQueued?: (index: number) => void,
  onResend?: (text: string) => void,
  onQuote?: (text: string) => void,
  onOpenBrowserPane?: (url: string, options?: { newPane?: boolean }) => void,
): ReactElement {
  // Show a live "working" indicator only until the agent produces its block:
  // a streaming block carries its own caret, and a complete block means the turn
  // is done — so the indicator never lingers after the answer (even if the
  // backend runtime state is slow to flip).
  const lastBlock = blocks[blocks.length - 1];
  const lastIsAgent = lastBlock?.role === "agent";
  const working = chatState === "running" && !lastIsAgent;

  return (
    <section
      ref={sessionRef}
      className={`agent-session${blocks.length > 0 ? " agent-session--has-turns" : ""}`}
      aria-label="Agent Session"
      data-session-state={blocks.length === 0 ? "empty" : "turns"}
      // Event-delegated clicks: Copy a code block, or open a file chip.
      onClick={(event: { target: EventTarget | null; preventDefault: () => void; metaKey?: boolean; ctrlKey?: boolean }) => {
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
          // cmd/ctrl+click opens the link in a NEW Browser Pane (beside the page
          // you're reading); a plain click reuses the active one.
          const newPane = event.metaKey === true || event.ctrlKey === true;
          onOpenBrowserPane?.(browserUrl, { newPane });
          return;
        }
        const path = onOpenFile ? target.closest("[data-open-file]")?.getAttribute("data-open-file") : null;
        if (path) {
          // file-open links render as <a href="#"> — stop the anchor navigation.
          event.preventDefault();
          onOpenFile?.(path);
        }
      }}
    >
      {blocks.length === 0
        ? chatState === "hydrating"
          ? createAgentSessionSkeleton()
          : // A loaded, idle thread with no messages (e.g. an agent that produced
            // nothing) shows a placeholder instead of a blank void. But once a message
            // is submitted it shows as the optimistic/queued "You" row below — there IS
            // content, so the "No messages here" placeholder must not render alongside it.
            chatState === "ready" && queuedInputs.length === 0
            ? createAgentSessionEmptyPlaceholder()
            : null
        : groupSessionItems(blocks).map(renderSessionItem)}
      {working ? <AgentWorkingIndicator runtimeStartedAt={runtimeStartedAt} /> : null}
      {/* An optimistic just-sent message (idle send) still shows in the transcript
          until its real block arrives. Messages QUEUED behind a live turn — including
          while it waits on a prompt — dock to the Composer "steer" stack instead, so
          they aren't done here (only when the turn is genuinely idle/ready). */}
      {chatState !== "running" &&
      chatState !== "waiting_for_approval" &&
      chatState !== "waiting_for_input"
        ? queuedInputs.map((queued, index) => createQueuedInputRow(queued, false, index))
        : null}
    </section>
  );
}

// Skeleton shown while an opened thread is loading its blocks from the backend, so
// switching into a thread feels responsive instead of flashing blank.
function createAgentSessionSkeleton(): ReactElement {
  const line = (width: string, key: string) => (
    <div key={key} className="agent-skeleton__line" style={{ width }} />
  );
  return (
    <div className="agent-session-skeleton" aria-label="Loading thread" aria-busy="true">
      <div className="agent-skeleton__bubble" />
      <div className="agent-skeleton__agent">
        {line("92%", "l1")}
        {line("78%", "l2")}
        {line("85%", "l3")}
        {line("40%", "l4")}
      </div>
    </div>
  );
}

// Empty state for a loaded thread that has no messages to show (e.g. an agent that
// produced nothing, or a session that ended before any output) — better than a void.
function createAgentSessionEmptyPlaceholder(): ReactElement {
  return (
    <div className="agent-session-empty" aria-label="No messages">
      <MessageSquareDashed size={26} strokeWidth={1.5} className="agent-session-empty__icon" />
      <p className="agent-session-empty__title">No messages here</p>
      <p className="agent-session-empty__hint">
        This thread has no output yet. Send a message below to start.
      </p>
    </div>
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
    return <ToolActivityGroup key={item.key} blocks={item.blocks} />;
  }
  if (item.block.role === "reasoning" || item.block.kind === "reasoning") {
    return <ReasoningTurn key={item.block.blockId} block={item.block} />;
  }
  return <AgentSessionTurn key={item.block.blockId} block={item.block} />;
}
