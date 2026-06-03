// All port interfaces: inward (what the app can do) + outward (what the app needs).

pub(crate) mod inward;
pub(crate) mod outward;

// Re-export inward ports
pub(crate) use inward::*;

// Re-export outward ports and Ports struct
