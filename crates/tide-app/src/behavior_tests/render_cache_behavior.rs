// Spec: docs/specs/terminal-sync.md — UC-2: InvalidateCache
use crate::state::RenderCache;

#[test]
fn new_render_cache_starts_dirty_for_initial_render() {
    // UC-2 BR-1: New RenderCache starts dirty
    let cache = RenderCache::new();
    assert!(cache.needs_redraw);
}

#[test]
fn invalidating_chrome_increments_generation_and_marks_render_cache_dirty() {
    // UC-2 BR-2: invalidate_chrome increments generation and marks dirty
    let mut cache = RenderCache::new();
    cache.invalidate_chrome();
    assert!(cache.needs_redraw);
    assert!(cache.is_chrome_dirty());
}

#[test]
fn invalidating_pane_removes_pane_generation_and_marks_render_cache_dirty() {
    // UC-2 BR-3: invalidate_pane removes pane generation entry and marks dirty
    let mut cache = RenderCache::new();
    cache.pane_generations.insert(42, 1);
    cache.invalidate_pane(42);
    assert!(!cache.pane_generations.contains_key(&42));
    assert!(cache.needs_redraw);
}

#[test]
fn chrome_generation_is_not_dirty_when_generations_match() {
    // UC-2 BR-4: Chrome is not dirty when generations match
    let mut cache = RenderCache::new();
    cache.chrome_generation = 5;
    cache.last_chrome_generation = 5;
    assert!(!cache.is_chrome_dirty());
}

#[test]
fn chrome_generation_is_dirty_when_generations_differ() {
    // UC-2 BR-5: Chrome is dirty when generations differ
    let mut cache = RenderCache::new();
    cache.chrome_generation = 6;
    cache.last_chrome_generation = 5;
    assert!(cache.is_chrome_dirty());
}
