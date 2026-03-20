// GpuState — placeholder. All GPU state is managed by GpuPort (application/ports/outward/gpu_port.rs).
// This exists only as a re-export target for backwards compatibility.

pub(crate) struct GpuState;

impl GpuState {
    pub fn new() -> Self {
        Self
    }
}
