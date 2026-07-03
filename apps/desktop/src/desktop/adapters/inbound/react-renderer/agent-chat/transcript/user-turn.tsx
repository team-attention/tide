import type { ReactElement } from "react";
import { renderMarkdownToHtml } from "./markdown.tsx";
import { AttachedImage, AttachedImageList, MediaText, TurnBody } from "./transcript.parts.tsx";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

// A user message that carries attached regions (each formatted as `**↳ label**`
// + note + content) renders as markdown so the labels, quoted notes, and code
// blocks read as structured attachments instead of raw asterisks/backticks.
export function renderUserAttachmentBody(body: string): ReactElement {
  return (
    <TurnBody
      as="div"
      $attachments
      $markdown
      $userBubble
      data-turn-body="true"
      data-turn-attachments="true"
      dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(body) }}
    />
  );
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
    // Render as a structured attachment body when it carries a "↳ label" header
    // (file/code/terminal/browser chips) OR a leading blockquote (a quoted message,
    // whose header is dropped as redundant — see formatContextChipForMessage).
    const isAttachment = text.includes("**↳ ") || /(^|\n)>\s/.test(text);
    return isAttachment ? (
      renderUserAttachmentBody(body)
    ) : (
      <TurnBody $userBubble data-turn-body="true">{body}</TurnBody>
    );
  }
  // Image(s) present → a media bubble: the (path-free) text, then thumbnails.
  return (
    <TurnBody as="div" $media $userBubble data-turn-body="true" data-turn-media="true">
      {text.length > 0 ? <MediaText>{text}</MediaText> : null}
      <AttachedImageList>
        {images.map((path, index) => (
          <AttachedImage
            key={`att-${index}`}
            data-attached-image="true"
            src={`file://${encodeURI(path)}`}
            alt="Attached image"
            loading="lazy"
            draggable={false}
          />
        ))}
      </AttachedImageList>
    </TurnBody>
  );
}
