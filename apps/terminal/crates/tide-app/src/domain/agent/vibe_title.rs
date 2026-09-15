// Native Mistral Vibe tab-status protocol (2.25.4).
#[derive(PartialEq)]
enum State {
    Running,
    Waiting,
    Complete,
    Plain,
}
fn state(title: &str) -> State {
    if title.starts_with(">> ") {
        State::Running
    } else if title.starts_with("? ") || title.ends_with(" - Action Required") {
        State::Waiting
    } else if title.ends_with(" - Task Complete") {
        State::Complete
    } else {
        State::Plain
    }
}
pub(crate) fn lifecycle_event(previous: Option<&str>, title: Option<&str>) -> Option<&'static str> {
    let next = state(title?);
    let previous = previous.map(state);
    if previous.as_ref() == Some(&next) {
        return None;
    }
    match next {
        State::Running => Some("agent-running"),
        State::Waiting => Some("agent-needs-input"),
        State::Complete => Some("agent-idle"),
        State::Plain if previous == Some(State::Running) => Some("agent-idle"),
        _ => None,
    }
}
