# Research: UI Rendering Surface

## Question

Tide v2 is moving from a terminal-centered product toward a Codex App alternative. The open question is whether Tide should keep extending its custom Rust + GPU renderer for the main Agent Chat UI, or use a community-proven UI surface while keeping the Rust base.

## Non-Negotiable

Rust remains the product base.

This research does not evaluate rewriting Tide as a JavaScript app. It evaluates the UI surface for Agent Chat while preserving:

- Rust application core.
- Agent Runtime control.
- Thread, Project, Workspace, and Workbench state.
- Existing GPU-native Pane rendering where it is already valuable.

## Current Tide Evidence

### Existing GPU Renderer

Source: `docs/domain/renderer.md`

Observed:

- Tide has a `WgpuRenderer`.
- It renders Grid, Chrome, Overlay, and Top layers.
- It owns glyph atlas, GPU pipelines, per-pane grid caches, and dirty buffer upload rules.
- It uses instanced rendering for grid backgrounds and grid glyphs.
- It uses `cosmic-text` for shaping/fallback and MSDF font rendering for glyph output.

Implication:

- The renderer is optimized for dense grid-like surfaces: Terminal Pane, Editor Pane, Diff Pane, FileTree View, and chrome.
- Agent Chat would require a broader document UI system: variable-height blocks, markdown, cards, buttons, focus rings, copy/selection semantics, accessibility, composition input, and scroll virtualization.

### Current Dependencies

Source: `crates/tide-app/Cargo.toml`

Observed:

- Tide already depends on `wgpu`, `cosmic-text`, and Rust-side renderer support crates.
- Tide also depends on macOS native bridge crates such as `objc2`, `objc2-foundation`, and `objc2-app-kit`.

Implication:

- Tide can remain Rust-native while using platform UI surfaces.
- A WebView-backed Agent Chat does not imply abandoning Rust; it is another outward adapter surface.

### Existing WebView Surface

Sources:

- `crates/tide-app/src/domain/pane/browser.rs`
- `crates/tide-app/src/application/services/workspace_infra_service/mod.rs`
- `crates/tide-app/src/adapter/outward/platform_adapter/macos/webview.rs`

Observed:

- `BrowserPane` is backed by native `WKWebView`.
- Browser Pane WebViews are native `NSView`s outside the `wgpu` render tree.
- The macOS WebView wrapper uses `objc2` message sends to interact with WebKit classes.

Implication:

- Tide already supports a hybrid rendering model.
- Adding a WebView-backed Agent Chat is consistent with current architecture if it is treated as a bounded outward adapter, not as a product rewrite.

## External Framework Evidence

### Tauri

Source: https://v2.tauri.app/concept/architecture/

Observed:

- Tauri uses Rust tools and HTML rendered in a WebView.
- WebViews control system behavior through message passing to the Rust side.
- Tauri uses the operating system WebView instead of shipping a full runtime.

Implication for Tide:

- Tauri validates the architecture pattern: Rust core plus WebView UI.
- Tide does not need to adopt Tauri wholesale because it already has a native macOS shell and `WKWebView` bridge.

### Electron

Source: https://www.electronjs.org/docs/latest/

Observed:

- Electron builds desktop apps with JavaScript, HTML, and CSS.
- It embeds Chromium and Node.js to maintain one JavaScript codebase across platforms.

Implication for Tide:

- Electron validates web UI productivity for desktop apps.
- It is a poor fit for preserving Tide's current Rust-native shell and small native surface because it brings a bundled Chromium + Node runtime.

### React

Source: https://react.dev/learn/describing-the-ui

Observed:

- React is a JavaScript library for rendering UI.
- It composes UI from reusable components.

Implication for Tide:

- React is a strong candidate for Agent Chat because Agent Session Blocks naturally map to components.
- React should render a bounded Agent Chat surface, not own Tide's core runtime state.

### React Aria

Source: https://react-aria.adobe.com/quality#accessibility

Observed:

- React Aria focuses on accessibility, internationalization, and interactions.
- It handles semantics, keyboard/pointer events, focus management, and screen reader announcements.
- It includes locale handling, including Korean.

Implication for Tide:

- Agent Chat controls such as Composer, menus, dialogs, and prompts should prefer proven accessibility primitives over custom GPU implementations.

### Radix Primitives

Source: https://www.radix-ui.com/primitives/docs/overview/introduction

Observed:

- Radix Primitives provides unstyled accessible components.
- It handles focus management, keyboard navigation, ARIA attributes, and component behavior.
- It supports incremental adoption and keeps styling under the application's control.

Implication for Tide:

- Radix is a good fit for popovers, dialogs, dropdowns, tooltips, tabs, and composer options when the Agent Chat is WebView-rendered.

### Web Composition Events

Source: https://developer.mozilla.org/en-US/docs/Web/API/CompositionEvent

Observed:

- `CompositionEvent` represents indirect text input such as input method editor behavior.
- The feature is broadly established across browsers.

Implication for Tide:

- Browser-native text input gives Tide a stronger base for Korean IME behavior than implementing every composition edge case in a custom GPU input system.

### CodeMirror

Source: https://codemirror.net/docs/ref/

Observed:

- CodeMirror's view is a DOM component that displays editor state and allows text input.
- `EditorView.composing` reports IME composition state.
- CodeMirror renders only the visible viewport for large documents.

Implication for Tide:

- CodeMirror is a candidate for a code-aware Composer or prompt editor.
- It is not necessary for the first Composer if native `<textarea>` is enough.

### ProseMirror / Tiptap

Sources:

- https://prosemirror.net/docs/guide/
- https://tiptap.dev/docs/editor/core-concepts/introduction

Observed:

- ProseMirror provides a structured document model, editor state, view component, transactions, plugins, and commands.
- ProseMirror is powerful but not a simple drop-in component.
- Tiptap builds a headless editor framework on top of ProseMirror.

Implication for Tide:

- Rich text editing should remain a later option.
- Agent Chat does not need ProseMirror/Tiptap unless Composer becomes a structured rich-text document editor.

### GPUI

Source: https://github.com/zed-industries/zed/blob/main/crates/gpui/README.md

Observed:

- GPUI is a hybrid immediate and retained mode, GPU-accelerated UI framework for Rust.
- It is used by Zed.
- It is still pre-1.0 and in active development.
- The README says the current best way to learn APIs is to read Zed source or ask in Discord.

Implication for Tide:

- GPUI aligns with a Rust + GPU product philosophy.
- It is not the low-risk productivity choice for Agent Chat right now because the goal is to avoid owning low-level UI behavior.

### iced

Source: https://docs.iced.rs/

Observed:

- iced is a cross-platform GUI library for Rust focused on simplicity and type-safety.
- Its documentation describes it as experimental software and says the docs may frustrate users expecting hand-holding.

Implication for Tide:

- iced may be useful for Rust-native app UI exploration.
- It is not clearly superior to WebView + web UI libraries for a complex chat/composer surface today.

### egui

Source: https://github.com/emilk/egui

Observed:

- egui is an immediate-mode GUI library in Rust for native and web.
- It is simple, fast, and portable.
- It includes optional AccessKit support for native accessibility APIs on Windows and macOS.

Implication for Tide:

- egui is attractive for tools and internal surfaces.
- Immediate-mode UI is not the best match for Agent Chat's document-like transcript, rich controls, and text input depth.

### Slint

Source: https://docs.slint.dev/

Observed:

- Slint is a GUI toolkit for Embedded, Desktop, and Mobile.
- It has Rust, C++, JavaScript, and Python language integrations.
- It includes standard widgets and a declarative UI language.

Implication for Tide:

- Slint is a credible native UI toolkit.
- It does not have the same direct ecosystem fit for Agent Chat, markdown rendering, web-style component reuse, and browser-native input behavior as WebView + React.

## Candidate Architectures

### A. All-In Custom WGPU UI

Model:

```text
Rust core -> WgpuRenderer -> Agent Chat + Workbench
```

Strengths:

- One rendering engine.
- Maximum control.
- Strong fit with existing Terminal Pane and grid rendering.

Risks:

- Tide owns text input, Korean IME, selection, copy/paste, markdown layout, accessibility, focus management, menus, popovers, and virtualized transcript behavior.
- Agent Chat work competes with renderer infrastructure work.
- The product spends effort recreating community UI infrastructure.

Assessment:

- Keep for Workbench surfaces.
- Do not choose for Agent Chat without a performance workload that proves WebView cannot meet the product need.

### B. Rust Core + WebView Agent Chat + WGPU Workbench

Model:

```text
Rust core
  -> Agent Session Block JSON
  -> Agent Chat WebView

Rust core
  -> WgpuRenderer
  -> Workbench Panes
```

Strengths:

- Preserves Rust as the core.
- Uses community-proven UI/input/accessibility stack for the most interaction-heavy surface.
- Keeps existing GPU renderer where it already has evidence-based value.
- Matches Tide's existing hybrid model because Browser Pane already uses native WebView outside the `wgpu` render tree.

Risks:

- Requires a clear bridge contract.
- Requires lifecycle rules for focus, selection, keyboard shortcuts, themes, and persistence across native + WebView surfaces.
- Requires careful packaging of frontend assets.

Assessment:

- Best current fit for Tide v2.

### C. Full Tauri-Style Shell

Model:

```text
Tauri shell -> Rust backend -> WebView UI
```

Strengths:

- Proven architecture for Rust + WebView apps.
- Strong ecosystem and packaging story.

Risks:

- Tide already has a native shell, renderer, platform adapter, and Browser Pane.
- A wholesale shell migration would mix product direction with platform rewrite.

Assessment:

- Useful reference architecture.
- Not the next implementation move.

### D. Electron App

Model:

```text
Electron main process -> Chromium UI -> Rust sidecar or native module
```

Strengths:

- Very mature UI ecosystem.
- Predictable Chromium target.

Risks:

- Does not preserve Tide's current Rust-native shell identity.
- Adds bundled Chromium and Node.
- Moves too much product surface away from the existing codebase.

Assessment:

- Not preferred.

### E. Rust-Native Toolkit Replacement

Model:

```text
Rust core -> GPUI / iced / egui / Slint -> full app UI
```

Strengths:

- Keeps a single-language Rust product.
- Some options are promising for performance or native feel.

Risks:

- The main problem is not just drawing UI; it is polished text input, Korean IME, accessibility, document layout, markdown, menus, and web-like component iteration.
- Evidence does not show these toolkits reducing that risk more than WebView + React for Agent Chat.

Assessment:

- Worth revisiting after a small prototype if WebView creates unacceptable product constraints.
- Not the lowest-risk default.

## Current Conclusion

Tide v2 should keep Rust as the base and stop treating custom GPU rendering as a universal UI requirement.

Recommended target:

```text
Rust core + native shell
  Agent Runtime control
  Thread / Workspace / Project state
  Agent Session Block model
  Workbench state

Agent Chat WebView
  React / TypeScript
  React Aria or Radix for controls
  native textarea first
  CodeMirror only when the Composer needs code-editor behavior

WGPU Workbench
  Terminal Pane
  Diff Pane
  Editor Pane
  FileTree View
  overlays and dense local coding surfaces
```

The key architectural boundary is `Agent Session Block`.

Agent Session Blocks must be renderer-agnostic. WebView can render them first. WGPU can render selected blocks later if a real performance need appears.

## Validation Plan

Before finalizing the product architecture, build one narrow prototype:

1. Add a hidden or experimental Agent Chat WebView surface.
2. Render a static list of Agent Session Blocks from Rust-provided JSON.
3. Implement Composer with browser-native textarea.
4. Test Korean IME composition, paste, copy, selection, keyboard shortcuts, scroll behavior, and focus handoff with existing Tide Panes.
5. Add a long transcript sample and measure interaction latency.
6. Keep Workbench Panes in the existing WGPU renderer.

Decision gate:

- If the prototype passes IME, selection, focus, and transcript performance checks, Agent Chat should use WebView.
- If it fails on constraints that cannot be fixed locally, revisit GPUI or a narrower WGPU Agent Chat renderer.

## Open Questions

1. Should Agent Chat WebView be one native `WKWebView` attached to the active Thread, or one per visible Thread?
2. How should global shortcuts be routed when focus is inside Agent Chat WebView?
3. How should themes and font settings sync between WGPU Workbench and WebView Agent Chat?
4. How should Agent Chat WebView lifecycle interact with Workspace cold storage?
5. Should the frontend bundle live under `crates/tide-app/` or a separate `ui/` package?
