// ModalPort — read/write access to the modal overlay stack.

use crate::state::ModalStack;

pub(crate) trait ModalPort {
    fn modal(&self) -> &ModalStack;
    fn modal_mut(&mut self) -> &mut ModalStack;
}
