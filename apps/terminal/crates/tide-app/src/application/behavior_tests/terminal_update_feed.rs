// Spec: docs/specs/terminal-update-feed.md

#[cfg(unix)]
use std::fs;
#[cfg(unix)]
use std::process::Command;

const TERMINAL_RELEASE_WORKFLOW: &str =
    include_str!("../../../../../../../.github/workflows/release.yml");

fn workflow_step(name: &str) -> &'static str {
    let marker = format!("      - name: {}", name);
    let start = TERMINAL_RELEASE_WORKFLOW
        .find(&marker)
        .unwrap_or_else(|| panic!("missing workflow step: {}", name));
    let body = &TERMINAL_RELEASE_WORKFLOW[start..];
    let next_step = body[marker.len()..]
        .find("\n      - name:")
        .map(|offset| marker.len() + offset)
        .unwrap_or(body.len());
    &body[..next_step]
}

fn assert_contains_all(haystack: &str, expected: &[&str]) {
    for token in expected {
        assert!(
            haystack.contains(token),
            "expected workflow block to contain {token:?}\n\n{haystack}"
        );
    }
}

// --- UC-1: PublishCanonicalTerminalDownload ---

#[test]
fn terminal_release_workflow_keeps_the_monorepo_download_release() {
    // UC-1 BR-1, BR-2 / UC-2 BR-9: The v* terminal release remains the human-facing monorepo download release.
    let monorepo_release = workflow_step("Create GitHub Release");

    assert!(
        TERMINAL_RELEASE_WORKFLOW.contains("tags:") && TERMINAL_RELEASE_WORKFLOW.contains("\"v*\""),
        "expected terminal releases to keep using v* tags"
    );
    assert_contains_all(
        monorepo_release,
        &[
            "GH_TOKEN: ${{ github.token }}",
            "gh release create",
            "$GITHUB_REF_NAME",
            "target/dist/Tide-Terminal-${VERSION}.dmg",
        ],
    );
}

// --- UC-2: PublishTerminalUpdateFeed ---

#[test]
fn terminal_release_workflow_publishes_the_update_feed_to_the_dedicated_repo() {
    // UC-2 BR-3, BR-4, BR-5, BR-9: The updater path publishes DMG + latest-mac.json to the dedicated Terminal Releases Repo.
    let metadata_step = workflow_step("Build updater metadata");
    let updater_release =
        workflow_step("Publish updater feed to the dedicated terminal releases repo");

    assert_contains_all(
        metadata_step,
        &[
            "scripts/build-update-metadata.sh",
            "$VERSION",
            "target/dist",
        ],
    );
    assert_contains_all(
        updater_release,
        &[
            "DESKTOP_RELEASES_TOKEN",
            "gh release create",
            "target/dist/Tide-Terminal-${VERSION}.dmg",
            "target/dist/latest-mac.json",
            "--repo eatnug/tide-terminal-releases",
        ],
    );
}

#[test]
#[cfg(unix)]
fn terminal_update_metadata_script_writes_latest_mac_json() {
    // UC-2 BR-6, BR-8: The metadata must include version, artifact name, size, SHA-256, release URL, and download URL.
    let temp_dir = tempfile::tempdir().expect("create temp update metadata dir");
    let dmg_path = temp_dir.path().join("Tide-Terminal-9.8.7.dmg");
    fs::write(&dmg_path, b"fake notarized dmg").expect("write fake dmg");

    let script = format!(
        "{}/../../scripts/build-update-metadata.sh",
        env!("CARGO_MANIFEST_DIR")
    );
    let output = Command::new("bash")
        .arg(script)
        .arg("9.8.7")
        .arg(temp_dir.path())
        .output()
        .expect("run metadata script");

    assert!(
        output.status.success(),
        "metadata script failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let metadata = fs::read_to_string(temp_dir.path().join("latest-mac.json"))
        .expect("read generated metadata");

    assert!(metadata.contains("\"product\": \"Tide Terminal\""));
    assert!(metadata.contains("\"platform\": \"darwin\""));
    assert!(metadata.contains("\"version\": \"9.8.7\""));
    assert!(metadata.contains("\"artifact\": \"Tide-Terminal-9.8.7.dmg\""));
    assert!(metadata.contains("\"sizeBytes\": 18"));
    assert!(metadata.contains("\"sha256\":"));
    assert!(metadata.contains(
        "\"releaseUrl\": \"https://github.com/eatnug/tide-terminal-releases/releases/tag/v9.8.7\""
    ));
    assert!(metadata.contains(
        "\"downloadUrl\": \"https://github.com/eatnug/tide-terminal-releases/releases/download/v9.8.7/Tide-Terminal-9.8.7.dmg\""
    ));
}

#[test]
#[cfg(unix)]
fn terminal_update_metadata_script_reports_missing_default_version_cleanly() {
    // UC-2 BR-7: Missing default version discovery must reach the explicit version error under set -euo pipefail.
    let temp_dir = tempfile::tempdir().expect("create temp update metadata dir");
    let script_dir = temp_dir.path().join("scripts");
    fs::create_dir(&script_dir).expect("create script dir");
    let copied_script = script_dir.join("build-update-metadata.sh");
    fs::copy(
        format!(
            "{}/../../scripts/build-update-metadata.sh",
            env!("CARGO_MANIFEST_DIR")
        ),
        &copied_script,
    )
    .expect("copy metadata script");

    let output = Command::new("bash")
        .arg(copied_script)
        .output()
        .expect("run copied metadata script");

    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr)
            .contains("Could not determine Tide Terminal version"),
        "expected friendly version error, got stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}
