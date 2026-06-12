// Shared markdown-rendering helpers for the two surfaces that render
// provider/file markdown to HTML: the Agent Chat answer body and the Workbench
// Editor Pane Preview. Keeps GFM behavior (task lists) and render caching
// identical across both, instead of per-surface workarounds.
// Spec: docs_v2/specs/workbench-markdown-preview-editor.md (D5, D8).
import type MarkdownIt from "markdown-it";

// Token/StateCore aren't re-exported from markdown-it's package root, so derive
// them from the public `core.ruler.after` rule signature instead of a deep
// subpath import.
type CoreRule = Parameters<MarkdownIt["core"]["ruler"]["after"]>[2];
type StateCore = Parameters<CoreRule>[0];
type Token = StateCore["tokens"][number];
type TokenCtor = StateCore["Token"];

// GFM task lists (`- [ ]` / `- [x]`). Dependency-free port of the conventional
// markdown-it-task-lists behavior: after inline parsing, list items whose text
// starts with a `[ ]`/`[x]` marker get a leading read-only checkbox, and the
// item/list get GitHub-compatible classes for styling. The injected checkbox is
// an `html_inline` token we author ourselves — safe under `html: false`, which
// only gates raw HTML parsed *from source*, not the renderer.
export function taskListPlugin(md: MarkdownIt): void {
  md.core.ruler.after("inline", "tide-task-lists", (state) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      if (!isTaskListItem(tokens, i)) {
        continue;
      }
      injectCheckbox(tokens[i], state.Token);
      setTokenClass(tokens[i - 2], "task-list-item");
      const listIndex = parentListOpen(tokens, i - 2);
      if (listIndex >= 0) {
        setTokenClass(tokens[listIndex], "contains-task-list");
      }
    }
  });
}

// A task-list item is an inline token preceded by a paragraph_open inside a
// list_item_open, whose rendered text begins with a checkbox marker.
function isTaskListItem(tokens: Token[], index: number): boolean {
  return (
    tokens[index].type === "inline" &&
    tokens[index - 1].type === "paragraph_open" &&
    tokens[index - 2].type === "list_item_open" &&
    startsWithMarker(tokens[index].content)
  );
}

function startsWithMarker(content: string): boolean {
  return (
    content.startsWith("[ ] ") ||
    content.startsWith("[x] ") ||
    content.startsWith("[X] ")
  );
}

// Replace the leading `[ ] ` / `[x] ` marker with a disabled checkbox input.
function injectCheckbox(
  inlineToken: Token,
  TokenCtor: TokenCtor,
): void {
  const checked = !inlineToken.content.startsWith("[ ] ");
  const checkbox = new TokenCtor("html_inline", "", 0);
  checkbox.content =
    `<input class="task-list-item-checkbox" type="checkbox" disabled=""` +
    (checked ? ` checked=""` : ``) +
    `>`;
  const children = inlineToken.children ?? [];
  children.unshift(checkbox);
  // Strip the 3-char marker (`[ ]`/`[x]`) from the first text child and the
  // token's own content, leaving a single leading space before the label.
  if (children.length > 1 && children[1].type === "text") {
    children[1].content = children[1].content.slice(3);
  }
  inlineToken.children = children;
  inlineToken.content = inlineToken.content.slice(3);
}

function parentListOpen(tokens: Token[], itemOpenIndex: number): number {
  const targetLevel = tokens[itemOpenIndex].level - 1;
  for (let i = itemOpenIndex - 1; i >= 0; i--) {
    const token = tokens[i];
    if (
      token.level === targetLevel &&
      (token.type === "bullet_list_open" || token.type === "ordered_list_open")
    ) {
      return i;
    }
  }
  return -1;
}

function setTokenClass(token: Token, className: string): void {
  const existing = token.attrGet("class");
  if (existing === null || existing === undefined || existing.length === 0) {
    token.attrSet("class", className);
    return;
  }
  // The list_open token is visited once per task item; don't append duplicates.
  if (existing.split(/\s+/).includes(className)) {
    return;
  }
  token.attrSet("class", `${existing} ${className}`);
}

// Per-instance memoization of `md.render(source)`. Rendering large markdown on
// every React re-render (e.g. while another turn streams) is the perf cost the
// makeshift workarounds were fighting; this caches by source string so only the
// changed body re-parses. Returns the *same string reference* for repeat
// sources, so `dangerouslySetInnerHTML` skips the DOM mutation too.
const RENDER_CACHE_LIMIT = 64;
const renderCaches = new WeakMap<MarkdownIt, Map<string, string>>();

export function renderMarkdownCached(md: MarkdownIt, source: string): string {
  let cache = renderCaches.get(md);
  if (cache === undefined) {
    cache = new Map();
    renderCaches.set(md, cache);
  }
  const cached = cache.get(source);
  if (cached !== undefined) {
    // Refresh LRU recency.
    cache.delete(source);
    cache.set(source, cached);
    return cached;
  }
  const html = md.render(source);
  cache.set(source, html);
  if (cache.size > RENDER_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  return html;
}
