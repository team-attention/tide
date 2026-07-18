# Spec: Browser Pane Popup Contract

Status: Investigation complete; presentation decision and implementation pending.

## Scope

Define how a Tide Browser Pane handles renderer-created auxiliary browsing
contexts (`window.open`, links/forms with a browsing-context target, and related
popup/tab dispositions) without changing browser semantics.

The motivating failure is Google sign-in opened from Figma, but the contract is
provider-neutral. This spec does not classify authentication providers, URL
paths, query parameters, or domains.

## Evidence

### E1. User-visible failure

The supplied Tide 0.1.128 screenshots show this sequence:

1. Figma renders its sign-up/log-in dialog.
2. `Continue with Google` opens a second Tide Browser Pane.
3. Google account chooser renders successfully.
4. After account selection, the second pane becomes blank and Figma remains
   signed out.

The rendered account chooser proves that the initial Google navigation, DNS,
TLS, and page rendering succeeded. It does not by itself prove the status of
the final Figma callback request.

### E2. Current BrowserRuntime cancels every renderer-created window

`BrowserRuntimeHost` currently installs this policy on each page
`WebContents`:

```ts
view.webContents.setWindowOpenHandler(({ url }) => {
  if (isHttpUrl(url)) {
    this.openPopupInBrowserPane(runtime, url);
  }
  return { action: "deny" };
});
```

`openPopupInBrowserPane` sends only the URL to React:

```ts
window.webContents.send("tide:open-browser-pane", url, true);
```

The original renderer-created window is therefore cancelled. A later
Workbench command creates a separate BrowserRuntime and navigates it to the
copied URL.

The following browser information is discarded at that boundary:

- the `WindowProxy` returned to the opener;
- the opener/child browsing-context relationship;
- `frameName` and named-window reuse;
- window feature intent;
- referrer details;
- form `postBody`;
- child-close coupling and `window.close` behavior.

The shared `persist:tide-workbench-browser` partition preserves cookies and
storage. It does not recreate an opener relationship between two independently
created `WebContents`.

### E3. Deterministic Tide 0.1.128 runtime probe

An isolated packaged-app probe used two local HTTP pages and no external
network:

- Parent calls `window.open(childUrl, name, "popup,width=420,height=540")`.
- Child records `window.opener === null` and posts `done` to its opener when one
  exists.
- Parent records whether it receives the message.

Observed result:

```json
{
  "returnedNull": true,
  "didCreateWindow": 0,
  "parentStatus": "waiting",
  "childRuntimeCreated": true,
  "childState": {
    "openerMissing": true,
    "text": "opener:false"
  }
}
```

This proves the failure mechanism independently of Figma and Google: Tide
cancels the auxiliary browsing context, creates a new page container, and makes
opener/postMessage completion impossible.

### E4. Regression history

The old renderer-`<webview>` implementation had an explicit auxiliary-window
exception. Its comments state that popup sign-in flows rely on
`window.opener`/`window.close`, and it returned Electron `action: "allow"` for a
subset of popup requests.

The policy changed repeatedly before removal:

| Commit | Policy |
| --- | --- |
| `e48857e8` | Preserve all HTTPS requests reported as `new-window`. |
| `4ad36425` | Narrow preservation using auth-like URL/path/query signals. |
| `7d2206f4` | Keep the auth-signal policy and native child window. |
| `596831c1` | Move popup ownership to `BrowserRuntimeHost`, remove the preservation policy/tests, deny every request, copy only the URL into a new Browser Pane. |

The repeated broad/narrow policy changes are evidence that URL recognition is
not a stable contract. The main-process migration removed the web-platform
relationship instead of moving it with BrowserRuntime ownership.

### E5. Current docs and tests disagree on popup preservation

`browser-use-main-process-runtime.md` puts system dialogs out of scope "beyond
preserving existing popup behavior" and says BrowserRuntime owns popup
execution.

The current architecture test instead asserts that `BrowserRuntimeHost` does
not contain `overrideBrowserWindowOptions`. That assertion locks in the
regression rather than a product invariant.

### E6. Platform contract

Electron documents that:

- `setWindowOpenHandler` handles `window.open`, `target=_blank`, and targeted
  form submissions;
- returning `{ action: "deny" }` cancels child-window creation;
- returning `{ action: "allow" }` preserves renderer-created window semantics;
- `createWindow(options) => WebContents` can supply the child `WebContents`
  instead of creating a standalone `BrowserWindow`.

The HTML model represents such windows as auxiliary browsing contexts with an
opener context and a corresponding `WindowProxy`. Cross-origin pages can still
use the limited opener surface, including `postMessage`, unless the page itself
requests isolation through `noopener` or Cross-Origin-Opener-Policy.

References:

- <https://www.electronjs.org/docs/latest/api/window-open>
- <https://www.electronjs.org/docs/latest/api/structures/window-open-handler-response>
- <https://html.spec.whatwg.org/multipage/document-sequences.html>
- <https://developer.mozilla.org/en-US/docs/Web/API/Window/opener>
- <https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage>

### E7. Observability gap

BrowserRuntime currently does not record bounded events for:

- `did-create-window`;
- `did-fail-load`;
- navigation redirects;
- renderer console errors;
- request completion/error status.

Therefore the exact final HTTP status or Figma callback script error behind the
blank screenshot is not recorded. What is proven is the Tide-level contract
violation that makes every opener-dependent completion path fail.

## Decisions

### Decided: preserve browser semantics, not auth-provider knowledge

Tide must not decide whether a renderer-created browsing context is important
by matching Google, Figma, OAuth, OIDC, SAML, login paths, query keys, or a list
of providers.

The browser request already carries semantic inputs such as disposition,
features, frame name, referrer, and form body. Tide must either preserve that
auxiliary context or explicitly block it. It must not cancel it and silently
reconstruct a different navigation from the URL alone.

### Decided: respect site-requested isolation

Tide must not invent an opener when the site requests `noopener`, when
Cross-Origin-Opener-Policy separates browsing-context groups, or when Chromium
otherwise returns no opener. The invariant is fidelity to the browser decision,
not forcing `window.opener` to exist.

### Decided: popup policy belongs to BrowserRuntime

BrowserRuntime owns page `WebContents`, popup creation, and child lifecycle.
React may project a child into Workbench, but React must not be the execution
authority for creating the child browsing context.

### Needs decision: child presentation

Two viable semantic implementations remain:

| Option | Shape | Strength | Cost/Risk |
| --- | --- | --- | --- |
| A. Pane-backed auxiliary `WebContents` | `setWindowOpenHandler` returns `action: "allow"` with `createWindow`; BrowserRuntime creates the exact child `WebContents`, then presents that same object in a new Browser Pane. | Preserves opener semantics and keeps work inside Thread/Workbench. No URL classification. | Requires synchronous child-runtime allocation, later Backend pane registration, close propagation, and proof that a returned child `WebContents` can be safely hosted by `WebContentsView`. |
| B. Native transient child window | Return `action: "allow"` and let Electron create a child `BrowserWindow` for true popup dispositions. | Smallest semantic restoration; Electron owns opener and close behavior. No URL classification. | Popup leaves Workbench, needs clear ownership/cleanup, and generic site popups can create native windows. |

Option A is the product-aligned target, but it is not decided until an Electron
prototype proves all of these with the same child `WebContents`:

- non-null `WindowProxy`;
- correct `window.opener` behavior;
- cross-origin `postMessage`;
- `window.close` and opener-close coupling;
- visible attach/detach through `WebContentsView`;
- no second navigation or state loss during pane registration.

Option B is the bounded fallback if public Electron primitives cannot satisfy
those proofs.

### Rejected: auth URL heuristic

The previous provider/path/query matcher is not an acceptable final policy. It
has false positives, false negatives, nested redirect ambiguity, and requires
ongoing provider-specific maintenance. The git history already demonstrates
policy oscillation without establishing a browser invariant.

### Rejected: current URL-copy behavior

Cancelling an auxiliary context and creating an unrelated Browser Pane from its
URL is not equivalent browser behavior. Shared cookies do not repair the lost
relationship.

## Out Of Scope

- Implementing either presentation option in this slice.
- Selecting a Google account, entering credentials, MFA, CAPTCHA, or consent.
- Provider/domain/path/query allowlists.
- Driving an external Chrome profile or system browser.
- Download, file chooser, permission-prompt, or general dialog policy.
- Production logging of complete auth URLs, tokens, query strings, form bodies,
  cookies, or page console contents.

## Domain Model

The semantic model to prove before choosing contracts:

```ts
interface AuxiliaryBrowserContext {
  openerRuntimeKey: { threadId: string; paneId: string };
  childRuntimeId: string;
  childWebContentsId: number;
  disposition: "default" | "foreground-tab" | "background-tab" | "new-window" | "other";
  frameName: string;
  lifecycle: "creating" | "open" | "closing" | "closed" | "failed";
  presentation: "workbench-pane" | "native-transient";
}
```

This model deliberately excludes `isAuth`, provider names, and URL-pattern
classification.

## Contracts

No process-boundary contract is decided yet.

If Option A passes the prototype, a later implementation spec must define a
main-to-Backend event that registers an already-created child runtime without
recreating or navigating its `WebContents`. The event must not carry secrets
that are unnecessary for pane registration.

If Option B is selected, no Workbench pane contract is required, but the owner
runtime and close lifecycle still need an Electron-main model.

## Flow

### Current failing flow

```text
page window.open
  -> Electron setWindowOpenHandler
  -> Tide copies URL to renderer
  -> Tide returns action: deny
  -> original WindowProxy/child context is cancelled
  -> renderer asks Backend for a new Browser Pane
  -> BrowserRuntime creates unrelated WebContents and loadURL(url)
  -> opener/postMessage/window.close contract is lost
```

### Required semantic flow

```text
page requests auxiliary context
  -> BrowserRuntime receives full Electron open details
  -> BrowserRuntime allows or explicitly blocks the request
  -> when allowed, Electron creates exactly one child WebContents
  -> opener receives the WindowProxy for that same child
  -> Tide presents that same child (pane or native transient)
  -> child navigation/message/close lifecycle stays browser-native
```

## Invariants

- An allowed `window.open` returns a `WindowProxy` for the exact child
  `WebContents` Tide presents.
- Tide never substitutes `loadURL(copiedUrl)` on an unrelated runtime for an
  allowed auxiliary context.
- `postMessage`, named-window reuse, referrer, targeted form body, and close
  behavior are either preserved or explicitly unsupported with a visible
  refusal.
- `noopener` and Cross-Origin-Opener-Policy isolation remain authoritative.
- Popup correctness is independent of provider/domain/path/query naming.
- One child `WebContents` has one BrowserRuntime owner and at most one
  presentation host.
- Closing the opener, child, pane, Thread, or app has a defined, testable
  lifecycle result.
- Debug evidence redacts query strings, fragments, form bodies, cookies, tokens,
  and page content by default.

## Tests

### Evidence harness before implementation

Record the full `setWindowOpenHandler` detail shape for deterministic local
fixtures:

- JavaScript `window.open(url, name, "popup,width=...")`;
- `window.open(url, name)` without features;
- `<a target="_blank">` plain click;
- Cmd/Ctrl-click, middle-click, and Shift-click;
- `<a target="_blank" rel="noopener">`;
- `<form method="post" target="name">`;
- repeated named-window opens;
- child page with Cross-Origin-Opener-Policy.

This matrix decides routing from platform evidence instead of assumptions about
Electron dispositions.

### Option A prototype gate

- `createWindow` returns a child `WebContents` accepted by Electron.
- Parent receives a non-null `WindowProxy` for that exact child.
- Same-origin direct access works where the platform allows it.
- Cross-origin child posts a message to the parent.
- `window.close` closes the same pane/runtime.
- The same child attaches to and detaches from `WebContentsView` without reload.
- Backend pane registration does not create a second child runtime.
- Hidden/visible BrowserRuntime observation still works.

### Option B fallback gate

- Electron creates a parented transient `BrowserWindow` with inherited safe web
  preferences and Browser Pane partition.
- Opener/message/close behavior passes the same fixtures.
- Closing the opener runtime closes the transient child unless the web platform
  explicitly requested otherwise.
- Generic popup behavior is understandable and bounded for the user.

### End-to-end regression

- Local opener/postMessage fixture passes.
- Figma -> Google sign-in completes after explicit human account interaction.
- No production test stores credentials or full auth URLs.

## Implementation Notes

Do not change product popup routing until the evidence harness and Option A
prototype results are recorded here.

Next slice:

1. Add a test-only Electron probe for handler details and child-context
   lifecycle; no production behavior change.
2. Prototype Option A entirely behind the test hook.
3. Record pass/fail evidence for every gate.
4. Decide Option A or B with the user.
5. Write the implementation spec and only then change BrowserRuntime production
   code.

