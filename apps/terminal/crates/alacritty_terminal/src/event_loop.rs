//! The main event loop which performs I/O on the pseudoterminal.

use std::borrow::Cow;
use std::collections::VecDeque;
use std::fmt::{self, Display, Formatter};
use std::fs::File;
use std::io::{self, ErrorKind, Read, Write};
use std::num::NonZeroUsize;
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::thread::JoinHandle;
use std::time::Instant;

use log::error;
use polling::{Event as PollingEvent, Events, PollMode};

use crate::event::{self, Event, EventListener, GraphicsData, GraphicsProtocol, WindowSize};
use crate::sync::FairMutex;
use crate::term::Term;
use crate::{thread, tty};
use vte::ansi;

/// Max bytes to read from the PTY before forced terminal synchronization.
pub(crate) const READ_BUFFER_SIZE: usize = 0x10_0000;

/// Max bytes to read from the PTY while the terminal is locked.
const MAX_LOCKED_READ: usize = u16::MAX as usize;

/// Messages that may be sent to the `EventLoop`.
#[derive(Debug)]
pub enum Msg {
    /// Data that should be written to the PTY.
    Input(Cow<'static, [u8]>),

    /// Indicates that the `EventLoop` should shut down, as Alacritty is shutting down.
    Shutdown,

    /// Instruction to resize the PTY.
    Resize(WindowSize),
}

/// The main event loop.
///
/// Handles all the PTY I/O and runs the PTY parser which updates terminal
/// state.
pub struct EventLoop<T: tty::EventedPty, U: EventListener> {
    poll: Arc<polling::Poller>,
    pty: T,
    rx: PeekableReceiver<Msg>,
    tx: Sender<Msg>,
    terminal: Arc<FairMutex<Term<U>>>,
    event_proxy: U,
    drain_on_exit: bool,
    ref_test: bool,
}

impl<T, U> EventLoop<T, U>
where
    T: tty::EventedPty + event::OnResize + Send + 'static,
    U: EventListener + Send + 'static,
{
    /// Create a new event loop.
    pub fn new(
        terminal: Arc<FairMutex<Term<U>>>,
        event_proxy: U,
        pty: T,
        drain_on_exit: bool,
        ref_test: bool,
    ) -> io::Result<EventLoop<T, U>> {
        let (tx, rx) = mpsc::channel();
        let poll = polling::Poller::new()?.into();
        Ok(EventLoop {
            poll,
            pty,
            tx,
            rx: PeekableReceiver::new(rx),
            terminal,
            event_proxy,
            drain_on_exit,
            ref_test,
        })
    }

    pub fn channel(&self) -> EventLoopSender {
        EventLoopSender { sender: self.tx.clone(), poller: self.poll.clone() }
    }

    /// Drain the channel.
    ///
    /// Returns `false` when a shutdown message was received.
    fn drain_recv_channel(&mut self, state: &mut State) -> bool {
        while let Some(msg) = self.rx.recv() {
            match msg {
                Msg::Input(input) => state.write_list.push_back(input),
                Msg::Resize(window_size) => self.pty.on_resize(window_size),
                Msg::Shutdown => return false,
            }
        }

        true
    }

    #[inline]
    fn pty_read<X>(
        &mut self,
        state: &mut State,
        buf: &mut [u8],
        mut writer: Option<&mut X>,
    ) -> io::Result<()>
    where
        X: Write,
    {
        let mut unprocessed = 0;
        let mut processed = 0;

        // Reserve the next terminal lock for PTY reading.
        let _terminal_lease = Some(self.terminal.lease());
        let mut terminal = None;

        loop {
            // Read from the PTY.
            match self.pty.reader().read(&mut buf[unprocessed..]) {
                // This is received on Windows/macOS when no more data is readable from the PTY.
                Ok(0) if unprocessed == 0 => break,
                Ok(got) => unprocessed += got,
                Err(err) => match err.kind() {
                    ErrorKind::Interrupted | ErrorKind::WouldBlock => {
                        // Go back to mio if we're caught up on parsing and the PTY would block.
                        if unprocessed == 0 {
                            break;
                        }
                    },
                    _ => return Err(err),
                },
            }

            // Attempt to lock the terminal.
            let terminal = match &mut terminal {
                Some(terminal) => terminal,
                None => terminal.insert(match self.terminal.try_lock_unfair() {
                    // Force block if we are at the buffer size limit.
                    None if unprocessed >= READ_BUFFER_SIZE => self.terminal.lock_unfair(),
                    None => continue,
                    Some(terminal) => terminal,
                }),
            };

            // Write a copy of the bytes to the ref test file.
            if let Some(writer) = &mut writer {
                writer.write_all(&buf[..unprocessed]).unwrap();
            }

            // Parse the incoming bytes, stripping terminal graphics payloads so
            // binary image data is not interpreted as printable text.
            state
                .graphics
                .advance(&buf[..unprocessed], |token| match token {
                    PtyToken::Bytes(bytes) => state.parser.advance(&mut **terminal, bytes),
                    PtyToken::Graphics(protocol, payload) => {
                        let point = terminal.grid().cursor.point;
                        let row = point.line.0.max(0) as u16;
                        let col = point.column.0 as u16;
                        self.event_proxy.send_event(Event::Graphics(GraphicsData {
                            protocol,
                            row,
                            col,
                            payload,
                        }));
                    },
                });

            processed += unprocessed;
            unprocessed = 0;

            // Assure we're not blocking the terminal too long unnecessarily.
            if processed >= MAX_LOCKED_READ {
                break;
            }
        }

        // Queue terminal redraw unless all processed bytes were synchronized.
        if state.parser.sync_bytes_count() < processed && processed > 0 {
            self.event_proxy.send_event(Event::Wakeup);
        }

        Ok(())
    }

    #[inline]
    fn pty_write(&mut self, state: &mut State) -> io::Result<()> {
        state.ensure_next();

        'write_many: while let Some(mut current) = state.take_current() {
            'write_one: loop {
                match self.pty.writer().write(current.remaining_bytes()) {
                    Ok(0) => {
                        state.set_current(Some(current));
                        break 'write_many;
                    },
                    Ok(n) => {
                        current.advance(n);
                        if current.finished() {
                            state.goto_next();
                            break 'write_one;
                        }
                    },
                    Err(err) => {
                        state.set_current(Some(current));
                        match err.kind() {
                            ErrorKind::Interrupted | ErrorKind::WouldBlock => break 'write_many,
                            _ => return Err(err),
                        }
                    },
                }
            }
        }

        Ok(())
    }

    pub fn spawn(mut self) -> JoinHandle<(Self, State)> {
        thread::spawn_named("PTY reader", move || {
            let mut state = State::default();
            let mut buf = [0u8; READ_BUFFER_SIZE];

            let poll_opts = PollMode::Level;
            let mut interest = PollingEvent::readable(0);

            // Register TTY through EventedRW interface.
            if let Err(err) = unsafe { self.pty.register(&self.poll, interest, poll_opts) } {
                error!("Event loop registration error: {err}");
                return (self, state);
            }

            let mut events = Events::with_capacity(NonZeroUsize::new(1024).unwrap());

            let mut pipe = if self.ref_test {
                Some(File::create("./alacritty.recording").expect("create alacritty recording"))
            } else {
                None
            };

            'event_loop: loop {
                // Wakeup the event loop when a synchronized update timeout was reached.
                let handler = state.parser.sync_timeout();
                let timeout =
                    handler.sync_timeout().map(|st| st.saturating_duration_since(Instant::now()));

                events.clear();
                if let Err(err) = self.poll.wait(&mut events, timeout) {
                    match err.kind() {
                        ErrorKind::Interrupted => continue,
                        _ => {
                            error!("Event loop polling error: {err}");
                            break 'event_loop;
                        },
                    }
                }

                // Handle synchronized update timeout.
                if events.is_empty() && self.rx.peek().is_none() {
                    state.parser.stop_sync(&mut *self.terminal.lock());
                    self.event_proxy.send_event(Event::Wakeup);
                    continue;
                }

                // Handle channel events, if there are any.
                if !self.drain_recv_channel(&mut state) {
                    break;
                }

                for event in events.iter() {
                    match event.key {
                        tty::PTY_CHILD_EVENT_TOKEN => {
                            if let Some(tty::ChildEvent::Exited(code)) = self.pty.next_child_event()
                            {
                                if let Some(code) = code {
                                    self.event_proxy.send_event(Event::ChildExit(code));
                                }
                                if self.drain_on_exit {
                                    let _ = self.pty_read(&mut state, &mut buf, pipe.as_mut());
                                }
                                self.terminal.lock().exit();
                                self.event_proxy.send_event(Event::Wakeup);
                                break 'event_loop;
                            }
                        },

                        tty::PTY_READ_WRITE_TOKEN => {
                            if event.is_interrupt() {
                                // Don't try to do I/O on a dead PTY.
                                continue;
                            }

                            if event.readable {
                                if let Err(err) = self.pty_read(&mut state, &mut buf, pipe.as_mut())
                                {
                                    // On Linux, a `read` on the master side of a PTY can fail
                                    // with `EIO` if the client side hangs up.  In that case,
                                    // just loop back round for the inevitable `Exited` event.
                                    // This sucks, but checking the process is either racy or
                                    // blocking.
                                    #[cfg(target_os = "linux")]
                                    if err.raw_os_error() == Some(libc::EIO) {
                                        continue;
                                    }

                                    error!("Error reading from PTY in event loop: {err}");
                                    break 'event_loop;
                                }
                            }

                            if event.writable {
                                if let Err(err) = self.pty_write(&mut state) {
                                    error!("Error writing to PTY in event loop: {err}");
                                    break 'event_loop;
                                }
                            }
                        },
                        _ => (),
                    }
                }

                // Register write interest if necessary.
                let needs_write = state.needs_write();
                if needs_write != interest.writable {
                    interest.writable = needs_write;

                    // Re-register with new interest.
                    self.pty.reregister(&self.poll, interest, poll_opts).unwrap();
                }
            }

            // The evented instances are not dropped here so deregister them explicitly.
            let _ = self.pty.deregister(&self.poll);

            (self, state)
        })
    }
}

/// Helper type which tracks how much of a buffer has been written.
struct Writing {
    source: Cow<'static, [u8]>,
    written: usize,
}

pub struct Notifier(pub EventLoopSender);

impl event::Notify for Notifier {
    fn notify<B>(&self, bytes: B)
    where
        B: Into<Cow<'static, [u8]>>,
    {
        let bytes = bytes.into();
        // Terminal hangs if we send 0 bytes through.
        if bytes.is_empty() {
            return;
        }

        let _ = self.0.send(Msg::Input(bytes));
    }
}

impl event::OnResize for Notifier {
    fn on_resize(&mut self, window_size: WindowSize) {
        let _ = self.0.send(Msg::Resize(window_size));
    }
}

#[derive(Debug)]
pub enum EventLoopSendError {
    /// Error polling the event loop.
    Io(io::Error),

    /// Error sending a message to the event loop.
    Send(mpsc::SendError<Msg>),
}

impl Display for EventLoopSendError {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        match self {
            EventLoopSendError::Io(err) => err.fmt(f),
            EventLoopSendError::Send(err) => err.fmt(f),
        }
    }
}

impl std::error::Error for EventLoopSendError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            EventLoopSendError::Io(err) => err.source(),
            EventLoopSendError::Send(err) => err.source(),
        }
    }
}

#[derive(Clone)]
pub struct EventLoopSender {
    sender: Sender<Msg>,
    poller: Arc<polling::Poller>,
}

impl EventLoopSender {
    pub fn send(&self, msg: Msg) -> Result<(), EventLoopSendError> {
        self.sender.send(msg).map_err(EventLoopSendError::Send)?;
        self.poller.notify().map_err(EventLoopSendError::Io)
    }
}

enum PtyToken<'a> {
    Bytes(&'a [u8]),
    Graphics(GraphicsProtocol, Vec<u8>),
}

#[derive(Default)]
struct GraphicsEscapeExtractor {
    state: GraphicsState,
    plain: Vec<u8>,
}

enum GraphicsState {
    Ground,
    Esc,
    KittyApc(Vec<u8>),
    KittyApcEsc(Vec<u8>),
    Dcs(Vec<u8>),
    DcsEsc(Vec<u8>),
}

impl Default for GraphicsState {
    fn default() -> Self {
        Self::Ground
    }
}

impl GraphicsEscapeExtractor {
    fn advance<F>(&mut self, bytes: &[u8], mut emit: F)
    where
        F: for<'token> FnMut(PtyToken<'token>),
    {
        for &byte in bytes {
            self.advance_byte(byte, &mut emit);
        }
        self.flush_plain(&mut emit);
    }

    fn advance_byte<F>(&mut self, byte: u8, emit: &mut F)
    where
        F: for<'token> FnMut(PtyToken<'token>),
    {
        let state = std::mem::replace(&mut self.state, GraphicsState::Ground);
        match state {
            GraphicsState::Ground => {
                if byte == 0x1b {
                    self.state = GraphicsState::Esc;
                } else {
                    self.plain.push(byte);
                    self.state = GraphicsState::Ground;
                }
            },
            GraphicsState::Esc => match byte {
                b'_' => {
                    self.flush_plain(emit);
                    self.state = GraphicsState::KittyApc(Vec::new());
                },
                b'P' => {
                    self.flush_plain(emit);
                    self.state = GraphicsState::Dcs(Vec::new());
                },
                _ => {
                    self.plain.push(0x1b);
                    self.plain.push(byte);
                    self.state = GraphicsState::Ground;
                },
            },
            GraphicsState::KittyApc(mut payload) => {
                if byte == 0x1b {
                    self.state = GraphicsState::KittyApcEsc(payload);
                } else {
                    payload.push(byte);
                    self.state = GraphicsState::KittyApc(payload);
                }
            },
            GraphicsState::KittyApcEsc(mut payload) => {
                if byte == b'\\' {
                    if payload.first() == Some(&b'G') {
                        emit(PtyToken::Graphics(GraphicsProtocol::Kitty, payload));
                    } else {
                        let mut bytes = Vec::with_capacity(payload.len() + 4);
                        bytes.extend_from_slice(b"\x1b_");
                        bytes.append(&mut payload);
                        bytes.extend_from_slice(b"\x1b\\");
                        emit(PtyToken::Bytes(&bytes));
                    }
                    self.state = GraphicsState::Ground;
                } else {
                    payload.push(0x1b);
                    payload.push(byte);
                    self.state = GraphicsState::KittyApc(payload);
                }
            },
            GraphicsState::Dcs(mut payload) => {
                if byte == 0x1b {
                    self.state = GraphicsState::DcsEsc(payload);
                } else {
                    payload.push(byte);
                    self.state = GraphicsState::Dcs(payload);
                }
            },
            GraphicsState::DcsEsc(mut payload) => {
                if byte == b'\\' {
                    if dcs_payload_is_sixel(&payload) {
                        emit(PtyToken::Graphics(GraphicsProtocol::Sixel, payload));
                    } else {
                        let mut bytes = Vec::with_capacity(payload.len() + 4);
                        bytes.extend_from_slice(b"\x1bP");
                        bytes.append(&mut payload);
                        bytes.extend_from_slice(b"\x1b\\");
                        emit(PtyToken::Bytes(&bytes));
                    }
                    self.state = GraphicsState::Ground;
                } else {
                    payload.push(0x1b);
                    payload.push(byte);
                    self.state = GraphicsState::Dcs(payload);
                }
            },
        }
    }

    fn flush_plain<F>(&mut self, emit: &mut F)
    where
        F: for<'token> FnMut(PtyToken<'token>),
    {
        if !self.plain.is_empty() {
            emit(PtyToken::Bytes(&self.plain));
            self.plain.clear();
        }
    }
}

fn dcs_payload_is_sixel(payload: &[u8]) -> bool {
    for byte in payload.iter().copied() {
        match byte {
            0x30..=0x3f => continue,     // DCS parameters
            0x20..=0x2f => return false, // intermediates, e.g. DECRQSS "$q"
            0x40..=0x7e => return byte == b'q',
            _ => return false,
        }
    }
    false
}

/// All of the mutable state needed to run the event loop.
///
/// Contains list of items to write, current write state, etc. Anything that
/// would otherwise be mutated on the `EventLoop` goes here.
#[derive(Default)]
pub struct State {
    write_list: VecDeque<Cow<'static, [u8]>>,
    writing: Option<Writing>,
    parser: ansi::Processor,
    graphics: GraphicsEscapeExtractor,
}

impl State {
    #[inline]
    fn ensure_next(&mut self) {
        if self.writing.is_none() {
            self.goto_next();
        }
    }

    #[inline]
    fn goto_next(&mut self) {
        self.writing = self.write_list.pop_front().map(Writing::new);
    }

    #[inline]
    fn take_current(&mut self) -> Option<Writing> {
        self.writing.take()
    }

    #[inline]
    fn needs_write(&self) -> bool {
        self.writing.is_some() || !self.write_list.is_empty()
    }

    #[inline]
    fn set_current(&mut self, new: Option<Writing>) {
        self.writing = new;
    }
}

impl Writing {
    #[inline]
    fn new(c: Cow<'static, [u8]>) -> Writing {
        Writing { source: c, written: 0 }
    }

    #[inline]
    fn advance(&mut self, n: usize) {
        self.written += n;
    }

    #[inline]
    fn remaining_bytes(&self) -> &[u8] {
        &self.source[self.written..]
    }

    #[inline]
    fn finished(&self) -> bool {
        self.written >= self.source.len()
    }
}

struct PeekableReceiver<T> {
    rx: Receiver<T>,
    peeked: Option<T>,
}

impl<T> PeekableReceiver<T> {
    fn new(rx: Receiver<T>) -> Self {
        Self { rx, peeked: None }
    }

    fn peek(&mut self) -> Option<&T> {
        if self.peeked.is_none() {
            self.peeked = self.rx.try_recv().ok();
        }

        self.peeked.as_ref()
    }

    fn recv(&mut self) -> Option<T> {
        if self.peeked.is_some() {
            self.peeked.take()
        } else {
            match self.rx.try_recv() {
                Err(TryRecvError::Disconnected) => panic!("event loop channel closed"),
                res => res.ok(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    enum OwnedPtyToken {
        Bytes(Vec<u8>),
        Graphics(GraphicsProtocol, Vec<u8>),
    }

    fn collect_tokens(extractor: &mut GraphicsEscapeExtractor, bytes: &[u8]) -> Vec<OwnedPtyToken> {
        let mut tokens = Vec::new();
        extractor.advance(bytes, |token| match token {
            PtyToken::Bytes(bytes) => tokens.push(OwnedPtyToken::Bytes(bytes.to_vec())),
            PtyToken::Graphics(protocol, payload) => {
                tokens.push(OwnedPtyToken::Graphics(protocol, payload));
            },
        });
        tokens
    }

    fn token_bytes(token: &OwnedPtyToken) -> Option<&[u8]> {
        match token {
            OwnedPtyToken::Bytes(bytes) => Some(bytes),
            _ => None,
        }
    }

    #[test]
    fn graphics_extractor_splits_kitty_apc_from_plain_text() {
        let mut extractor = GraphicsEscapeExtractor::default();
        let tokens = collect_tokens(&mut extractor, b"ab\x1b_Gf=100;AAAA\x1b\\cd");

        assert_eq!(tokens.len(), 3);
        assert_eq!(token_bytes(&tokens[0]), Some(&b"ab"[..]));
        match &tokens[1] {
            OwnedPtyToken::Graphics(GraphicsProtocol::Kitty, payload) => {
                assert_eq!(payload, b"Gf=100;AAAA");
            }
            _ => panic!("expected kitty graphics token"),
        }
        assert_eq!(token_bytes(&tokens[2]), Some(&b"cd"[..]));
    }

    #[test]
    fn graphics_extractor_preserves_non_sixel_dcs() {
        let mut extractor = GraphicsEscapeExtractor::default();
        let tokens = collect_tokens(&mut extractor, b"\x1bP$qm\x1b\\");

        assert_eq!(tokens.len(), 1);
        assert_eq!(token_bytes(&tokens[0]), Some(&b"\x1bP$qm\x1b\\"[..]));
    }

    #[test]
    fn graphics_extractor_recognizes_sixel_dcs() {
        let mut extractor = GraphicsEscapeExtractor::default();
        let tokens = collect_tokens(&mut extractor, b"\x1bPq\"1;1;1;1#0~~\x1b\\");

        assert_eq!(tokens.len(), 1);
        match &tokens[0] {
            OwnedPtyToken::Graphics(GraphicsProtocol::Sixel, payload) => {
                assert!(payload.starts_with(b"q"));
            }
            _ => panic!("expected sixel graphics token"),
        }
    }
}
