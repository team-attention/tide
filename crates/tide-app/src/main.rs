// Tide v0.1 — Integration (Step 3)
// Wires all crates together: winit window, wgpu surface, renderer, terminal panes,
// layout engine, input router, file tree, and CWD following.

mod input;
mod pane;
mod theme;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use winit::application::ApplicationHandler;
use winit::dpi::{LogicalSize, PhysicalSize};
use winit::event::{ElementState, Ime, MouseButton as WinitMouseButton, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::ModifiersState;
use winit::window::{Window, WindowAttributes, WindowId};

use tide_core::{
    Color, FileTreeSource, InputEvent, LayoutEngine, MouseButton, PaneId, Rect, Renderer, Size,
    SplitDirection, TerminalBackend, TextStyle, Vec2,
};
use tide_input::{Action, Direction, GlobalAction, Router};
use tide_layout::SplitLayout;
use tide_renderer::WgpuRenderer;
use tide_tree::FsTree;

use input::{winit_key_to_tide, winit_modifiers_to_tide};
use pane::TerminalPane;
use theme::*;

// ──────────────────────────────────────────────
// App state
// ──────────────────────────────────────────────

struct App {
    window: Option<Arc<Window>>,
    surface: Option<wgpu::Surface<'static>>,
    device: Option<Arc<wgpu::Device>>,
    queue: Option<Arc<wgpu::Queue>>,
    surface_config: Option<wgpu::SurfaceConfiguration>,
    renderer: Option<WgpuRenderer>,

    // Panes
    terminal_panes: HashMap<PaneId, TerminalPane>,
    layout: SplitLayout,
    router: Router,
    focused: Option<PaneId>,

    // File tree
    file_tree: Option<FsTree>,
    show_file_tree: bool,
    file_tree_scroll: f32,

    // Window state
    scale_factor: f32,
    window_size: PhysicalSize<u32>,
    modifiers: ModifiersState,
    last_cursor_pos: Vec2,

    // CWD tracking
    last_cwd: Option<PathBuf>,
    last_cwd_check: Instant,

    // Frame pacing
    needs_redraw: bool,
    last_frame: Instant,

    // IME composition state
    ime_composing: bool,
    ime_preedit: String,

    // Computed pane rects (cached after layout computation)
    pane_rects: Vec<(PaneId, Rect)>,

    // Grid generation tracking for vertex caching
    pane_generations: HashMap<PaneId, u64>,
    layout_generation: u64,

    // Chrome generation tracking (borders + file tree)
    chrome_generation: u64,
    last_chrome_generation: u64,

    // Input latency: skip 8ms sleep after keypress while awaiting PTY response
    input_just_sent: bool,
    input_sent_at: Option<Instant>,

    // Adaptive frame pacing: throttle to ~60fps during high throughput
    consecutive_dirty_frames: u32,
}

impl App {
    fn new() -> Self {
        Self {
            window: None,
            surface: None,
            device: None,
            queue: None,
            surface_config: None,
            renderer: None,
            terminal_panes: HashMap::new(),
            layout: SplitLayout::new(),
            router: Router::new(),
            focused: None,
            file_tree: None,
            show_file_tree: false,
            file_tree_scroll: 0.0,
            scale_factor: 1.0,
            window_size: PhysicalSize::new(1200, 800),
            modifiers: ModifiersState::empty(),
            last_cursor_pos: Vec2::new(0.0, 0.0),
            last_cwd: None,
            last_cwd_check: Instant::now(),
            needs_redraw: true,
            last_frame: Instant::now(),
            ime_composing: false,
            ime_preedit: String::new(),
            pane_rects: Vec::new(),
            pane_generations: HashMap::new(),
            layout_generation: 0,
            chrome_generation: 0,
            last_chrome_generation: u64::MAX,
            input_just_sent: false,
            input_sent_at: None,
            consecutive_dirty_frames: 0,
        }
    }

    fn init_gpu(&mut self) {
        let window = self.window.as_ref().unwrap().clone();
        self.scale_factor = window.scale_factor() as f32;
        self.window_size = window.inner_size();

        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            ..Default::default()
        });

        let surface = instance.create_surface(window).expect("create surface");

        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
        }))
        .expect("no suitable GPU adapter found");

        let (device, queue) = pollster::block_on(adapter.request_device(
            &wgpu::DeviceDescriptor {
                label: Some("tide_device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                memory_hints: Default::default(),
            },
            None,
        ))
        .expect("failed to create device");

        let device = Arc::new(device);
        let queue = Arc::new(queue);

        let caps = surface.get_capabilities(&adapter);
        let format = caps
            .formats
            .iter()
            .find(|f| !f.is_srgb())
            .copied()
            .unwrap_or(caps.formats[0]);

        // Prefer Mailbox (low latency, no tearing) > Fifo (vsync fallback)
        let present_mode = if caps.present_modes.contains(&wgpu::PresentMode::Mailbox) {
            wgpu::PresentMode::Mailbox
        } else {
            wgpu::PresentMode::Fifo
        };

        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: self.window_size.width,
            height: self.window_size.height,
            present_mode,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);

        let renderer = WgpuRenderer::new(
            Arc::clone(&device),
            Arc::clone(&queue),
            format,
            self.scale_factor,
        );

        self.surface = Some(surface);
        self.device = Some(device);
        self.queue = Some(queue);
        self.surface_config = Some(config);
        self.renderer = Some(renderer);
    }

    fn create_initial_pane(&mut self) {
        let (layout, pane_id) = SplitLayout::with_initial_pane();
        self.layout = layout;

        let cell_size = self.renderer.as_ref().unwrap().cell_size();
        let logical_w = self.window_size.width as f32 / self.scale_factor;
        let logical_h = self.window_size.height as f32 / self.scale_factor;

        let cols = (logical_w / cell_size.width).max(1.0) as u16;
        let rows = (logical_h / cell_size.height).max(1.0) as u16;

        match TerminalPane::new(pane_id, cols, rows) {
            Ok(pane) => {
                self.terminal_panes.insert(pane_id, pane);
                self.focused = Some(pane_id);
                self.router.set_focused(pane_id);
            }
            Err(e) => {
                log::error!("Failed to create terminal pane: {}", e);
            }
        }

        // Initialize file tree with CWD
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
        let tree = FsTree::new(cwd.clone());
        self.file_tree = Some(tree);
        self.last_cwd = Some(cwd);
    }

    fn logical_size(&self) -> Size {
        Size::new(
            self.window_size.width as f32 / self.scale_factor,
            self.window_size.height as f32 / self.scale_factor,
        )
    }

    fn compute_layout(&mut self) {
        let logical = self.logical_size();
        let pane_ids = self.layout.pane_ids();

        // Reserve space for file tree if visible
        let terminal_area = if self.show_file_tree {
            Size::new(
                (logical.width - FILE_TREE_WIDTH).max(100.0),
                logical.height,
            )
        } else {
            logical
        };

        let terminal_offset_x = if self.show_file_tree {
            FILE_TREE_WIDTH
        } else {
            0.0
        };

        let mut rects = self.layout.compute(terminal_area, &pane_ids, self.focused);

        // Offset rects to account for file tree panel
        for (_, rect) in &mut rects {
            rect.x += terminal_offset_x;
        }

        // Resize terminal backends to match their rects
        // During border drag, skip PTY resize to avoid SIGWINCH spam
        // (shell redraws prompt on every resize, flooding the terminal)
        let is_dragging = self.router.is_dragging_border();
        if !is_dragging {
            if let Some(renderer) = &self.renderer {
                let cell_size = renderer.cell_size();
                for &(id, rect) in &rects {
                    if let Some(pane) = self.terminal_panes.get_mut(&id) {
                        pane.resize_to_rect(rect, cell_size);
                    }
                }
            }
        }

        // Force grid rebuild if rects changed
        let rects_changed = rects != self.pane_rects;
        self.pane_rects = rects;

        if rects_changed {
            self.layout_generation += 1;
            self.pane_generations.clear();
            self.chrome_generation += 1;
        }

        // Store window size for layout drag operations
        self.layout.last_window_size = Some(terminal_area);
    }

    fn render(&mut self) {
        let surface = match self.surface.as_ref() {
            Some(s) => s,
            None => return,
        };

        let output = match surface.get_current_texture() {
            Ok(t) => t,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                self.reconfigure_surface();
                return;
            }
            Err(e) => {
                log::error!("Surface error: {}", e);
                return;
            }
        };

        let view = output
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());

        let logical = self.logical_size();
        let focused = self.focused;
        let show_file_tree = self.show_file_tree;
        let file_tree_scroll = self.file_tree_scroll;
        let pane_rects = self.pane_rects.clone();

        let renderer = self.renderer.as_mut().unwrap();

        // Atlas reset → all cached UV coords are stale, force full rebuild
        if renderer.atlas_was_reset() {
            self.pane_generations.clear();
            self.last_chrome_generation = self.chrome_generation.wrapping_sub(1);
        }

        renderer.begin_frame(logical);

        // Rebuild chrome layer only when chrome content changed (borders, file tree)
        let chrome_dirty = self.chrome_generation != self.last_chrome_generation;
        if chrome_dirty {
            renderer.invalidate_chrome();

            // Draw file tree panel if visible
            if show_file_tree {
                if let Some(tree) = self.file_tree.as_ref() {
                    let panel_rect = Rect::new(0.0, 0.0, FILE_TREE_WIDTH, logical.height);

                    renderer.draw_chrome_rect(panel_rect, TREE_BG_COLOR);
                    renderer.draw_chrome_rect(
                        Rect::new(FILE_TREE_WIDTH - BORDER_WIDTH, 0.0, BORDER_WIDTH, logical.height),
                        BORDER_COLOR,
                    );

                    let cell_size = renderer.cell_size();
                    let line_height = cell_size.height;
                    let indent_width = cell_size.width * 1.5;
                    let left_padding = 4.0;

                    let entries = tree.visible_entries();
                    for (i, entry) in entries.iter().enumerate() {
                        let y = i as f32 * line_height - file_tree_scroll;
                        if y + line_height < 0.0 || y > logical.height {
                            continue;
                        }

                        let x = left_padding + entry.depth as f32 * indent_width;

                        let prefix = if entry.entry.is_dir {
                            if entry.is_expanded { "v " } else { "> " }
                        } else {
                            "  "
                        };

                        let text_color = if entry.entry.is_dir {
                            TREE_DIR_COLOR
                        } else {
                            TREE_TEXT_COLOR
                        };

                        let style = TextStyle {
                            foreground: text_color,
                            background: None,
                            bold: entry.entry.is_dir,
                            italic: false,
                            underline: false,
                        };

                        let display_text = format!("{}{}", prefix, entry.entry.name);
                        renderer.draw_chrome_text(&display_text, Vec2::new(x, y), style, panel_rect);
                    }
                }
            }

            // Draw pane borders
            for &(id, rect) in &pane_rects {
                let is_focused = focused == Some(id);
                let border_color = if is_focused {
                    FOCUSED_BORDER_COLOR
                } else {
                    BORDER_COLOR
                };

                renderer.draw_chrome_rect(
                    Rect::new(rect.x, rect.y, rect.width, BORDER_WIDTH),
                    border_color,
                );
                renderer.draw_chrome_rect(
                    Rect::new(
                        rect.x,
                        rect.y + rect.height - BORDER_WIDTH,
                        rect.width,
                        BORDER_WIDTH,
                    ),
                    border_color,
                );
                renderer.draw_chrome_rect(
                    Rect::new(rect.x, rect.y, BORDER_WIDTH, rect.height),
                    border_color,
                );
                renderer.draw_chrome_rect(
                    Rect::new(
                        rect.x + rect.width - BORDER_WIDTH,
                        rect.y,
                        BORDER_WIDTH,
                        rect.height,
                    ),
                    border_color,
                );
            }

            self.last_chrome_generation = self.chrome_generation;
        }

        // Check if grid needs rebuild (any pane content or layout changed)
        let mut grid_dirty = false;
        for &(id, _) in &pane_rects {
            if let Some(pane) = self.terminal_panes.get(&id) {
                let gen = pane.backend.grid_generation();
                let prev = self.pane_generations.get(&id).copied().unwrap_or(u64::MAX);
                if gen != prev {
                    grid_dirty = true;
                    break;
                }
            }
        }

        // Rebuild grid layer only when content or layout changed
        if grid_dirty {
            renderer.invalidate_grid();
            for &(id, rect) in &pane_rects {
                if let Some(pane) = self.terminal_panes.get(&id) {
                    let inner = Rect::new(
                        rect.x + BORDER_WIDTH,
                        rect.y + BORDER_WIDTH,
                        rect.width - 2.0 * BORDER_WIDTH,
                        rect.height - 2.0 * BORDER_WIDTH,
                    );
                    pane.render_grid(inner, renderer);
                    self.pane_generations.insert(id, pane.backend.grid_generation());
                }
            }
        }

        // Always render cursor (overlay layer) — cursor blinks/moves independently
        for &(id, rect) in &pane_rects {
            if let Some(pane) = self.terminal_panes.get(&id) {
                let inner = Rect::new(
                    rect.x + BORDER_WIDTH,
                    rect.y + BORDER_WIDTH,
                    rect.width - 2.0 * BORDER_WIDTH,
                    rect.height - 2.0 * BORDER_WIDTH,
                );
                pane.render_cursor(inner, renderer);
            }
        }

        // Render IME preedit overlay (Korean composition in progress)
        if !self.ime_preedit.is_empty() {
            if let Some(focused_id) = focused {
                if let Some((_, rect)) = pane_rects.iter().find(|(id, _)| *id == focused_id) {
                    if let Some(pane) = self.terminal_panes.get(&focused_id) {
                        let cursor = pane.backend.cursor();
                        let cell_size = renderer.cell_size();
                        let inner_offset = Vec2::new(
                            rect.x + BORDER_WIDTH,
                            rect.y + BORDER_WIDTH,
                        );
                        let cx = inner_offset.x + cursor.col as f32 * cell_size.width;
                        let cy = inner_offset.y + cursor.row as f32 * cell_size.height;

                        // Draw preedit background
                        let preedit_chars: Vec<char> = self.ime_preedit.chars().collect();
                        let pw = preedit_chars.len().max(1) as f32 * cell_size.width;
                        let preedit_bg = Color::new(0.18, 0.22, 0.38, 1.0);
                        renderer.draw_rect(
                            Rect::new(cx, cy, pw, cell_size.height),
                            preedit_bg,
                        );

                        // Draw each preedit character
                        let preedit_style = TextStyle {
                            foreground: Color::new(0.95, 0.96, 1.0, 1.0),
                            background: None,
                            bold: false,
                            italic: false,
                            underline: true,
                        };
                        for (i, &ch) in preedit_chars.iter().enumerate() {
                            renderer.draw_cell(
                                ch,
                                cursor.row as usize,
                                cursor.col as usize + i,
                                preedit_style,
                                cell_size,
                                inner_offset,
                            );
                        }
                    }
                }
            }
        }

        renderer.end_frame();

        let device = self.device.as_ref().unwrap();
        let queue = self.queue.as_ref().unwrap();
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("render_encoder"),
        });

        renderer.render_frame(&mut encoder, &view);

        queue.submit(std::iter::once(encoder.finish()));
        output.present();
    }

    fn handle_window_event(&mut self, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => {
                std::process::exit(0);
            }
            WindowEvent::Resized(new_size) => {
                self.window_size = new_size;
                self.reconfigure_surface();
                self.compute_layout();
            }
            WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
                self.scale_factor = scale_factor as f32;
            }
            WindowEvent::ModifiersChanged(modifiers) => {
                self.modifiers = modifiers.state();
            }
            WindowEvent::Ime(ime) => match ime {
                Ime::Commit(text) => {
                    // IME composed text (Korean, CJK, etc.) → write directly to terminal
                    if let Some(focused_id) = self.focused {
                        if let Some(pane) = self.terminal_panes.get_mut(&focused_id) {
                            pane.backend.write(text.as_bytes());
                            self.input_just_sent = true;
                            self.input_sent_at = Some(Instant::now());
                        }
                    }
                    self.ime_composing = false;
                    self.ime_preedit.clear();
                }
                Ime::Preedit(text, _) => {
                    self.ime_composing = !text.is_empty();
                    self.ime_preedit = text;
                }
                _ => {}
            },
            WindowEvent::KeyboardInput { event, .. } => {
                if event.state != ElementState::Pressed {
                    return;
                }

                // During IME composition, only handle non-character keys
                if self.ime_composing
                    && matches!(event.logical_key, winit::keyboard::Key::Character(_))
                {
                    return;
                }

                if let Some(key) = winit_key_to_tide(&event.logical_key) {
                    let modifiers = winit_modifiers_to_tide(self.modifiers);
                    let input = InputEvent::KeyPress { key, modifiers };

                    let action = self.router.process(input, &self.pane_rects);
                    self.handle_action(action, Some(input));
                }
            }
            WindowEvent::MouseInput { state, button, .. } => {
                if state != ElementState::Pressed {
                    let was_dragging = self.router.is_dragging_border();
                    // End drag on mouse release
                    self.layout.end_drag();
                    self.router.end_drag();
                    // Apply final PTY resize now that drag is over
                    if was_dragging {
                        self.compute_layout();
                    }
                    return;
                }

                let btn = match button {
                    WinitMouseButton::Left => MouseButton::Left,
                    WinitMouseButton::Right => MouseButton::Right,
                    WinitMouseButton::Middle => MouseButton::Middle,
                    _ => return,
                };

                let input = InputEvent::MouseClick {
                    position: self.last_cursor_pos,
                    button: btn,
                };

                let action = self.router.process(input, &self.pane_rects);
                self.handle_action(action, Some(input));
            }
            WindowEvent::CursorMoved { position, .. } => {
                let pos = Vec2::new(
                    position.x as f32 / self.scale_factor,
                    position.y as f32 / self.scale_factor,
                );
                self.last_cursor_pos = pos;

                if self.router.is_dragging_border() {
                    // Adjust position for file tree offset
                    let drag_pos = if self.show_file_tree {
                        Vec2::new(pos.x - FILE_TREE_WIDTH, pos.y)
                    } else {
                        pos
                    };
                    self.layout.drag_border(drag_pos);
                    self.compute_layout();
                } else {
                    let input = InputEvent::MouseMove { position: pos };
                    let _ = self.router.process(input, &self.pane_rects);
                }
            }
            WindowEvent::MouseWheel { delta, .. } => {
                let dy = match delta {
                    MouseScrollDelta::LineDelta(_, y) => y * 3.0,
                    MouseScrollDelta::PixelDelta(p) => p.y as f32 / 10.0,
                };

                // Check if scrolling over the file tree
                if self.show_file_tree && self.last_cursor_pos.x < FILE_TREE_WIDTH {
                    let new_scroll = (self.file_tree_scroll - dy * 10.0).max(0.0);
                    if new_scroll != self.file_tree_scroll {
                        self.file_tree_scroll = new_scroll;
                        self.chrome_generation += 1;
                    }
                } else {
                    let input = InputEvent::MouseScroll {
                        delta: dy,
                        position: self.last_cursor_pos,
                    };
                    let action = self.router.process(input, &self.pane_rects);
                    self.handle_action(action, Some(input));
                }
            }
            WindowEvent::RedrawRequested => {
                self.update();
                self.render();
                self.needs_redraw = false;
                self.last_frame = Instant::now();
            }
            _ => {}
        }
    }

    fn handle_action(&mut self, action: Action, event: Option<InputEvent>) {
        match action {
            Action::RouteToPane(id) => {
                // Update focus
                if let Some(InputEvent::MouseClick { .. }) = event {
                    if self.focused != Some(id) {
                        self.focused = Some(id);
                        self.router.set_focused(id);
                        self.chrome_generation += 1;
                        self.update_file_tree_cwd();
                    }
                }

                // Forward keyboard input to terminal
                if let Some(InputEvent::KeyPress { key, modifiers }) = event {
                    if let Some(pane) = self.terminal_panes.get_mut(&id) {
                        pane.handle_key(&key, &modifiers);
                        self.input_just_sent = true;
                        self.input_sent_at = Some(Instant::now());
                    }
                }
            }
            Action::GlobalAction(global) => {
                self.handle_global_action(global);
            }
            Action::DragBorder(pos) => {
                let drag_pos = if self.show_file_tree {
                    Vec2::new(pos.x - FILE_TREE_WIDTH, pos.y)
                } else {
                    pos
                };
                let terminal_area = if self.show_file_tree {
                    Size::new(
                        (self.logical_size().width - FILE_TREE_WIDTH).max(100.0),
                        self.logical_size().height,
                    )
                } else {
                    self.logical_size()
                };
                self.layout.begin_drag(drag_pos, terminal_area);
                self.layout.drag_border(drag_pos);
                self.compute_layout();
            }
            Action::None => {}
        }
    }

    fn handle_global_action(&mut self, action: GlobalAction) {
        match action {
            GlobalAction::SplitVertical => {
                if let Some(focused) = self.focused {
                    let new_id = self.layout.split(focused, SplitDirection::Vertical);
                    self.create_terminal_pane(new_id);
                    self.chrome_generation += 1;
                    self.compute_layout();
                }
            }
            GlobalAction::SplitHorizontal => {
                if let Some(focused) = self.focused {
                    let new_id = self.layout.split(focused, SplitDirection::Horizontal);
                    self.create_terminal_pane(new_id);
                    self.chrome_generation += 1;
                    self.compute_layout();
                }
            }
            GlobalAction::ClosePane => {
                if let Some(focused) = self.focused {
                    let remaining = self.layout.pane_ids();
                    if remaining.len() <= 1 {
                        // Don't close the last pane — exit the app instead
                        std::process::exit(0);
                    }

                    self.layout.remove(focused);
                    self.terminal_panes.remove(&focused);

                    // Focus the first remaining pane
                    let remaining = self.layout.pane_ids();
                    if let Some(&next) = remaining.first() {
                        self.focused = Some(next);
                        self.router.set_focused(next);
                    } else {
                        self.focused = None;
                    }

                    self.chrome_generation += 1;
                    self.compute_layout();
                    self.update_file_tree_cwd();
                }
            }
            GlobalAction::ToggleFileTree => {
                self.show_file_tree = !self.show_file_tree;
                self.chrome_generation += 1;
                self.compute_layout();
                if self.show_file_tree {
                    self.update_file_tree_cwd();
                }
            }
            GlobalAction::MoveFocus(direction) => {
                if self.pane_rects.len() < 2 {
                    return;
                }
                let current_id = match self.focused {
                    Some(id) => id,
                    None => return,
                };
                let current_rect = match self.pane_rects.iter().find(|(id, _)| *id == current_id) {
                    Some((_, r)) => *r,
                    None => return,
                };
                let cx = current_rect.x + current_rect.width / 2.0;
                let cy = current_rect.y + current_rect.height / 2.0;

                // Find the closest pane in the given direction.
                // For Left/Right: prefer panes that vertically overlap, rank by horizontal distance.
                // For Up/Down: prefer panes that horizontally overlap, rank by vertical distance.
                let mut best: Option<(PaneId, f32)> = None;
                for &(id, rect) in &self.pane_rects {
                    if id == current_id {
                        continue;
                    }
                    let ox = rect.x + rect.width / 2.0;
                    let oy = rect.y + rect.height / 2.0;
                    let dx = ox - cx;
                    let dy = oy - cy;

                    let (valid, overlaps, dist) = match direction {
                        Direction::Left => (
                            dx < -1.0,
                            rect.y < current_rect.y + current_rect.height && rect.y + rect.height > current_rect.y,
                            dx.abs(),
                        ),
                        Direction::Right => (
                            dx > 1.0,
                            rect.y < current_rect.y + current_rect.height && rect.y + rect.height > current_rect.y,
                            dx.abs(),
                        ),
                        Direction::Up => (
                            dy < -1.0,
                            rect.x < current_rect.x + current_rect.width && rect.x + rect.width > current_rect.x,
                            dy.abs(),
                        ),
                        Direction::Down => (
                            dy > 1.0,
                            rect.x < current_rect.x + current_rect.width && rect.x + rect.width > current_rect.x,
                            dy.abs(),
                        ),
                    };

                    if !valid {
                        continue;
                    }

                    // Prefer overlapping panes; among those, pick the closest on the primary axis
                    let score = if overlaps { dist } else { dist + 100000.0 };
                    if best.is_none_or(|(_, d)| score < d) {
                        best = Some((id, score));
                    }
                }

                if let Some((next_id, _)) = best {
                    self.focused = Some(next_id);
                    self.router.set_focused(next_id);
                    self.chrome_generation += 1;
                    self.update_file_tree_cwd();
                }
            }
        }
    }

    fn create_terminal_pane(&mut self, id: PaneId) {
        let cell_size = self.renderer.as_ref().unwrap().cell_size();
        let logical = self.logical_size();
        let cols = (logical.width / 2.0 / cell_size.width).max(1.0) as u16;
        let rows = (logical.height / cell_size.height).max(1.0) as u16;

        match TerminalPane::new(id, cols, rows) {
            Ok(pane) => {
                self.terminal_panes.insert(id, pane);
            }
            Err(e) => {
                log::error!("Failed to create terminal pane: {}", e);
            }
        }
    }

    fn update(&mut self) {
        // Process PTY output for all terminals
        for pane in self.terminal_panes.values_mut() {
            pane.backend.process();
        }

        // Poll file tree events
        if let Some(tree) = self.file_tree.as_mut() {
            let had_changes = tree.poll_events();
            if had_changes {
                self.chrome_generation += 1;
            }
        }

        // Periodic CWD check (every 500ms)
        if self.last_cwd_check.elapsed() > Duration::from_millis(500) {
            self.last_cwd_check = Instant::now();
            self.update_file_tree_cwd();
        }
    }

    fn update_file_tree_cwd(&mut self) {
        if !self.show_file_tree {
            return;
        }

        let cwd = self.focused.and_then(|id| {
            self.terminal_panes
                .get(&id)
                .and_then(|p| p.backend.detect_cwd_fallback())
        });

        if let Some(cwd) = cwd {
            if self.last_cwd.as_ref() != Some(&cwd) {
                self.last_cwd = Some(cwd.clone());
                if let Some(tree) = self.file_tree.as_mut() {
                    tree.set_root(cwd);
                }
                self.file_tree_scroll = 0.0;
                self.chrome_generation += 1;
            }
        }
    }

    fn handle_file_tree_click(&mut self, position: Vec2) {
        if !self.show_file_tree || position.x >= FILE_TREE_WIDTH {
            return;
        }

        let cell_size = match self.renderer.as_ref() {
            Some(r) => r.cell_size(),
            None => return,
        };

        let line_height = cell_size.height;
        let index = ((position.y + self.file_tree_scroll) / line_height) as usize;

        if let Some(tree) = self.file_tree.as_mut() {
            let entries = tree.visible_entries();
            if index < entries.len() {
                let entry = entries[index].clone();
                if entry.entry.is_dir {
                    tree.toggle(&entry.entry.path);
                    self.chrome_generation += 1;
                }
            }
        }
    }

    fn reconfigure_surface(&mut self) {
        if let (Some(surface), Some(device), Some(config)) = (
            self.surface.as_ref(),
            self.device.as_ref(),
            self.surface_config.as_mut(),
        ) {
            config.width = self.window_size.width.max(1);
            config.height = self.window_size.height.max(1);
            surface.configure(device, config);
        }
    }
}

// ──────────────────────────────────────────────
// ApplicationHandler implementation
// ──────────────────────────────────────────────

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }

        let attrs = WindowAttributes::default()
            .with_title("Tide")
            .with_inner_size(LogicalSize::new(1200.0, 800.0))
            .with_min_inner_size(LogicalSize::new(400.0, 300.0));

        let window = Arc::new(event_loop.create_window(attrs).expect("create window"));
        window.set_ime_allowed(true);

        self.window = Some(window);
        self.init_gpu();
        self.create_initial_pane();
        self.compute_layout();
    }

    fn window_event(
        &mut self,
        _event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        event: WindowEvent,
    ) {
        // Handle file tree clicks before general routing
        if let WindowEvent::MouseInput {
            state: ElementState::Pressed,
            button: WinitMouseButton::Left,
            ..
        } = &event
        {
            if self.show_file_tree && self.last_cursor_pos.x < FILE_TREE_WIDTH {
                self.handle_file_tree_click(self.last_cursor_pos);
                return;
            }
        }

        self.handle_window_event(event);
        self.needs_redraw = true;
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        // Check if any terminal has new PTY output (cheap atomic load)
        for pane in self.terminal_panes.values() {
            if pane.backend.has_new_output() {
                self.needs_redraw = true;
                self.input_just_sent = false;
                self.input_sent_at = None;
                break;
            }
        }

        if self.needs_redraw {
            self.consecutive_dirty_frames += 1;
            if let Some(window) = &self.window {
                window.request_redraw();
            }
        } else if self.input_just_sent {
            // Poll aggressively while awaiting PTY response after keypress
            // 50ms safety timeout: stop polling if PTY hasn't responded
            if self.input_sent_at.is_some_and(|t| t.elapsed() > Duration::from_millis(50)) {
                self.input_just_sent = false;
                self.input_sent_at = None;
                event_loop.set_control_flow(ControlFlow::wait_duration(Duration::from_millis(8)));
            } else {
                event_loop.set_control_flow(ControlFlow::Poll);
            }
        } else {
            // Adaptive frame pacing: 16ms (~60fps) during high throughput, 8ms otherwise
            let wait_ms = if self.consecutive_dirty_frames > 10 { 16 } else { 8 };
            self.consecutive_dirty_frames = 0;
            event_loop.set_control_flow(ControlFlow::wait_duration(Duration::from_millis(wait_ms)));
        }
    }
}

// ──────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────

fn main() {
    env_logger::init();

    let event_loop = EventLoop::new().expect("create event loop");
    event_loop.set_control_flow(ControlFlow::Poll);

    let mut app = App::new();
    event_loop.run_app(&mut app).expect("run event loop");
}
