import { isWebViewSettled, type BrowserWebViewElement } from "./browser-webview-actions.ts";

export function safeWebviewExec(webview: BrowserWebViewElement, code: string): Promise<unknown> {
  try {
    const result = webview.executeJavaScript?.(code);
    return result instanceof Promise ? result.catch(() => undefined) : Promise.resolve(undefined);
  } catch {
    return Promise.resolve(undefined);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForPostActionSettle(webview: BrowserWebViewElement): Promise<void> {
  await wait(150);
  const deadline = Date.now() + 1200;
  while (!isWebViewSettled(webview) && Date.now() < deadline) {
    await wait(75);
  }
}

export const BROWSER_ELEMENT_PICKER_SCRIPT = `(() => {
  if (window.__tidePickerActive) return;
  window.__tidePickerActive = true;
  window.__tidePicks = [];
  var els = [];
  var style = document.createElement('style');
  style.id = '__tidePickerStyle';
  style.textContent = '.__tidePickHover{outline:2px dashed #4c8bf5 !important;outline-offset:1px;cursor:crosshair !important;}.__tidePicked{outline:2px solid #4c8bf5 !important;outline-offset:1px;background:rgba(76,139,245,0.14) !important;cursor:crosshair !important;}';
  document.documentElement.appendChild(style);
  var last = null;
  function sync(){ window.__tidePicks = els.map(function(x){ return { text:(x.innerText||x.textContent||'').trim().slice(0,3000), tag:(x.tagName||'element').toLowerCase() }; }); }
  function over(e){ if(last && els.indexOf(last)<0){last.classList.remove('__tidePickHover');} last=e.target; if(last&&last.classList&&els.indexOf(last)<0){last.classList.add('__tidePickHover');} }
  function click(e){ e.preventDefault(); e.stopPropagation(); var el=e.target; var i=els.indexOf(el); if(i>=0){ els.splice(i,1); el.classList.remove('__tidePicked'); } else { els.push(el); el.classList.remove('__tidePickHover'); el.classList.add('__tidePicked'); } sync(); }
  function cleanup(){ els.forEach(function(x){x.classList.remove('__tidePicked');}); if(last){last.classList.remove('__tidePickHover');} document.removeEventListener('mouseover',over,true); document.removeEventListener('click',click,true); var s=document.getElementById('__tidePickerStyle'); if(s){s.remove();} window.__tidePickerActive=false; window.__tidePicks=[]; els=[]; }
  window.__tideCancelPick=cleanup;
  document.addEventListener('mouseover',over,true);
  document.addEventListener('click',click,true);
})()`;

export function normalizeBrowserUrl(input: string): string {
  const value = input.trim();
  if (value.length === 0) {
    return "";
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith("about:")) {
    return value;
  }
  if (/^[^\s/]+\.[^\s/]+/.test(value)) {
    return `https://${value}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}
