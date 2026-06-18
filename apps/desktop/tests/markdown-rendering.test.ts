// Spec: docs_v2/specs/workbench-markdown-preview-editor.md (D5, D8, Invariant 1)
import assert from "node:assert/strict";
import test from "node:test";

import MarkdownIt from "markdown-it";

import {
  headingAnchorPlugin,
  renderMarkdownCached,
  taskListPlugin,
} from "../src/desktop/adapters/inbound/react-renderer/support/markdown-rendering.ts";

function makeRenderer(): MarkdownIt {
  const md = new MarkdownIt({ html: false });
  md.use(taskListPlugin);
  return md;
}

// Count actual parse work by wrapping md.render — string outputs are value-equal
// whether cached or not, so identity can't detect caching; call counts can.
function countingRenderer(): { md: MarkdownIt; calls: () => number } {
  const md = makeRenderer();
  let calls = 0;
  const original = md.render.bind(md);
  md.render = (src: string, env?: unknown) => {
    calls++;
    return original(src, env);
  };
  return { md, calls: () => calls };
}

test("markdown_rendering_is_memoized_by_source", () => {
  const { md, calls } = countingRenderer();
  const source = "# Title\n\nsome **bold** text\n";
  const first = renderMarkdownCached(md, source);
  const second = renderMarkdownCached(md, source);
  // Same source is parsed once; the second call is served from cache.
  assert.equal(calls(), 1);
  assert.equal(first, second);
  assert.match(first, /<h1>Title<\/h1>/);
  // A different source is parsed fresh.
  renderMarkdownCached(md, "different\n");
  assert.equal(calls(), 2);
});

test("markdown_render_cache_is_bounded", () => {
  const { md, calls } = countingRenderer();
  renderMarkdownCached(md, "evict-me\n");
  assert.equal(calls(), 1);
  // Push more distinct sources than the cache holds (limit is 64).
  for (let i = 0; i < 80; i++) {
    renderMarkdownCached(md, `line ${i}\n`);
  }
  const afterFill = calls();
  // The first entry was evicted, so re-rendering it parses again (cache miss)
  // rather than growing the cache without bound.
  renderMarkdownCached(md, "evict-me\n");
  assert.equal(calls(), afterFill + 1);
});

test("markdown_task_list_checkboxes_are_disabled", () => {
  const md = makeRenderer();
  const html = renderMarkdownCached(md, "- [ ] a\n- [x] b\n");
  // Both checkboxes are present, read-only (disabled), and the [x] is checked.
  const checkboxes = html.match(/<input[^>]*task-list-item-checkbox[^>]*>/g) ?? [];
  assert.equal(checkboxes.length, 2);
  for (const box of checkboxes) {
    assert.match(box, /disabled=""/);
    assert.match(box, /type="checkbox"/);
  }
  assert.equal(checkboxes.filter((b) => /checked=""/.test(b)).length, 1);
});

test("markdown_task_list_does_not_execute_raw_html", () => {
  const md = makeRenderer();
  const html = renderMarkdownCached(md, "- [ ] <img src=x onerror=alert(1)>\n");
  // html:false still escapes raw HTML in the label even with the task plugin on.
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.match(html, /&lt;img/);
});

test("markdown_heading_anchors_match_github_style_slugs_and_deduplicate", () => {
  const md = makeRenderer();
  md.use(headingAnchorPlugin);
  const html = renderMarkdownCached(md, "# Hello, World!\n\n## Hello World\n\n## Hello World\n");

  assert.match(html, /<h1 id="hello-world">/);
  assert.match(html, /href="#hello-world"/);
  assert.match(html, /<h2 id="hello-world-1">/);
  assert.match(html, /<h2 id="hello-world-2">/);
});
