use crate::tide_core::{Rect, Renderer, TextStyle, Vec2};

use crate::theme::*;
use crate::App;
use crate::AppCorePort;

use super::super::raster_icons::FLATICON_OPEN_EXTERNAL;
use super::super::svg_icons::{
    svg_icon_palette, SVG_ICON_CONNECT, SVG_ICON_DELETE, SVG_ICON_FILE_TREE, SVG_ICON_FOLDER,
    SVG_ICON_RENAME, SVG_ICON_TERMINAL,
};
use super::draw_popup_rounded_bg;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ContextMenuIcon {
    Folder,
    Terminal,
    OpenExternal,
    Rename,
    Delete,
    Definition,
    References,
}

pub(crate) fn context_menu_icon(action: crate::ContextMenuAction) -> ContextMenuIcon {
    match action {
        crate::ContextMenuAction::CdHere => ContextMenuIcon::Folder,
        crate::ContextMenuAction::OpenTerminalHere => ContextMenuIcon::Terminal,
        crate::ContextMenuAction::OpenApp | crate::ContextMenuAction::RevealInFinder => {
            ContextMenuIcon::OpenExternal
        }
        crate::ContextMenuAction::Rename => ContextMenuIcon::Rename,
        crate::ContextMenuAction::Delete => ContextMenuIcon::Delete,
        crate::ContextMenuAction::GoToDefinition => ContextMenuIcon::Definition,
        crate::ContextMenuAction::FindReferences => ContextMenuIcon::References,
    }
}

pub(crate) fn context_menu_icon_text_glyph(_icon: ContextMenuIcon) -> Option<&'static str> {
    None
}

pub(crate) fn context_menu_raster_icon_asset(
    icon: ContextMenuIcon,
) -> Option<&'static crate::tide_renderer::RasterIconAsset> {
    match icon {
        ContextMenuIcon::OpenExternal => Some(&FLATICON_OPEN_EXTERNAL),
        _ => None,
    }
}

fn render_context_menu_icon(
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    icon: ContextMenuIcon,
    rect: Rect,
    color: crate::tide_core::Color,
) {
    if context_menu_icon_text_glyph(icon).is_some() {
        return;
    }

    let icon_w = 13.0_f32;
    let icon_h = 13.0_f32;
    let x = (rect.x + (rect.width - icon_w) / 2.0).round();
    let y = (rect.y + (rect.height - icon_h) / 2.0).round();
    let icon_rect = Rect::new(x, y, icon_w, icon_h);
    if let Some(asset) = context_menu_raster_icon_asset(icon) {
        renderer.draw_top_raster_icon(asset, icon_rect, color);
        return;
    }

    let secondary = crate::tide_core::Color::new(color.r, color.g, color.b, color.a * 0.56);
    let svg = match icon {
        ContextMenuIcon::Folder => SVG_ICON_FOLDER,
        ContextMenuIcon::Terminal => SVG_ICON_TERMINAL,
        ContextMenuIcon::Rename => SVG_ICON_RENAME,
        ContextMenuIcon::Delete => SVG_ICON_DELETE,
        ContextMenuIcon::Definition => SVG_ICON_FILE_TREE,
        ContextMenuIcon::References => SVG_ICON_CONNECT,
        ContextMenuIcon::OpenExternal => return,
    };
    renderer.draw_top_svg_icon(svg, icon_rect, svg_icon_palette(color, secondary));
}

/// Render context menu popup (right-click on file tree).
pub(super) fn render_context_menu(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
) {
    let menu = match app.modal.context_menu {
        Some(ref m) => m,
        None => return,
    };

    let cell_size = renderer.cell_size();
    let cell_height = cell_size.height;
    let logical = app.logical_size();
    let rect = menu.geometry(cell_height, logical.width, logical.height);
    let line_height = cell_height + POPUP_LINE_EXTRA;

    // Background + border (rounded)
    draw_popup_rounded_bg(
        renderer,
        rect,
        p.popup_bg,
        p.popup_border,
        POPUP_CORNER_RADIUS,
    );

    // Items
    let actions = menu.items();
    for (i, action) in actions.iter().enumerate() {
        let y = rect.y + 4.0 + i as f32 * line_height;

        // Selected highlight
        if i == menu.selected {
            let sel_rect = Rect::new(
                rect.x + POPUP_SELECTED_INSET,
                y,
                rect.width - 2.0 * POPUP_SELECTED_INSET,
                line_height,
            );
            renderer.draw_top_rect(sel_rect, p.popup_selected);
        }

        let item_x = rect.x + POPUP_TEXT_INSET;
        let item_y = y + (line_height - cell_height) / 2.0;
        let item_clip = Rect::new(rect.x, y, rect.width, line_height);

        // Icon
        render_context_menu_icon(
            renderer,
            context_menu_icon(*action),
            Rect::new(item_x, y, 2.0 * cell_size.width, line_height),
            p.tree_icon,
        );

        // Label
        let label_x = item_x + 2.5 * cell_size.width;
        let label_color = if i == menu.selected {
            p.tab_text_focused
        } else {
            p.tree_text
        };
        let label_style = TextStyle {
            foreground: label_color,
            background: None,
            bold: i == menu.selected,
            dim: false,
            italic: false,
            underline: false,
        };
        renderer.draw_top_text(
            action.label(),
            Vec2::new(label_x, item_y),
            label_style,
            item_clip,
        );
    }
}
