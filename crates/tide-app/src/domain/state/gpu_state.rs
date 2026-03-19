// GpuState — GPU resources: device, queue, surface, renderer, render thread.

pub(crate) struct GpuState {
    pub device: Option<std::sync::Arc<wgpu::Device>>,
    pub queue: Option<std::sync::Arc<wgpu::Queue>>,
    pub surface_config: Option<wgpu::SurfaceConfiguration>,
    pub renderer: Option<tide_renderer::WgpuRenderer>,
    pub render_thread: Option<crate::rendering::render_thread::RenderThreadHandle>,
    pub pending_surface_config: Option<wgpu::SurfaceConfiguration>,
    pub drawable_wait_us: u64,
}

impl GpuState {
    pub fn new() -> Self {
        Self { device: None, queue: None, surface_config: None, renderer: None, render_thread: None, pending_surface_config: None, drawable_wait_us: 0 }
    }
}
