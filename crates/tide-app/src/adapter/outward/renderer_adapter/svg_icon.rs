use crate::tide_core::{Color, Rect};

use lyon::math::{point, vector, Angle, Point};
use lyon::path::builder::SvgPathBuilder;
use lyon::path::{ArcFlags, Path};
use lyon::tessellation::geometry_builder::{BuffersBuilder, VertexBuffers};
use lyon::tessellation::{
    FillOptions, FillTessellator, FillVertex, LineCap, LineJoin, StrokeOptions, StrokeTessellator,
    StrokeVertex,
};
use svgtypes::{PathParser, PathSegment, PointsParser};

use super::vertex::RectVertex;
use super::WgpuRenderer;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct SvgIconPalette {
    pub primary: Color,
    pub secondary: Color,
}

#[derive(Debug, Clone, Copy)]
struct SvgViewBox {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

#[derive(Debug, Clone, Copy)]
struct SvgPaint {
    color: Color,
    opacity: f32,
}

impl WgpuRenderer {
    pub fn draw_chrome_svg_icon(&mut self, svg: &str, rect: Rect, palette: SvgIconPalette) {
        draw_svg_icon(
            &mut self.chrome_vector_vertices,
            &mut self.chrome_vector_indices,
            self.scale_factor,
            svg,
            rect,
            palette,
        );
    }

    pub fn draw_top_svg_icon(&mut self, svg: &str, rect: Rect, palette: SvgIconPalette) {
        draw_svg_icon(
            &mut self.top_rect_vertices,
            &mut self.top_rect_indices,
            self.scale_factor,
            svg,
            rect,
            palette,
        );
    }
}

fn draw_svg_icon(
    vertices: &mut Vec<RectVertex>,
    indices: &mut Vec<u32>,
    scale_factor: f32,
    svg: &str,
    rect: Rect,
    palette: SvgIconPalette,
) {
    let Ok(document) = roxmltree::Document::parse(svg) else {
        return;
    };
    let root = document.root_element();
    let view_box = parse_view_box(&root).unwrap_or(SvgViewBox {
        x: 0.0,
        y: 0.0,
        width: rect.width.max(1.0),
        height: rect.height.max(1.0),
    });

    for node in root.descendants().filter(|node| node.is_element()) {
        let tag = node.tag_name().name();
        if tag == "svg" || tag == "g" {
            continue;
        }

        let Some(path) = node_to_path(&node) else {
            continue;
        };

        if let Some(fill) = fill_paint(&node, palette) {
            tessellate_fill(
                vertices,
                indices,
                scale_factor,
                &path,
                view_box,
                rect,
                fill.color,
            );
        }

        if let Some(stroke) = stroke_paint(&node, palette) {
            let stroke_width = parse_attr_f32(&node, "stroke-width").unwrap_or(1.5);
            tessellate_stroke(
                vertices,
                indices,
                scale_factor,
                &path,
                view_box,
                rect,
                stroke.color,
                stroke_width,
                stroke_line_cap(&node),
                stroke_line_join(&node),
            );
        }
    }
}

fn tessellate_fill(
    vertices: &mut Vec<RectVertex>,
    indices: &mut Vec<u32>,
    scale_factor: f32,
    path: &Path,
    view_box: SvgViewBox,
    rect: Rect,
    color: Color,
) {
    let mut buffers: VertexBuffers<Point, u32> = VertexBuffers::new();
    let mut tessellator = FillTessellator::new();
    let options = FillOptions::DEFAULT;
    let mut builder = BuffersBuilder::new(&mut buffers, |vertex: FillVertex| vertex.position());

    if tessellator
        .tessellate_path(path, &options, &mut builder)
        .is_ok()
    {
        append_svg_geometry(
            vertices,
            indices,
            scale_factor,
            buffers,
            view_box,
            rect,
            color,
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn tessellate_stroke(
    vertices: &mut Vec<RectVertex>,
    indices: &mut Vec<u32>,
    scale_factor: f32,
    path: &Path,
    view_box: SvgViewBox,
    rect: Rect,
    color: Color,
    stroke_width: f32,
    line_cap: LineCap,
    line_join: LineJoin,
) {
    let mut buffers: VertexBuffers<Point, u32> = VertexBuffers::new();
    let mut tessellator = StrokeTessellator::new();
    let options = StrokeOptions::DEFAULT
        .with_line_width(stroke_width)
        .with_line_cap(line_cap)
        .with_line_join(line_join);
    let mut builder = BuffersBuilder::new(&mut buffers, |vertex: StrokeVertex| vertex.position());

    if tessellator
        .tessellate_path(path, &options, &mut builder)
        .is_ok()
    {
        append_svg_geometry(
            vertices,
            indices,
            scale_factor,
            buffers,
            view_box,
            rect,
            color,
        );
    }
}

fn append_svg_geometry(
    vertices: &mut Vec<RectVertex>,
    indices: &mut Vec<u32>,
    scale_factor: f32,
    buffers: VertexBuffers<Point, u32>,
    view_box: SvgViewBox,
    rect: Rect,
    color: Color,
) {
    let base = vertices.len() as u32;
    let icon_scale =
        (rect.width / view_box.width.max(1.0)).min(rect.height / view_box.height.max(1.0));
    let draw_w = view_box.width * icon_scale;
    let draw_h = view_box.height * icon_scale;
    let offset_x = rect.x + (rect.width - draw_w) * 0.5 - view_box.x * icon_scale;
    let offset_y = rect.y + (rect.height - draw_h) * 0.5 - view_box.y * icon_scale;
    let color = [color.r, color.g, color.b, color.a];

    for point in buffers.vertices {
        vertices.push(RectVertex {
            position: [
                (offset_x + point.x * icon_scale) * scale_factor,
                (offset_y + point.y * icon_scale) * scale_factor,
            ],
            color,
        });
    }

    indices.extend(buffers.indices.into_iter().map(|index| base + index));
}

fn node_to_path(node: &roxmltree::Node<'_, '_>) -> Option<Path> {
    match node.tag_name().name() {
        "path" => node.attribute("d").and_then(path_from_data),
        "rect" => Some(path_from_rect(node)?),
        "circle" => Some(path_from_circle(node)?),
        "line" => Some(path_from_line(node)?),
        "polyline" => Some(path_from_points(node, false)?),
        "polygon" => Some(path_from_points(node, true)?),
        _ => None,
    }
}

fn path_from_data(data: &str) -> Option<Path> {
    let mut builder = Path::builder().with_svg();
    for segment in PathParser::from(data) {
        match segment.ok()? {
            PathSegment::MoveTo { abs, x, y } => {
                if abs {
                    builder.move_to(point(x as f32, y as f32));
                } else {
                    builder.relative_move_to(vector(x as f32, y as f32));
                }
            }
            PathSegment::LineTo { abs, x, y } => {
                if abs {
                    builder.line_to(point(x as f32, y as f32));
                } else {
                    builder.relative_line_to(vector(x as f32, y as f32));
                }
            }
            PathSegment::HorizontalLineTo { abs, x } => {
                if abs {
                    builder.horizontal_line_to(x as f32);
                } else {
                    builder.relative_horizontal_line_to(x as f32);
                }
            }
            PathSegment::VerticalLineTo { abs, y } => {
                if abs {
                    builder.vertical_line_to(y as f32);
                } else {
                    builder.relative_vertical_line_to(y as f32);
                }
            }
            PathSegment::CurveTo {
                abs,
                x1,
                y1,
                x2,
                y2,
                x,
                y,
            } => {
                if abs {
                    builder.cubic_bezier_to(
                        point(x1 as f32, y1 as f32),
                        point(x2 as f32, y2 as f32),
                        point(x as f32, y as f32),
                    );
                } else {
                    builder.relative_cubic_bezier_to(
                        vector(x1 as f32, y1 as f32),
                        vector(x2 as f32, y2 as f32),
                        vector(x as f32, y as f32),
                    );
                }
            }
            PathSegment::SmoothCurveTo { abs, x2, y2, x, y } => {
                if abs {
                    builder.smooth_cubic_bezier_to(
                        point(x2 as f32, y2 as f32),
                        point(x as f32, y as f32),
                    );
                } else {
                    builder.smooth_relative_cubic_bezier_to(
                        vector(x2 as f32, y2 as f32),
                        vector(x as f32, y as f32),
                    );
                }
            }
            PathSegment::Quadratic { abs, x1, y1, x, y } => {
                if abs {
                    builder.quadratic_bezier_to(
                        point(x1 as f32, y1 as f32),
                        point(x as f32, y as f32),
                    );
                } else {
                    builder.relative_quadratic_bezier_to(
                        vector(x1 as f32, y1 as f32),
                        vector(x as f32, y as f32),
                    );
                }
            }
            PathSegment::SmoothQuadratic { abs, x, y } => {
                if abs {
                    builder.smooth_quadratic_bezier_to(point(x as f32, y as f32));
                } else {
                    builder.smooth_relative_quadratic_bezier_to(vector(x as f32, y as f32));
                }
            }
            PathSegment::EllipticalArc {
                abs,
                rx,
                ry,
                x_axis_rotation,
                large_arc,
                sweep,
                x,
                y,
            } => {
                let radii = vector(rx as f32, ry as f32);
                let flags = ArcFlags { large_arc, sweep };
                if abs {
                    builder.arc_to(
                        radii,
                        Angle::degrees(x_axis_rotation as f32),
                        flags,
                        point(x as f32, y as f32),
                    );
                } else {
                    builder.relative_arc_to(
                        radii,
                        Angle::degrees(x_axis_rotation as f32),
                        flags,
                        vector(x as f32, y as f32),
                    );
                }
            }
            PathSegment::ClosePath { .. } => builder.close(),
        }
    }

    Some(builder.build())
}

fn path_from_rect(node: &roxmltree::Node<'_, '_>) -> Option<Path> {
    let x = parse_attr_f32(node, "x").unwrap_or(0.0);
    let y = parse_attr_f32(node, "y").unwrap_or(0.0);
    let width = parse_attr_f32(node, "width")?;
    let height = parse_attr_f32(node, "height")?;

    let mut builder = Path::builder().with_svg();
    builder.move_to(point(x, y));
    builder.line_to(point(x + width, y));
    builder.line_to(point(x + width, y + height));
    builder.line_to(point(x, y + height));
    builder.close();
    Some(builder.build())
}

fn path_from_circle(node: &roxmltree::Node<'_, '_>) -> Option<Path> {
    let cx = parse_attr_f32(node, "cx").unwrap_or(0.0);
    let cy = parse_attr_f32(node, "cy").unwrap_or(0.0);
    let radius = parse_attr_f32(node, "r")?;

    let mut builder = Path::builder().with_svg();
    builder.move_to(point(cx + radius, cy));
    builder.arc_to(
        vector(radius, radius),
        Angle::degrees(0.0),
        ArcFlags {
            large_arc: true,
            sweep: true,
        },
        point(cx - radius, cy),
    );
    builder.arc_to(
        vector(radius, radius),
        Angle::degrees(0.0),
        ArcFlags {
            large_arc: true,
            sweep: true,
        },
        point(cx + radius, cy),
    );
    builder.close();
    Some(builder.build())
}

fn path_from_line(node: &roxmltree::Node<'_, '_>) -> Option<Path> {
    let x1 = parse_attr_f32(node, "x1").unwrap_or(0.0);
    let y1 = parse_attr_f32(node, "y1").unwrap_or(0.0);
    let x2 = parse_attr_f32(node, "x2").unwrap_or(0.0);
    let y2 = parse_attr_f32(node, "y2").unwrap_or(0.0);

    let mut builder = Path::builder().with_svg();
    builder.move_to(point(x1, y1));
    builder.line_to(point(x2, y2));
    Some(builder.build())
}

fn path_from_points(node: &roxmltree::Node<'_, '_>, close: bool) -> Option<Path> {
    let points = node.attribute("points")?;
    let mut parser = PointsParser::from(points);
    let first = parser.next()?;

    let mut builder = Path::builder().with_svg();
    builder.move_to(point(first.0 as f32, first.1 as f32));
    for (x, y) in parser {
        builder.line_to(point(x as f32, y as f32));
    }
    if close {
        builder.close();
    }
    Some(builder.build())
}

fn parse_view_box(root: &roxmltree::Node<'_, '_>) -> Option<SvgViewBox> {
    let view_box = root.attribute("viewBox")?;
    let values: Vec<f32> = view_box
        .split(|ch: char| ch.is_whitespace() || ch == ',')
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<f32>().ok())
        .collect();
    if values.len() != 4 {
        return None;
    }

    Some(SvgViewBox {
        x: values[0],
        y: values[1],
        width: values[2].max(1.0),
        height: values[3].max(1.0),
    })
}

fn fill_paint(node: &roxmltree::Node<'_, '_>, palette: SvgIconPalette) -> Option<SvgPaint> {
    let fill = node.attribute("fill").unwrap_or("none");
    if fill == "none" {
        return None;
    }
    let opacity = parse_opacity(node, "fill-opacity");
    let color = paint_color(node, palette);
    Some(SvgPaint {
        color: Color::new(color.r, color.g, color.b, color.a * opacity),
        opacity,
    })
}

fn stroke_paint(node: &roxmltree::Node<'_, '_>, palette: SvgIconPalette) -> Option<SvgPaint> {
    let stroke = node.attribute("stroke").unwrap_or("none");
    if stroke == "none" {
        return None;
    }
    let opacity = parse_opacity(node, "stroke-opacity");
    let color = paint_color(node, palette);
    Some(SvgPaint {
        color: Color::new(color.r, color.g, color.b, color.a * opacity),
        opacity,
    })
}

fn paint_color(node: &roxmltree::Node<'_, '_>, palette: SvgIconPalette) -> Color {
    match node.attribute("data-paint") {
        Some("secondary") => palette.secondary,
        _ => palette.primary,
    }
}

fn stroke_line_cap(node: &roxmltree::Node<'_, '_>) -> LineCap {
    match node.attribute("stroke-linecap") {
        Some("square") => LineCap::Square,
        Some("round") => LineCap::Round,
        _ => LineCap::Butt,
    }
}

fn stroke_line_join(node: &roxmltree::Node<'_, '_>) -> LineJoin {
    match node.attribute("stroke-linejoin") {
        Some("round") => LineJoin::Round,
        Some("bevel") => LineJoin::Bevel,
        _ => LineJoin::Miter,
    }
}

fn parse_opacity(node: &roxmltree::Node<'_, '_>, name: &str) -> f32 {
    parse_attr_f32(node, name).unwrap_or(1.0).clamp(0.0, 1.0)
}

fn parse_attr_f32(node: &roxmltree::Node<'_, '_>, name: &str) -> Option<f32> {
    node.attribute(name)?.parse::<f32>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn svg_icon_renderer_tessellates_stroked_path_into_vertices() {
        let svg = r#"
            <svg viewBox="0 0 16 16">
                <path d="M4 8 L12 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
        "#;
        let mut vertices = Vec::new();
        let mut indices = Vec::new();

        draw_svg_icon(
            &mut vertices,
            &mut indices,
            2.0,
            svg,
            Rect::new(0.0, 0.0, 16.0, 16.0),
            SvgIconPalette {
                primary: Color::new(1.0, 1.0, 1.0, 1.0),
                secondary: Color::new(1.0, 1.0, 1.0, 0.5),
            },
        );

        assert!(!vertices.is_empty());
        assert!(!indices.is_empty());
        assert!(vertices.iter().all(|vertex| vertex.position[0] >= 0.0));
    }

    #[test]
    fn svg_icon_renderer_supports_path_arc_commands() {
        let path = path_from_data("M8 2 A6 6 0 1 1 7.99 2").expect("path");
        let mut vertices = Vec::new();
        let mut indices = Vec::new();
        tessellate_stroke(
            &mut vertices,
            &mut indices,
            1.0,
            &path,
            SvgViewBox {
                x: 0.0,
                y: 0.0,
                width: 16.0,
                height: 16.0,
            },
            Rect::new(0.0, 0.0, 16.0, 16.0),
            Color::new(1.0, 1.0, 1.0, 1.0),
            1.5,
            LineCap::Round,
            LineJoin::Round,
        );

        assert!(!vertices.is_empty());
        assert!(!indices.is_empty());
    }
}
