//! Project-local Tide configuration discovery and parsing.
//!
//! This is intentionally read-only. Tide exposes project actions and workspace
//! presets to the workbench, but does not execute them implicitly.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub(crate) const PROJECT_CONFIG_RELATIVE_PATH: &str = ".tide/workspace.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub(crate) struct ProjectLocalConfig {
    #[serde(default)]
    pub workspaces: Vec<ProjectWorkspacePreset>,
    #[serde(default)]
    pub actions: Vec<ProjectActionPreset>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub(crate) struct ProjectWorkspacePreset {
    pub name: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub agent: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub(crate) struct ProjectActionPreset {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LoadedProjectConfig {
    pub root: PathBuf,
    pub path: PathBuf,
    pub config: ProjectLocalConfig,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ProjectConfigLoad {
    Loaded(LoadedProjectConfig),
    Invalid {
        start: Option<PathBuf>,
        root: PathBuf,
        path: PathBuf,
        error: String,
    },
    NotFound {
        start: Option<PathBuf>,
    },
}

pub(crate) fn discover_project_config_path(start: &Path) -> Option<PathBuf> {
    let mut current = start.to_path_buf();

    loop {
        let candidate = current.join(PROJECT_CONFIG_RELATIVE_PATH);
        if candidate.is_file() {
            return Some(candidate);
        }

        if !current.pop() {
            return None;
        }
    }
}

fn project_root_for_config_path(path: &Path) -> PathBuf {
    path.parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

pub(crate) fn load_project_config_for_start(start: Option<&Path>) -> ProjectConfigLoad {
    let start_path = start
        .map(Path::to_path_buf)
        .or_else(|| std::env::current_dir().ok());

    let Some(ref start_path) = start_path else {
        return ProjectConfigLoad::NotFound { start: None };
    };

    let Some(path) = discover_project_config_path(start_path) else {
        return ProjectConfigLoad::NotFound {
            start: Some(start_path.clone()),
        };
    };

    let root = project_root_for_config_path(&path);
    let data = match std::fs::read_to_string(&path) {
        Ok(data) => data,
        Err(err) => {
            return ProjectConfigLoad::Invalid {
                start: Some(start_path.clone()),
                root,
                path,
                error: format!("failed to read project config: {err}"),
            };
        }
    };

    match serde_json::from_str::<ProjectLocalConfig>(&data) {
        Ok(config) => ProjectConfigLoad::Loaded(LoadedProjectConfig { root, path, config }),
        Err(err) => ProjectConfigLoad::Invalid {
            start: Some(start_path.clone()),
            root,
            path,
            error: format!("failed to parse project config JSON: {err}"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_config_parses_workspace_and_action_presets() {
        let config: ProjectLocalConfig = serde_json::from_str(
            r#"{
                "workspaces": [
                    {
                        "name": "Dev",
                        "cwd": ".",
                        "command": "npm run dev",
                        "agent": "codex"
                    }
                ],
                "actions": [
                    {
                        "name": "test",
                        "description": "Run focused tests",
                        "command": "cargo test -p tide-app tide_mcp_runtime",
                        "cwd": "apps/terminal"
                    }
                ]
            }"#,
        )
        .expect("project config parses");

        assert_eq!(config.workspaces.len(), 1);
        assert_eq!(config.workspaces[0].name, "Dev");
        assert_eq!(config.workspaces[0].agent.as_deref(), Some("codex"));
        assert_eq!(config.actions.len(), 1);
        assert_eq!(config.actions[0].name, "test");
        assert_eq!(
            config.actions[0].command,
            "cargo test -p tide-app tide_mcp_runtime"
        );
    }
}
