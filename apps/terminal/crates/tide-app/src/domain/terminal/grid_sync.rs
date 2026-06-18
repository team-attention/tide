// Grid synchronization machinery: the sync thread that copies alacritty grid
// state into renderer-ready snapshots, plus its event listener and dimensions.
// Extracted from the terminal facade (mod.rs); `Terminal` drives these.

use std::borrow::Cow;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use alacritty_terminal::event_loop::{Msg, Notifier};
use alacritty_terminal::grid::{Dimensions, Scroll};
use alacritty_terminal::index::{Column, Line, Point};
use alacritty_terminal::sync::FairMutex;
use alacritty_terminal::term::cell::Flags as CellFlags;
use alacritty_terminal::term::cell::LineLength;
use alacritty_terminal::term::{ClipboardType, Term, TermMode};

use crate::tide_core::{CursorShape, CursorState, TerminalCell, TerminalGrid};

// Brings the parent terminal module's items into scope: SCROLLBACK_LINES,
// WIDE_CHAR_SPACER, the alacritty type aliases (Event, AnsiColor, …), and the
// `color` helpers the sync code shares with `Terminal`.
use super::*;

/// Simple dimensions struct that implements alacritty_terminal's Dimensions trait.
pub(super) struct TermDimensions {
    cols: usize,
    rows: usize,
}

impl TermDimensions {
    pub(super) fn new(cols: usize, rows: usize) -> Self {
        Self { cols, rows }
    }
}

impl Dimensions for TermDimensions {
    fn columns(&self) -> usize {
        self.cols
    }

    fn screen_lines(&self) -> usize {
        self.rows
    }

    fn total_lines(&self) -> usize {
        self.rows + SCROLLBACK_LINES
    }
}

// ──────────────────────────────────────────────
// Shared snapshot: exchange point between sync thread and main thread
// ──────────────────────────────────────────────

pub(super) struct SharedSnapshot {
    pub(super) grid: TerminalGrid,
    pub(super) inverse_cursor: Option<(u16, u16)>,
    pub(super) url_ranges: Vec<Vec<(usize, usize)>>,
    pub(super) hyperlink_ranges: Vec<Vec<(usize, usize, String)>>,
    pub(super) wrapped_rows: Vec<bool>,
    pub(super) generation: u64,
    pub(super) cursor: CursorState,
}

// ──────────────────────────────────────────────
// Event listener (PTY thread → sync thread signaling)
// ──────────────────────────────────────────────

/// Event listener that sets a dirty flag when the terminal has new output,
/// forwards PtyWrite events back to the PTY, and wakes the sync thread.
#[derive(Clone)]
pub(super) struct TermEventListener {
    pub(super) dirty: Arc<AtomicBool>,
    /// Lazily initialized after EventLoop creation so PtyWrite can be forwarded.
    pub(super) pty_writer: Arc<Mutex<Option<Notifier>>>,
    /// Handle to the grid sync thread — unparked when new output arrives.
    pub(super) sync_thread: Arc<Mutex<Option<std::thread::Thread>>>,
    /// Dark/light mode — used to resolve OSC 10/11 color queries.
    pub(super) dark_mode: Arc<AtomicBool>,
    /// Mode 2031: app opted in to dark/light color-scheme notifications.
    pub(super) mode_2031: Arc<AtomicBool>,
    /// OSC 9 notification messages queued for main thread processing.
    pub(super) notifications: Arc<Mutex<Vec<String>>>,
    /// Pending OSC 0/2 title change (last-write-wins).
    pub(super) pending_title: Arc<Mutex<Option<TitleChange>>>,
    /// Edge-triggered BEL flag.
    pub(super) bell_pending: Arc<AtomicBool>,
    /// OSC 52 clipboard-write requests queued for the main thread.
    pub(super) clipboard_writes: Arc<Mutex<Vec<(ClipboardTarget, String)>>>,
    /// OSC 52 clipboard-read requests queued for the main thread (gated).
    pub(super) clipboard_loads: Arc<Mutex<Vec<(ClipboardTarget, ClipboardLoadFormatter)>>>,
    /// Policy: allow OSC 52 clipboard reads (default false).
    pub(super) clipboard_read_allowed: Arc<AtomicBool>,
    /// Terminal graphics payloads queued for main thread parsing/rendering.
    pub(super) graphics_events: Arc<Mutex<Vec<alacritty_terminal::event::GraphicsData>>>,
}

/// Map alacritty's `ClipboardType` onto our boundary `ClipboardTarget`.
fn clipboard_target(ty: ClipboardType) -> ClipboardTarget {
    match ty {
        ClipboardType::Clipboard => ClipboardTarget::Clipboard,
        ClipboardType::Selection => ClipboardTarget::Selection,
    }
}

impl TermEventListener {
    /// Resolve a color index to an RGB value for OSC 10/11/12 responses.
    ///
    /// Index mapping (from vte/alacritty_terminal):
    ///   0-15   = Named ANSI colors (Black..BrightWhite)
    ///   16-255 = 256-color palette
    ///   256    = Foreground (OSC 10)
    ///   257    = Background (OSC 11)
    ///   258    = Cursor     (OSC 12)
    fn resolve_color(&self, index: usize) -> AnsiRgb {
        let dark = self.dark_mode.load(Ordering::Relaxed);
        match index {
            // Foreground (OSC 10)
            256 => {
                if dark {
                    AnsiRgb {
                        r: 230,
                        g: 232,
                        b: 242,
                    } // dark fg: (0.9, 0.91, 0.95)
                } else {
                    AnsiRgb {
                        r: 26,
                        g: 20,
                        b: 13,
                    } // light fg: (0.10, 0.08, 0.05)
                }
            }
            // Background (OSC 11) — report the actual visible pane background
            257 => {
                if dark {
                    AnsiRgb {
                        r: 14,
                        g: 14,
                        b: 16,
                    } // dark pane_bg: (0.055, 0.055, 0.063)
                } else {
                    AnsiRgb {
                        r: 255,
                        g: 255,
                        b: 255,
                    } // light pane_bg: #FFFFFF
                }
            }
            // Cursor (OSC 12) — use foreground color
            258 => {
                if dark {
                    AnsiRgb {
                        r: 230,
                        g: 232,
                        b: 242,
                    }
                } else {
                    AnsiRgb {
                        r: 26,
                        g: 20,
                        b: 13,
                    }
                }
            }
            // Named ANSI colors (0-15)
            0..=15 => {
                let color =
                    Terminal::named_color_to_rgb(dark, Terminal::index_to_named(index as u8));
                AnsiRgb {
                    r: (color.r * 255.0) as u8,
                    g: (color.g * 255.0) as u8,
                    b: (color.b * 255.0) as u8,
                }
            }
            // 256-color palette (16-255)
            16..=255 => {
                let color = Terminal::indexed_color_fallback(index as u8);
                AnsiRgb {
                    r: (color.r * 255.0) as u8,
                    g: (color.g * 255.0) as u8,
                    b: (color.b * 255.0) as u8,
                }
            }
            _ => AnsiRgb { r: 0, g: 0, b: 0 },
        }
    }
}

impl EventListener for TermEventListener {
    fn send_event(&self, event: Event) {
        match &event {
            Event::PtyWrite(text) => {
                if let Ok(guard) = self.pty_writer.lock() {
                    if let Some(notifier) = guard.as_ref() {
                        let _ = notifier
                            .0
                            .send(Msg::Input(Cow::Owned(text.clone().into_bytes())));
                    }
                }
            }
            Event::ColorRequest(index, formatter) => {
                let rgb = self.resolve_color(*index);
                let response = formatter(rgb);
                if let Ok(guard) = self.pty_writer.lock() {
                    if let Some(notifier) = guard.as_ref() {
                        let _ = notifier
                            .0
                            .send(Msg::Input(Cow::Owned(response.into_bytes())));
                    }
                }
                return; // No need to mark dirty or wake sync thread
            }
            Event::Notification(msg) => {
                if let Ok(mut queue) = self.notifications.lock() {
                    queue.push(msg.clone());
                }
                // Mark dirty + wake so main thread processes the notification
            }
            Event::Title(title) => {
                // OSC 0 / OSC 2: program sets the window title. Last write wins.
                if let Ok(mut pending) = self.pending_title.lock() {
                    *pending = Some(TitleChange::Set(title.clone()));
                }
                // Mark dirty + wake so the main thread applies the title.
            }
            Event::ResetTitle => {
                if let Ok(mut pending) = self.pending_title.lock() {
                    *pending = Some(TitleChange::Reset);
                }
            }
            Event::Bell => {
                // BEL: edge-triggered. Coalesces multiple bells in one frame.
                self.bell_pending.store(true, Ordering::Relaxed);
            }
            Event::ClipboardStore(ty, text) => {
                // OSC 52 write: queue for the main thread to push to the system
                // pasteboard. (No AppKit call on the PTY thread.)
                if let Ok(mut q) = self.clipboard_writes.lock() {
                    q.push((clipboard_target(*ty), text.clone()));
                }
            }
            Event::ClipboardLoad(ty, formatter) => {
                // OSC 52 read: drop unless explicitly allowed (secure default).
                if self.clipboard_read_allowed.load(Ordering::Relaxed) {
                    if let Ok(mut q) = self.clipboard_loads.lock() {
                        q.push((clipboard_target(*ty), formatter.clone()));
                    }
                } else {
                    return; // No response — matches xterm's denied-read behavior.
                }
            }
            Event::PrivateModeUpdate(2031, enabled) => {
                // Mode 2031: app opts in/out of color-scheme change notifications.
                self.mode_2031.store(*enabled, Ordering::Relaxed);
                // Immediately report current mode: CSI ? 997 ; N n (1=dark, 2=light)
                if *enabled {
                    let mode = if self.dark_mode.load(Ordering::Relaxed) {
                        1
                    } else {
                        2
                    };
                    let response = format!("\x1b[?997;{}n", mode);
                    if let Ok(guard) = self.pty_writer.lock() {
                        if let Some(notifier) = guard.as_ref() {
                            let _ = notifier
                                .0
                                .send(Msg::Input(Cow::Owned(response.into_bytes())));
                        }
                    }
                }
                return;
            }
            Event::Graphics(data) => {
                if let Ok(mut queue) = self.graphics_events.lock() {
                    queue.push(data.clone());
                }
            }
            _ => {}
        }
        self.dirty.store(true, Ordering::Relaxed);
        // Wake the sync thread to process new output
        if let Ok(guard) = self.sync_thread.lock() {
            if let Some(ref thread) = *guard {
                thread.unpark();
            }
        }
    }
}

// ──────────────────────────────────────────────
// GridSyncer: owns all state for grid synchronization (runs on sync thread)
// ──────────────────────────────────────────────

pub(super) struct GridSyncer {
    pub(super) term: Arc<FairMutex<Term<TermEventListener>>>,
    pub(super) raw_buf: Vec<(char, AnsiColor, AnsiColor, CellFlags, Option<String>)>,
    pub(super) prev_raw_buf: Vec<(char, AnsiColor, AnsiColor, CellFlags, Option<String>)>,
    pub(super) palette_buf: [Option<AnsiRgb>; 256],
    pub(super) grid: TerminalGrid,
    pub(super) inverse_cursor: Option<(u16, u16)>,
    pub(super) cached_cursor: CursorState,
    pub(super) url_ranges: Vec<Vec<(usize, usize)>>,
    pub(super) hyperlink_ranges: Vec<Vec<(usize, usize, String)>>,
    pub(super) wrapped_rows: Vec<bool>,
    pub(super) grid_generation: u64,
    pub(super) url_row_buf: String,
    pub(super) dark_mode: Arc<AtomicBool>,
    pub(super) dark_mode_changed: Arc<AtomicBool>,
    pub(super) stay_at_bottom: Arc<AtomicBool>,
}

impl GridSyncer {
    /// Run one grid synchronization cycle.
    /// Phase 1: Lock Term briefly to copy raw cell data + palette.
    /// Phase 2: Convert colors and diff against previous frame (no lock held).
    fn sync(&mut self) {
        // Check if dark mode changed — force full re-render
        if self.dark_mode_changed.swap(false, Ordering::Relaxed) {
            self.prev_raw_buf.clear();
        }

        let dark_mode = self.dark_mode.load(Ordering::Relaxed);
        let stay_at_bottom = self.stay_at_bottom.load(Ordering::Relaxed);

        // Phase 1: Hold lock briefly — copy raw cell data + palette + cursor
        let (cols, total_lines) = {
            let mut term = self.term.lock();

            if stay_at_bottom {
                term.scroll_display(Scroll::Bottom);
            }

            let grid = term.grid();
            let cols = grid.columns();
            let total_lines = grid.screen_lines();
            let display_offset = grid.display_offset();
            let total_cells = cols * total_lines;

            // Copy color palette
            let colors = term.colors();
            for i in 0..256 {
                self.palette_buf[i] = colors[i];
            }

            // Copy raw cell data into flat buffer
            self.raw_buf.resize(
                total_cells,
                (
                    ' ',
                    AnsiColor::Named(NamedColor::Foreground),
                    AnsiColor::Named(NamedColor::Background),
                    CellFlags::empty(),
                    None,
                ),
            );
            self.wrapped_rows.resize(total_lines, false);
            for line_idx in 0..total_lines {
                let line = Line(line_idx as i32 - display_offset as i32);
                let base = line_idx * cols;
                let grid_line = &grid[line];
                let line_length = grid_line.line_length();
                self.wrapped_rows[line_idx] = line_length.0 != 0
                    && grid_line[line_length - 1]
                        .flags
                        .contains(CellFlags::WRAPLINE);
                for col_idx in 0..cols {
                    let point = Point::new(line, Column(col_idx));
                    let cell = &grid[point];
                    self.raw_buf[base + col_idx] = (
                        cell.c,
                        cell.fg,
                        cell.bg,
                        cell.flags,
                        cell.hyperlink().map(|link| link.uri().to_string()),
                    );
                }
            }

            // Read cursor state while we have the lock
            let cursor_point = grid.cursor.point;
            let cursor_shape = match term.cursor_style().shape {
                alacritty_terminal::vte::ansi::CursorShape::Block => CursorShape::Block,
                alacritty_terminal::vte::ansi::CursorShape::Beam => CursorShape::Beam,
                alacritty_terminal::vte::ansi::CursorShape::Underline => CursorShape::Underline,
                _ => CursorShape::Block,
            };
            let cursor_visible = term.mode().contains(TermMode::SHOW_CURSOR);

            self.cached_cursor = CursorState {
                row: cursor_point.line.0 as u16,
                col: cursor_point.column.0 as u16,
                visible: cursor_visible,
                shape: cursor_shape,
            };

            (cols, total_lines)
        }; // Lock released here!

        // Phase 2: Diff with previous frame — only convert changed cells
        let total_cells = cols * total_lines;
        let same_size = self.prev_raw_buf.len() == total_cells;

        // Scan for the last INVERSE cell — TUI apps (Ink/Claude Code) draw their
        // visual cursor as an INVERSE cell while hiding the real terminal cursor.
        self.inverse_cursor = None;
        for idx in (0..total_cells).rev() {
            let flags = self.raw_buf[idx].3;
            if flags.contains(CellFlags::INVERSE) && !flags.contains(CellFlags::WIDE_CHAR_SPACER) {
                let row = idx / cols;
                let col = idx % cols;
                self.inverse_cursor = Some((row as u16, col as u16));
                break;
            }
        }

        // Apply INVERSE cursor fallback to cached_cursor
        if !self.cached_cursor.visible {
            if let Some((inv_row, inv_col)) = self.inverse_cursor {
                self.cached_cursor.row = inv_row;
                self.cached_cursor.col = inv_col;
            }
        }

        let cells = &mut self.grid.cells;
        cells.resize_with(total_lines, || vec![TerminalCell::default(); cols]);

        let mut any_changed = false;

        for (line_idx, row) in cells.iter_mut().enumerate().take(total_lines) {
            row.resize_with(cols, TerminalCell::default);
            let base = line_idx * cols;

            for (col_idx, tc) in row.iter_mut().enumerate().take(cols) {
                let idx = base + col_idx;
                let raw = self.raw_buf[idx].clone();

                // Skip unchanged cells (same char, fg, bg, flags)
                if same_size && self.prev_raw_buf[idx] == raw {
                    continue;
                }
                any_changed = true;

                let (c, fg, bg, flags, hyperlink) = raw;

                if flags.contains(CellFlags::WIDE_CHAR_SPACER) {
                    tc.character = '\0';
                    tc.hyperlink = hyperlink;
                    // Preserve background for selection/ANSI highlights on
                    // the second half of wide characters (Korean, CJK, etc.).
                    let mut bg_color = Terminal::convert_color(dark_mode, &bg, &self.palette_buf);
                    let mut bg_is_default = matches!(bg, AnsiColor::Named(NamedColor::Background));
                    if flags.contains(CellFlags::INVERSE) {
                        let fg_color = Terminal::convert_color(dark_mode, &fg, &self.palette_buf);
                        bg_color = fg_color;
                        bg_is_default = false;
                    }
                    // Remap mismatched true-color backgrounds (see main cell path below).
                    let effective_bg = if flags.contains(CellFlags::INVERSE) {
                        &fg
                    } else {
                        &bg
                    };
                    if !bg_is_default {
                        if let AnsiColor::Spec(_) = effective_bg {
                            let bg_lum =
                                0.2126 * bg_color.r + 0.7152 * bg_color.g + 0.0722 * bg_color.b;
                            if !dark_mode && bg_lum < 0.5 {
                                bg_color = Terminal::remap_bg_for_light(bg_color);
                            } else if dark_mode && bg_lum > 0.7 {
                                bg_color = Terminal::remap_bg_for_dark(bg_color);
                            }
                        }
                    }
                    tc.style.background = if bg_is_default { None } else { Some(bg_color) };
                    continue;
                }

                let mut fg_color = Terminal::convert_color(dark_mode, &fg, &self.palette_buf);
                let mut bg_color = Terminal::convert_color(dark_mode, &bg, &self.palette_buf);
                let mut bg_is_default = matches!(bg, AnsiColor::Named(NamedColor::Background));

                // SGR 7: swap foreground and background
                if flags.contains(CellFlags::INVERSE) {
                    std::mem::swap(&mut fg_color, &mut bg_color);
                    bg_is_default = false;
                }

                // Remap mismatched true-color (Spec) backgrounds for the current
                // theme. Apps that haven't detected the theme change via OSC 11
                // or Mode 2031 send dark bgs in light mode (or bright bgs in dark
                // mode). Remap them to theme-appropriate equivalents.
                // Named/indexed colors are already mode-aware via our palette.
                let effective_bg = if flags.contains(CellFlags::INVERSE) {
                    &fg
                } else {
                    &bg
                };
                if !bg_is_default {
                    if let AnsiColor::Spec(_) = effective_bg {
                        let bg_lum =
                            0.2126 * bg_color.r + 0.7152 * bg_color.g + 0.0722 * bg_color.b;
                        if !dark_mode && bg_lum < 0.5 {
                            bg_color = Terminal::remap_bg_for_light(bg_color);
                        } else if dark_mode && bg_lum > 0.7 {
                            bg_color = Terminal::remap_bg_for_dark(bg_color);
                        }
                    }
                }

                if dark_mode {
                    fg_color = Terminal::ensure_dark_fg_contrast(fg_color);
                } else {
                    fg_color = Terminal::ensure_light_fg_contrast(fg_color);
                }

                let background = if bg_is_default { None } else { Some(bg_color) };

                tc.character = c;
                tc.hyperlink = hyperlink;
                tc.style.bold = flags.contains(CellFlags::BOLD);
                tc.style.dim = flags.contains(CellFlags::DIM);
                tc.style.italic = flags.contains(CellFlags::ITALIC);
                tc.style.underline = flags.contains(CellFlags::UNDERLINE)
                    || flags.contains(CellFlags::DOUBLE_UNDERLINE)
                    || flags.contains(CellFlags::UNDERCURL);

                tc.style.foreground = if tc.style.dim {
                    Color::new(
                        fg_color.r * 0.65,
                        fg_color.g * 0.65,
                        fg_color.b * 0.65,
                        fg_color.a,
                    )
                } else {
                    fg_color
                };
                tc.style.background = background;
            }
        }

        // Swap buffers for next frame's diff
        std::mem::swap(&mut self.prev_raw_buf, &mut self.raw_buf);

        if any_changed || !same_size {
            self.grid_generation += 1;
        }

        cells.truncate(total_lines);
        self.grid.cols = cols as u16;
        self.grid.rows = total_lines as u16;

        // Scan for URLs and OSC 8 hyperlinks in the visible grid.
        if any_changed || !same_size {
            self.detect_link_ranges();
        }
    }

    /// Detect URLs and OSC 8 hyperlinks in the grid and store column ranges per row.
    fn detect_link_ranges(&mut self) {
        let re = terminal_url_regex();

        let rows = self.grid.cells.len();
        self.url_ranges.resize(rows, Vec::new());
        self.hyperlink_ranges.resize(rows, Vec::new());

        for (row_idx, row) in self.grid.cells.iter().enumerate() {
            self.url_ranges[row_idx].clear();
            self.hyperlink_ranges[row_idx].clear();
            self.url_row_buf.clear();

            let mut active_hyperlink: Option<(usize, String)> = None;
            for (col_idx, c) in row.iter().enumerate() {
                match (&mut active_hyperlink, c.hyperlink.as_ref()) {
                    (None, Some(uri)) => {
                        active_hyperlink = Some((col_idx, uri.clone()));
                    }
                    (Some((_, active_uri)), Some(uri)) if active_uri == uri => {}
                    (Some((start, active_uri)), Some(uri)) => {
                        self.hyperlink_ranges[row_idx].push((
                            *start,
                            col_idx,
                            active_uri.clone(),
                        ));
                        active_hyperlink = Some((col_idx, uri.clone()));
                    }
                    (Some((start, active_uri)), None) => {
                        self.hyperlink_ranges[row_idx].push((
                            *start,
                            col_idx,
                            active_uri.clone(),
                        ));
                        active_hyperlink = None;
                    }
                    (None, None) => {}
                }
            }
            if let Some((start, uri)) = active_hyperlink {
                self.hyperlink_ranges[row_idx].push((start, row.len(), uri));
            }

            for c in row.iter() {
                self.url_row_buf.push(if c.character == '\0' {
                    ' '
                } else {
                    c.character
                });
            }
            for m in re.find_iter(&self.url_row_buf) {
                let url = trim_url_trailing(m.as_str());
                let start_col = self.url_row_buf[..m.start()].chars().count();
                let end_col = start_col + url.chars().count();
                self.url_ranges[row_idx].push((start_col, end_col));
            }
        }
        self.url_ranges.truncate(rows);
        self.hyperlink_ranges.truncate(rows);
    }
}

// ──────────────────────────────────────────────
// Sync thread entry point
// ──────────────────────────────────────────────

pub(super) fn grid_sync_thread_main(
    thread_handle: Arc<Mutex<Option<std::thread::Thread>>>,
    mut syncer: GridSyncer,
    dirty: Arc<AtomicBool>,
    snapshot: Arc<Mutex<SharedSnapshot>>,
    snapshot_ready: Arc<AtomicBool>,
    waker: Arc<Mutex<Option<Box<dyn Fn() + Send>>>>,
    shutdown: Arc<AtomicBool>,
) {
    // Install our thread handle so PTY thread / main thread can unpark us
    {
        let mut guard = thread_handle.lock().unwrap();
        *guard = Some(std::thread::current());
    }

    loop {
        // Process all pending dirty flags before parking
        while dirty.swap(false, Ordering::Relaxed) {
            if shutdown.load(Ordering::Relaxed) {
                return;
            }

            syncer.sync();

            // Copy results into shared snapshot
            {
                let mut snap = snapshot.lock().unwrap();
                snap.grid.clone_from(&syncer.grid);
                snap.inverse_cursor = syncer.inverse_cursor;
                snap.url_ranges.clone_from(&syncer.url_ranges);
                snap.hyperlink_ranges.clone_from(&syncer.hyperlink_ranges);
                snap.wrapped_rows.clone_from(&syncer.wrapped_rows);
                snap.generation = syncer.grid_generation;
                snap.cursor = syncer.cached_cursor;
            }
            snapshot_ready.store(true, Ordering::Relaxed);

            // Wake main thread event loop
            if let Ok(guard) = waker.lock() {
                if let Some(f) = guard.as_ref() {
                    f();
                }
            }
        }

        // Park until PTY thread or main thread unparks us
        std::thread::park();

        if shutdown.load(Ordering::Relaxed) {
            return;
        }
    }
}
