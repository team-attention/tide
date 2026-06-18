use std::collections::hash_map::Entry;

use crate::tide_core::{Color, Rect};

use super::vertex::GlyphVertex;
use super::WgpuRenderer;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RasterIconAsset {
    pub key: &'static str,
    pub flaticon_id: &'static str,
    pub source_url: &'static str,
    pub bytes: &'static [u8],
}

pub(crate) struct RasterIconTexture {
    pub(crate) bind_group: wgpu::BindGroup,
    _texture: wgpu::Texture,
    _texture_view: wgpu::TextureView,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct RasterIconDrawCall {
    pub(crate) key: &'static str,
    pub(crate) index_start: u32,
    pub(crate) index_count: u32,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct TerminalImageDrawCall {
    pub(crate) key: u64,
    pub(crate) index_start: u32,
    pub(crate) index_count: u32,
}

impl WgpuRenderer {
    pub fn draw_chrome_raster_icon(
        &mut self,
        asset: &'static RasterIconAsset,
        rect: Rect,
        color: Color,
    ) {
        if !self.ensure_raster_icon_cached(asset) {
            return;
        }
        push_raster_icon_quad(
            &mut self.chrome_icon_vertices,
            &mut self.chrome_icon_indices,
            &mut self.chrome_icon_draws,
            self.scale_factor,
            asset.key,
            rect,
            color,
        );
    }

    pub fn draw_top_raster_icon(
        &mut self,
        asset: &'static RasterIconAsset,
        rect: Rect,
        color: Color,
    ) {
        if !self.ensure_raster_icon_cached(asset) {
            return;
        }
        push_raster_icon_quad(
            &mut self.top_icon_vertices,
            &mut self.top_icon_indices,
            &mut self.top_icon_draws,
            self.scale_factor,
            asset.key,
            rect,
            color,
        );
    }

    pub fn draw_terminal_image(
        &mut self,
        key: u64,
        width: u32,
        height: u32,
        rgba: &[u8],
        rect: Rect,
    ) {
        if !self.ensure_terminal_image_cached(key, width, height, rgba) {
            return;
        }
        push_terminal_image_quad(
            &mut self.top_icon_vertices,
            &mut self.top_icon_indices,
            &mut self.top_image_draws,
            self.scale_factor,
            key,
            rect,
            Color::WHITE,
        );
    }

    fn ensure_raster_icon_cached(&mut self, asset: &'static RasterIconAsset) -> bool {
        match self.raster_icon_textures.entry(asset.key) {
            Entry::Occupied(_) => true,
            Entry::Vacant(slot) => {
                let Ok(decoded) = image::load_from_memory(asset.bytes) else {
                    log::warn!("Failed to decode raster icon {}", asset.key);
                    return false;
                };
                let rgba = decoded.to_rgba8();
                let width = rgba.width();
                let height = rgba.height();
                if width == 0 || height == 0 {
                    return false;
                }

                let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some(asset.key),
                    size: wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                });

                self.queue.write_texture(
                    wgpu::ImageCopyTexture {
                        texture: &texture,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    rgba.as_raw(),
                    wgpu::ImageDataLayout {
                        offset: 0,
                        bytes_per_row: Some(width * 4),
                        rows_per_image: Some(height),
                    },
                    wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                );

                let texture_view = texture.create_view(&wgpu::TextureViewDescriptor::default());
                let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some(asset.key),
                    layout: &self.raster_icon_bind_group_layout,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(&texture_view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::Sampler(&self.raster_icon_sampler),
                        },
                    ],
                });

                slot.insert(RasterIconTexture {
                    bind_group,
                    _texture: texture,
                    _texture_view: texture_view,
                });
                true
            }
        }
    }

    fn ensure_terminal_image_cached(
        &mut self,
        key: u64,
        width: u32,
        height: u32,
        rgba: &[u8],
    ) -> bool {
        match self.terminal_image_textures.entry(key) {
            Entry::Occupied(_) => true,
            Entry::Vacant(slot) => {
                let Some(expected_len) = width
                    .checked_mul(height)
                    .and_then(|pixels| pixels.checked_mul(4))
                    .map(|len| len as usize)
                else {
                    return false;
                };
                if width == 0 || height == 0 || rgba.len() < expected_len {
                    log::warn!("Invalid terminal image dimensions for {key}");
                    return false;
                }

                let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("terminal_image"),
                    size: wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                });

                self.queue.write_texture(
                    wgpu::ImageCopyTexture {
                        texture: &texture,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    &rgba[..expected_len],
                    wgpu::ImageDataLayout {
                        offset: 0,
                        bytes_per_row: Some(width * 4),
                        rows_per_image: Some(height),
                    },
                    wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                );

                let texture_view = texture.create_view(&wgpu::TextureViewDescriptor::default());
                let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("terminal_image_bg"),
                    layout: &self.raster_icon_bind_group_layout,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(&texture_view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::Sampler(&self.raster_icon_sampler),
                        },
                    ],
                });

                slot.insert(RasterIconTexture {
                    bind_group,
                    _texture: texture,
                    _texture_view: texture_view,
                });
                true
            }
        }
    }
}

fn push_raster_icon_quad(
    vertices: &mut Vec<GlyphVertex>,
    indices: &mut Vec<u32>,
    draws: &mut Vec<RasterIconDrawCall>,
    scale_factor: f32,
    key: &'static str,
    rect: Rect,
    color: Color,
) {
    if rect.width <= 0.0 || rect.height <= 0.0 {
        return;
    }

    let x = rect.x * scale_factor;
    let y = rect.y * scale_factor;
    let w = rect.width * scale_factor;
    let h = rect.height * scale_factor;
    let c = [color.r, color.g, color.b, color.a];
    let base_vertex = vertices.len() as u32;
    let index_start = indices.len() as u32;

    vertices.push(GlyphVertex {
        position: [x, y],
        uv: [0.0, 0.0],
        color: c,
    });
    vertices.push(GlyphVertex {
        position: [x + w, y],
        uv: [1.0, 0.0],
        color: c,
    });
    vertices.push(GlyphVertex {
        position: [x + w, y + h],
        uv: [1.0, 1.0],
        color: c,
    });
    vertices.push(GlyphVertex {
        position: [x, y + h],
        uv: [0.0, 1.0],
        color: c,
    });

    indices.extend_from_slice(&[
        base_vertex,
        base_vertex + 1,
        base_vertex + 2,
        base_vertex,
        base_vertex + 2,
        base_vertex + 3,
    ]);
    draws.push(RasterIconDrawCall {
        key,
        index_start,
        index_count: 6,
    });
}

fn push_terminal_image_quad(
    vertices: &mut Vec<GlyphVertex>,
    indices: &mut Vec<u32>,
    draws: &mut Vec<TerminalImageDrawCall>,
    scale_factor: f32,
    key: u64,
    rect: Rect,
    color: Color,
) {
    if rect.width <= 0.0 || rect.height <= 0.0 {
        return;
    }

    let x = rect.x * scale_factor;
    let y = rect.y * scale_factor;
    let w = rect.width * scale_factor;
    let h = rect.height * scale_factor;
    let c = [color.r, color.g, color.b, color.a];
    let base_vertex = vertices.len() as u32;
    let index_start = indices.len() as u32;

    vertices.push(GlyphVertex {
        position: [x, y],
        uv: [0.0, 0.0],
        color: c,
    });
    vertices.push(GlyphVertex {
        position: [x + w, y],
        uv: [1.0, 0.0],
        color: c,
    });
    vertices.push(GlyphVertex {
        position: [x + w, y + h],
        uv: [1.0, 1.0],
        color: c,
    });
    vertices.push(GlyphVertex {
        position: [x, y + h],
        uv: [0.0, 1.0],
        color: c,
    });

    indices.extend_from_slice(&[
        base_vertex,
        base_vertex + 1,
        base_vertex + 2,
        base_vertex,
        base_vertex + 2,
        base_vertex + 3,
    ]);
    draws.push(TerminalImageDrawCall {
        key,
        index_start,
        index_count: 6,
    });
}
