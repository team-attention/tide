# Spec: Terminal Sync

How PTY bytes become pixels on screen, and how the render cache tracks changes.

## Bounded Contexts

| Context | Role |
|---------|------|
| `tide-terminal` | PTY → grid sync (3 threads) |
| `tide-app` | Calls process(), checks grid_generation, triggers render |
| `tide-renderer` | Converts grid cells to GPU instances |

## Use Cases

### UC-1: SyncGrid

- **Actor**: System (background threads)
- **Trigger**: Shell output arrives on PTY
- **Precondition**: Terminal Pane exists with active PTY
- **Flow**:
  1. PTY Thread: read bytes → feed to VT parser → update Term grid → set dirty → unpark sync thread
  2. Sync Thread Phase 1 (locked): copy palette + all cells + cursor from Term
  3. Sync Thread Phase 2 (unlocked): diff raw_buf vs prev_raw_buf, convert changed cells (ANSI → Color), scan URLs, detect inverse cursor
  4. Increment grid_generation, write to shared snapshot, call waker()
  5. Main Thread: terminal.process() → consume_snapshot(), compare grid_generation → invalidate_pane(id)
- **Postcondition**: Grid snapshot updated, render cache invalidated for changed Pane

### UC-2: InvalidateCache

- **Actor**: System (RenderCache)
- **Trigger**: State change requiring re-render
- **Precondition**: RenderCache exists
- **Flow**:
  1. invalidate_chrome() → increment chrome_generation, set needs_redraw
  2. invalidate_pane(id) → remove pane from pane_generations, set needs_redraw
  3. Renderer checks is_chrome_dirty() and pane_generations to decide what to rebuild
- **Postcondition**: Affected regions marked for GPU rebuild
- **Business Rules**:
  - BR-1: New RenderCache starts dirty (needs initial render)
  - BR-2: invalidate_chrome increments generation and marks dirty
  - BR-3: invalidate_pane removes pane generation entry and marks dirty
  - BR-4: Chrome is not dirty when generations match
  - BR-5: Chrome is dirty when generations differ

## Generation Tracking

```
grid_generation (tide-terminal)    ← incremented on cell change
    │
    ▼
pane_generations[id] (tide-app)    ← compared to detect change
    │
    ▼
grid_dirty_panes (tide-renderer)   ← marks pane for cache rebuild
```

If a terminal has no output (idle shell), none of these increment → zero GPU work.

## Performance Path

| Step | Cost | Optimization |
|------|------|-------------|
| PTY read | O(bytes) | alacritty's optimized parser |
| Grid sync | O(changed_cells) | Diff against previous frame |
| Color conversion | O(changed_cells) | Skip unchanged cells |
| Snapshot swap | O(1) | Pointer swap, no copy |
| Grid cache rebuild | O(rows × cols) | Only for changed pane |
| Instance assembly | O(total_instances) | Incremental if pane order unchanged |
| GPU draw | O(1) | Instanced rendering (1 draw call) |

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-2 | BR-1 | `new_render_cache_starts_dirty_for_initial_render` |
| UC-2 | BR-2 | `invalidating_chrome_increments_generation_and_marks_render_cache_dirty` |
| UC-2 | BR-3 | `invalidating_pane_removes_pane_generation_and_marks_render_cache_dirty` |
| UC-2 | BR-4 | `chrome_generation_is_not_dirty_when_generations_match` |
| UC-2 | BR-5 | `chrome_generation_is_dirty_when_generations_differ` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| PTY | tide-terminal | `terminal.rs`, `grid_syncer.rs` |
| Cache | tide-app | `ui_state.rs` (RenderCache) |
| Renderer | tide-renderer | `wgpu_renderer.rs` |
| Tests | tide-app | `behavior_tests.rs :: mod render_cache_behavior` |
