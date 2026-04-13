// GpuPort — GPU device, renderer, surface, and render thread.

use crate::tide_core::PaneId;
use crate::tide_renderer::render_thread::RenderThreadHandle;
use crate::tide_renderer::WgpuRenderer;
use std::sync::Arc;

pub(crate) trait GpuPort {
    fn renderer(&self) -> Option<&WgpuRenderer>;
    fn renderer_mut(&mut self) -> Option<&mut WgpuRenderer>;
    fn take_renderer(&mut self) -> Option<WgpuRenderer>;
    fn restore_renderer(&mut self, renderer: WgpuRenderer);
    fn has_renderer(&self) -> bool;

    fn device(&self) -> Option<&Arc<wgpu::Device>>;
    fn queue(&self) -> Option<&Arc<wgpu::Queue>>;

    fn render_thread(&self) -> Option<&RenderThreadHandle>;
    fn set_render_thread(&mut self, rt: RenderThreadHandle);

    fn surface_config(&self) -> Option<&wgpu::SurfaceConfiguration>;
    fn surface_config_mut(&mut self) -> Option<&mut wgpu::SurfaceConfiguration>;
    fn set_surface_config(&mut self, config: wgpu::SurfaceConfiguration);
    fn take_pending_surface_config(&mut self) -> Option<wgpu::SurfaceConfiguration>;
    fn set_pending_surface_config(&mut self, config: wgpu::SurfaceConfiguration);

    fn drawable_wait_us(&self) -> u64;
    fn set_drawable_wait_us(&mut self, us: u64);

    fn set_device_and_queue(&mut self, device: Arc<wgpu::Device>, queue: Arc<wgpu::Queue>);
    fn set_renderer(&mut self, renderer: WgpuRenderer);

    // Convenience: domain-level operations
    fn remove_pane_cache(&mut self, pane_id: PaneId);
    fn set_clear_color(&mut self, color: crate::tide_core::Color);
    fn set_font_size(&mut self, size: f32) -> bool;
}
