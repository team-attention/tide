import { createElement } from "react";
import type { ReactElement } from "react";
import { renderMarkdownToHtml } from "./markdown.ts";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

// A user message that carries attached regions (each formatted as `**↳ label**`
// + note + content) renders as markdown so the labels, quoted notes, and code
// blocks read as structured attachments instead of raw asterisks/backticks.
export function renderUserAttachmentBody(body: string): ReactElement {
  return createElement("div", {
    className:
      "agent-session-turn__body agent-session-turn__body--md agent-session-turn__body--attachments",
    dangerouslySetInnerHTML: { __html: renderMarkdownToHtml(body) },
  });
}

// A pasted/attached image rides the message as a `[Attached image: <abs path>]`
// line (the agent needs the path to read the file). In the USER's transcript we
// render it as a thumbnail instead of the raw path, and drop the path text from
// the visible message — keep the picture, hide the plumbing.
const ATTACHED_IMAGE_RE = /\[Attached image:\s*([^\]]+?)\]/g;

export function renderUserBody(body: string): ReactElement {
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
