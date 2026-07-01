import MarkdownIt from "markdown-it";
import { guessLanguage, highlightToHtml } from "../../support/code-highlight.ts";
import { renderMarkdownCached } from "../../support/markdown-rendering.ts";
import type { ReactElement } from "react";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

// Agent answers are markdown (headings, lists, code, links, bold). Render them
// with markdown-it (html:false escapes raw HTML, so this is injection-safe for
// provider text); linkify makes bare URLs clickable, breaks honors soft breaks.
const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

// Agents often link to repo files as [name](file:///abs/path) or Codex-style
// [name](/abs/path:line). Render them as Workbench file-open links (the same
// data-open-file the tool chips use) instead of navigating anchors.
const defaultValidateLink = markdown.validateLink.bind(markdown);

markdown.validateLink = (url: string) =>
  url.startsWith("file://") || isPosixAbsoluteHref(url) || defaultValidateLink(url);

markdown.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  const token = tokens[index];
  const href = token.attrGet("href");
  const fileLink = parseFileOpenHref(href);
  if (fileLink !== null) {
    token.attrSet("data-open-file", fileLink.path);
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

function parseFileOpenHref(href: string | null): { path: string } | null {
  if (href === null || href.length === 0) {
    return null;
  }
  const rawPath = href.startsWith("file://")
    ? href.slice("file://".length)
    : isPosixAbsoluteHref(href)
      ? href
      : null;
  if (rawPath === null) {
    return null;
  }
  const path = stripLineSuffix(safeDecodeUriComponent(rawPath));
  return path.length > 0 ? { path } : null;
}

function isPosixAbsoluteHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

function stripLineSuffix(path: string): string {
  const match = path.match(/^(.*):[1-9]\d*(?::\d+)?$/);
  return match?.[1] !== undefined && match[1].length > 0 ? match[1] : path;
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

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

// Render the agent-chat markdown body through the shared per-instance cache.
// A streaming turn re-renders the whole transcript on every chunk; without this
// it is O(blocks × chunks) markdown parses per turn (perf E2). renderMarkdownCached
// memoizes by source string AND returns the same string reference for a repeat
// source, so dangerouslySetInnerHTML skips the DOM mutation for unchanged bodies.
export function renderMarkdownToHtml(body: string): string {
  return renderMarkdownCached(markdown, body);
}

export function renderAgentMarkdown(body: string): ReactElement {
  return (
    <div
      className="agent-session-turn__body agent-session-turn__body--md"
      dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(body) }}
    />
  );
}
