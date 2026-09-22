use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

const MAX_RUNTIME_EVENTS: usize = 256;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommandBoundary {
    PromptStart,
    CommandLine,
    CommandStart,
    CommandFinished(Option<i32>),
}

impl From<alacritty_terminal::vte::ansi::CommandBoundary> for CommandBoundary {
    fn from(boundary: alacritty_terminal::vte::ansi::CommandBoundary) -> Self {
        match boundary {
            alacritty_terminal::vte::ansi::CommandBoundary::PromptStart => Self::PromptStart,
            alacritty_terminal::vte::ansi::CommandBoundary::CommandLine => Self::CommandLine,
            alacritty_terminal::vte::ansi::CommandBoundary::CommandStart => Self::CommandStart,
            alacritty_terminal::vte::ansi::CommandBoundary::CommandFinished(status) => {
                Self::CommandFinished(status)
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ShellStateSignal {
    WorkingDirectory {
        uri: String,
        nonce: String,
    },
    CommandLifecycle {
        boundary: CommandBoundary,
        nonce: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TerminalRuntimeEvent {
    ShellState(ShellStateSignal),
    ChildExited(Option<i32>),
}

#[derive(Default)]
pub struct TerminalRuntimeEventQueue {
    events: Mutex<VecDeque<TerminalRuntimeEvent>>,
    snapshot_sync_epoch: AtomicU64,
    deferred_child_exit: Mutex<Option<DeferredChildExit>>,
}

struct DeferredChildExit {
    status: Option<i32>,
    required_sync_epoch: u64,
}

impl TerminalRuntimeEventQueue {
    pub fn push(&self, event: TerminalRuntimeEvent) {
        let Ok(mut events) = self.events.lock() else {
            return;
        };
        if let TerminalRuntimeEvent::ChildExited(new_status) = event {
            if let Some(TerminalRuntimeEvent::ChildExited(status)) = events
                .iter_mut()
                .find(|queued| matches!(queued, TerminalRuntimeEvent::ChildExited(_)))
            {
                if status.is_none() && new_status.is_some() {
                    *status = new_status;
                }
                return;
            }
            if events.len() == MAX_RUNTIME_EVENTS {
                events.pop_front();
            }
            events.push_back(TerminalRuntimeEvent::ChildExited(new_status));
            return;
        }
        if events.len() == MAX_RUNTIME_EVENTS {
            events.pop_front();
        }
        events.push_back(event);
    }

    pub fn drain(&self) -> Vec<TerminalRuntimeEvent> {
        self.events
            .lock()
            .map(|mut events| events.drain(..).collect())
            .unwrap_or_default()
    }

    pub fn defer_child_exit(&self, status: Option<i32>) {
        let required_sync_epoch = self.snapshot_sync_epoch.load(Ordering::Acquire) + 1;
        let Ok(mut deferred) = self.deferred_child_exit.lock() else {
            return;
        };
        match deferred.as_mut() {
            Some(exit) => {
                if exit.status.is_none() && status.is_some() {
                    exit.status = status;
                }
                exit.required_sync_epoch = exit.required_sync_epoch.max(required_sync_epoch);
            }
            None => {
                *deferred = Some(DeferredChildExit {
                    status,
                    required_sync_epoch,
                });
            }
        }
    }

    pub fn begin_snapshot_sync(&self) -> u64 {
        self.snapshot_sync_epoch.fetch_add(1, Ordering::AcqRel) + 1
    }

    pub fn publish_deferred_child_exit(&self, completed_sync_epoch: u64) {
        let status = self
            .deferred_child_exit
            .lock()
            .ok()
            .and_then(|mut deferred| {
                deferred
                    .as_ref()
                    .is_some_and(|exit| exit.required_sync_epoch <= completed_sync_epoch)
                    .then(|| deferred.take().unwrap().status)
            });
        if let Some(status) = status {
            self.push(TerminalRuntimeEvent::ChildExited(status));
        }
    }
}

pub(super) fn nonce_parameter(params: &[String]) -> String {
    params
        .iter()
        .find_map(|param| param.strip_prefix("tide_nonce="))
        .unwrap_or_default()
        .to_owned()
}

pub(super) fn nonce_from_working_directory_uri(uri: &str) -> String {
    uri.split_once('?')
        .map(|(_, query)| query)
        .and_then(|query| {
            query
                .split('&')
                .find_map(|part| part.strip_prefix("tide_nonce="))
        })
        .unwrap_or_default()
        .to_owned()
}

pub fn decode_working_directory(uri: &str, expected_nonce: &str) -> Option<PathBuf> {
    decode_working_directory_with_local_hostname(
        uri,
        expected_nonce,
        std::env::var("HOSTNAME").ok().as_deref(),
        machine_hostname().as_deref(),
    )
}

pub(super) fn decode_working_directory_with_local_hostname(
    uri: &str,
    expected_nonce: &str,
    env_hostname: Option<&str>,
    machine_hostname: Option<&str>,
) -> Option<PathBuf> {
    let remainder = uri.strip_prefix("file://")?;
    let (location, query) = remainder.split_once('?')?;
    let nonce = query
        .split('&')
        .find_map(|part| part.strip_prefix("tide_nonce="))?;
    if nonce != expected_nonce {
        return None;
    }

    let (host, path) = location.split_once('/')?;
    if !is_local_host(host, env_hostname, machine_hostname) {
        return None;
    }

    let decoded = percent_decode(&format!("/{path}"))?;
    Some(PathBuf::from(decoded))
}

fn is_local_host(host: &str, env_hostname: Option<&str>, machine_hostname: Option<&str>) -> bool {
    if host.is_empty() || host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    env_hostname
        .into_iter()
        .chain(machine_hostname)
        .any(|local| {
            host.eq_ignore_ascii_case(&local)
                || host
                    .split('.')
                    .next()
                    .zip(local.split('.').next())
                    .is_some_and(|(left, right)| left.eq_ignore_ascii_case(right))
        })
}

fn machine_hostname() -> Option<String> {
    let mut buffer = [0_u8; 256];
    if unsafe { libc::gethostname(buffer.as_mut_ptr().cast(), buffer.len()) } != 0 {
        return None;
    }
    let len = buffer
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(buffer.len());
    String::from_utf8(buffer[..len].to_vec()).ok()
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = hex_value(*bytes.get(index + 1)?)?;
            let low = hex_value(*bytes.get(index + 2)?)?;
            decoded.push((high << 4) | low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}
