// RouterPort — input event routing.

use crate::tide_core::InputEvent;
use crate::tide_input::Action;

pub(crate) trait RouterPort {
    fn route_input(&mut self, input: InputEvent) -> Action;
}
