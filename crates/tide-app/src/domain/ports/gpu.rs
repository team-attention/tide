// GpuPort — GPU device, renderer, surface, and render thread.
//
// Owns the entire GpuState. All GPU access goes through this port.

use std::sync::Arc;
use tide_core::PaneId;
use tide_renderer::WgpuRenderer;

use crate::rendering::render_thread::RenderThreadHandle;

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
    fn set_clear_color(&mut self, color: tide_core::Color);
    fn set_font_size(&mut self, size: f32) -> bool;
}

// ── Real implementation ──

pub(crate) struct RealGpu {
    device: Option<Arc<wgpu::Device>>,
    queue: Option<Arc<wgpu::Queue>>,
    surface_config: Option<wgpu::SurfaceConfiguration>,
    renderer: Option<WgpuRenderer>,
    render_thread: Option<RenderThreadHandle>,
    pending_surface_config: Option<wgpu::SurfaceConfiguration>,
    drawable_wait_us: u64,
}

impl RealGpu {
    pub fn new() -> Self {
        Self {
            device: None,
            queue: None,
            surface_config: None,
            renderer: None,
            render_thread: None,
            pending_surface_config: None,
            drawable_wait_us: 0,
        }
    }
}

impl GpuPort for RealGpu {
    fn renderer(&self) -> Option<&WgpuRenderer> { self.renderer.as_ref() }
    fn renderer_mut(&mut self) -> Option<&mut WgpuRenderer> { self.renderer.as_mut() }
    fn take_renderer(&mut self) -> Option<WgpuRenderer> { self.renderer.take() }
    fn restore_renderer(&mut self, renderer: WgpuRenderer) { self.renderer = Some(renderer); }
    fn has_renderer(&self) -> bool { self.renderer.is_some() }

    fn device(&self) -> Option<&Arc<wgpu::Device>> { self.device.as_ref() }
    fn queue(&self) -> Option<&Arc<wgpu::Queue>> { self.queue.as_ref() }

    fn render_thread(&self) -> Option<&RenderThreadHandle> { self.render_thread.as_ref() }
    fn set_render_thread(&mut self, rt: RenderThreadHandle) { self.render_thread = Some(rt); }

    fn surface_config(&self) -> Option<&wgpu::SurfaceConfiguration> { self.surface_config.as_ref() }
    fn surface_config_mut(&mut self) -> Option<&mut wgpu::SurfaceConfiguration> { self.surface_config.as_mut() }
    fn set_surface_config(&mut self, config: wgpu::SurfaceConfiguration) { self.surface_config = Some(config); }
    fn take_pending_surface_config(&mut self) -> Option<wgpu::SurfaceConfiguration> { self.pending_surface_config.take() }
    fn set_pending_surface_config(&mut self, config: wgpu::SurfaceConfiguration) { self.pending_surface_config = Some(config); }

    fn drawable_wait_us(&self) -> u64 { self.drawable_wait_us }
    fn set_drawable_wait_us(&mut self, us: u64) { self.drawable_wait_us = us; }

    fn set_device_and_queue(&mut self, device: Arc<wgpu::Device>, queue: Arc<wgpu::Queue>) {
        self.device = Some(device);
        self.queue = Some(queue);
    }
    fn set_renderer(&mut self, renderer: WgpuRenderer) { self.renderer = Some(renderer); }

    fn remove_pane_cache(&mut self, pane_id: PaneId) {
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.remove_pane_cache(pane_id);
        }
    }
    fn set_clear_color(&mut self, color: tide_core::Color) {
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.clear_color = color;
        }
    }
    fn set_font_size(&mut self, size: f32) -> bool {
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.set_font_size(size);
            true
        } else {
            false
        }
    }
}

// ── Noop implementation (tests) ──

pub(crate) struct NoopGpu;

impl GpuPort for NoopGpu {
    fn renderer(&self) -> Option<&WgpuRenderer> { None }
    fn renderer_mut(&mut self) -> Option<&mut WgpuRenderer> { None }
    fn take_renderer(&mut self) -> Option<WgpuRenderer> { None }
    fn restore_renderer(&mut self, _renderer: WgpuRenderer) {}
    fn has_renderer(&self) -> bool { false }
    fn device(&self) -> Option<&Arc<wgpu::Device>> { None }
    fn queue(&self) -> Option<&Arc<wgpu::Queue>> { None }
    fn render_thread(&self) -> Option<&RenderThreadHandle> { None }
    fn set_render_thread(&mut self, _rt: RenderThreadHandle) {}
    fn surface_config(&self) -> Option<&wgpu::SurfaceConfiguration> { None }
    fn surface_config_mut(&mut self) -> Option<&mut wgpu::SurfaceConfiguration> { None }
    fn set_surface_config(&mut self, _config: wgpu::SurfaceConfiguration) {}
    fn take_pending_surface_config(&mut self) -> Option<wgpu::SurfaceConfiguration> { None }
    fn set_pending_surface_config(&mut self, _config: wgpu::SurfaceConfiguration) {}
    fn drawable_wait_us(&self) -> u64 { 0 }
    fn set_drawable_wait_us(&mut self, _us: u64) {}
    fn set_device_and_queue(&mut self, _device: Arc<wgpu::Device>, _queue: Arc<wgpu::Queue>) {}
    fn set_renderer(&mut self, _renderer: WgpuRenderer) {}
    fn remove_pane_cache(&mut self, _pane_id: PaneId) {}
    fn set_clear_color(&mut self, _color: tide_core::Color) {}
    fn set_font_size(&mut self, _size: f32) -> bool { false }
}
