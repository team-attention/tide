// Browser Pane JS bridge / render-document builders (pure string builders).
// Extracted from browser.rs so the JS payloads are not buried in pane state.

use crate::tide_core::PaneId;

pub(crate) fn escape_js_string_literal(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('`', "\\`")
        .replace("${", "\\${")
}

/// Build the full render HTML document with render runtime injected.
/// BR-31: morphdom, Tailwind CSS, Tide theme CSS vars, JS bridge.
pub(crate) fn build_render_document(agent_html: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://unpkg.com/morphdom@2/dist/morphdom-umd.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {{
      --tide-bg: #1e1e2e;
      --tide-fg: #cdd6f4;
      --tide-accent: #89b4fa;
      --tide-surface: #313244;
      --tide-border: #45475a;
      --tide-success: #a6e3a1;
      --tide-warning: #f9e2af;
      --tide-error: #f38ba8;
    }}
    body {{ background: var(--tide-bg); color: var(--tide-fg); font-family: system-ui; margin: 0; padding: 16px; }}
  </style>
  <script>
    window.tide = {{
      send: (msg) => window.webkit.messageHandlers.tide.postMessage(JSON.stringify(msg)),
      _listeners: [],
      onMessage: (cb) => window.tide._listeners.push(cb),
      _dispatch: (msg) => window.tide._listeners.forEach(cb => cb(msg)),
    }};
  </script>
</head>
<body>
  <div id="root">{agent_html}</div>
</body>
</html>"#
    )
}

pub(crate) fn browser_selection_bridge_script(pane_id: PaneId) -> String {
    format!(
        r#"(() => {{
  if (window.__tideSelectionBridgeInstalled) return;
  window.__tideSelectionBridgeInstalled = true;
  const paneId = {pane_id};
  const post = (payload) => {{
    try {{
      window.webkit.messageHandlers.tide.postMessage(JSON.stringify(payload));
    }} catch (_e) {{}}
  }};
  const clampText = (value, limit) => {{
    const text = value == null ? "" : String(value);
    return text.length > limit ? text.slice(0, limit) : text;
  }};
  const networkLimit = 80;
  const networkTextLimit = 4096;
  const networkLog = window.__tideNetworkLog || [];
  window.__tideNetworkLog = networkLog;
  window.__tideNetworkSeq = window.__tideNetworkSeq || 0;
  const postNetworkLog = () => {{
    const resources = [];
    try {{
      if (performance && typeof performance.getEntriesByType === "function") {{
        for (const entry of performance.getEntriesByType("resource").slice(-40)) {{
          resources.push({{
            id: `resource:${{entry.name}}:${{Math.round(entry.startTime || 0)}}`,
            source: entry.initiatorType || "resource",
            method: null,
            url: entry.name || "",
            status: null,
            ok: null,
            mime_type: null,
            request_body: null,
            response_excerpt: null,
            started_ms: Number.isFinite(entry.startTime) ? entry.startTime : null,
            duration_ms: Number.isFinite(entry.duration) ? entry.duration : null
          }});
        }}
      }}
    }} catch (_e) {{}}
    const entries = resources.concat(networkLog).filter((entry) => entry && entry.url).slice(-networkLimit);
    post({{
      kind: "browser-network-log",
      pane_id: paneId,
      entries,
      truncated: resources.length + networkLog.length > networkLimit
    }});
  }};
  const pushNetworkEntry = (entry) => {{
    networkLog.push(entry);
    if (networkLog.length > networkLimit) networkLog.splice(0, networkLog.length - networkLimit);
    postNetworkLog();
  }};
  if (!window.__tideNetworkBridgeInstalled) {{
    window.__tideNetworkBridgeInstalled = true;
    const originalFetch = window.fetch;
    if (typeof originalFetch === "function") {{
      window.fetch = async function(input, init) {{
        const started = performance && typeof performance.now === "function" ? performance.now() : null;
        const id = `fetch:${{++window.__tideNetworkSeq}}`;
        const url = typeof input === "string" ? input : (input && input.url) || "";
        const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
        const requestBody = init && typeof init.body === "string" ? clampText(init.body, networkTextLimit) : null;
        try {{
          const response = await originalFetch.apply(this, arguments);
          const ended = performance && typeof performance.now === "function" ? performance.now() : null;
          const mimeType = response && response.headers && response.headers.get ? response.headers.get("content-type") : null;
          const record = {{
            id,
            source: "fetch",
            method,
            url: (response && response.url) || url,
            status: response ? response.status : null,
            ok: response ? response.ok : null,
            mime_type: mimeType,
            request_body: requestBody,
            response_excerpt: null,
            started_ms: started,
            duration_ms: started != null && ended != null ? ended - started : null
          }};
          pushNetworkEntry(record);
          if (response && response.clone && mimeType && /(json|text|javascript|xml|html)/i.test(mimeType)) {{
            response.clone().text().then((text) => {{
              record.response_excerpt = clampText(text, networkTextLimit);
              postNetworkLog();
            }}).catch(() => {{}});
          }}
          return response;
        }} catch (error) {{
          const ended = performance && typeof performance.now === "function" ? performance.now() : null;
          pushNetworkEntry({{
            id,
            source: "fetch",
            method,
            url,
            status: null,
            ok: false,
            mime_type: null,
            request_body: requestBody,
            response_excerpt: clampText(error && error.message ? error.message : String(error), networkTextLimit),
            started_ms: started,
            duration_ms: started != null && ended != null ? ended - started : null
          }});
          throw error;
        }}
      }};
    }}
    const OriginalXHR = window.XMLHttpRequest;
    if (typeof OriginalXHR === "function" && OriginalXHR.prototype) {{
      const originalOpen = OriginalXHR.prototype.open;
      const originalSend = OriginalXHR.prototype.send;
      OriginalXHR.prototype.open = function(method, url) {{
        this.__tideNetwork = {{
          id: `xhr:${{++window.__tideNetworkSeq}}`,
          method: method ? String(method).toUpperCase() : "GET",
          url: url ? String(url) : "",
          started_ms: null,
          request_body: null
        }};
        return originalOpen.apply(this, arguments);
      }};
      OriginalXHR.prototype.send = function(body) {{
        if (this.__tideNetwork) {{
          this.__tideNetwork.started_ms = performance && typeof performance.now === "function" ? performance.now() : null;
          this.__tideNetwork.request_body = typeof body === "string" ? clampText(body, networkTextLimit) : null;
          this.addEventListener("loadend", () => {{
            const ended = performance && typeof performance.now === "function" ? performance.now() : null;
            let mimeType = null;
            let excerpt = null;
            try {{ mimeType = this.getResponseHeader("content-type"); }} catch (_e) {{}}
            try {{
              if ((this.responseType === "" || this.responseType === "text") && typeof this.responseText === "string" && (!mimeType || /(json|text|javascript|xml|html)/i.test(mimeType))) {{
                excerpt = clampText(this.responseText, networkTextLimit);
              }}
            }} catch (_e) {{}}
            pushNetworkEntry({{
              id: this.__tideNetwork.id,
              source: "xhr",
              method: this.__tideNetwork.method,
              url: this.responseURL || this.__tideNetwork.url,
              status: this.status || null,
              ok: this.status >= 200 && this.status < 400,
              mime_type: mimeType,
              request_body: this.__tideNetwork.request_body,
              response_excerpt: excerpt,
              started_ms: this.__tideNetwork.started_ms,
              duration_ms: this.__tideNetwork.started_ms != null && ended != null ? ended - this.__tideNetwork.started_ms : null
            }});
          }}, {{once: true}});
        }}
        return originalSend.apply(this, arguments);
      }};
    }}
  }}
  const visibleRect = (el) => {{
    if (!el || el.id === "__tide-automation-cursor") return null;
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) return null;
    const left = Math.max(0, Math.min(window.innerWidth || rect.right, rect.left));
    const top = Math.max(0, Math.min(window.innerHeight || rect.bottom, rect.top));
    const right = Math.max(0, Math.min(window.innerWidth || rect.right, rect.right));
    const bottom = Math.max(0, Math.min(window.innerHeight || rect.bottom, rect.bottom));
    const width = right - left;
    const height = bottom - top;
    if (width < 1 || height < 1) return null;
    return {{x: left, y: top, width, height}};
  }};
  const derivedRole = (el) => {{
    const explicit = el.getAttribute && el.getAttribute("role");
    if (explicit) return explicit;
    const tag = (el.tagName || "").toLowerCase();
    const type = (el.getAttribute && el.getAttribute("type") || "").toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a") return "link";
    if (tag === "summary") return "button";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {{
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "search") return "searchbox";
      if (type === "submit" || type === "button") return "button";
      return "textbox";
    }}
    if (tag === "select") return "combobox";
    if (tag === "option") return "option";
    if (tag === "form") return "form";
    if (tag === "nav") return "navigation";
    if (tag === "main") return "main";
    if (tag === "aside") return "complementary";
    if (tag === "dialog") return "dialog";
    if (tag === "ul" || tag === "ol") return "list";
    return null;
  }};
  const normalizeText = (value, limit = 160) => {{
    if (value == null) return "";
    return clampText(String(value).trim().replace(/\s+/g, " "), limit);
  }};
  const cssEscape = (value) => {{
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  }};
  const textFromIds = (ids) => {{
    if (!ids) return "";
    return normalizeText(
      String(ids)
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => node.innerText || node.textContent || "")
        .join(" ")
    );
  }};
  const associatedLabelText = (el) => {{
    const id = el.getAttribute && el.getAttribute("id");
    if (id) {{
      const labels = Array.from(document.querySelectorAll('label[for="' + cssEscape(id) + '"]'));
      const text = normalizeText(labels.map((label) => label.innerText || label.textContent || "").join(" "));
      if (text) return text;
    }}
    const wrappingLabel = el.closest && el.closest("label");
    return normalizeText(wrappingLabel && (wrappingLabel.innerText || wrappingLabel.textContent || ""));
  }};
  const ancestorContextText = (el) => {{
    let parent = el.parentElement;
    let depth = 0;
    while (parent && parent !== document.body && depth < 3) {{
      const explicit = normalizeText(
        (parent.getAttribute && parent.getAttribute("aria-label")) ||
        (parent.getAttribute && parent.getAttribute("title"))
      );
      if (explicit) return explicit;
      const text = normalizeText(parent.innerText || parent.textContent || "", 1000);
      if (text && text.length <= 240) return text;
      parent = parent.parentElement;
      depth += 1;
    }}
    return "";
  }};
  const elementLabel = (el) => {{
    const candidates = [
      el.getAttribute && el.getAttribute("aria-label"),
      textFromIds(el.getAttribute && el.getAttribute("aria-labelledby")),
      el.getAttribute && el.getAttribute("title"),
      el.getAttribute && el.getAttribute("alt"),
      associatedLabelText(el),
      el.getAttribute && el.getAttribute("placeholder"),
      el.innerText,
      el.textContent,
      el.value,
      el.getAttribute && el.getAttribute("data-action"),
      el.getAttribute && el.getAttribute("name"),
      el.id,
      ancestorContextText(el)
    ];
    for (const candidate of candidates) {{
      const normalized = normalizeText(candidate);
      if (normalized) return normalized;
    }}
    return "";
  }};
  const belongsToElement = (root, node) => {{
    if (!root || !node) return false;
    return root === node || (root.contains && root.contains(node));
  }};
  const hitTestPoint = (el, x, y) => {{
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (x < 0 || y < 0 || x > (window.innerWidth || 0) || y > (window.innerHeight || 0)) return false;
    const stack = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
    return stack.some((node) => belongsToElement(el, node));
  }};
  const clickPointFor = (el, rect) => {{
    const samples = [
      [0.5, 0.5, "center"],
      [0.25, 0.5, "mid_left"],
      [0.75, 0.5, "mid_right"],
      [0.5, 0.25, "mid_top"],
      [0.5, 0.75, "mid_bottom"],
      [0.25, 0.25, "top_left"],
      [0.75, 0.25, "top_right"],
      [0.25, 0.75, "bottom_left"],
      [0.75, 0.75, "bottom_right"]
    ];
    const centerX = rect.x + rect.width * 0.5;
    const centerY = rect.y + rect.height * 0.5;
    const centerOk = hitTestPoint(el, centerX, centerY);
    for (const [px, py, source] of samples) {{
      const x = rect.x + rect.width * px;
      const y = rect.y + rect.height * py;
      if (hitTestPoint(el, x, y)) {{
        return {{
          click_point: {{x, y}},
          hit_test: {{clickable: true, center_blocked: !centerOk, point_source: source}}
        }};
      }}
    }}
    return {{
      click_point: null,
      hit_test: {{clickable: false, center_blocked: !centerOk, point_source: "none"}}
    }};
  }};
  const isScrollableElement = (el) => {{
    if (!el || !window.getComputedStyle) return false;
    const style = window.getComputedStyle(el);
    if (!style) return false;
    const overflowY = style.overflowY || style.overflow;
    const overflowX = style.overflowX || style.overflow;
    return (
      (/(auto|scroll|overlay)/.test(overflowY) && el.scrollHeight > el.clientHeight) ||
      (/(auto|scroll|overlay)/.test(overflowX) && el.scrollWidth > el.clientWidth)
    );
  }};
  const elementPayload = (el, ref, kind) => {{
    const rect = visibleRect(el);
    if (!rect) return null;
    const role = derivedRole(el);
    const text = el.innerText || el.textContent || "";
    const disabled = !!el.disabled || (el.getAttribute && el.getAttribute("aria-disabled") === "true");
    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    const pointerBlocked = style && style.pointerEvents === "none";
    const interaction = disabled || pointerBlocked
      ? {{
          click_point: null,
          hit_test: {{clickable: false, center_blocked: false, point_source: disabled ? "disabled" : "pointer-events-none"}}
        }}
      : clickPointFor(el, rect);
    return {{
      ref,
      kind,
      role,
      tag: el.tagName || "",
      label: elementLabel(el),
      text: clampText(String(text).trim().replace(/\s+/g, " "), 512),
      value: typeof el.value === "string" ? clampText(el.value, 160) : null,
      placeholder: el.getAttribute ? el.getAttribute("placeholder") : null,
      action: el.getAttribute ? el.getAttribute("data-action") : null,
      disabled,
      rect,
      click_point: interaction.click_point,
      hit_test: interaction.hit_test,
      scrollable: isScrollableElement(el)
    }};
  }};
  const stableElementRef = (el, prefix) => {{
    if (!el) return prefix + "0";
    const attr = "data-tide-page-map-" + prefix + "-ref";
    const existing = el.getAttribute && el.getAttribute(attr);
    if (existing) return existing;
    const next = (window.__tidePageMapRefCounter || 0) + 1;
    window.__tidePageMapRefCounter = next;
    const ref = prefix + next;
    if (el.setAttribute) el.setAttribute(attr, ref);
    return ref;
  }};
  const rectIntersectsViewport = (rect) => {{
    return rect && rect.right >= 0 && rect.bottom >= 0 && rect.left <= (window.innerWidth || 0) && rect.top <= (window.innerHeight || 0);
  }};
  const listSignature = (el) => {{
    const tag = (el.tagName || "").toLowerCase();
    const role = derivedRole(el) || "";
    const className = typeof el.className === "string" ? el.className : "";
    const classes = className.split(/\s+/).filter(Boolean).slice(0, 2).join(".");
    const dataIndex = el.getAttribute && el.getAttribute("data-index") != null ? "data-index" : "";
    return [tag, role, classes, dataIndex].filter(Boolean).join("|") || tag || "item";
  }};
  const listItemPayload = (el) => {{
    const rect = visibleRect(el);
    if (!rect) return null;
    const rawRect = el.getBoundingClientRect();
    if (!rectIntersectsViewport(rawRect)) return null;
    const text = normalizeText(el.innerText || el.textContent || "", 1000);
    if (text.length < 2) return null;
    const hrefNode = el.closest && el.closest("a[href]");
    const click = clickPointFor(el, rect);
    const dataIndex = el.getAttribute && el.getAttribute("data-index");
    const parsedIndex = dataIndex != null && dataIndex !== "" ? Number.parseInt(dataIndex, 10) : NaN;
    return {{
      ref: stableElementRef(el, "l"),
      index: Number.isFinite(parsedIndex) ? parsedIndex : null,
      label: elementLabel(el),
      text,
      href: hrefNode && hrefNode.href ? hrefNode.href : null,
      rect,
      click_point: click.click_point,
      signature: listSignature(el)
    }};
  }};
  const collectListSnapshot = () => {{
    const title = document.title || "";
    const url = window.location ? window.location.href : "";
    const scrollers = [];
    const rootScroller = document.scrollingElement || document.documentElement || document.body;
    if (rootScroller) scrollers.push(rootScroller);
    for (const el of Array.from(document.querySelectorAll("*"))) {{
      if (isScrollableElement(el)) scrollers.push(el);
      if (scrollers.length >= 12) break;
    }}
    const groups = [];
    for (const scroller of scrollers) {{
      const scrollerRect = scroller === rootScroller
        ? {{x: 0, y: 0, width: window.innerWidth || 0, height: window.innerHeight || 0}}
        : visibleRect(scroller);
      if (!scrollerRect || scrollerRect.width < 80 || scrollerRect.height < 60) continue;
      const nodes = Array.from(scroller.querySelectorAll("article, li, [role='listitem'], [data-index], a[href], button, section, div"));
      const buckets = new Map();
      for (const node of nodes.slice(0, 800)) {{
        if (node === scroller || node === document.body || node === document.documentElement) continue;
        const item = listItemPayload(node);
        if (!item) continue;
        if (item.rect.width < 80 || item.rect.height < 20 || item.rect.height > 700) continue;
        const bucket = buckets.get(item.signature) || [];
        bucket.push(item);
        buckets.set(item.signature, bucket);
      }}
      const candidates = Array.from(buckets.entries())
        .filter(([, items]) => items.length >= 2)
        .sort((a, b) => b[1].length - a[1].length);
      for (const [signature, items] of candidates.slice(0, 3)) {{
        const boundedItems = items.slice(0, 120).map((item) => {{
          const {{signature: _signature, ...rest}} = item;
          return rest;
        }});
        groups.push({{
          ref: stableElementRef(scroller, "s"),
          signature,
          label: elementLabel(scroller),
          rect: scrollerRect,
          scroll_top: scroller === rootScroller ? (window.scrollY || rootScroller.scrollTop || 0) : scroller.scrollTop,
          scroll_height: scroller === rootScroller ? Math.max(rootScroller.scrollHeight || 0, document.body ? document.body.scrollHeight : 0) : scroller.scrollHeight,
          client_height: scroller === rootScroller ? (window.innerHeight || rootScroller.clientHeight || 0) : scroller.clientHeight,
          at_top: (scroller === rootScroller ? (window.scrollY || rootScroller.scrollTop || 0) : scroller.scrollTop) <= 2,
          at_bottom: ((scroller === rootScroller ? (window.scrollY || rootScroller.scrollTop || 0) : scroller.scrollTop) + (scroller === rootScroller ? (window.innerHeight || rootScroller.clientHeight || 0) : scroller.clientHeight)) >= ((scroller === rootScroller ? Math.max(rootScroller.scrollHeight || 0, document.body ? document.body.scrollHeight : 0) : scroller.scrollHeight) - 8),
          items: boundedItems,
          truncated: items.length > boundedItems.length
        }});
      }}
      if (groups.length >= 8) break;
    }}
    return {{
      title,
      url,
      groups: groups.slice(0, 8),
      truncated: groups.length > 8
    }};
  }};
  const postListSnapshot = () => {{
    post({{kind: "browser-list-snapshot", pane_id: paneId, ...collectListSnapshot()}});
  }};
  const collectPageMap = () => {{
    const regionLimit = 30;
    const interactableLimit = 80;
    const interactableSelector = [
      "button", "input", "textarea", "select", "a[href]",
      "summary", "[onclick]", "[tabindex]:not([tabindex='-1'])",
      "[role='button']", "[role='link']", "[role='textbox']", "[role='searchbox']", "[role='combobox']",
      "[role='checkbox']", "[role='radio']", "[role='switch']", "[role='slider']", "[role='spinbutton']",
      "[role='tab']", "[role='menuitem']", "[role='option']", "[role='treeitem']",
      "[data-action]", "[contenteditable='true']"
    ].join(",");
    const regionSelector = [
      "main", "aside", "nav", "header", "footer", "section", "form", "dialog", "ul", "ol",
      "[role='main']", "[role='navigation']", "[role='complementary']", "[role='dialog']",
      "[role='form']", "[role='search']", "[role='list']", "[role='listbox']", "[role='region']",
      "[role='application']",
      "[aria-label]", "[data-region]", "[data-panel]"
    ].join(",");
    const interactables = [];
    const regions = [];
    let seen = new Set();
    const pushElement = (target, el, prefix, kind, limit) => {{
      if (!el || seen.has(el)) return false;
      const payload = elementPayload(el, stableElementRef(el, prefix), kind);
      if (!payload) return false;
      seen.add(el);
      if (target.length < limit) target.push(payload);
      return true;
    }};
    const interactableNodes = Array.from(document.querySelectorAll(interactableSelector));
    const interactableSet = new Set(interactableNodes);
    let visibleInteractableCount = 0;
    for (const el of interactableNodes) {{
      if (pushElement(interactables, el, "i", "interactable", interactableLimit)) visibleInteractableCount += 1;
    }}
    seen = new Set();
    const regionNodes = Array.from(document.querySelectorAll(regionSelector));
    let visibleRegionCount = 0;
    for (const el of regionNodes) {{
      if (interactableSet.has(el)) continue;
      if (pushElement(regions, el, "r", "region", regionLimit)) visibleRegionCount += 1;
    }}
    return {{
      regions,
      interactables,
      truncated_regions: visibleRegionCount > regionLimit,
      truncated_interactables: visibleInteractableCount > interactableLimit
    }};
  }};
  const postPageSnapshot = () => {{
    const title = document.title || "";
    const url = window.location ? window.location.href : "";
    const root = document.body || document.documentElement;
    const text = root && typeof root.innerText === "string" ? root.innerText : "";
    post({{kind: "browser-snapshot", pane_id: paneId, text, title, url, page_map: collectPageMap()}});
  }};
  const postSelectionSnapshot = () => {{
    const selection = window.getSelection ? window.getSelection() : null;
    const title = document.title || "";
    const url = window.location ? window.location.href : "";
    if (!selection || selection.rangeCount === 0) {{
      post({{kind: "browser-selection", pane_id: paneId, text: "", html: "", context: null, title, url, collapsed: true}});
      return;
    }}
    const text = selection.toString();
    if (!text || !text.trim()) {{
      post({{kind: "browser-selection", pane_id: paneId, text: "", html: "", context: null, title, url, collapsed: true}});
      return;
    }}
    const range = selection.getRangeAt(0);
    const fragment = document.createElement("div");
    fragment.appendChild(range.cloneContents());
    const anchor = range.commonAncestorContainer && range.commonAncestorContainer.parentElement
      ? range.commonAncestorContainer.parentElement
      : document.body;
    const context = anchor && anchor.innerText ? anchor.innerText : "";
    post({{
      kind: "browser-selection",
      pane_id: paneId,
      text,
      html: fragment.innerHTML,
      context,
      title,
      url,
      collapsed: !!selection.isCollapsed
    }});
  }};
  const snapshot = () => {{
    postPageSnapshot();
    postSelectionSnapshot();
    postNetworkLog();
    postListSnapshot();
  }};
  window.__tideRequestNetworkLog = postNetworkLog;
  window.__tideRequestListSnapshot = postListSnapshot;
  const ensureAutomationCursor = () => {{
    let cursor = document.getElementById('__tide-automation-cursor');
    if (cursor) return cursor;
    cursor = document.createElement('div');
    cursor.id = '__tide-automation-cursor';
    cursor.style.position = 'fixed';
    cursor.style.left = '0px';
    cursor.style.top = '0px';
    cursor.style.width = '24px';
    cursor.style.height = '24px';
    cursor.style.background = 'transparent';
    cursor.style.transform = 'translate(-2px, -2px)';
    cursor.style.pointerEvents = 'none';
    cursor.style.zIndex = '2147483647';
    cursor.style.display = 'none';
    cursor.style.opacity = '0';
    cursor.style.transition = 'left 280ms cubic-bezier(0.2, 0.8, 0.2, 1), top 280ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 180ms ease-out';
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    shape.setAttribute('viewBox', '0 0 24 24');
    shape.setAttribute('width', '24');
    shape.setAttribute('height', '24');
    shape.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))';
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M3 2 L3 21 L8.6 15.7 L12.2 23 L15.4 21.4 L11.9 14.3 L19 14.3 Z');
    path.setAttribute('fill', 'white');
    path.setAttribute('stroke', 'rgba(17,24,39,0.92)');
    path.setAttribute('stroke-width', '1.6');
    path.setAttribute('stroke-linejoin', 'round');
    shape.appendChild(path);
    cursor.appendChild(shape);
    (document.body || document.documentElement).appendChild(cursor);
    return cursor;
  }};
  window.__tideAutomationCursorMotionDurationMs = (origin, target, provided) => {{
    if (Number.isFinite(provided)) {{
      return Math.max(0, Math.min(900, Math.round(provided)));
    }}
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1) return 0;
    return Math.max(120, Math.min(900, Math.round(distance / 1.35)));
  }};
  window.__tideSetAutomationCursor = (payload) => {{
    if (!payload || payload.visible === false) {{
      if (window.__tideClearAutomationCursor) window.__tideClearAutomationCursor();
      return;
    }}
    const cursor = ensureAutomationCursor();
    const wasHidden = cursor.style.display === 'none' || cursor.style.opacity === '0';
    const target = {{
      x: Number.isFinite(payload.x) ? payload.x : 0,
      y: Number.isFinite(payload.y) ? payload.y : 0
    }};
    const previous = window.__tideAutomationCursorLastPoint;
    const origin = wasHidden
      ? (previous || {{
          x: Math.max(0, target.x - 28),
          y: Math.max(0, target.y - 18)
        }})
      : (previous || {{
          x: Number.parseFloat(cursor.style.left) || target.x,
          y: Number.parseFloat(cursor.style.top) || target.y
        }});
    const motionMs = window.__tideAutomationCursorMotionDurationMs(origin, target, payload.motionMs);
    cursor.style.transition = `left ${{motionMs}}ms cubic-bezier(0.2, 0.8, 0.2, 1), top ${{motionMs}}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 180ms ease-out`;
    cursor.style.display = 'block';
    if (wasHidden) {{
      cursor.style.left = `${{origin.x}}px`;
      cursor.style.top = `${{origin.y}}px`;
      cursor.offsetHeight;
      requestAnimationFrame(() => {{
        cursor.style.opacity = '1';
        cursor.style.left = `${{target.x}}px`;
        cursor.style.top = `${{target.y}}px`;
      }});
    }} else {{
      cursor.style.opacity = '1';
      cursor.style.left = `${{target.x}}px`;
      cursor.style.top = `${{target.y}}px`;
    }}
    window.__tideAutomationCursorLastPoint = target;
  }};
  window.__tideClearAutomationCursor = () => {{
    const cursor = document.getElementById('__tide-automation-cursor');
    if (!cursor) return;
    cursor.style.opacity = '0';
    window.setTimeout(() => {{
      if (cursor.style.opacity === '0') cursor.style.display = 'none';
    }}, 180);
  }};
  const dispatchMouse = (target, type, x, y) => {{
    target.dispatchEvent(new MouseEvent(type, {{
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      view: window
    }}));
  }};
  window.__tideBrowserAutomationClick = (x, y, delayMs = 0) => {{
    const fireClick = () => {{
      const target = document.elementFromPoint(x, y);
      if (!target) return false;
      if (typeof target.focus === 'function') target.focus();
      dispatchMouse(target, 'mousemove', x, y);
      dispatchMouse(target, 'mouseover', x, y);
      dispatchMouse(target, 'mousedown', x, y);
      dispatchMouse(target, 'mouseup', x, y);
      dispatchMouse(target, 'click', x, y);
      return true;
    }};
    const clickDelayMs = Math.max(0, delayMs + 45);
    window.setTimeout(() => requestAnimationFrame(fireClick), clickDelayMs);
    return true;
  }};
  window.__tideBrowserAutomationType = (text) => {{
    const target = document.activeElement;
    if (!target) return false;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {{
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      target.setRangeText(text, start, end, 'end');
      target.dispatchEvent(new InputEvent('input', {{bubbles: true, data: text, inputType: 'insertText'}}));
      return true;
    }}
    if (target.isContentEditable) {{
      if (document.execCommand) {{
        document.execCommand('insertText', false, text);
      }} else {{
        target.textContent = (target.textContent || '') + text;
      }}
      target.dispatchEvent(new InputEvent('input', {{bubbles: true, data: text, inputType: 'insertText'}}));
      return true;
    }}
    return false;
  }};
  window.__tideBrowserAutomationTypeAt = (x, y, text, delayMs = 0) => {{
    const focusAndType = () => {{
      const target = document.elementFromPoint(x, y);
      if (!target) return false;
      if (typeof target.focus === 'function') target.focus();
      return window.__tideBrowserAutomationType ? window.__tideBrowserAutomationType(text) : false;
    }};
    const typeDelayMs = Math.max(0, delayMs + 45);
    window.setTimeout(() => requestAnimationFrame(focusAndType), typeDelayMs);
    return true;
  }};
  window.__tideBrowserAutomationPress = (key) => {{
    const target = document.activeElement || document.body || document.documentElement;
    if (!target) return false;
    const init = {{key, bubbles: true, cancelable: true}};
    target.dispatchEvent(new KeyboardEvent('keydown', init));
    target.dispatchEvent(new KeyboardEvent('keypress', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
    if ((key === 'Enter' || key === ' ') && typeof target.click === 'function' &&
        (target.tagName === 'BUTTON' || target.tagName === 'A')) {{
      target.click();
    }}
    return true;
  }};
  const nearestScrollable = (node) => {{
    let el = node && node.nodeType === Node.ELEMENT_NODE ? node : null;
    while (el && el !== document.body && el !== document.documentElement) {{
      const style = window.getComputedStyle(el);
      if (style) {{
        const overflowY = style.overflowY || style.overflow;
        const overflowX = style.overflowX || style.overflow;
        const canScrollY = /(auto|scroll|overlay)/.test(overflowY) && el.scrollHeight > el.clientHeight;
        const canScrollX = /(auto|scroll|overlay)/.test(overflowX) && el.scrollWidth > el.clientWidth;
        if (canScrollY || canScrollX) return el;
      }}
      el = el.parentElement;
    }}
    return document.scrollingElement || document.documentElement || document.body;
  }};
  window.__tideBrowserAutomationScroll = (deltaX, deltaY, x = null, y = null) => {{
    const hasPoint = Number.isFinite(x) && Number.isFinite(y);
    const pointTarget = hasPoint ? document.elementFromPoint(x, y) : document.activeElement;
    const target = nearestScrollable(pointTarget);
    if (!target) return false;
    target.scrollBy({{
      left: Number.isFinite(deltaX) ? deltaX : 0,
      top: Number.isFinite(deltaY) ? deltaY : 0,
      behavior: 'auto'
    }});
    return true;
  }};
  let scheduled = false;
  const schedule = () => {{
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {{
      scheduled = false;
      snapshot();
    }}, 0);
  }};
  window.__tideRequestPageSnapshot = schedule;
  const root = document.documentElement || document.body;
  if (root && typeof MutationObserver !== "undefined") {{
    const observer = new MutationObserver(schedule);
    observer.observe(root, {{
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true
    }});
  }}
  document.addEventListener("contextmenu", (e) => {{
    let link_url = null;
    let image_url = null;
    let el = e.target;
    while (el && el !== document) {{
      if (!link_url && el.tagName === "A" && el.href) link_url = el.href;
      if (!image_url && el.tagName === "IMG" && el.src) image_url = el.src;
      el = el.parentElement;
    }}
    const sel = window.getSelection ? window.getSelection() : null;
    const selected_text = (sel && sel.toString().trim()) ? sel.toString() : null;
    post({{
      kind: "browser-context-menu",
      pane_id: paneId,
      link_url,
      image_url,
      selected_text
    }});
  }}, true);
  document.addEventListener("selectionchange", schedule, true);
  document.addEventListener("mouseup", schedule, true);
  document.addEventListener("keyup", schedule, true);
  document.addEventListener("input", schedule, true);
  document.addEventListener("change", schedule, true);
  document.addEventListener("touchend", schedule, true);
  window.addEventListener("focus", schedule, true);
  window.addEventListener("load", schedule, true);
  schedule();
}})();"#,
        pane_id = pane_id
    )
}
