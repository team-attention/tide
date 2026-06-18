use std::collections::HashMap;

use alacritty_terminal::event::{GraphicsData, GraphicsProtocol};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;

use crate::tide_core::{TerminalGraphic, TerminalGraphicProtocol};

const MAX_GRAPHIC_DIMENSION: u32 = 4096;

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
    rgba: Vec<u8>,
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
        let (control, encoded) =
            if let Some(separator) = payload.iter().position(|byte| *byte == b';') {
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

        let mut complete_payload =
            if let Some(mut pending) = self.pending_kitty_chunks.remove(&image_id) {
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
            width_px: image.width_px,
            height_px: image.height_px,
            rgba: image.rgba,
        })
    }

    fn handle_sixel(&mut self, data: GraphicsData) -> Option<GraphicsUpdate> {
        let (rgba, width, height) = decode_sixel_to_rgba(&data.payload)?;
        self.next_key = self.next_key.wrapping_add(1).max(1);
        Some(GraphicsUpdate::Image(TerminalGraphic {
            key: self.next_key,
            protocol: TerminalGraphicProtocol::Sixel,
            row: data.row,
            col: data.col,
            width_cells: ((width + 7) / 8).clamp(1, u32::from(u16::MAX)) as u16,
            height_cells: ((height + 15) / 16).clamp(1, u32::from(u16::MAX)) as u16,
            width_px: width,
            height_px: height,
            rgba,
        }))
    }
}

fn parse_kitty_control_fields(control: &str) -> HashMap<&str, &str> {
    control
        .split(',')
        .filter_map(|field| field.split_once('='))
        .collect()
}

fn decode_kitty_image(fields: &HashMap<&str, &str>, encoded: &str) -> Option<StoredKittyImage> {
    let format = fields.get("f").copied().unwrap_or("100");
    let decoded = STANDARD.decode(encoded).ok()?;
    if decoded.is_empty() {
        return None;
    }

    match format {
        "100" => {
            let image = image::load_from_memory(&decoded).ok()?;
            let width_px = image.width();
            let height_px = image.height();
            if !valid_dimensions(width_px, height_px) {
                return None;
            }
            let rgba = image.to_rgba8().into_raw();
            Some(StoredKittyImage {
                rgba,
                width_px,
                height_px,
            })
        }
        "24" | "32" => {
            let width = fields
                .get("s")
                .and_then(|value| value.parse::<u32>().ok())?;
            let height = fields
                .get("v")
                .and_then(|value| value.parse::<u32>().ok())?;
            if !valid_dimensions(width, height) {
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
            Some(StoredKittyImage {
                rgba,
                width_px: width,
                height_px: height,
            })
        }
        _ => None,
    }
}

fn valid_dimensions(width: u32, height: u32) -> bool {
    width > 0 && height > 0 && width <= MAX_GRAPHIC_DIMENSION && height <= MAX_GRAPHIC_DIMENSION
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

fn decode_sixel_to_rgba(payload: &[u8]) -> Option<(Vec<u8>, u32, u32)> {
    let final_index = payload
        .iter()
        .position(|byte| (0x40..=0x7e).contains(byte))?;
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
    pixels: Vec<u8>,
    buffer_width: u32,
    buffer_height: u32,
    invalid: bool,
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
            pixels: Vec::new(),
            buffer_width: 0,
            buffer_height: 0,
            invalid: false,
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

        if self.invalid {
            return None;
        }
        let width = self.declared_width.max(self.max_x.saturating_add(1));
        let height = self.declared_height.max(self.max_y.saturating_add(1));
        if !valid_dimensions(width, height) {
            return None;
        }

        let len = rgba_len(width, height)?;
        let mut rgba = vec![0; len];
        let copy_width = width.min(self.buffer_width);
        let copy_height = height.min(self.buffer_height);
        for y in 0..copy_height {
            let source = (y as usize)
                .checked_mul(self.buffer_width as usize)?
                .checked_mul(4)?;
            let dest = (y as usize).checked_mul(width as usize)?.checked_mul(4)?;
            let len = (copy_width as usize).checked_mul(4)?;
            rgba[dest..dest + len].copy_from_slice(&self.pixels[source..source + len]);
        }

        Some((rgba, width, height))
    }

    fn draw_sixel_byte(&mut self, byte: u8, repeat: u32) {
        if self.invalid || !(0x3f..=0x7e).contains(&byte) {
            return;
        }
        let bits = byte - 0x3f;
        let repeat = repeat.max(1);
        let remaining = MAX_GRAPHIC_DIMENSION.saturating_sub(self.x);
        if repeat > remaining {
            self.invalid = true;
            return;
        }
        let color = self
            .palette
            .get(&self.current_color)
            .copied()
            .unwrap_or([255, 255, 255, 255]);
        for bit in 0..6 {
            if bits & (1 << bit) != 0 {
                self.fill_horizontal_run(self.x, self.y + bit, repeat, color);
            }
        }
        self.x = self.x.saturating_add(repeat);
    }

    fn fill_horizontal_run(&mut self, start_x: u32, y: u32, width: u32, color: [u8; 4]) {
        if width == 0 {
            return;
        }
        let Some(end_x) = start_x.checked_add(width - 1) else {
            self.invalid = true;
            return;
        };
        if !self.ensure_buffer(end_x + 1, y + 1) {
            return;
        }
        let Some(row_start) = (y as usize)
            .checked_mul(self.buffer_width as usize)
            .and_then(|row| row.checked_add(start_x as usize))
            .and_then(|pixel| pixel.checked_mul(4))
        else {
            self.invalid = true;
            return;
        };
        for x in 0..width as usize {
            let offset = row_start + x * 4;
            self.pixels[offset..offset + 4].copy_from_slice(&color);
        }
        self.max_x = self.max_x.max(end_x);
        self.max_y = self.max_y.max(y);
    }

    fn ensure_buffer(&mut self, width: u32, height: u32) -> bool {
        if !valid_dimensions(width, height) {
            self.invalid = true;
            return false;
        }
        if width <= self.buffer_width && height <= self.buffer_height {
            return true;
        }

        let new_width = grow_dimension(self.buffer_width, width);
        let new_height = grow_dimension(self.buffer_height, height);
        let Some(len) = rgba_len(new_width, new_height) else {
            self.invalid = true;
            return false;
        };
        let mut grown = vec![0; len];
        for y in 0..self.buffer_height {
            let source = (y as usize)
                .saturating_mul(self.buffer_width as usize)
                .saturating_mul(4);
            let dest = (y as usize)
                .saturating_mul(new_width as usize)
                .saturating_mul(4);
            let len = (self.buffer_width as usize).saturating_mul(4);
            grown[dest..dest + len].copy_from_slice(&self.pixels[source..source + len]);
        }
        self.pixels = grown;
        self.buffer_width = new_width;
        self.buffer_height = new_height;
        true
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
        self.palette.insert(
            self.current_color,
            [to_byte(r), to_byte(g), to_byte(b), 255],
        );
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
            if width > MAX_GRAPHIC_DIMENSION {
                self.invalid = true;
            } else {
                self.declared_width = width;
            }
        }
        if data.get(*index) == Some(&b';') {
            *index += 1;
        }
        if let Some(height) = parse_decimal(data, index) {
            if height > MAX_GRAPHIC_DIMENSION {
                self.invalid = true;
            } else {
                self.declared_height = height;
            }
        }
    }
}

fn grow_dimension(current: u32, required: u32) -> u32 {
    let mut value = current.max(1);
    while value < required {
        value = value.saturating_mul(2).min(MAX_GRAPHIC_DIMENSION);
    }
    value
}

fn rgba_len(width: u32, height: u32) -> Option<usize> {
    width
        .checked_mul(height)?
        .checked_mul(4)
        .map(|len| len as usize)
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
    use std::io::Cursor;

    use image::{DynamicImage, ImageFormat, RgbaImage};

    fn encode_rgba_image_to_png(image: RgbaImage) -> Option<Vec<u8>> {
        let mut png = Vec::new();
        DynamicImage::ImageRgba8(image)
            .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
            .ok()?;
        Some(png)
    }

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
        assert_eq!((graphic.width_px, graphic.height_px), (2, 2));
        assert_eq!(graphic.rgba.len(), 16);
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
        assert_eq!((graphic.width_px, graphic.height_px), (2, 2));
        assert_eq!(graphic.rgba.len(), 16);
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
        assert_eq!((graphic.width_px, graphic.height_px), (2, 2));
        assert_eq!(graphic.rgba.len(), 16);
    }

    #[test]
    fn kitty_raw_rgb_payload_is_stored_as_rgba() {
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
        assert_eq!((graphic.width_px, graphic.height_px), (2, 1));
        assert_eq!(graphic.rgba, vec![255_u8, 0, 0, 255, 0, 255, 0, 255]);
    }

    #[test]
    fn sixel_payload_decodes_to_rgba_graphic() {
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
        assert_eq!((graphic.width_px, graphic.height_px), (2, 6));
        assert_eq!(graphic.rgba.len(), 2 * 6 * 4);
    }

    #[test]
    fn sixel_repeat_that_exceeds_max_dimension_is_rejected() {
        let mut state = TerminalGraphicsState::default();
        let update = state.handle_event(GraphicsData {
            protocol: GraphicsProtocol::Sixel,
            row: 0,
            col: 0,
            payload: br#"q!1000000~"#.to_vec(),
        });

        assert!(update.is_none());
    }
}
