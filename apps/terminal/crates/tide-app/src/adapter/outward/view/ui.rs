use std::collections::HashMap;

use crate::tide_core::PaneId;

use crate::pane::PaneKind;

// ──────────────────────────────────────────────
// Tab bar title
// ──────────────────────────────────────────────

pub(crate) fn pane_title(panes: &HashMap<PaneId, PaneKind>, id: PaneId) -> String {
    match panes.get(&id) {
        Some(PaneKind::Terminal(pane)) => {
            if let Some(title) = pane.context.osc_title.as_ref() {
                return title.clone();
            }
            if let Some(cwd) = pane.backend.detect_cwd_fallback() {
                let components: Vec<_> = cwd.components().collect();
                if components.len() <= 2 {
                    return cwd.display().to_string();
                } else {
                    let last_two: std::path::PathBuf =
                        components[components.len() - 2..].iter().collect();
                    return last_two.display().to_string();
                }
            }
            format!("Terminal {}", id)
        }
        Some(PaneKind::Editor(pane)) => pane.title(),
        Some(PaneKind::Diff(dp)) => format!("Git Changes ({})", dp.files.len()),
        Some(PaneKind::Browser(bp)) => bp.title(),
        Some(PaneKind::Launcher(_)) => "New Tab".to_string(),
        None => format!("Pane {}", id),
    }
}

// ──────────────────────────────────────────────
// Nerd Font file icons
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FileIconKind {
    FolderOpen,
    FolderClosed,
    AgentInstruction,
    Readme,
    License,
    Rust,
    RustConfig,
    JavaScript,
    React,
    TypeScript,
    Python,
    Markdown,
    Json,
    Config,
    Html,
    Css,
    Shell,
    Go,
    Ruby,
    Java,
    C,
    Cpp,
    Swift,
    Lua,
    Vim,
    Lock,
    Image,
    Pdf,
    Archive,
    Xml,
    Sql,
    Docker,
    Git,
    Generic,
}

impl FileIconKind {
    pub(crate) fn glyph(self) -> char {
        match self {
            FileIconKind::FolderOpen | FileIconKind::FolderClosed => '\u{f07b}',
            FileIconKind::AgentInstruction
            | FileIconKind::Readme
            | FileIconKind::License
            | FileIconKind::RustConfig
            | FileIconKind::Markdown
            | FileIconKind::Json
            | FileIconKind::Config
            | FileIconKind::Git
            | FileIconKind::Generic => '\u{f15c}',
            FileIconKind::Rust => '\u{e7a8}',
            FileIconKind::JavaScript => '\u{e74e}',
            FileIconKind::React => '\u{e7ba}',
            FileIconKind::TypeScript => '\u{e628}',
            FileIconKind::Python => '\u{e73c}',
            FileIconKind::Html => '\u{e736}',
            FileIconKind::Css => '\u{e749}',
            FileIconKind::Shell => '\u{e795}',
            FileIconKind::Go => '\u{e626}',
            FileIconKind::Ruby => '\u{e739}',
            FileIconKind::Java => '\u{e738}',
            FileIconKind::C => '\u{e61e}',
            FileIconKind::Cpp => '\u{e61d}',
            FileIconKind::Swift => '\u{e755}',
            FileIconKind::Lua => '\u{e620}',
            FileIconKind::Vim => '\u{e62b}',
            FileIconKind::Lock => '\u{f023}',
            FileIconKind::Image => '\u{f1c5}',
            FileIconKind::Pdf => '\u{f1c1}',
            FileIconKind::Archive => '\u{f1c6}',
            FileIconKind::Xml => '\u{e619}',
            FileIconKind::Sql => '\u{e706}',
            FileIconKind::Docker => '\u{e7b0}',
        }
    }
}

pub(crate) fn file_tree_disclosure(is_dir: bool, expanded: bool) -> Option<char> {
    if !is_dir {
        return None;
    }
    Some(if expanded { '\u{2304}' } else { '\u{203A}' })
}

pub(crate) fn file_icon(name: &str, is_dir: bool, expanded: bool) -> char {
    file_icon_kind(name, is_dir, expanded).glyph()
}

fn file_extension_icon_kind(name: &str) -> FileIconKind {
    // Per-extension Nerd Font icons
    let ext = name.rsplit('.').next().unwrap_or("");
    match ext {
        "rs" => FileIconKind::Rust,
        "js" | "mjs" => FileIconKind::JavaScript,
        "jsx" | "tsx" => FileIconKind::React,
        "ts" | "mts" => FileIconKind::TypeScript,
        "py" => FileIconKind::Python,
        "md" | "markdown" => FileIconKind::Markdown,
        "json" => FileIconKind::Json,
        "toml" | "yaml" | "yml" => FileIconKind::Config,
        "html" | "htm" => FileIconKind::Html,
        "css" | "scss" | "sass" | "less" => FileIconKind::Css,
        "sh" | "bash" | "zsh" | "fish" => FileIconKind::Shell,
        "go" => FileIconKind::Go,
        "rb" => FileIconKind::Ruby,
        "java" => FileIconKind::Java,
        "c" | "h" => FileIconKind::C,
        "cpp" | "cc" | "cxx" | "hpp" => FileIconKind::Cpp,
        "swift" => FileIconKind::Swift,
        "lua" => FileIconKind::Lua,
        "vim" => FileIconKind::Vim,
        "lock" => FileIconKind::Lock,
        "svg" | "png" | "jpg" | "jpeg" | "gif" | "webp" | "ico" => FileIconKind::Image,
        "pdf" => FileIconKind::Pdf,
        "zip" | "tar" | "gz" | "bz2" | "xz" => FileIconKind::Archive,
        "xml" => FileIconKind::Xml,
        "sql" => FileIconKind::Sql,
        "docker" => FileIconKind::Docker,
        "git" | "gitignore" | "gitmodules" => FileIconKind::Git,
        _ => FileIconKind::Generic,
    }
}

pub(crate) fn file_icon_kind(name: &str, is_dir: bool, expanded: bool) -> FileIconKind {
    if is_dir {
        return if expanded {
            FileIconKind::FolderOpen
        } else {
            FileIconKind::FolderClosed
        };
    }

    let lower = name.to_ascii_lowercase();
    match lower.as_str() {
        "agents.md" | "claude.md" | "gemini.md" => FileIconKind::AgentInstruction,
        "readme.md" | "readme" => FileIconKind::Readme,
        "license" | "license.md" => FileIconKind::License,
        "cargo.toml" => FileIconKind::RustConfig,
        "cargo.lock" => FileIconKind::Lock,
        ".gitignore" | ".gitmodules" => FileIconKind::Git,
        "dockerfile" => FileIconKind::Docker,
        _ => file_extension_icon_kind(&lower),
    }
}
