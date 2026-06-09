// Terminal backend implementation
// Implements crate::tide_core::TerminalBackend using alacritty_terminal
//
// Threading model:
//   PTY Thread (alacritty EventLoop) — reads PTY, parses VT, updates Term state
//   Sync Thread — copies grid state from Term, converts colors, produces snapshots
//   Main Thread — swaps in latest snapshot, renders, handles input
//
// The sync thread decouples expensive grid synchronization from the main thread,
// so input events are never blocked by terminal output processing.

use std::borrow::Cow;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use alacritty_terminal::event::{Event, EventListener, WindowSize};
use alacritty_terminal::event_loop::{EventLoop, Msg, Notifier};
use alacritty_terminal::grid::{Dimensions, Scroll};
use alacritty_terminal::index::{Column, Line, Point};
use alacritty_terminal::sync::FairMutex;
use alacritty_terminal::term::cell::Flags as CellFlags;
use alacritty_terminal::term::cell::LineLength;
use alacritty_terminal::term::{Config as TermConfig, Term, TermMode};
use alacritty_terminal::tty;
use alacritty_terminal::vte::ansi::{Color as AnsiColor, NamedColor, Rgb as AnsiRgb};
#[cfg(test)]
use unicode_width::UnicodeWidthChar;

mod color;
pub mod git;
mod key_input;
mod wheel_input;

use crate::tide_core::{
    Color, CursorShape, CursorState, TerminalBackend, TerminalCell, TerminalGrid, TideWindowId,
};

/// Number of scrollback history lines to keep.
const SCROLLBACK_LINES: usize = 10_000;

/// Whether agent auto-integration is enabled (wrapper PATH injection + shell integration).
/// Updated at runtime when the user toggles the setting.
static AUTO_INTEGRATION_ENABLED: AtomicBool = AtomicBool::new(true);

/// Set the auto-integration enabled flag. Called when the user toggles the setting.
pub fn set_auto_integration(enabled: bool) {
    AUTO_INTEGRATION_ENABLED.store(enabled, Ordering::Relaxed);
}

/// Global socket path for the Agent Gateway. Set once on app startup.
/// Every PTY spawned after this is set will export TIDE_TERMINAL_SOCKET.
static GATEWAY_SOCKET_PATH: OnceLock<String> = OnceLock::new();

/// Set the Agent Gateway socket path. Called once from main after server starts.
pub fn set_gateway_socket_path(path: String) {
    let _ = GATEWAY_SOCKET_PATH.set(path);
}

/// Directory containing agent wrapper scripts (claude, codex, gemini, agy, opencode).
/// Resolved from the .app bundle's Contents/Resources/bin/ at startup.
/// Prepended to PATH in every PTY so wrappers shadow the real binaries.
static AGENT_WRAPPER_DIR: OnceLock<String> = OnceLock::new();

/// Directory containing shell integration files (.zshenv for ZDOTDIR hijack).
/// Resolved from the .app bundle's Contents/Resources/shell-integration/ at startup.
static SHELL_INTEGRATION_DIR: OnceLock<String> = OnceLock::new();

static URL_RE: OnceLock<regex::Regex> = OnceLock::new();

/// Discover agent wrapper and shell integration directories from the .app bundle.
/// Called once from main after the gateway socket is ready.
/// Looks for `Contents/Resources/bin/` and `Contents/Resources/shell-integration/`
/// relative to the running binary's location.
pub fn discover_agent_resources() {
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(_) => return,
    };

    // exe is at Contents/MacOS/Tide → go up to Contents/, then into Resources/
    let contents_dir = match exe.parent().and_then(|p| p.parent()) {
        Some(d) => d,
        None => return,
    };

    // cargo-bundle preserves relative paths: resources end up at
    // Contents/Resources/crates/tide-app/resources/{bin,shell-integration}/
    let res_base = contents_dir.join("Resources/crates/tide-app/resources");

    let bin_dir = res_base.join("bin");
    if bin_dir.is_dir() {
        let _ = AGENT_WRAPPER_DIR.set(bin_dir.to_string_lossy().to_string());
    }

    let shell_dir = res_base.join("shell-integration");
    if shell_dir.is_dir() {
        let _ = SHELL_INTEGRATION_DIR.set(shell_dir.to_string_lossy().to_string());
    }
}

/// Simple dimensions struct that implements alacritty_terminal's Dimensions trait.
struct TermDimensions {
    cols: usize,
    rows: usize,
}

impl TermDimensions {
    fn new(cols: usize, rows: usize) -> Self {
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

struct SharedSnapshot {
    grid: TerminalGrid,
    inverse_cursor: Option<(u16, u16)>,
    url_ranges: Vec<Vec<(usize, usize)>>,
    wrapped_rows: Vec<bool>,
    generation: u64,
    cursor: CursorState,
}

// ──────────────────────────────────────────────
// Event listener (PTY thread → sync thread signaling)
// ──────────────────────────────────────────────

/// Event listener that sets a dirty flag when the terminal has new output,
/// forwards PtyWrite events back to the PTY, and wakes the sync thread.
#[derive(Clone)]
struct TermEventListener {
    dirty: Arc<AtomicBool>,
    /// Lazily initialized after EventLoop creation so PtyWrite can be forwarded.
    pty_writer: Arc<Mutex<Option<Notifier>>>,
    /// Handle to the grid sync thread — unparked when new output arrives.
    sync_thread: Arc<Mutex<Option<std::thread::Thread>>>,
    /// Dark/light mode — used to resolve OSC 10/11 color queries.
    dark_mode: Arc<AtomicBool>,
    /// Mode 2031: app opted in to dark/light color-scheme notifications.
    mode_2031: Arc<AtomicBool>,
    /// OSC 9 notification messages queued for main thread processing.
    notifications: Arc<Mutex<Vec<String>>>,
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

struct GridSyncer {
    term: Arc<FairMutex<Term<TermEventListener>>>,
    raw_buf: Vec<(char, AnsiColor, AnsiColor, CellFlags)>,
    prev_raw_buf: Vec<(char, AnsiColor, AnsiColor, CellFlags)>,
    palette_buf: [Option<AnsiRgb>; 256],
    grid: TerminalGrid,
    inverse_cursor: Option<(u16, u16)>,
    cached_cursor: CursorState,
    url_ranges: Vec<Vec<(usize, usize)>>,
    wrapped_rows: Vec<bool>,
    grid_generation: u64,
    url_row_buf: String,
    dark_mode: Arc<AtomicBool>,
    dark_mode_changed: Arc<AtomicBool>,
    stay_at_bottom: Arc<AtomicBool>,
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
                    self.raw_buf[base + col_idx] = (cell.c, cell.fg, cell.bg, cell.flags);
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
                let raw = self.raw_buf[idx];

                // Skip unchanged cells (same char, fg, bg, flags)
                if same_size && self.prev_raw_buf[idx] == raw {
                    continue;
                }
                any_changed = true;

                let (c, fg, bg, flags) = raw;

                if flags.contains(CellFlags::WIDE_CHAR_SPACER) {
                    tc.character = '\0';
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

        // Scan for URLs in the visible grid
        if any_changed || !same_size {
            self.detect_urls();
        }
    }

    /// Detect URLs in the grid and store column ranges per row.
    fn detect_urls(&mut self) {
        let re = terminal_url_regex();

        let rows = self.grid.cells.len();
        self.url_ranges.resize(rows, Vec::new());

        for (row_idx, row) in self.grid.cells.iter().enumerate() {
            self.url_ranges[row_idx].clear();
            self.url_row_buf.clear();
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
    }
}

pub(crate) fn terminal_url_regex() -> &'static regex::Regex {
    URL_RE.get_or_init(|| regex::Regex::new(r#"https?://[^\s<>"{}|\\^`\[\]]+"#).unwrap())
}

/// Trim unbalanced trailing parentheses and punctuation from a URL match.
/// Preserves balanced parens (e.g. Wikipedia URLs like `https://en.wikipedia.org/wiki/Foo_(bar)`).
pub(crate) fn trim_url_trailing(url: &str) -> &str {
    let mut end = url.len();
    loop {
        if end == 0 {
            break;
        }
        let last = url.as_bytes()[end - 1];
        // Strip trailing punctuation that's unlikely part of a URL
        if matches!(last, b'.' | b',' | b';') {
            end -= 1;
            continue;
        }
        // Strip unbalanced closing paren
        if last == b')' {
            let s = &url[..end];
            let opens = s.bytes().filter(|&b| b == b'(').count();
            let closes = s.bytes().filter(|&b| b == b')').count();
            if closes > opens {
                end -= 1;
                continue;
            }
        }
        break;
    }
    &url[..end]
}

// ──────────────────────────────────────────────
// Sync thread entry point
// ──────────────────────────────────────────────

fn grid_sync_thread_main(
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

// ──────────────────────────────────────────────
// Terminal backend
// ──────────────────────────────────────────────

/// Terminal backend using alacritty_terminal for PTY management and terminal emulation.
pub struct Terminal {
    /// The alacritty terminal emulator state, wrapped in a FairMutex for thread safety
    term: Arc<FairMutex<Term<TermEventListener>>>,
    /// Notifier to send messages to the PTY event loop
    notifier: Notifier,
    /// Cached grid — swapped in from the sync thread's SharedSnapshot
    cached_grid: TerminalGrid,
    /// Detected current working directory (from OSC 7 or fallback)
    current_dir: Option<PathBuf>,
    /// Current column count
    cols: u16,
    /// Current row count
    rows: u16,
    /// The child process ID for CWD detection fallback
    child_pid: Option<u32>,
    /// Atomic flag: sync thread has a new snapshot ready to consume
    snapshot_ready: Arc<AtomicBool>,
    /// Shared snapshot for grid exchange with sync thread
    snapshot: Arc<Mutex<SharedSnapshot>>,
    /// Last INVERSE cell position (read from snapshot)
    inverse_cursor: Option<(u16, u16)>,
    /// Cached cursor state (read from snapshot)
    cached_cursor: CursorState,
    /// Detected URL ranges per row (read from snapshot)
    url_ranges: Vec<Vec<(usize, usize)>>,
    /// Whether each visible row ends because of terminal wrap instead of a hard line break.
    wrapped_rows: Vec<bool>,
    /// Grid generation counter
    grid_generation: u64,
    /// Stay-at-bottom mode (shared with sync thread via atomic)
    stay_at_bottom: Arc<AtomicBool>,
    /// Dark/light mode (shared with sync thread via atomic)
    dark_mode: Arc<AtomicBool>,
    /// Signal to sync thread: dark mode changed, force full re-render
    dark_mode_changed: Arc<AtomicBool>,
    /// Mode 2031: app opted in to color-scheme notifications (shared with listener)
    mode_2031: Arc<AtomicBool>,
    /// Dirty flag (shared with PTY thread and sync thread)
    dirty: Arc<AtomicBool>,
    /// Shared waker callback — installed by main thread, called by sync thread
    waker: Arc<Mutex<Option<Box<dyn Fn() + Send>>>>,
    /// Pending PTY resize notification retained for compatibility with older queued paths.
    pending_pty_resize: Option<(WindowSize, Instant)>,
    /// Handle to sync thread for unparking
    sync_thread_handle: Arc<Mutex<Option<std::thread::Thread>>>,
    /// Shutdown flag for sync thread
    sync_shutdown: Arc<AtomicBool>,
    /// Sync thread join handle (joined on Drop)
    _sync_join: Option<std::thread::JoinHandle<()>>,
    /// OSC 9 notification queue (shared with TermEventListener on PTY thread)
    notifications: Arc<Mutex<Vec<String>>>,
}

impl Terminal {
    /// Create a new terminal backend with the given dimensions.
    pub fn new(cols: u16, rows: u16) -> Result<Self, Box<dyn std::error::Error>> {
        Self::with_cwd(cols, rows, None, true, None)
    }

    /// Create a new terminal backend, optionally starting in the given directory.
    /// If `pane_id` is provided, sets the `TIDE_TERMINAL_PANE` env var for the child process.
    pub fn with_cwd(
        cols: u16,
        rows: u16,
        cwd: Option<PathBuf>,
        dark_mode: bool,
        pane_id: Option<u64>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        Self::with_cwd_for_window(cols, rows, cwd, dark_mode, pane_id, None, None)
    }

    pub fn with_cwd_for_window(
        cols: u16,
        rows: u16,
        cwd: Option<PathBuf>,
        dark_mode: bool,
        pane_id: Option<u64>,
        tide_window_id: Option<TideWindowId>,
        workspace_name: Option<&str>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let cell_width = 8;
        let cell_height = 16;

        let window_size = WindowSize {
            num_cols: cols,
            num_lines: rows,
            cell_width,
            cell_height,
        };

        let term_size = TermDimensions::new(cols as usize, rows as usize);

        let dirty = Arc::new(AtomicBool::new(true));
        let pty_writer = Arc::new(Mutex::new(None));
        let sync_thread_handle: Arc<Mutex<Option<std::thread::Thread>>> =
            Arc::new(Mutex::new(None));
        let dark_mode_flag = Arc::new(AtomicBool::new(dark_mode));
        let mode_2031_flag = Arc::new(AtomicBool::new(false));
        let notifications: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let listener = TermEventListener {
            dirty: dirty.clone(),
            pty_writer: pty_writer.clone(),
            sync_thread: sync_thread_handle.clone(),
            dark_mode: dark_mode_flag.clone(),
            mode_2031: mode_2031_flag.clone(),
            notifications: notifications.clone(),
        };

        let config = TermConfig::default();
        let term = Term::new(config, &term_size, listener.clone());
        let term = Arc::new(FairMutex::new(term));

        // Determine the shell to use
        let shell = Self::detect_shell();

        // Use provided cwd, or fall back to $HOME so .app bundles don't land in /
        let working_directory = cwd.or_else(|| std::env::var("HOME").ok().map(PathBuf::from));
        let mut env = std::collections::HashMap::new();
        env.insert(String::from("TERM"), String::from("xterm-256color"));
        env.insert(String::from("COLORTERM"), String::from("truecolor"));
        env.insert(String::from("PROMPT_EOL_MARK"), String::new());
        if dark_mode {
            env.insert(String::from("COLORFGBG"), String::from("15;0"));
        } else {
            env.insert(String::from("COLORFGBG"), String::from("0;15"));
        }
        // Agent Gateway: export socket path, pane id, and workspace name
        // so child processes can discover Tide
        if let Some(socket_path) = GATEWAY_SOCKET_PATH.get() {
            env.insert(String::from("TIDE_TERMINAL_SOCKET"), socket_path.clone());
        }
        if let Some(id) = pane_id {
            env.insert(String::from("TIDE_TERMINAL_PANE"), id.to_string());
        }
        if let Some(id) = tide_window_id {
            env.insert(String::from("TIDE_TERMINAL_WINDOW"), id.get().to_string());
        }
        env.insert(
            String::from("TIDE_TERMINAL_INSTANCE_PID"),
            std::process::id().to_string(),
        );
        if let Some(name) = workspace_name {
            env.insert(String::from("TIDE_TERMINAL_WORKSPACE"), name.to_string());
        }
        // TIDE_TERMINAL_BIN is always set (supports manual `tide` CLI usage)
        if let Ok(exe) = std::env::current_exe() {
            env.insert(String::from("TIDE_TERMINAL_BIN"), exe.to_string_lossy().to_string());
        }
        // Agent wrappers: ZDOTDIR hijack + __TIDE_TERMINAL_WRAPPER_DIR env var.
        // Only injected when auto-integration is enabled.
        // Direct PATH injection doesn't work on macOS because /etc/zprofile
        // runs path_helper which reconstructs PATH from scratch.
        // Instead, ZDOTDIR points to shell-integration/ which has a .zshenv
        // that registers a precmd hook to prepend the wrapper bin/ to PATH
        // after all init files have run (including path_helper).
        if AUTO_INTEGRATION_ENABLED.load(Ordering::Relaxed) {
            if let Some(wrapper_dir) = AGENT_WRAPPER_DIR.get() {
                env.insert(String::from("__TIDE_TERMINAL_WRAPPER_DIR"), wrapper_dir.clone());
            }
            if let Some(shell_dir) = SHELL_INTEGRATION_DIR.get() {
                // Save user's original ZDOTDIR before overwriting
                if let Ok(orig) = std::env::var("ZDOTDIR") {
                    env.insert(String::from("__TIDE_TERMINAL_ORIG_ZDOTDIR"), orig);
                }
                env.insert(String::from("ZDOTDIR"), shell_dir.clone());
            }
        }
        let pty_config = tty::Options {
            shell: Some(tty::Shell::new(shell, vec![String::from("--login")])),
            working_directory,
            env,
            ..tty::Options::default()
        };

        // Spawn the PTY
        let pty = tty::new(&pty_config, window_size, 0)?;

        // Get child PID before moving pty into the event loop
        let child_pid = pty.child().id();

        // Create the event loop that bridges PTY I/O with the terminal emulator
        let event_loop = EventLoop::new(term.clone(), listener, pty, false, false)?;
        let notifier = Notifier(event_loop.channel());
        if let Ok(mut guard) = pty_writer.lock() {
            *guard = Some(Notifier(event_loop.channel()));
        }
        event_loop.spawn();

        // Initialize shared state for the sync thread
        let cached_grid = Self::build_empty_grid(cols, rows);
        let stay_at_bottom = Arc::new(AtomicBool::new(false));
        let dark_mode_changed = Arc::new(AtomicBool::new(false));
        let snapshot_ready = Arc::new(AtomicBool::new(false));
        let sync_shutdown = Arc::new(AtomicBool::new(false));
        let waker: Arc<Mutex<Option<Box<dyn Fn() + Send>>>> = Arc::new(Mutex::new(None));

        let snapshot = Arc::new(Mutex::new(SharedSnapshot {
            grid: Self::build_empty_grid(cols, rows),
            inverse_cursor: None,
            url_ranges: Vec::new(),
            wrapped_rows: Vec::new(),
            generation: 0,
            cursor: CursorState {
                row: 0,
                col: 0,
                visible: true,
                shape: CursorShape::Block,
            },
        }));

        // Create the GridSyncer with all sync-related state
        let syncer = GridSyncer {
            term: term.clone(),
            raw_buf: Vec::new(),
            prev_raw_buf: Vec::new(),
            palette_buf: [None; 256],
            grid: Self::build_empty_grid(cols, rows),
            inverse_cursor: None,
            cached_cursor: CursorState {
                row: 0,
                col: 0,
                visible: true,
                shape: CursorShape::Block,
            },
            url_ranges: Vec::new(),
            wrapped_rows: Vec::new(),
            grid_generation: 0,
            url_row_buf: String::new(),
            dark_mode: dark_mode_flag.clone(),
            dark_mode_changed: dark_mode_changed.clone(),
            stay_at_bottom: stay_at_bottom.clone(),
        };

        // Spawn the grid sync thread
        let sync_join = {
            let handle = sync_thread_handle.clone();
            let dirty = dirty.clone();
            let snapshot = snapshot.clone();
            let snapshot_ready = snapshot_ready.clone();
            let waker = waker.clone();
            let shutdown = sync_shutdown.clone();
            std::thread::Builder::new()
                .name("grid-sync".to_string())
                .spawn(move || {
                    grid_sync_thread_main(
                        handle,
                        syncer,
                        dirty,
                        snapshot,
                        snapshot_ready,
                        waker,
                        shutdown,
                    );
                })
                .expect("failed to spawn grid sync thread")
        };

        Ok(Terminal {
            term,
            notifier,
            cached_grid,
            current_dir: None,
            cols,
            rows,
            child_pid: Some(child_pid),
            snapshot_ready,
            snapshot,
            inverse_cursor: None,
            cached_cursor: CursorState {
                row: 0,
                col: 0,
                visible: true,
                shape: CursorShape::Block,
            },
            url_ranges: Vec::new(),
            wrapped_rows: Vec::new(),
            grid_generation: 0,
            stay_at_bottom,
            dark_mode: dark_mode_flag,
            dark_mode_changed,
            mode_2031: mode_2031_flag,
            dirty,
            waker,
            pending_pty_resize: None,
            sync_thread_handle,
            sync_shutdown,
            _sync_join: Some(sync_join),
            notifications,
        })
    }

    /// Drain pending OSC 9 notifications from the PTY thread.
    /// Returns an empty Vec if none are pending.
    pub fn drain_notifications(&self) -> Vec<String> {
        if let Ok(mut queue) = self.notifications.lock() {
            std::mem::take(&mut *queue)
        } else {
            Vec::new()
        }
    }

    #[cfg(test)]
    pub fn queue_notification_for_test(&self, message: &str) {
        if let Ok(mut queue) = self.notifications.lock() {
            queue.push(message.to_string());
        }
    }

    /// Detect the user's preferred shell
    fn detect_shell() -> String {
        std::env::var("SHELL").unwrap_or_else(|_| {
            if std::path::Path::new("/bin/zsh").exists() {
                "/bin/zsh".to_string()
            } else {
                "/bin/bash".to_string()
            }
        })
    }

    /// Build an empty grid filled with default cells
    fn build_empty_grid(cols: u16, rows: u16) -> TerminalGrid {
        let cells = (0..rows as usize)
            .map(|_| {
                (0..cols as usize)
                    .map(|_| TerminalCell::default())
                    .collect()
            })
            .collect();
        TerminalGrid { cols, rows, cells }
    }

    /// Detect the CWD of the child process using native OS APIs (no subprocess).
    #[cfg(target_os = "macos")]
    pub fn detect_cwd_fallback(&self) -> Option<PathBuf> {
        let pid = self.child_pid? as i32;

        const PROC_PIDVNODEPATHINFO: i32 = 9;
        const BUF_SIZE: usize = 2352;
        const PATH_OFFSET: usize = 152;
        const MAXPATHLEN: usize = 1024;

        let mut buf = [0u8; BUF_SIZE];
        let ret = unsafe {
            libc::proc_pidinfo(
                pid,
                PROC_PIDVNODEPATHINFO,
                0,
                buf.as_mut_ptr() as *mut libc::c_void,
                BUF_SIZE as i32,
            )
        };

        if ret <= 0 {
            return None;
        }

        let path_bytes = &buf[PATH_OFFSET..PATH_OFFSET + MAXPATHLEN];
        let len = path_bytes.iter().position(|&b| b == 0).unwrap_or(0);
        if len == 0 {
            return None;
        }

        let path = std::str::from_utf8(&path_bytes[..len]).ok()?;
        let p = PathBuf::from(path);
        if p.is_dir() {
            Some(p)
        } else {
            None
        }
    }

    #[cfg(not(target_os = "macos"))]
    pub fn detect_cwd_fallback(&self) -> Option<PathBuf> {
        if let Some(pid) = self.child_pid {
            let path = format!("/proc/{}/cwd", pid);
            std::fs::read_link(path).ok()
        } else {
            None
        }
    }

    /// Unpark the sync thread so it processes pending dirty flags.
    fn notify_sync_thread(&self) {
        if let Ok(guard) = self.sync_thread_handle.lock() {
            if let Some(ref thread) = *guard {
                thread.unpark();
            }
        }
    }

    /// Consume the latest snapshot from the sync thread (if available).
    fn consume_snapshot(&mut self) {
        if !self.snapshot_ready.load(Ordering::Relaxed) {
            return;
        }
        if let Ok(mut snap) = self.snapshot.lock() {
            std::mem::swap(&mut self.cached_grid, &mut snap.grid);
            self.inverse_cursor = snap.inverse_cursor;
            std::mem::swap(&mut self.url_ranges, &mut snap.url_ranges);
            std::mem::swap(&mut self.wrapped_rows, &mut snap.wrapped_rows);
            self.grid_generation = snap.generation;
            self.cached_cursor = snap.cursor;
        }
        self.snapshot_ready.store(false, Ordering::Relaxed);
    }
}

impl Terminal {
    /// Set a waker callback that will be called from the sync thread when a new
    /// grid snapshot is ready. This allows the event loop to sleep with
    /// `ControlFlow::Wait` and be woken up on demand.
    pub fn set_waker(&self, f: Box<dyn Fn() + Send>) {
        if let Ok(mut guard) = self.waker.lock() {
            *guard = Some(f);
        }
    }

    /// Returns the child PID of the shell process.
    pub fn child_pid(&self) -> Option<u32> {
        self.child_pid
    }

    /// Check if the child shell process is still alive.
    pub fn is_child_alive(&self) -> bool {
        let pid = match self.child_pid {
            Some(p) => p,
            None => return false,
        };
        // kill(pid, 0) checks if the process exists without sending a signal.
        // Returns 0 if alive, -1 with ESRCH if dead.
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }

    /// Detect whether the shell is idle (no foreground child process running).
    #[cfg(target_os = "macos")]
    pub fn is_shell_idle(&self) -> bool {
        let pid = match self.child_pid {
            Some(p) => p,
            None => return false,
        };
        let mut pids = [0i32; 16];
        let ret = unsafe {
            libc::proc_listchildpids(
                pid as i32,
                pids.as_mut_ptr() as *mut libc::c_void,
                (pids.len() * std::mem::size_of::<i32>()) as i32,
            )
        };
        ret <= 0
    }

    #[cfg(not(target_os = "macos"))]
    pub fn is_shell_idle(&self) -> bool {
        let pid = match self.child_pid {
            Some(p) => p,
            None => return false,
        };
        let stat_path = format!("/proc/{}/stat", pid);
        if let Ok(contents) = std::fs::read_to_string(&stat_path) {
            let fields: Vec<&str> = contents.split_whitespace().collect();
            if fields.len() > 7 {
                let pgrp = fields[4].parse::<i32>().unwrap_or(0);
                let tpgid = fields[7].parse::<i32>().unwrap_or(-1);
                return pgrp == tpgid;
            }
        }
        false
    }

    /// Returns true if the sync thread has produced a new snapshot since the
    /// last `process()` call.
    pub fn has_new_output(&self) -> bool {
        self.snapshot_ready.load(Ordering::Relaxed)
    }

    /// Returns the grid generation counter. Increments when grid content changes.
    pub fn grid_generation(&self) -> u64 {
        self.grid_generation
    }

    /// Force a sync_grid cycle for benchmarking purposes.
    /// Sets the dirty flag, wakes the sync thread, and spins until the snapshot is ready.
    #[doc(hidden)]
    pub fn bench_sync_grid(&mut self) {
        self.dirty.store(true, Ordering::Relaxed);
        self.notify_sync_thread();
        // Spin until snapshot is ready
        while !self.snapshot_ready.load(Ordering::Relaxed) {
            std::thread::yield_now();
        }
        self.consume_snapshot();
    }

    /// Inject bytes directly into the terminal emulator for benchmarking.
    /// Bypasses the PTY — feeds data straight into vte::ansi::Processor → Term.
    #[doc(hidden)]
    pub fn bench_write_to_term(&self, data: &[u8]) {
        use alacritty_terminal::vte::ansi::{Processor, StdSyncHandler};
        let mut processor: Processor<StdSyncHandler> = Processor::new();
        let mut term = self.term.lock();
        processor.advance(&mut *term, data);
    }

    /// Returns detected URL column ranges per row.
    pub fn url_ranges(&self) -> &[Vec<(usize, usize)>] {
        &self.url_ranges
    }

    /// Returns whether the visible row ended because of terminal wrap.
    pub fn visible_row_is_wrapped(&self, row: usize) -> bool {
        self.wrapped_rows.get(row).copied().unwrap_or(false)
    }

    /// Returns cells for an absolute row in the terminal scrollback + screen buffer.
    pub fn buffer_row_cells(&self, absolute_row: usize) -> Option<Vec<TerminalCell>> {
        let term = self.term.lock();
        let grid = term.grid();
        let history_len = grid.history_size();
        let total_lines = history_len + grid.screen_lines();
        if absolute_row >= total_lines {
            return None;
        }

        let line = Line(absolute_row as i32 - history_len as i32);
        let cols = grid.columns();
        let mut cells = Vec::with_capacity(cols);
        for col_idx in 0..cols {
            let point = Point::new(line, Column(col_idx));
            let cell = &grid[point];
            let mut terminal_cell = TerminalCell::default();
            terminal_cell.character = if cell.flags.contains(CellFlags::WIDE_CHAR_SPACER) {
                '\0'
            } else {
                cell.c
            };
            cells.push(terminal_cell);
        }
        Some(cells)
    }

    /// Returns whether an absolute row in the terminal buffer ended with a terminal wrap.
    pub fn buffer_row_is_wrapped(&self, absolute_row: usize) -> bool {
        let term = self.term.lock();
        let grid = term.grid();
        let history_len = grid.history_size();
        let total_lines = history_len + grid.screen_lines();
        if absolute_row >= total_lines {
            return false;
        }

        let line = Line(absolute_row as i32 - history_len as i32);
        let grid_line = &grid[line];
        let line_length = grid_line.line_length();
        line_length.0 != 0
            && grid_line[line_length - 1]
                .flags
                .contains(CellFlags::WRAPLINE)
    }

    /// Returns the current column count.
    pub fn current_cols(&self) -> u16 {
        self.cols
    }

    /// Returns the current row count.
    pub fn current_rows(&self) -> u16 {
        self.rows
    }

    #[cfg(test)]
    pub fn load_mock_screen_for_test(&mut self, content: &str) {
        let _ = self.notifier.0.send(Msg::Shutdown);
        let rows: Vec<&str> = content.split('\n').collect();
        let cols = self.cols as usize;
        let screen_lines = self.rows as usize;
        let mut cells = vec![vec![TerminalCell::default(); cols]; screen_lines];
        let mut wrapped_rows = vec![false; screen_lines];

        for (line_idx, raw_text) in rows.iter().take(screen_lines).enumerate() {
            let text = raw_text.trim_end_matches('\r');
            wrapped_rows[line_idx] = !raw_text.ends_with('\r') && line_idx + 1 != rows.len();

            let mut col_idx = 0usize;
            for ch in text.chars() {
                let width = match ch.width() {
                    Some(width) if width > 0 => width,
                    _ => continue,
                };
                if col_idx >= cols || (width == 2 && col_idx + 1 >= cols) {
                    break;
                }

                cells[line_idx][col_idx].character = ch;
                if width == 2 {
                    cells[line_idx][col_idx + 1].character = '\0';
                }
                col_idx += width;
            }
        }

        self.cached_grid = TerminalGrid {
            cols: self.cols,
            rows: self.rows,
            cells,
        };
        self.wrapped_rows = wrapped_rows;
        self.url_ranges.clear();
        self.grid_generation += 1;
    }

    /// Search the full scrollback + screen buffer for case-insensitive substring matches.
    /// Returns `(absolute_line_from_top, char_col, char_len)` tuples.
    pub fn search_buffer(&self, query: &str) -> Vec<(usize, usize, usize)> {
        let mut results = Vec::new();
        if query.is_empty() {
            return results;
        }

        let query_lower = query.to_lowercase();
        let query_char_len = query.chars().count();
        let term = self.term.lock();
        let grid = term.grid();
        let total_lines = grid.screen_lines();
        let history_len = grid.history_size();
        let cols = grid.columns();

        for abs_line in 0..(history_len + total_lines) {
            let line_idx = Line(abs_line as i32 - history_len as i32);
            let mut row_text = String::with_capacity(cols);
            for col_idx in 0..cols {
                let point = Point::new(line_idx, Column(col_idx));
                let c = grid[point].c;
                row_text.push(if c == '\0' { ' ' } else { c });
            }

            let row_lower = row_text.to_lowercase();
            let mut start = 0;
            while let Some(byte_pos) = row_lower[start..].find(&query_lower) {
                let byte_col = start + byte_pos;
                let char_col = row_text[..byte_col].chars().count();
                results.push((abs_line, char_col, query_char_len));
                start = byte_col
                    + row_lower[byte_col..]
                        .chars()
                        .next()
                        .map_or(1, |c| c.len_utf8());
            }
        }

        results
    }

    /// Get the current display offset (how many lines scrolled up into history).
    pub fn display_offset(&self) -> usize {
        let term = self.term.lock();
        term.grid().display_offset()
    }

    /// Get the number of history (scrollback) lines.
    pub fn history_size(&self) -> usize {
        let term = self.term.lock();
        term.grid().history_size()
    }

    /// Check if the terminal has bracketed paste mode enabled.
    pub fn is_bracketed_paste_mode(&self) -> bool {
        let term = self.term.lock();
        term.mode().contains(TermMode::BRACKETED_PASTE)
    }

    /// Set dark/light mode for the terminal color palette.
    /// Signals the sync thread to force a full grid re-render.
    /// The listener's `dark_mode` atomic is shared, so subsequent OSC 10/11
    /// queries from apps will automatically return the updated colors.
    ///
    /// If Mode 2031 is enabled (app opted in via CSI ? 2031 h), sends a
    /// color-scheme notification (CSI ? 997 ; N n) so the app can auto-switch.
    pub fn set_dark_mode(&mut self, dark: bool) {
        if self.dark_mode.load(Ordering::Relaxed) != dark {
            self.dark_mode.store(dark, Ordering::Relaxed);
            self.dark_mode_changed.store(true, Ordering::Relaxed);
            self.dirty.store(true, Ordering::Relaxed);
            self.notify_sync_thread();

            // Send Mode 2031 notification only if the app opted in.
            if self.mode_2031.load(Ordering::Relaxed) {
                let mode = if dark { 1 } else { 2 };
                let _ = self.notifier.0.send(Msg::Input(Cow::Owned(
                    format!("\x1b[?997;{}n", mode).into_bytes(),
                )));
            }
        }
    }

    #[cfg(test)]
    pub fn dark_mode_for_test(&self) -> bool {
        self.dark_mode.load(Ordering::Relaxed)
    }

    /// Enter stay-at-bottom mode: every sync_grid will scroll to bottom until
    /// the user explicitly scrolls away via scroll_display().
    pub fn request_scroll_to_bottom(&mut self) {
        self.stay_at_bottom.store(true, Ordering::Relaxed);
        self.dirty.store(true, Ordering::Relaxed);
        self.notify_sync_thread();
    }

    /// Scroll the terminal display by the given delta (positive = scroll up into history).
    /// Cancels stay-at-bottom mode since the user is explicitly scrolling.
    pub fn scroll_display(&mut self, delta: i32) {
        self.stay_at_bottom.store(false, Ordering::Relaxed);

        let mut term = self.term.lock();
        let old_offset = term.grid().display_offset();
        term.scroll_display(Scroll::Delta(delta));
        let new_offset = term.grid().display_offset();
        drop(term);

        if old_offset != new_offset {
            self.dirty.store(true, Ordering::Relaxed);
            self.notify_sync_thread();
        }
    }
}

impl TerminalBackend for Terminal {
    fn write(&mut self, data: &[u8]) {
        let _ = self.notifier.0.send(Msg::Input(Cow::Owned(data.to_vec())));
    }

    fn process(&mut self) {
        // Compatibility drain for any resize that was queued by an older path.
        // Normal resize coalescing happens at the layout layer before resize().
        if let Some((window_size, stamp)) = self.pending_pty_resize {
            if stamp.elapsed().as_millis() >= 50 {
                self.pending_pty_resize = None;
                let _ = self.notifier.0.send(Msg::Resize(window_size));
            }
        }

        // Consume the latest snapshot from the sync thread (cheap: just pointer swaps)
        self.consume_snapshot();
    }

    fn grid(&self) -> &TerminalGrid {
        &self.cached_grid
    }

    fn resize(&mut self, cols: u16, rows: u16) {
        // Clamp to sane maximums to prevent catastrophic allocation
        // (e.g. 65535×65535 grid ≈ 100GB)
        let cols = cols.min(1000);
        let rows = rows.min(500);
        if self.cols == cols && self.rows == rows {
            return;
        }
        self.cols = cols;
        self.rows = rows;

        let cell_width = 8;
        let cell_height = 16;

        let window_size = WindowSize {
            num_cols: cols,
            num_lines: rows,
            cell_width,
            cell_height,
        };

        let term_size = TermDimensions::new(cols as usize, rows as usize);

        {
            let mut term = self.term.lock();
            term.resize(term_size);
        }

        // Layout code already coalesces transient geometry changes. Once
        // resize() is called, send the final PTY size immediately so shell
        // prompt redraw happens at the same size as the emulator grid.
        self.pending_pty_resize = None;
        let _ = self.notifier.0.send(Msg::Resize(window_size));

        // Trigger a sync so the grid reflects the new dimensions promptly
        self.dirty.store(true, Ordering::Relaxed);
        self.notify_sync_thread();
    }

    fn cwd(&self) -> Option<PathBuf> {
        self.current_dir.clone()
    }

    fn cursor(&self) -> CursorState {
        self.cached_cursor
    }
}

/// Wait for a child process to exit after SIGHUP, polling with `waitpid`.
/// If the child doesn't exit within 200ms, escalate to SIGKILL.
fn wait_for_child_exit(pid: u32) {
    use std::time::{Duration, Instant};

    let deadline = Instant::now() + Duration::from_millis(200);
    loop {
        let ret = unsafe { libc::waitpid(pid as i32, std::ptr::null_mut(), libc::WNOHANG) };
        // ret > 0: child exited; ret == -1: ECHILD (already reaped)
        if ret != 0 {
            return;
        }
        if Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(Duration::from_millis(5));
    }

    // Child didn't exit in time — escalate to SIGKILL
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
    let kill_deadline = Instant::now() + Duration::from_millis(50);
    loop {
        let ret = unsafe { libc::waitpid(pid as i32, std::ptr::null_mut(), libc::WNOHANG) };
        if ret != 0 || Instant::now() >= kill_deadline {
            return;
        }
        std::thread::sleep(Duration::from_millis(1));
    }
}

impl Drop for Terminal {
    fn drop(&mut self) {
        // Send SIGHUP to the child process group so the shell can run trap
        // handlers and clean up (e.g. pyenv rehash lock files).  Without this,
        // closing a PTY fd kills the shell instantly and leaves stale locks.
        if let Some(pid) = self.child_pid {
            unsafe {
                // Negative PID targets the entire process group
                libc::kill(-(pid as i32), libc::SIGHUP);
            }
            // Poll waitpid until the child exits or 200ms deadline.
            // This ensures cleanup handlers (e.g. `rm -f .pyenv-shim`) finish
            // before we close the PTY fd, preventing stale lock files.
            wait_for_child_exit(pid);
        }

        // Signal the sync thread to shut down and wait for it
        self.sync_shutdown.store(true, Ordering::Relaxed);
        self.notify_sync_thread();
        if let Some(handle) = self._sync_join.take() {
            let _ = handle.join();
        }

        // Signal the PTY event loop to shut down
        #[allow(unused)]
        let _ = self.notifier.0.send(Msg::Shutdown);
    }
}

mod tests;
