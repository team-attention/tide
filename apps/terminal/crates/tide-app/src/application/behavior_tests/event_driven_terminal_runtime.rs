use crate::pane::{PaneKind, TerminalPane};
use crate::tide_core::FileTreeSource;
use crate::tide_terminal::{CommandBoundary, ShellStateSignal, TerminalRuntimeEvent};
use crate::App;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

struct PendingRepositoryWatcher {
    changes:
        Vec<crate::application::ports::outward::repository_watcher_port::RepositoryChangeSignal>,
}

struct RecordingRepositoryWatcher {
    desired: Arc<std::sync::Mutex<Vec<HashMap<
        crate::application::ports::outward::repository_watcher_port::RepositoryWatchPaths,
        usize,
    >>>>,
}

impl crate::application::ports::outward::RepositoryWatcherPort for RecordingRepositoryWatcher {
    fn init(&mut self, _waker: Option<crate::tide_platform::WakeCallback>) {}

    fn reconcile(
        &mut self,
        desired: HashMap<
            crate::application::ports::outward::repository_watcher_port::RepositoryWatchPaths,
            usize,
        >,
    ) {
        self.desired.lock().unwrap().push(desired);
    }

    fn drain_changes(
        &mut self,
    ) -> Vec<crate::application::ports::outward::repository_watcher_port::RepositoryChangeSignal>
    {
        Vec::new()
    }
}

struct CountingProcessObserver {
    calls: Arc<AtomicUsize>,
}

impl crate::application::ports::outward::ProcessPort for CountingProcessObserver {
    fn open_with_default_app(&self, _path: &std::path::Path) -> std::io::Result<()> {
        Ok(())
    }

    fn reveal_in_finder(&self, _path: &std::path::Path) -> std::io::Result<()> {
        Ok(())
    }

    fn open_url(&self, _url: &str) -> std::io::Result<()> {
        Ok(())
    }

    fn detect_agent(&self, shell_pid: u32) -> Option<crate::state::gateway_status::AgentInfo> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        Some(crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: shell_pid,
            wrapper_managed: false,
            gateway_connected: false,
            status: None,
        })
    }
}

impl crate::application::ports::outward::RepositoryWatcherPort for PendingRepositoryWatcher {
    fn init(&mut self, _waker: Option<crate::tide_platform::WakeCallback>) {}

    fn reconcile(
        &mut self,
        _desired: HashMap<
            crate::application::ports::outward::repository_watcher_port::RepositoryWatchPaths,
            usize,
        >,
    ) {
    }

    fn drain_changes(
        &mut self,
    ) -> Vec<crate::application::ports::outward::repository_watcher_port::RepositoryChangeSignal>
    {
        std::mem::take(&mut self.changes)
    }
}

fn terminal_app() -> (App, u64) {
    let mut app = App::new();
    let (layout, pane_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let mut terminal = TerminalPane::with_cwd(
        pane_id,
        80,
        24,
        Some(std::path::PathBuf::from("/tmp/initial")),
        true,
    )
    .unwrap();
    terminal.backend.stop_pty_for_test();
    app.panes.insert(pane_id, PaneKind::Terminal(terminal));
    (app, pane_id)
}

fn live_terminal_app() -> (App, u64) {
    let mut app = App::new();
    let (layout, pane_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let terminal = TerminalPane::with_cwd(
        pane_id,
        80,
        24,
        Some(std::path::PathBuf::from("/tmp/initial")),
        true,
    )
    .unwrap();
    app.panes.insert(pane_id, PaneKind::Terminal(terminal));
    (app, pane_id)
}

fn queue(app: &mut App, pane_id: u64, event: TerminalRuntimeEvent) {
    let Some(PaneKind::Terminal(terminal)) = app.panes.get_mut(&pane_id) else {
        panic!()
    };
    terminal
        .backend
        .queue_runtime_event_for_test(event, Some("trusted"));
}

#[test]
fn trusted_shell_events_update_terminal_context_without_polling() {
    let (mut app, pane_id) = terminal_app();
    queue(
        &mut app,
        pane_id,
        TerminalRuntimeEvent::ShellState(ShellStateSignal::WorkingDirectory {
            uri: "file://localhost/tmp/next%20dir?tide_nonce=trusted".into(),
            nonce: "trusted".into(),
        }),
    );
    queue(
        &mut app,
        pane_id,
        TerminalRuntimeEvent::ShellState(ShellStateSignal::CommandLifecycle {
            boundary: CommandBoundary::CommandStart,
            nonce: "trusted".into(),
        }),
    );

    let effects = app.drain_terminal_runtime_events();
    let Some(PaneKind::Terminal(terminal)) = app.panes.get(&pane_id) else {
        panic!()
    };
    assert_eq!(
        terminal.context.cwd.as_deref(),
        Some(std::path::Path::new("/tmp/next dir"))
    );
    assert!(!terminal.context.shell_idle);
    assert!(effects.chrome_changed);
    assert!(effects.git_refresh);
    assert!(effects
        .agent_observation
        .contains(&crate::state::gateway_status::AgentObservationCause::CommandStarted(pane_id)));
}

#[test]
fn cwd_event_retargets_visible_file_tree_in_same_event_batch() {
    let root = tempfile::tempdir().unwrap();
    let old_cwd = root.path().join("old");
    let new_cwd = root.path().join("new");
    std::fs::create_dir_all(&old_cwd).unwrap();
    std::fs::create_dir_all(&new_cwd).unwrap();

    let (mut app, pane_id) = terminal_app();
    app.focus.focused = Some(pane_id);
    app.ft.visible = true;
    app.ft.tree = Some(crate::tide_tree::FsTree::new(old_cwd.clone()));
    app.timing.last_cwd = Some(old_cwd);
    queue(
        &mut app,
        pane_id,
        TerminalRuntimeEvent::ShellState(ShellStateSignal::WorkingDirectory {
            uri: format!(
                "file://localhost{}?tide_nonce=trusted",
                new_cwd.display()
            ),
            nonce: "trusted".into(),
        }),
    );

    let now = app.ports.clock.now();
    app.drain_and_apply_terminal_runtime_events(now);

    assert_eq!(app.ft.tree.as_ref().unwrap().root(), new_cwd.as_path());
}

#[test]
fn child_exit_event_marks_terminal_dead() {
    let (mut app, pane_id) = terminal_app();
    queue(
        &mut app,
        pane_id,
        TerminalRuntimeEvent::ChildExited(Some(7)),
    );

    let effects = app.drain_terminal_runtime_events();
    let Some(PaneKind::Terminal(terminal)) = app.panes.get(&pane_id) else {
        panic!()
    };
    assert!(terminal.context.child_dead);
    assert!(effects.chrome_changed);
}

#[test]
fn working_directory_signal_updates_active_and_background_terminal_contexts() {
    let (mut app, active_id) = terminal_app();
    let background_id = active_id + 1;
    let mut background = TerminalPane::with_cwd(
        background_id,
        80,
        24,
        Some(PathBuf::from("/tmp/background-before")),
        true,
    )
    .unwrap();
    background.backend.stop_pty_for_test();
    background.backend.queue_runtime_event_for_test(
        TerminalRuntimeEvent::ShellState(ShellStateSignal::WorkingDirectory {
            uri: "file://localhost/tmp/background-after?tide_nonce=trusted".into(),
            nonce: "trusted".into(),
        }),
        Some("trusted"),
    );
    app.ws.workspaces.push(crate::Workspace {
        name: "background".into(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: Some(background_id),
        panes: HashMap::from([(background_id, PaneKind::Terminal(background))]),
    });

    queue(
        &mut app,
        active_id,
        TerminalRuntimeEvent::ShellState(ShellStateSignal::WorkingDirectory {
            uri: "file://localhost/tmp/active-after?tide_nonce=trusted".into(),
            nonce: "trusted".into(),
        }),
    );
    app.drain_terminal_runtime_events();

    let PaneKind::Terminal(active) = app.panes.get(&active_id).unwrap() else {
        panic!()
    };
    assert_eq!(
        active.context.cwd.as_deref(),
        Some(std::path::Path::new("/tmp/active-after"))
    );
    let PaneKind::Terminal(background) = app.ws.workspaces[0].panes.get(&background_id).unwrap()
    else {
        panic!()
    };
    assert_eq!(
        background.context.cwd.as_deref(),
        Some(std::path::Path::new("/tmp/background-after"))
    );
}

#[test]
fn untrusted_or_remote_working_directory_signal_keeps_last_local_cwd() {
    let (mut app, pane_id) = terminal_app();
    for uri in [
        "file://remote/tmp/remote?tide_nonce=trusted",
        "https://localhost/tmp/not-file?tide_nonce=trusted",
        "file://localhost/%ZZ?tide_nonce=trusted",
    ] {
        queue(
            &mut app,
            pane_id,
            TerminalRuntimeEvent::ShellState(ShellStateSignal::WorkingDirectory {
                uri: uri.into(),
                nonce: "trusted".into(),
            }),
        );
    }
    app.drain_terminal_runtime_events();
    let PaneKind::Terminal(terminal) = app.panes.get(&pane_id).unwrap() else {
        panic!()
    };
    assert_eq!(
        terminal.context.cwd.as_deref(),
        Some(std::path::Path::new("/tmp/initial"))
    );
}

#[test]
fn cwd_change_clears_git_context_before_refresh() {
    let (mut app, pane_id) = terminal_app();
    let PaneKind::Terminal(terminal) = app.panes.get_mut(&pane_id).unwrap() else {
        panic!()
    };
    terminal.context.git_info = Some(crate::tide_terminal::git::GitInfo {
        branch: "old".into(),
        status: Default::default(),
    });
    terminal.context.worktree_count = 2;
    queue(
        &mut app,
        pane_id,
        TerminalRuntimeEvent::ShellState(ShellStateSignal::WorkingDirectory {
            uri: "file://localhost/tmp/new?tide_nonce=trusted".into(),
            nonce: "trusted".into(),
        }),
    );
    let effects = app.drain_terminal_runtime_events();
    let PaneKind::Terminal(terminal) = app.panes.get(&pane_id).unwrap() else {
        panic!()
    };
    assert!(terminal.context.git_info.is_none());
    assert_eq!(terminal.context.worktree_count, 0);
    assert!(effects.git_refresh);
}

#[test]
fn command_completion_requests_git_refresh_without_output() {
    let (mut app, pane_id) = terminal_app();
    queue(
        &mut app,
        pane_id,
        TerminalRuntimeEvent::ShellState(ShellStateSignal::CommandLifecycle {
            boundary: CommandBoundary::CommandFinished(Some(0)),
            nonce: "trusted".into(),
        }),
    );
    assert!(app.drain_terminal_runtime_events().git_refresh);
}

#[test]
fn repository_watch_registry_covers_live_background_and_retained_contexts() {
    let (mut app, active_id) = terminal_app();
    let background_id = active_id + 1;
    let mut background_terminal = TerminalPane::with_cwd(
        background_id,
        80,
        24,
        Some(PathBuf::from("/tmp/background")),
        true,
    )
    .unwrap();
    background_terminal.backend.stop_pty_for_test();

    app.ws.workspaces.push(crate::Workspace {
        name: "background".into(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: Some(background_id),
        panes: HashMap::from([(background_id, PaneKind::Terminal(background_terminal))]),
    });
    app.assoc.retained_contexts.insert(
        background_id + 1,
        crate::pane::TerminalContext {
            cwd: Some(PathBuf::from("/tmp/retained")),
            ..Default::default()
        },
    );

    assert_eq!(
        app.git_refresh_cwds(),
        HashSet::from([
            PathBuf::from("/tmp/initial"),
            PathBuf::from("/tmp/background"),
            PathBuf::from("/tmp/retained"),
        ])
    );
}

#[test]
fn repository_watch_reconciliation_drops_removed_contexts_and_last_watch() {
    use crate::application::ports::outward::repository_watcher_port::RepositoryWatchPaths;

    let (mut app, pane_id) = terminal_app();
    let desired = Arc::new(std::sync::Mutex::new(Vec::new()));
    app.ports.repository_watcher = Box::new(RecordingRepositoryWatcher {
        desired: desired.clone(),
    });
    app.bg.repository_watch_paths.insert(
        PathBuf::from("/tmp/initial"),
        Some(RepositoryWatchPaths {
            worktree_root: PathBuf::from("/tmp/initial"),
            git_dir: PathBuf::from("/tmp/initial/.git"),
            git_common_dir: PathBuf::from("/tmp/initial/.git"),
        }),
    );

    app.reconcile_repository_watches();
    assert_eq!(desired.lock().unwrap().last().unwrap().len(), 1);

    app.panes.remove(&pane_id);
    app.reconcile_repository_watches();
    assert!(desired.lock().unwrap().last().unwrap().is_empty());
}

#[test]
fn empty_git_request_is_sent_so_last_repository_watch_can_clear() {
    use crate::state::background::{GitRefreshCause, GitWorkerMessage};

    let (mut app, pane_id) = terminal_app();
    app.panes.remove(&pane_id);
    let (tx, rx) = std::sync::mpsc::channel();
    app.bg.git_worker_tx = Some(tx);

    app.request_git_refresh(GitRefreshCause::ShellLifecycle);

    assert!(
        matches!(rx.try_recv(), Ok(GitWorkerMessage::Refresh(requests)) if requests.is_empty())
    );
}

#[test]
fn repository_watch_paths_include_worktree_and_git_metadata() {
    let repo = tempfile::tempdir().unwrap();
    let status = std::process::Command::new("git")
        .args(["init", "--quiet"])
        .current_dir(repo.path())
        .status()
        .unwrap();
    assert!(status.success());

    let paths = crate::adapter::outward::git_adapter::git_cli::repository_watch_paths(repo.path())
        .expect("git repository paths");
    let canonical = std::fs::canonicalize(repo.path()).unwrap();
    assert_eq!(paths.worktree_root, canonical);
    assert_eq!(paths.git_dir, canonical.join(".git"));
    assert_eq!(paths.git_common_dir, canonical.join(".git"));
}

#[test]
fn git_refresh_worker_coalesces_to_newest_repository_set() {
    use crate::state::background::{GitRefreshRequest, GitWorkerMessage};

    let request = |cwd: &str, wants_diff| GitRefreshRequest {
        cwd: PathBuf::from(cwd),
        wants_diff,
    };
    let initial = vec![request("/tmp/old", false)];
    let expected = vec![request("/tmp/new", true)];
    let (tx, rx) = std::sync::mpsc::channel();
    tx.send(GitWorkerMessage::Refresh(vec![request(
        "/tmp/intermediate",
        false,
    )]))
    .unwrap();
    tx.send(GitWorkerMessage::Refresh(expected.clone()))
        .unwrap();

    assert_eq!(
        crate::application::services::file_tree_service::latest_git_refresh_requests(&rx, initial,),
        Some(expected)
    );
}

#[test]
fn repository_rescan_event_requests_one_debounced_full_refresh() {
    use crate::application::ports::outward::repository_watcher_port::RepositoryChangeSignal;

    let (mut app, _) = terminal_app();
    app.ports.repository_watcher = Box::new(PendingRepositoryWatcher {
        changes: vec![
            RepositoryChangeSignal::Rescan(PathBuf::from("/tmp/initial")),
            RepositoryChangeSignal::Changed(PathBuf::from("/tmp/initial/.git/index")),
        ],
    });
    let now = app.ports.clock.now();

    assert!(app.drain_repository_changes(now));
    assert_eq!(
        app.timing.repository_refresh_at,
        Some(now + std::time::Duration::from_millis(100))
    );
    assert!(!app.drain_repository_changes(now));
}

#[test]
fn unwrapped_agent_observation_runs_once_after_command_start_deadline() {
    let (mut app, pane_id) = live_terminal_app();
    let calls = Arc::new(AtomicUsize::new(0));
    app.ports.process = Box::new(CountingProcessObserver {
        calls: calls.clone(),
    });
    app.cache.clear_redraw();
    app.window.is_focused = false;
    app.focus.focused = None;

    queue(
        &mut app,
        pane_id,
        TerminalRuntimeEvent::ShellState(ShellStateSignal::CommandLifecycle {
            boundary: CommandBoundary::CommandStart,
            nonce: "trusted".into(),
        }),
    );
    let now = app.ports.clock.now();
    app.drain_and_apply_terminal_runtime_events(now);
    assert_eq!(calls.load(Ordering::Relaxed), 0);
    app.cache.clear_redraw();

    let deadline = app.next_runtime_deadline(now).unwrap();
    assert_eq!(
        deadline.kind,
        crate::state::RuntimeDeadlineKind::AgentObservation
    );
    assert!(deadline.at > now);

    app.drain_due_agent_observations(deadline.at);
    assert_eq!(calls.load(Ordering::Relaxed), 1);
    app.drain_due_agent_observations(deadline.at + std::time::Duration::from_secs(1));
    assert_eq!(calls.load(Ordering::Relaxed), 1);
}

#[test]
fn wrapper_managed_agent_status_remains_authoritative() {
    use crate::state::gateway_status::{AgentInfo, AgentObservationCause, AgentStatus};

    let (mut app, pane_id) = terminal_app();
    let calls = Arc::new(AtomicUsize::new(0));
    app.ports.process = Box::new(CountingProcessObserver {
        calls: calls.clone(),
    });
    app.gateway.detected_agents.insert(
        pane_id,
        AgentInfo {
            name: "Claude Code",
            pid: 0,
            wrapper_managed: true,
            gateway_connected: true,
            status: Some(AgentStatus::NeedsInput),
        },
    );

    app.observe_agents(AgentObservationCause::CommandFinished(pane_id));

    let agent = app.gateway.detected_agents.get(&pane_id).unwrap();
    assert_eq!(agent.name, "Claude Code");
    assert_eq!(agent.status, Some(AgentStatus::NeedsInput));
    assert!(agent.wrapper_managed);
    assert_eq!(calls.load(Ordering::Relaxed), 0);
}

#[test]
fn gateway_client_topology_change_wakes_each_tide_window() {
    let router = Arc::new(crate::adapter::inward::cli_adapter::server::GatewayCommandRouter::new());
    let (first_tx, first_rx) = std::sync::mpsc::channel();
    let (second_tx, second_rx) = std::sync::mpsc::channel();
    let wake_count = Arc::new(AtomicUsize::new(0));
    let waker = |counter: Arc<AtomicUsize>| -> crate::tide_platform::WakeCallback {
        Arc::new(move || {
            counter.fetch_add(1, Ordering::Relaxed);
        })
    };
    router.register_window(
        crate::tide_core::TideWindowId::new(1),
        first_tx,
        waker(wake_count.clone()),
    );
    router.register_window(
        crate::tide_core::TideWindowId::new(2),
        second_tx,
        waker(wake_count.clone()),
    );
    let clients =
        crate::adapter::inward::cli_adapter::server::ConnectedClients::with_router(router);

    clients.add(42);
    assert!(matches!(
        first_rx.try_recv(),
        Ok(crate::event_loop::AppEvent::GatewayClientsChanged)
    ));
    assert!(matches!(
        second_rx.try_recv(),
        Ok(crate::event_loop::AppEvent::GatewayClientsChanged)
    ));
    assert_eq!(wake_count.load(Ordering::Relaxed), 2);

    clients.add(42);
    clients.remove(42);
    assert!(first_rx.try_recv().is_err());
    clients.remove(42);
    assert!(matches!(
        first_rx.try_recv(),
        Ok(crate::event_loop::AppEvent::GatewayClientsChanged)
    ));
}

#[test]
fn gateway_client_state_change_invalidates_visible_agent_chrome() {
    use crate::state::gateway_status::{AgentInfo, AgentObservationCause};
    let (mut app, pane_id) = live_terminal_app();
    let PaneKind::Terminal(terminal) = app.panes.get(&pane_id).unwrap() else {
        panic!()
    };
    let pid = terminal.backend.child_pid().unwrap();
    app.gateway.detected_agents.insert(
        pane_id,
        AgentInfo {
            name: "Codex",
            pid,
            wrapper_managed: false,
            gateway_connected: false,
            status: None,
        },
    );
    let router = Arc::new(crate::adapter::inward::cli_adapter::server::GatewayCommandRouter::new());
    let clients = Arc::new(
        crate::adapter::inward::cli_adapter::server::ConnectedClients::with_router(router),
    );
    clients.add(pid);
    app.gateway.connected_clients_shared = Some(clients);
    app.cache.clear_redraw();
    let chrome_generation = app.cache.chrome_generation;

    app.observe_agents(AgentObservationCause::GatewayClientsChanged);

    assert!(app.cache.needs_redraw);
    assert!(app.cache.chrome_generation > chrome_generation);
}

#[test]
fn runtime_wait_has_no_deadline_when_idle() {
    let mut app = App::new();
    app.cache.clear_redraw();
    app.window.is_focused = false;
    app.focus.focused = None;
    let now = app.ports.clock.now();

    assert_eq!(app.next_runtime_deadline(now), None);
}

#[test]
fn runtime_wait_selects_the_earliest_exact_deadline() {
    let mut app = App::new();
    app.cache.clear_redraw();
    app.window.is_focused = false;
    app.focus.focused = None;
    let now = app.ports.clock.now();
    app.timing.resize_deferred_at = Some(now + std::time::Duration::from_millis(50));
    app.timing.repository_refresh_at = Some(now + std::time::Duration::from_millis(20));

    let deadline = app.next_runtime_deadline(now).expect("runtime deadline");
    assert_eq!(deadline.at, now + std::time::Duration::from_millis(20));
    assert_eq!(
        deadline.kind,
        crate::state::RuntimeDeadlineKind::RepositoryDebounce
    );
}

#[test]
fn busy_renderer_waits_for_completion_wake_without_expired_render_deadline() {
    let mut app = App::new();
    app.window.is_focused = false;
    app.focus.focused = None;
    app.cache.needs_redraw = true;
    app.timing.waiting_for_renderer = true;
    let now = app.ports.clock.now();
    app.timing.last_frame = now - std::time::Duration::from_secs(1);

    assert_eq!(app.next_runtime_deadline(now), None);
    assert!(app.cache.needs_redraw);
}
