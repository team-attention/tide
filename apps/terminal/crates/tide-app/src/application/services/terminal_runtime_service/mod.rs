use std::collections::HashMap;

use crate::pane::PaneKind;
use crate::state::gateway_status::AgentObservationCause;
use crate::tide_core::{PaneId, TerminalBackend};
use crate::tide_terminal::{CommandBoundary, ShellStateSignal, TerminalRuntimeEvent};
use crate::App;

#[derive(Default)]
pub(crate) struct TerminalRuntimeEffects {
    pub(crate) chrome_changed: bool,
    pub(crate) cwd_changed: bool,
    pub(crate) git_refresh: bool,
    pub(crate) agent_observation: Vec<AgentObservationCause>,
}

const AGENT_OBSERVATION_DELAY: std::time::Duration = std::time::Duration::from_millis(16);

fn drain_panes(panes: &mut HashMap<PaneId, PaneKind>, effects: &mut TerminalRuntimeEffects) {
    for (&pane_id, pane) in panes.iter_mut() {
        let PaneKind::Terminal(terminal) = pane else {
            continue;
        };
        for event in terminal.backend.drain_runtime_events() {
            match event {
                TerminalRuntimeEvent::ShellState(ShellStateSignal::WorkingDirectory { .. }) => {
                    let cwd = terminal.backend.cwd();
                    if terminal.context.cwd != cwd {
                        terminal.context.cwd = cwd;
                        terminal.context.git_info = None;
                        terminal.context.worktree_count = 0;
                        terminal.context.current_worktree = None;
                        effects.chrome_changed = true;
                        effects.cwd_changed = true;
                        effects.git_refresh = true;
                    }
                }
                TerminalRuntimeEvent::ShellState(ShellStateSignal::CommandLifecycle {
                    boundary,
                    ..
                }) => {
                    let idle = match boundary {
                        CommandBoundary::PromptStart | CommandBoundary::CommandFinished(_) => true,
                        CommandBoundary::CommandStart => false,
                        CommandBoundary::CommandLine => terminal.context.shell_idle,
                    };
                    if terminal.context.shell_idle != idle {
                        terminal.context.shell_idle = idle;
                        effects.chrome_changed = true;
                    }
                    if matches!(
                        boundary,
                        CommandBoundary::CommandStart | CommandBoundary::CommandFinished(_)
                    ) {
                        effects.agent_observation.push(match boundary {
                            CommandBoundary::CommandStart => {
                                AgentObservationCause::CommandStarted(pane_id)
                            }
                            CommandBoundary::CommandFinished(_) => {
                                AgentObservationCause::CommandFinished(pane_id)
                            }
                            _ => unreachable!(),
                        });
                    }
                    if matches!(boundary, CommandBoundary::CommandFinished(_)) {
                        effects.git_refresh = true;
                    }
                }
                TerminalRuntimeEvent::ChildExited(_) => {
                    if !terminal.context.child_dead {
                        terminal.context.child_dead = true;
                        effects.chrome_changed = true;
                    }
                }
            }
        }
    }
}

impl App {
    pub(crate) fn drain_terminal_runtime_events(&mut self) -> TerminalRuntimeEffects {
        let mut effects = TerminalRuntimeEffects::default();
        drain_panes(&mut self.panes, &mut effects);
        for workspace in &mut self.ws.workspaces {
            drain_panes(&mut workspace.panes, &mut effects);
        }
        effects
    }

    pub(crate) fn drain_and_apply_terminal_runtime_events(&mut self, now: std::time::Instant) {
        let effects = self.drain_terminal_runtime_events();
        if effects.chrome_changed {
            self.cache.invalidate_chrome();
            self.cache.needs_redraw = true;
        }
        if effects.cwd_changed {
            self.update_file_tree_cwd();
        }
        if effects.git_refresh {
            self.request_git_refresh(crate::state::background::GitRefreshCause::ShellLifecycle);
        }
        for cause in effects.agent_observation {
            match cause {
                AgentObservationCause::CommandStarted(pane_id) => {
                    self.timing
                        .pending_agent_observations
                        .insert(pane_id, now + AGENT_OBSERVATION_DELAY);
                }
                AgentObservationCause::CommandFinished(_) => self.observe_agents(cause),
                AgentObservationCause::GatewayClientsChanged => unreachable!(),
            }
        }
    }

    pub(crate) fn drain_due_agent_observations(&mut self, now: std::time::Instant) {
        let due: Vec<_> = self
            .timing
            .pending_agent_observations
            .iter()
            .filter_map(|(&pane_id, &at)| (at <= now).then_some(pane_id))
            .collect();
        for pane_id in due {
            self.timing.pending_agent_observations.remove(&pane_id);
            self.observe_agents(AgentObservationCause::CommandStarted(pane_id));
        }
    }

    fn terminal_child_pid(&self, pane_id: PaneId) -> Option<u32> {
        self.panes
            .get(&pane_id)
            .or_else(|| {
                self.ws
                    .workspaces
                    .iter()
                    .find_map(|workspace| workspace.panes.get(&pane_id))
            })
            .and_then(|pane| match pane {
                PaneKind::Terminal(terminal) => terminal.backend.child_pid(),
                _ => None,
            })
    }

    pub(crate) fn observe_agents(&mut self, cause: AgentObservationCause) {
        let previous_agents = self.gateway.detected_agents.clone();
        let previous_connected_clients = self.gateway.connected_clients;
        let pane_ids = match cause {
            AgentObservationCause::CommandStarted(pane_id)
            | AgentObservationCause::CommandFinished(pane_id) => vec![pane_id],
            AgentObservationCause::GatewayClientsChanged => {
                if !self.gateway.sync_connected_pids() {
                    return;
                }
                self.gateway.refresh_agent_connections();
                self.panes
                    .iter()
                    .chain(
                        self.ws
                            .workspaces
                            .iter()
                            .flat_map(|workspace| workspace.panes.iter()),
                    )
                    .filter_map(|(&pane_id, pane)| {
                        matches!(pane, PaneKind::Terminal(_)).then_some(pane_id)
                    })
                    .collect()
            }
        };

        for pane_id in pane_ids {
            if self
                .gateway
                .detected_agents
                .get(&pane_id)
                .is_some_and(|agent| agent.wrapper_managed)
            {
                continue;
            }
            let Some(shell_pid) = self.terminal_child_pid(pane_id) else {
                continue;
            };
            if let Some(mut agent) = self.ports.process.detect_agent(shell_pid) {
                agent.gateway_connected = crate::state::gateway_status::is_agent_connected(
                    agent.pid,
                    &self.gateway.connected_pids,
                );
                self.gateway.detected_agents.insert(pane_id, agent);
            } else {
                self.gateway.detected_agents.remove(&pane_id);
            }
        }

        if self.gateway.detected_agents != previous_agents
            || self.gateway.connected_clients != previous_connected_clients
        {
            self.cache.invalidate_chrome();
        }
    }
}
