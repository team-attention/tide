# Spec: Adapter Isolation — Compile-Time Port Boundary Enforcement

## Overview

### As-Is

All 10 inward adapters are implemented as `impl App` blocks. Since App's fields are `pub(crate)`, every adapter has unrestricted access to the entire domain state. This results in 156 direct domain mutations bypassing the port layer.

**Violations by adapter:**

| Adapter | Direct Mutations | Port Calls |
|---------|-----------------|------------|
| cli_adapter | `layout.split`, `panes.insert`, `focus.focused =`, `router.set_focused`, `ime.pending_creates`, `cache.invalidate`, `gateway.notify` | `open_browser_pane`, `create_terminal_pane`, `open_editor_pane`, `close_specific_pane`, `split_pane_from` |
| click_adapter | `focus.focused =`, `focus.zoomed_pane =`, `layout.remove`, `cache.invalidate`, `assoc.associated_terminal.insert`, `dock.dock_zoomed =`, `panes.get_mut` | `close_specific_pane`, `focus_terminal`, various DockPort/LayoutPort reads |
| event_loop_adapter | `focus.focused =`, `focus.focus_area =`, `router.set_focused`, `cache.invalidate`, `gateway.*`, `ime.*`, `input.*` | `compute_layout`, `sync_browser_webview_frames`, FileOpsPort methods |
| keyboard_adapter | `cache.*`, `modal.*`, `focus.*`, `router.*`, `interaction.pane_drag`, `panes.get_mut` | `handle_action`, `handle_global_action`, ClipboardSearchPort methods |
| mouse_adapter | `cache.*`, `modal.*`, `focus.*`, `router.*`, `interaction.*`, `layout.set_split_ratio`, `panes.get_mut` | Many port calls (DockPort, LayoutPort, ActionPort, etc.) |
| scroll_adapter | `cache.*`, `ft.scroll`, `panes.get_mut` (scroll state), `input.scroll_at` | AppCorePort, LayoutPort reads |
| search_adapter | `focus.search_focus =`, `cache.*`, `panes.get_mut` (search state) | AppCorePort reads |
| ime_adapter | `cache.*`, `ime.*`, `panes.get_mut` (browser URL input) | `resolve_launcher`, PaneLifecyclePort methods |
| text_routing_adapter | `cache.*`, `modal.*` (input), `panes.get_mut` (all pane types) | `respawn_terminal`, PaneLifecyclePort methods |
| drag_drop_adapter | Read-only (minimal violations) | DockPort, AppCorePort reads |

**Root cause**: `impl App` blocks in adapter files have access to all `pub(crate)` fields. The Rust compiler cannot distinguish "this impl block should only use port traits" from "this impl block is a service that needs full access."

### To-Be

Each inward adapter's methods become **free functions** (or methods on adapter-local structs) that accept port trait references via generic bounds instead of `&mut App`. The compiler rejects direct field access because the function only sees trait methods, not App's fields.

```
Before:  adapter/inward/cli_adapter/commands.rs → impl App { fn cli_render_html(&mut self) }
After:   adapter/inward/cli_adapter/commands.rs → fn cli_render_html(ctx: &mut impl CliPorts) → no App fields visible
```

**What changes:**
- Adapter functions take `&mut impl PortTrait1 + PortTrait2` instead of `&mut self` (App)
- Missing port methods are added to existing port traits (focus mutation, cache invalidation, modal state, etc.)
- App keeps a thin dispatch layer (`handle_cli_command`, `handle_key_event`, etc.) that passes `self` as the trait implementor
- `scripts/lint-arch.sh` verifies no `impl App` blocks remain in `adapter/inward/`

**What does NOT change:**
- Folder structure stays identical
- Port trait files stay where they are
- Service implementations stay as `impl PortTrait for App`
- Outward adapters are not touched
- Domain types are not touched

### Approach

#### Phase 1: Expand Port Traits

Add missing port methods so adapters have everything they need without direct field access. Group by concern:

**FocusNavPort additions** (focus state mutation):
- `focus_pane(&mut self, id: PaneId)` — set focused pane + router + cache
- `set_focus_area(&mut self, area: FocusArea)` — switch focus area + cache
- `set_search_focus(&mut self, pane_id: Option<PaneId>)` — search overlay focus
- `toggle_zoom(&mut self, pane_id: PaneId)` — toggle zoomed pane
- `focused_pane(&self) -> Option<PaneId>` — read current focus
- `current_focus_area(&self) -> FocusArea` — read focus area
- `zoomed_pane(&self) -> Option<PaneId>` — read zoom state

**AppCorePort additions** (cache + render):
- `invalidate_chrome(&mut self)` — mark chrome as dirty
- `invalidate_pane(&mut self, id: PaneId)` — mark pane as dirty
- `request_redraw(&mut self)` — request full redraw

**New: ModalPort** (modal state management):
- Read and mutate modal state (file_finder, git_switcher, save_as, config_page, context_menu)
- Currently spread across keyboard, mouse, ime, text_routing adapters

**New: PaneQueryPort** (pane reads and targeted mutations):
- `pane_kind(&self, id: PaneId) -> Option<&PaneKind>` — read pane type
- `with_pane_mut<F, R>(&mut self, id: PaneId, f: F) -> Option<R>` — scoped pane mutation
- `pane_ids(&self) -> Vec<PaneId>` — list all pane IDs
- `pane_count(&self) -> usize` — total pane count

**New: InteractionPort** (input/interaction state):
- Mouse press state, drag state, scroll timing
- Currently directly mutated by mouse, keyboard, scroll adapters

**New: GatewayPort** (agent gateway state):
- `gateway_notify(&mut self, event: &str, data: Value)` — emit event
- `gateway_stream_count(&self) -> usize` — active streams
- Other gateway operations currently in cli_adapter

#### Phase 2: Convert Adapters to Free Functions

Convert one adapter at a time, starting with the simplest:

**Order** (simplest → most complex):
1. `drag_drop_adapter` — near-zero mutations, mostly reads
2. `scroll_adapter` — small, focused on scroll state
3. `search_adapter` — small, focused on search focus
4. `cli_adapter` — isolated from other adapters, clear port mapping
5. `ime_adapter` — medium complexity
6. `text_routing_adapter` — pane-type-specific routing
7. `click_adapter` — many hit-test reads + some mutations
8. `mouse_adapter` — complex interaction state
9. `keyboard_adapter` — most complex, modal handling
10. `event_loop_adapter` — most complex, bridges everything

**Conversion pattern for each adapter:**

```rust
// BEFORE: adapter/inward/scroll_adapter/mod.rs
impl App {
    pub(crate) fn handle_scroll(&mut self, delta: f32, pos: Vec2) {
        if let Some(pid) = self.pane_at(pos) {
            if let Some(PaneKind::Editor(ed)) = self.panes.get_mut(&pid) {
                ed.scroll(delta);
                self.cache.invalidate_pane(pid);
            }
        }
    }
}

// AFTER: adapter/inward/scroll_adapter/mod.rs
use crate::{AppCorePort, PaneQueryPort, LayoutPort};

pub(crate) fn handle_scroll(
    ctx: &mut (impl AppCorePort + PaneQueryPort + LayoutPort),
    delta: f32,
    pos: Vec2,
) {
    if let Some(pid) = ctx.pane_at(pos) {
        ctx.scroll_pane(pid, delta);  // PaneQueryPort method — handles pane mutation + cache
    }
}

// Dispatch in App (thin bridge):
impl App {
    pub(crate) fn handle_scroll(&mut self, delta: f32, pos: Vec2) {
        scroll_adapter::handle_scroll(self, delta, pos);
    }
}
```

#### Phase 3: Lock Down

After all adapters are converted:
1. Update `scripts/lint-arch.sh` to reject any `impl App` in `adapter/inward/`
2. Add to CI pipeline
3. Remove old lint patterns (no longer needed since compiler enforces)

## Bounded Contexts

| Context | Role |
|---------|------|
| All inward adapters (`adapter/inward/*`) | Refactored from `impl App` to free functions with port bounds |
| All inward ports (`application/ports/inward/*`) | Expanded with missing methods |
| All services (`application/services/*`) | Implement new port methods |
| `app.rs` | Thin dispatch bridge from App to adapter free functions |

## Use Cases

### UC-1: ConvertAdapter — Convert an inward adapter to use port boundary

**Actor**: Developer
**Trigger**: Adapter has `impl App` blocks with direct domain mutations
**Precondition**: Required port methods exist (added in Phase 1)
**Flow**:
1. Identify all domain field accesses in the adapter
2. Classify each as: (a) read → use existing/new read port method, (b) mutation → use existing/new mutation port method
3. Change `impl App { fn method(&mut self) }` to `pub(crate) fn method(ctx: &mut impl Ports)`
4. Add thin dispatch in App that calls the free function with `self`
5. Verify `scripts/lint-arch.sh` passes
6. Verify all behavior tests pass

**Postcondition**: Adapter file contains no `impl App` blocks. All domain access goes through port traits.

**Business Rules**:
- **BR-1**: Adapter functions MUST NOT have `&mut App` or `&App` as receiver. They take `&mut impl PortTraits`.
- **BR-2**: Reads of domain state (pane type, focus state) MUST go through port query methods, not direct field access.
- **BR-3**: All domain mutations MUST go through port mutation methods. The port method handles cache invalidation internally.
- **BR-4**: Cache invalidation (`invalidate_chrome`, `invalidate_pane`, `needs_redraw`) MUST be internal to port methods, not called by adapters. Adapters never touch cache directly.
- **BR-5**: After conversion, `scripts/lint-arch.sh` MUST pass with zero violations for that adapter.
- **BR-6**: All existing behavior tests MUST pass after conversion (no behavioral change).

### UC-2: AddPortMethod — Add a missing port method

**Actor**: Developer
**Trigger**: An adapter needs to perform an operation that no existing port method covers
**Precondition**: The operation is currently a direct domain mutation in an adapter
**Flow**:
1. Identify the operation (e.g., "set focused pane and update router")
2. Find the appropriate port trait (e.g., FocusNavPort)
3. Add method signature to the port trait
4. Implement the method in the corresponding service
5. Service implementation handles all side effects (cache invalidation, router sync, etc.)

**Postcondition**: Port trait has a new method. Service implements it. Adapter can call it.

**Business Rules**:
- **BR-7**: New port methods MUST be added to the semantically closest existing port. Only create a new port trait if no existing port fits.
- **BR-8**: Port method implementations (in services) MUST handle all necessary side effects (cache invalidation, router sync, IME notification, gateway notification).
- **BR-9**: Port methods MUST be named for the intent (e.g., `focus_pane`), not the mechanism (e.g., `set_focus_and_invalidate_cache`).

### UC-3: LintArchitecture — Verify no adapter bypasses port boundary

**Actor**: CI / Developer
**Trigger**: `scripts/lint-arch.sh` is run
**Precondition**: None
**Flow**:
1. Scan all files in `adapter/inward/` for `impl App` blocks
2. Report any found as violations
3. Exit 0 if clean, 1 if violations found

**Postcondition**: Zero `impl App` blocks in `adapter/inward/`.

**Business Rules**:
- **BR-10**: No `impl App` blocks in any file under `adapter/inward/`.
- **BR-11**: The lint script runs in CI on every PR.

## Invariants

1. **Port Boundary**: After full conversion, no file in `adapter/inward/` contains `impl App`. Compiler enforces that adapter functions can only call port trait methods.
2. **Behavioral Equivalence**: All existing behavior tests pass after each adapter conversion. No user-visible behavior changes.
3. **Cache Encapsulation**: Cache invalidation is an internal concern of port method implementations. No adapter directly calls `cache.invalidate_*` or sets `cache.needs_redraw`.
4. **All existing Architecture Invariants** (PaneId sync, modal exclusivity, etc.) continue to hold.

## Tests

| UC | BR | Test Function |
|----|-----|---------------|
| UC-1 | BR-1 | `adapter_functions_take_port_traits_not_app()` |
| UC-1 | BR-5 | `lint_arch_passes_after_conversion()` |
| UC-1 | BR-6 | All existing behavior tests (537+) |
| UC-3 | BR-10 | `no_impl_app_in_inward_adapters()` |

Note: BR-1 through BR-4 are primarily enforced by the compiler (free functions can't access App fields) and the lint script. The behavior tests validate BR-6 (no behavioral regression).

## Location

| What | Where |
|------|-------|
| Inward adapters | `crates/tide-app/src/adapter/inward/` |
| Inward port traits | `crates/tide-app/src/application/ports/inward/` |
| Port implementations | `crates/tide-app/src/application/services/` |
| App dispatch bridge | `crates/tide-app/src/app.rs` |
| Lint script | `scripts/lint-arch.sh` |
| This spec | `docs/specs/adapter-isolation.md` |
