use crate::action::LauncherChoice;
use crate::theme::{PANE_PADDING, TAB_BAR_HEIGHT};
use crate::tide_core::{Rect, Size, Vec2};

use super::raster_icons::{FLATICON_BROWSER, FLATICON_DOCK_CONTEXT};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LauncherIcon {
    Terminal,
    NewFile,
    OpenFile,
    Browser,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LauncherChoiceSpec {
    pub choice: LauncherChoice,
    pub hotkey: &'static str,
    pub label: &'static str,
    pub icon: LauncherIcon,
}

pub(crate) const LAUNCHER_CHOICES: [LauncherChoiceSpec; 4] = [
    LauncherChoiceSpec {
        choice: LauncherChoice::Terminal,
        hotkey: "T",
        label: "Terminal",
        icon: LauncherIcon::Terminal,
    },
    LauncherChoiceSpec {
        choice: LauncherChoice::NewFile,
        hotkey: "E",
        label: "New File",
        icon: LauncherIcon::NewFile,
    },
    LauncherChoiceSpec {
        choice: LauncherChoice::OpenFile,
        hotkey: "O",
        label: "Open File",
        icon: LauncherIcon::OpenFile,
    },
    LauncherChoiceSpec {
        choice: LauncherChoice::Browser,
        hotkey: "B",
        label: "Browser",
        icon: LauncherIcon::Browser,
    },
];

pub(crate) fn launcher_icon_raster_icon_asset(
    icon: LauncherIcon,
) -> Option<&'static crate::tide_renderer::RasterIconAsset> {
    match icon {
        LauncherIcon::NewFile => Some(&FLATICON_DOCK_CONTEXT),
        LauncherIcon::Browser => Some(&FLATICON_BROWSER),
        LauncherIcon::Terminal | LauncherIcon::OpenFile => None,
    }
}

pub(crate) fn launcher_content_rect(pane_rect: Rect) -> Rect {
    crate::pane::pane_content_rect(pane_rect, TAB_BAR_HEIGHT)
}

pub(crate) fn launcher_choice_rects(inner: Rect, cell_size: Size) -> Vec<(LauncherChoice, Rect)> {
    let row_h = (cell_size.height * 2.25).max(34.0);
    let row_gap = (cell_size.height * 0.45).max(7.0);
    let max_w = (inner.width - PANE_PADDING * 2.0).max(0.0);
    let row_w = (cell_size.width * 30.0)
        .min(max_w)
        .max(max_w.min(cell_size.width * 18.0));
    let block_h =
        LAUNCHER_CHOICES.len() as f32 * row_h + (LAUNCHER_CHOICES.len() - 1) as f32 * row_gap;
    let start_y = inner.y + ((inner.height - block_h) / 2.0).max(PANE_PADDING);
    let x = inner.x + ((inner.width - row_w) / 2.0).max(PANE_PADDING);

    LAUNCHER_CHOICES
        .iter()
        .enumerate()
        .map(|(index, spec)| {
            (
                spec.choice,
                Rect::new(x, start_y + index as f32 * (row_h + row_gap), row_w, row_h),
            )
        })
        .collect()
}

pub(crate) fn launcher_choice_at(
    inner: Rect,
    cell_size: Size,
    pos: Vec2,
) -> Option<LauncherChoice> {
    launcher_choice_rects(inner, cell_size)
        .into_iter()
        .find_map(|(choice, rect)| rect.contains(pos).then_some(choice))
}

pub(crate) fn launcher_choice_rect(
    inner: Rect,
    cell_size: Size,
    choice: LauncherChoice,
) -> Option<Rect> {
    launcher_choice_rects(inner, cell_size)
        .into_iter()
        .find_map(|(candidate, rect)| (candidate == choice).then_some(rect))
}
