import type { ProductShellBrowserSnapshot } from "../../../../../application/domains/product-shell/product-shell.ts";

const BROWSER_INTERACTIVE_ELEMENT_CANDIDATES_SCRIPT = `(() => {
  const selectors = [
    "a[href]",
    "button",
    "input",
    "textarea",
    "select",
    "[role]",
    "[contenteditable='true']",
    "[tabindex]:not([tabindex='-1'])"
  ].join(",");
  const seen = new Set();
  const candidates = Array.from(document.querySelectorAll(selectors));
  const candidateSet = new Set(candidates);
  const pointerCandidates = [];
  const root = document.body ?? document.documentElement;
  if (root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let visited = 0;
    while (pointerCandidates.length < 240 && visited < 2000) {
      const element = walker.nextNode();
      if (!element) break;
      visited += 1;
      if (!(element instanceof HTMLElement) || candidateSet.has(element)) continue;
      const style = window.getComputedStyle(element);
      if (style.cursor !== "pointer") continue;
      const text = (element.innerText || element.textContent || "").trim();
      if (text.length > 0 || element.getAttribute("aria-label")) {
        pointerCandidates.push(element);
      }
    }
  }
  return candidates.concat(pointerCandidates)
    .map((element, sourceIndex) => ({ element, sourceIndex, rect: element.getBoundingClientRect() }))
    .filter(({ element, rect }) => {
      if (!(element instanceof HTMLElement) || seen.has(element)) return false;
      seen.add(element);
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none" && parseFloat(style.opacity) !== 0;
    })
    .map((item) => {
      const viewportLeft = Math.max(0, item.rect.left);
      const viewportTop = Math.max(0, item.rect.top);
      const viewportRight = Math.min(window.innerWidth, item.rect.right);
      const viewportBottom = Math.min(window.innerHeight, item.rect.bottom);
      const viewportWidth = Math.max(0, viewportRight - viewportLeft);
      const viewportHeight = Math.max(0, viewportBottom - viewportTop);
      return {
        ...item,
        inViewport: viewportWidth > 0 && viewportHeight > 0,
        viewportArea: viewportWidth * viewportHeight,
      };
    })
    .sort((a, b) => {
      if (a.inViewport !== b.inViewport) return a.inViewport ? -1 : 1;
      if (a.inViewport && b.inViewport) {
        const rowA = Math.floor(a.rect.top / 8);
        const rowB = Math.floor(b.rect.top / 8);
        if (rowA !== rowB) return rowA - rowB;
        const colA = Math.floor(a.rect.left / 8);
        const colB = Math.floor(b.rect.left / 8);
        if (colA !== colB) return colA - colB;
        const areaDelta = b.viewportArea - a.viewportArea;
        if (areaDelta !== 0) return areaDelta;
      }
      return a.sourceIndex - b.sourceIndex;
    })
    .slice(0, 80)
    .map((item) => item.element);
})()`;

export const BROWSER_INTERACTIVE_ELEMENTS_SCRIPT = `(() => {
  const elements = ${BROWSER_INTERACTIVE_ELEMENT_CANDIDATES_SCRIPT};
  return elements.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const text = "value" in element && typeof element.value === "string"
        ? element.value
        : (element.innerText || element.textContent || "");
      return {
        index,
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || undefined,
        type: element.getAttribute("type") || undefined,
        text: text.trim().replace(/\\s+/g, " ").slice(0, 240) || undefined,
        ariaLabel: element.getAttribute("aria-label") || undefined,
        placeholder: element.getAttribute("placeholder") || undefined,
        href: element instanceof HTMLAnchorElement ? element.href : undefined,
        disabled: element.disabled === true || element.getAttribute("aria-disabled") === "true",
        rect: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    });
})()`;

export function browserInteractiveElementClickScript(elementIndex: number): string {
  const payload = JSON.stringify({ elementIndex });
  return `((payload) => {
    const elements = ${BROWSER_INTERACTIVE_ELEMENT_CANDIDATES_SCRIPT};
    const target = elements[payload.elementIndex];
    if (!(target instanceof HTMLElement)) {
      return {
        ok: false,
        message: "Interactive element index out of range: " + payload.elementIndex + " (found " + elements.length + ")",
      };
    }
    const disabled = target.disabled === true || target.getAttribute("aria-disabled") === "true";
    if (disabled) {
      return { ok: false, message: "Interactive element " + payload.elementIndex + " is disabled" };
    }
    target.scrollIntoView?.({ block: "center", inline: "center" });
    target.focus?.({ preventScroll: true });
    const text = "value" in target && typeof target.value === "string"
      ? target.value
      : (target.innerText || target.textContent || "");
    const label = [
      "#" + payload.elementIndex,
      target.tagName.toLowerCase(),
      target.getAttribute("role") ? "role=" + target.getAttribute("role") : "",
      target.getAttribute("aria-label") || text.trim().replace(/\\s+/g, " ").slice(0, 80),
    ].filter(Boolean).join(" ");
    target.click();
    return { ok: true, message: "Clicked interactive element " + label };
  })(${payload})`;
}

export function browserInteractiveElementsFromUnknown(
  value: unknown,
): ProductShellBrowserSnapshot["interactiveElements"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const elements: NonNullable<ProductShellBrowserSnapshot["interactiveElements"]> = [];
  for (const item of value.slice(0, 80)) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const rect =
      record.rect !== null && typeof record.rect === "object" && !Array.isArray(record.rect)
        ? (record.rect as Record<string, unknown>)
        : {};
    const index = finiteRecordNumber(record, "index");
    const tag = stringRecordField(record, "tag");
    const x = finiteRecordNumber(rect, "x");
    const y = finiteRecordNumber(rect, "y");
    const width = finiteRecordNumber(rect, "width");
    const height = finiteRecordNumber(rect, "height");
    if (
      index === undefined ||
      tag === undefined ||
      x === undefined ||
      y === undefined ||
      width === undefined ||
      height === undefined
    ) {
      continue;
    }
    elements.push({
      index,
      tag,
      role: stringRecordField(record, "role"),
      type: stringRecordField(record, "type"),
      text: stringRecordField(record, "text"),
      ariaLabel: stringRecordField(record, "ariaLabel"),
      placeholder: stringRecordField(record, "placeholder"),
      href: stringRecordField(record, "href"),
      disabled: typeof record.disabled === "boolean" ? record.disabled : undefined,
      rect: { x, y, width, height },
    });
  }
  return elements.length === 0 ? undefined : elements;
}

function stringRecordField(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
}

function finiteRecordNumber(
  record: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
