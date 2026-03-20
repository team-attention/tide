// Domain layer: pure business logic, state, and algorithms.

pub(crate) mod ports;
pub(crate) mod state;
pub(crate) mod pane;
pub(crate) mod modal;
pub(crate) mod action;

// Absorbed crate modules
pub(crate) mod core_types;
pub(crate) mod terminal;
pub(crate) mod editor;
pub(crate) mod layout;
pub(crate) mod input;
pub(crate) mod tree;
