# Context Map

How Tide's bounded contexts relate to each other within the monocrate (`crates/tide-app/`).

```
┌─────────────────────────────────────────────────────────┐
│                  application/ (Orchestrator)             │
│                                                         │
│  Ports:  inward (10 port traits)                        │
│          outward (11 port traits)                        │
│  Services (15): action, dock, file_ops, file_tree,      │
│    focus_nav, gpu_init, lsp, pane_close, pane_create,   │
│    search, session, text_extract, update, workspace,    │
│    workspace_infra                                      │
└────┬──────┬──────┬──────┬──────┬──────┬─────────────────┘
     │      │      │      │      │      │
     ▼      ▼      ▼      ▼      ▼      ▼
┌────────┐┌──────┐┌──────┐┌──────┐┌─────┐┌──────┐┌──────┐┌──────┐
│ input  ││layout││termi-││editor││tree ││modal ││pane  ││state │
│        ││      ││nal   ││      ││     ││      ││      ││      │
│Router  ││Split-││Termi-││Edit- ││FsT- ││Modal-││Pane- ││Focus │
│Hotkey  ││Layout││nal   ││orSta-││ree  ││Stack ││Kind  ││Window│
│Global- ││Tab-  ││      ││te    ││     ││      ││      ││Cache │
│Action  ││Group ││      ││      ││     ││      ││      ││      │
└────────┘└──────┘└──────┘└──────┘└─────┘└──────┘└──────┘└──────┘
     │        │       │       │       │
     ▼        ▼       ▼       ▼       ▼
┌─────────────────────────────────────────────────────────┐
│              domain/core_types.rs (Shared Kernel)        │
│                                                         │
│  Types: PaneId, Rect, Size, Key, Modifiers, Color,     │
│         TerminalGrid, TerminalCell, CursorState         │
│  Traits: Renderer, LayoutEngine, TerminalBackend,       │
│          FileTreeSource, InputRouter                    │
└─────────────────────────────────────────────────────────┘
     ▲        ▲       ▲
     │        │       │
┌────────┐┌──────┐┌──────────┐
│renderer││platf-││lsp       │
│_adapter││orm_  ││_adapter  │
│        ││adapt-││          │
│WgpuRe- ││er   ││LspClient │
│nderer  ││     ││LspManager│
│        ││Platf-││          │
│        ││ormEv-││          │
│        ││ent   ││          │
└────────┘└──────┘└──────────┘
  adapter/outward/ (11 adapters)
```

## Module Structure

All code lives in `crates/tide-app/src/`:

| Layer | Path | Responsibility |
|-------|------|---------------|
| **Domain** | `domain/` | Pure business logic, no I/O |
| **Application** | `application/ports/` | Port trait definitions (inward + outward) |
| **Application** | `application/services/` | Use case implementations (15 services) |
| **Adapter Inward** | `adapter/inward/` | Platform events → application (9 adapters) |
| **Adapter Outward** | `adapter/outward/` | Application → infrastructure (11 adapters + view) |

## Relationships

### Shared Kernel: `domain/core_types.rs`
All modules depend on core_types for common types and trait definitions. This is the shared vocabulary — changing a type here affects everything.

### Dependency Direction

```
adapter/inward → application/services → domain
                                      ↘ application/ports/outward (traits)
                                          ↓
                              adapter/outward (implementations)
```

### Key Integration Points

1. **Platform → App**: `PlatformEvent` is the only way the outside world enters the system
2. **App → Input**: `Router.process(InputEvent)` returns `Action`
3. **App → Layout**: `SplitLayout.compute()` returns `Vec<(PaneId, Rect)>`
4. **App → Terminal**: `Terminal.process()` consumes PTY output; `Terminal.grid()` reads state
5. **App → Renderer**: `WgpuRenderer.begin_frame()` / `draw_*()` / `end_frame()`
6. **App → Platform**: `WindowCommand` channel for redraw requests, IME proxy management

## Invariants Across Contexts

- A `PaneId` is unique within a `WorkspaceManager` — no two panes share the same ID
- `SplitLayout` and `App.panes` HashMap must stay in sync — every ID in layout exists in the map
- Only the **active workspace** is loaded into App fields; others are stored in `WorkspaceManager.workspaces`
- `ModalStack` allows at most one open modal; `is_any_open()` gates input routing
