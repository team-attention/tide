// Settings persistence: global app configuration stored separately from session state.
// Uses platform-native config dir: e.g. ~/Library/Application Support/tide/settings.json
// on macOS, ~/.config/tide/settings.json on Linux.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TideSettings {
    #[serde(default)]
    pub worktree: WorktreeSettings,
    #[serde(default)]
    pub keybindings: Vec<KeybindingOverride>,
    #[serde(default = "default_true")]
    pub auto_integration: bool,
    #[serde(default)]
    pub appearance: AppearanceSettings,
    #[serde(default)]
    pub terminal: TerminalSettings,
    #[serde(default)]
    pub onboarding: OnboardingSettings,
}

fn default_true() -> bool {
    true
}

impl Default for TideSettings {
    fn default() -> Self {
        Self {
            worktree: WorktreeSettings::default(),
            keybindings: Vec::new(),
            auto_integration: true,
            appearance: AppearanceSettings::default(),
            terminal: TerminalSettings::default(),
            onboarding: OnboardingSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ThemePreference {
    Light,
    #[default]
    Dark,
}

impl ThemePreference {
    pub fn is_dark(self) -> bool {
        matches!(self, Self::Dark)
    }

    pub fn from_dark_mode(dark: bool) -> Self {
        if dark {
            Self::Dark
        } else {
            Self::Light
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum ThemePalettePreference {
    #[default]
    Tide,
    Graphite,
    Sage,
}

impl ThemePalettePreference {
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Tide => "Tide",
            Self::Graphite => "Graphite",
            Self::Sage => "Sage",
        }
    }

    pub fn next(self) -> Self {
        match self {
            Self::Tide => Self::Graphite,
            Self::Graphite => Self::Sage,
            Self::Sage => Self::Tide,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppearanceSettings {
    #[serde(default = "default_font_family")]
    pub font_family: String,
    #[serde(default = "default_font_size")]
    pub font_size: f32,
    #[serde(default)]
    pub theme: ThemePreference,
    #[serde(default)]
    pub palette: ThemePalettePreference,
}

fn default_font_family() -> String {
    "Menlo".to_string()
}

fn default_font_size() -> f32 {
    14.0
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            font_family: default_font_family(),
            font_size: default_font_size(),
            theme: ThemePreference::Dark,
            palette: ThemePalettePreference::Tide,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSettings {
    #[serde(default)]
    pub osc52_read: bool,
    #[serde(default = "default_scrollback_lines")]
    pub scrollback_lines: usize,
}

fn default_scrollback_lines() -> usize {
    crate::tide_terminal::DEFAULT_SCROLLBACK_LINES
}

impl Default for TerminalSettings {
    fn default() -> Self {
        Self {
            osc52_read: false,
            scrollback_lines: default_scrollback_lines(),
        }
    }
}

impl TerminalSettings {
    pub fn resolved_scrollback_lines(&self) -> usize {
        self.scrollback_lines
            .min(crate::tide_terminal::MAX_SCROLLBACK_LINES)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OnboardingSettings {
    #[serde(default)]
    pub first_run_guide_dismissed: bool,
}

/// A single keybinding override stored in settings.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeybindingOverride {
    pub action: String,
    pub key: String,
    #[serde(default)]
    pub shift: bool,
    #[serde(default)]
    pub ctrl: bool,
    #[serde(default)]
    pub meta: bool,
    #[serde(default)]
    pub alt: bool,
}

impl KeybindingOverride {
    /// Convert to a (Hotkey, GlobalAction) pair.
    pub fn to_binding(
        &self,
    ) -> Option<(crate::tide_input::Hotkey, crate::tide_input::GlobalAction)> {
        let action = crate::tide_input::GlobalAction::from_action_key(&self.action)?;
        let key = crate::tide_input::Hotkey::key_from_name(&self.key)?;
        let hotkey =
            crate::tide_input::Hotkey::new(key, self.shift, self.ctrl, self.meta, self.alt);
        Some((hotkey, action))
    }

    /// Create from a Hotkey and GlobalAction.
    pub fn from_binding(
        hotkey: &crate::tide_input::Hotkey,
        action: &crate::tide_input::GlobalAction,
    ) -> Self {
        Self {
            action: action.action_key().to_string(),
            key: hotkey.key_name(),
            shift: hotkey.shift,
            ctrl: hotkey.ctrl,
            meta: hotkey.meta,
            alt: hotkey.alt,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeSettings {
    /// Pattern for worktree base directory. Variables: {repo_root}, {branch}.
    /// Example: "{repo_root}.worktree/{branch}"
    #[serde(default)]
    pub base_dir_pattern: Option<String>,
    /// Files to copy from repo root to newly created worktrees.
    /// Relative paths, e.g. [".env", ".vscode/settings.json"]
    #[serde(default)]
    pub copy_files: Option<Vec<String>>,
}

impl Default for WorktreeSettings {
    fn default() -> Self {
        Self {
            base_dir_pattern: None,
            copy_files: None,
        }
    }
}

impl WorktreeSettings {
    /// Copy configured files from repo root into a newly created worktree.
    /// Logs errors but does not fail.
    pub fn copy_files_to_worktree(
        &self,
        repo_root: &std::path::Path,
        worktree_path: &std::path::Path,
    ) {
        let files = match &self.copy_files {
            Some(f) if !f.is_empty() => f,
            _ => return,
        };
        for rel in files {
            let src = repo_root.join(rel);
            let dst = worktree_path.join(rel);
            if !src.exists() {
                log::warn!("copy_files: source does not exist: {}", src.display());
                continue;
            }
            if let Some(parent) = dst.parent() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    log::error!(
                        "copy_files: failed to create dir {}: {}",
                        parent.display(),
                        e
                    );
                    continue;
                }
            }
            if let Err(e) = std::fs::copy(&src, &dst) {
                log::error!(
                    "copy_files: failed to copy {} -> {}: {}",
                    src.display(),
                    dst.display(),
                    e
                );
            }
        }
    }

    /// Compute the worktree path for a given branch name and repo root.
    pub fn compute_worktree_path(&self, repo_root: &std::path::Path, branch: &str) -> PathBuf {
        let sanitized_branch = branch.replace('/', "-");

        if let Some(ref pattern) = self.base_dir_pattern {
            let root_str = repo_root.to_string_lossy();
            let path_str = pattern
                .replace("{repo_root}", &root_str)
                .replace("{branch}", &sanitized_branch);
            PathBuf::from(path_str)
        } else {
            // Default: {repo_root}.worktree/{branch}
            let mut wt_dir = repo_root.as_os_str().to_owned();
            wt_dir.push(".worktree");
            PathBuf::from(wt_dir).join(&sanitized_branch)
        }
    }
}

fn settings_path() -> Option<PathBuf> {
    let config_dir = dirs::config_dir()?;
    Some(config_dir.join("tide-terminal").join("settings.json"))
}

pub fn load_settings() -> TideSettings {
    let path = match settings_path() {
        Some(p) => p,
        None => return TideSettings::default(),
    };

    match std::fs::read_to_string(&path) {
        Ok(data) => match serde_json::from_str(&data) {
            Ok(settings) => settings,
            Err(e) => {
                log::warn!("Failed to parse {}: {}", path.display(), e);
                TideSettings::default()
            }
        },
        Err(_) => TideSettings::default(),
    }
}

pub fn save_settings(settings: &TideSettings) {
    let path = match settings_path() {
        Some(p) => p,
        None => {
            log::warn!("Cannot determine settings path");
            return;
        }
    };

    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            log::error!("Failed to create config dir {}: {}", parent.display(), e);
            return;
        }
    }

    match serde_json::to_string_pretty(settings) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&path, json) {
                log::error!("Failed to write {}: {}", path.display(), e);
            }
        }
        Err(e) => {
            log::error!("Failed to serialize settings: {}", e);
        }
    }
}

/// Build a KeybindingMap from settings overrides.
pub fn build_keybinding_map(settings: &TideSettings) -> crate::tide_input::KeybindingMap {
    if settings.keybindings.is_empty() {
        return crate::tide_input::KeybindingMap::new();
    }
    let overrides: Vec<(crate::tide_input::Hotkey, crate::tide_input::GlobalAction)> = settings
        .keybindings
        .iter()
        .filter_map(|o| o.to_binding())
        .collect();
    crate::tide_input::KeybindingMap::with_overrides(overrides)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializing_legacy_settings_fills_appearance_and_terminal_defaults() {
        let settings: TideSettings =
            serde_json::from_str(r#"{"auto_integration":false}"#).expect("settings parse");

        assert!(!settings.auto_integration);
        assert_eq!(settings.appearance.font_family, "Menlo");
        assert!((settings.appearance.font_size - 14.0).abs() < f32::EPSILON);
        assert_eq!(settings.appearance.theme, ThemePreference::Dark);
        assert_eq!(settings.appearance.palette, ThemePalettePreference::Tide);
        assert!(!settings.terminal.osc52_read);
        assert_eq!(
            settings.terminal.scrollback_lines,
            crate::tide_terminal::DEFAULT_SCROLLBACK_LINES
        );
        assert!(!settings.onboarding.first_run_guide_dismissed);
    }

    #[test]
    fn deserializing_user_config_reads_appearance_and_terminal_settings() {
        let settings: TideSettings = serde_json::from_str(
            r#"{
                "appearance": {
                    "font_family": "JetBrains Mono",
                    "font_size": 16.0,
                    "theme": "light",
                    "palette": "graphite"
                },
                "terminal": {
                    "osc52_read": true,
                    "scrollback_lines": 20000
                },
                "onboarding": {
                    "first_run_guide_dismissed": true
                }
            }"#,
        )
        .expect("settings parse");

        assert_eq!(settings.appearance.font_family, "JetBrains Mono");
        assert!((settings.appearance.font_size - 16.0).abs() < f32::EPSILON);
        assert_eq!(settings.appearance.theme, ThemePreference::Light);
        assert_eq!(
            settings.appearance.palette,
            ThemePalettePreference::Graphite
        );
        assert!(settings.terminal.osc52_read);
        assert_eq!(settings.terminal.scrollback_lines, 20_000);
        assert!(settings.onboarding.first_run_guide_dismissed);
    }
}
