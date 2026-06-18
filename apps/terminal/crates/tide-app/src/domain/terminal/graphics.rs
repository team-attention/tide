use std::collections::HashMap;
use std::io::Cursor;

use alacritty_terminal::event::{GraphicsData, GraphicsProtocol};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use image::{DynamicImage, ImageFormat, RgbaImage};

use crate::tide_core::{TerminalGraphic, TerminalGraphicProtocol};

pub(super) enum GraphicsUpdate {
    Image(TerminalGraphic),
    Clear,
}

#[derive(Default)]
pub(super) struct TerminalGraphicsState {
    pending_kitty_chunks: HashMap<u32, String>,
    kitty_images: HashMap<u32, StoredKittyImage>,
    next_key: u64,
}

#[derive(Clone)]
struct StoredKittyImage {
    png: Vec<u8>,
    width_px: u32,
    height_px: u32,
}

impl TerminalGraphicsState {
    pub(super) fn handle_event(&mut self, data: GraphicsData) -> Option<GraphicsUpdate> {
        match data.protocol {
            GraphicsProtocol::Kitty => self.handle_kitty(data),
            GraphicsProtocol::Sixel => self.handle_sixel(data),
        }
    }

    fn handle_kitty(&mut self, data: GraphicsData) -> Option<GraphicsUpdate> {
        let payload = data.payload.strip_prefix(b"G")?;
        let (control, encoded) = if let Some(separator) = payload.iter().position(|byte| *byte == b';') {
            (&payload[..separator], &payload[separator + 1..])
        } else {
            (payload, &[][..])
        };
        let control = std::str::from_utf8(control).ok()?;
        let fields = parse_kitty_control_fields(control);

        if fields.get("a") == Some(&"d") {
            self.pending_kitty_chunks.clear();
            self.kitty_images.clear();
            return Some(GraphicsUpdate::Clear);
        }

        let image_id = fields
            .get("i")
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(0);
        let action = fields.get("a").copied().unwrap_or("T");
        if action == "p" {
            let image = self.kitty_images.get(&image_id)?.clone();
            return Some(self.kitty_graphic_update(data.row, data.col, &fields, image));
        }

        let more_chunks = fields.get("m") == Some(&"1");
        let encoded = std::str::from_utf8(encoded).ok()?;

        let mut complete_payload = if let Some(mut pending) = self.pending_kitty_chunks.remove(&image_id) {
            pending.push_str(encoded);
            pending
        } else {
            encoded.to_string()
        };

        if more_chunks {
            self.pending_kitty_chunks
                .insert(image_id, std::mem::take(&mut complete_payload));
            return None;
        }

        let image = decode_kitty_image(&fields, &complete_payload)?;
        if image_id != 0 {
            self.kitty_images.insert(image_id, image.clone());
        }

        if action == "t" {
            return None;
        }

        Some(self.kitty_graphic_update(data.row, data.col, &fields, image))
    }

    fn kitty_graphic_update(
        &mut self,
        row: u16,
        col: u16,
        fields: &HashMap<&str, &str>,
        image: StoredKittyImage,
    ) -> GraphicsUpdate {
        self.next_key = self.next_key.wrapping_add(1).max(1);
        GraphicsUpdate::Image(TerminalGraphic {
            key: self.next_key,
            protocol: TerminalGraphicProtocol::Kitty,
            row,
            col,
            width_cells: kitty_cells_field(fields, "c")
                .unwrap_or_else(|| pixel_width_to_cells(image.width_px)),
            height_cells: kitty_cells_field(fields, "r")
                .unwrap_or_else(|| pixel_height_to_cells(image.height_px)),
            bytes: image.png,
        })
    }

    fn handle_sixel(&mut self, data: GraphicsData) -> Option<GraphicsUpdate> {
        let (png, width, height) = decode_sixel_to_png(&data.payload)?;
        self.next_key = self.next_key.wrapping_add(1).max(1);
        Some(GraphicsUpdate::Image(TerminalGraphic {
            key: self.next_key,
            protocol: TerminalGraphicProtocol::Sixel,
            row: data.row,
            col: data.col,
            width_cells: ((width + 7) / 8).clamp(1, u32::from(u16::MAX)) as u16,
            height_cells: ((height + 15) / 16).clamp(1, u32::from(u16::MAX)) as u16,
            bytes: png,
        }))
    }
}

fn parse_kitty_control_fields(control: &str) -> HashMap<&str, &str> {
    control
        .split(',')
        .filter_map(|field| field.split_once('='))
        .collect()
}

fn decode_kitty_image(
    fields: &HashMap<&str, &str>,
    encoded: &str,
) -> Option<StoredKittyImage> {
    let format = fields.get("f").copied().unwrap_or("100");
    let decoded = STANDARD.decode(encoded).ok()?;
    if decoded.is_empty() {
        return None;
    }

    match format {
        "100" => {
            let image = image::load_from_memory(&decoded).ok()?;
            Some(StoredKittyImage {
                png: decoded,
                width_px: image.width(),
                height_px: image.height(),
            })
        }
        "24" | "32" => {
            let width = fields.get("s").and_then(|value| value.parse::<u32>().ok())?;
            let height = fields.get("v").and_then(|value| value.parse::<u32>().ok())?;
            if width == 0 || height == 0 || width > 4096 || height > 4096 {
                return None;
            }
            let pixel_count = width.checked_mul(height)? as usize;
            let rgba = if format == "24" {
                if decoded.len() < pixel_count.checked_mul(3)? {
                    return None;
                }
                let mut rgba = Vec::with_capacity(pixel_count * 4);
                for pixel in decoded.chunks_exact(3).take(pixel_count) {
                    rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
                }
                rgba
            } else {
                if decoded.len() < pixel_count.checked_mul(4)? {
                    return None;
                }
                decoded[..pixel_count * 4].to_vec()
            };
            let image = RgbaImage::from_raw(width, height, rgba)?;
            let png = encode_rgba_image_to_png(image)?;
            Some(StoredKittyImage {
                png,
                width_px: width,
                height_px: height,
            })
        }
        _ => None,
    }
}

fn encode_rgba_image_to_png(image: RgbaImage) -> Option<Vec<u8>> {
    let mut png = Vec::new();
    DynamicImage::ImageRgba8(image)
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .ok()?;
    Some(png)
}

fn kitty_cells_field(fields: &HashMap<&str, &str>, key: &str) -> Option<u16> {
    fields
        .get(key)
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|value| *value > 0)
}

fn pixel_width_to_cells(width_px: u32) -> u16 {
    ((width_px + 7) / 8).clamp(1, u32::from(u16::MAX)) as u16
}

fn pixel_height_to_cells(height_px: u32) -> u16 {
    ((height_px + 15) / 16).clamp(1, u32::from(u16::MAX)) as u16
}

fn decode_sixel_to_png(payload: &[u8]) -> Option<(Vec<u8>, u32, u32)> {
    let final_index = payload.iter().position(|byte| (0x40..=0x7e).contains(byte))?;
    if payload[final_index] != b'q' {
        return None;
    }
    let data = &payload[final_index + 1..];

    let mut decoder = SixelDecoder::default();
    decoder.decode(data)
}

struct SixelDecoder {
    x: u32,
    y: u32,
    declared_width: u32,
    declared_height: u32,
    max_x: u32,
    max_y: u32,
    current_color: u16,
    palette: HashMap<u16, [u8; 4]>,
    pixels: HashMap<(u32, u32), [u8; 4]>,
}

impl Default for SixelDecoder {
    fn default() -> Self {
        let mut palette = HashMap::new();
        palette.insert(0, [0, 0, 0, 255]);
        palette.insert(1, [255, 255, 255, 255]);
        Self {
            x: 0,
            y: 0,
            declared_width: 0,
            declared_height: 0,
            max_x: 0,
            max_y: 0,
            current_color: 1,
            palette,
            pixels: HashMap::new(),
        }
    }
}

impl SixelDecoder {
    fn decode(&mut self, data: &[u8]) -> Option<(Vec<u8>, u32, u32)> {
        let mut index = 0;
        while index < data.len() {
            match data[index] {
                b'!' => {
                    index += 1;
                    let repeat = parse_decimal(data, &mut index).unwrap_or(1);
                    if index < data.len() {
                        let byte = data[index];
                        index += 1;
                        self.draw_sixel_byte(byte, repeat);
                    }
                }
                b'#' => {
                    index += 1;
                    self.parse_color(data, &mut index);
                }
                b'"' => {
                    index += 1;
                    self.parse_raster_attributes(data, &mut index);
                }
                b'$' => {
                    self.x = 0;
                    index += 1;
                }
                b'-' => {
                    self.x = 0;
                    self.y = self.y.saturating_add(6);
                    index += 1;
                }
                byte @ 0x3f..=0x7e => {
                    self.draw_sixel_byte(byte, 1);
                    index += 1;
                }
                _ => index += 1,
            }
        }

        let width = self.declared_width.max(self.max_x.saturating_add(1));
        let height = self.declared_height.max(self.max_y.saturating_add(1));
        if width == 0 || height == 0 || width > 4096 || height > 4096 {
            return None;
        }

        let mut image = RgbaImage::new(width, height);
        for ((x, y), color) in &self.pixels {
            if *x < width && *y < height {
                image.put_pixel(*x, *y, image::Rgba(*color));
            }
        }

        Some((encode_rgba_image_to_png(image)?, width, height))
    }

    fn draw_sixel_byte(&mut self, byte: u8, repeat: u32) {
        if !(0x3f..=0x7e).contains(&byte) {
            return;
        }
        let bits = byte - 0x3f;
        let color = self
            .palette
            .get(&self.current_color)
            .copied()
            .unwrap_or([255, 255, 255, 255]);
        for _ in 0..repeat.max(1) {
            for bit in 0..6 {
                if bits & (1 << bit) != 0 {
                    let y = self.y + bit;
                    self.pixels.insert((self.x, y), color);
                    self.max_x = self.max_x.max(self.x);
                    self.max_y = self.max_y.max(y);
                }
            }
            self.x = self.x.saturating_add(1);
        }
    }

    fn parse_color(&mut self, data: &[u8], index: &mut usize) {
        let Some(color_index) = parse_decimal(data, index) else {
            return;
        };
        self.current_color = color_index.min(u32::from(u16::MAX)) as u16;
        if data.get(*index) != Some(&b';') {
            return;
        }
        *index += 1;
        let Some(mode) = parse_decimal(data, index) else {
            return;
        };
        if mode != 2 || data.get(*index) != Some(&b';') {
            return;
        }
        *index += 1;
        let Some(r) = parse_decimal(data, index) else {
            return;
        };
        if data.get(*index) != Some(&b';') {
            return;
        }
        *index += 1;
        let Some(g) = parse_decimal(data, index) else {
            return;
        };
        if data.get(*index) != Some(&b';') {
            return;
        }
        *index += 1;
        let Some(b) = parse_decimal(data, index) else {
            return;
        };
        let to_byte = |value: u32| ((value.min(100) * 255) / 100) as u8;
        self.palette
            .insert(self.current_color, [to_byte(r), to_byte(g), to_byte(b), 255]);
    }

    fn parse_raster_attributes(&mut self, data: &[u8], index: &mut usize) {
        let _pan = parse_decimal(data, index);
        if data.get(*index) == Some(&b';') {
            *index += 1;
        }
        let _pad = parse_decimal(data, index);
        if data.get(*index) == Some(&b';') {
            *index += 1;
        }
        if let Some(width) = parse_decimal(data, index) {
            self.declared_width = width;
        }
        if data.get(*index) == Some(&b';') {
            *index += 1;
        }
        if let Some(height) = parse_decimal(data, index) {
            self.declared_height = height;
        }
    }
}

fn parse_decimal(data: &[u8], index: &mut usize) -> Option<u32> {
    let start = *index;
    let mut value = 0_u32;
    while let Some(byte @ b'0'..=b'9') = data.get(*index).copied() {
        value = value
            .saturating_mul(10)
            .saturating_add(u32::from(byte - b'0'));
        *index += 1;
    }
    (*index > start).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encoded_test_png() -> String {
        let image = RgbaImage::from_raw(
            2,
            2,
            vec![
                255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
            ],
        )
        .expect("test image");
        STANDARD.encode(encode_rgba_image_to_png(image).expect("test png"))
    }

    #[test]
    fn kitty_direct_png_payload_decodes_to_terminal_graphic() {
        let mut state = TerminalGraphicsState::default();
        let payload = format!("Gf=100,c=4,r=2;{}", encoded_test_png()).into_bytes();
        let update = state.handle_event(GraphicsData {
            protocol: GraphicsProtocol::Kitty,
            row: 2,
            col: 3,
            payload,
        });

        let Some(GraphicsUpdate::Image(graphic)) = update else {
            panic!("expected kitty image");
        };
        assert_eq!(graphic.protocol, TerminalGraphicProtocol::Kitty);
        assert_eq!((graphic.row, graphic.col), (2, 3));
        assert_eq!((graphic.width_cells, graphic.height_cells), (4, 2));
        assert!(image::load_from_memory(&graphic.bytes).is_ok());
    }

    #[test]
    fn kitty_chunked_payload_waits_for_final_chunk() {
        let mut state = TerminalGraphicsState::default();
        let encoded = encoded_test_png();
        let split = encoded.len() / 2;
        let first = state.handle_event(GraphicsData {
            protocol: GraphicsProtocol::Kitty,
            row: 0,
            col: 0,
            payload: format!("Gf=100,i=9,m=1;{}", &encoded[..split]).into_bytes(),
        });
        assert!(first.is_none());

        let second = state.handle_event(GraphicsData {
            protocol: GraphicsProtocol::Kitty,
            row: 0,
            col: 0,
            payload: format!("Gf=100,i=9;{}", &encoded[split..]).into_bytes(),
        });
        let Some(GraphicsUpdate::Image(graphic)) = second else {
            panic!("expected final kitty image");
        };
        assert!(image::load_from_memory(&graphic.bytes).is_ok());
    }

    #[test]
    fn kitty_transmit_only_then_place_uses_stored_image() {
        let mut state = TerminalGraphicsState::default();
        let transmit = state.handle_event(GraphicsData {
            protocol: GraphicsProtocol::Kitty,
            row: 0,
            col: 0,
            payload: format!("Ga=t,f=100,i=12;{}", encoded_test_png()).into_bytes(),
        });
        assert!(transmit.is_none());

        let place = state.handle_event(GraphicsData {
            protocol: GraphicsProtocol::Kitty,
            row: 4,
            col: 5,
            payload: b"Ga=p,i=12,c=3,r=2;".to_vec(),
        });
        let Some(GraphicsUpdate::Image(graphic)) = place else {
            panic!("expected stored kitty image placement");
        };
        assert_eq!((graphic.row, graphic.col), (4, 5));
        assert_eq!((graphic.width_cells, graphic.height_cells), (3, 2));
        assert!(image::load_from_memory(&graphic.bytes).is_ok());
    }

    #[test]
    fn kitty_raw_rgb_payload_is_converted_to_png() {
        let mut state = TerminalGraphicsState::default();
        let raw_rgb = STANDARD.encode([255_u8, 0, 0, 0, 255, 0]);
        let update = state.handle_event(GraphicsData {
            protocol: GraphicsProtocol::Kitty,
            row: 0,
            col: 0,
            payload: format!("Gf=24,s=2,v=1;{raw_rgb}").into_bytes(),
        });

        let Some(GraphicsUpdate::Image(graphic)) = update else {
            panic!("expected raw rgb kitty image");
        };
        let decoded = image::load_from_memory(&graphic.bytes).expect("png decode");
        assert_eq!((decoded.width(), decoded.height()), (2, 1));
    }

    #[test]
    fn sixel_payload_decodes_to_png_graphic() {
        let mut state = TerminalGraphicsState::default();
        let update = state.handle_event(GraphicsData {
            protocol: GraphicsProtocol::Sixel,
            row: 1,
            col: 2,
            payload: br#"q"1;1;2;6#1;2;100;0;0~~"#.to_vec(),
        });

        let Some(GraphicsUpdate::Image(graphic)) = update else {
            panic!("expected sixel image");
        };
        assert_eq!(graphic.protocol, TerminalGraphicProtocol::Sixel);
        assert_eq!((graphic.row, graphic.col), (1, 2));
        assert!(image::load_from_memory(&graphic.bytes).is_ok());
    }
}
