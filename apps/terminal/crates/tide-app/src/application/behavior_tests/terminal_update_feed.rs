// Spec: docs/specs/terminal-update-feed.md

use std::fs;
use std::process::Command;

// --- UC-1: PublishCanonicalTerminalDownload ---

#[test]
fn terminal_release_workflow_keeps_the_monorepo_download_release() {
    // UC-1 BR-1, BR-2: The v* terminal release remains the human-facing monorepo download release.
    let workflow = include_str!("../../../../../../../.github/workflows/release.yml");

    assert!(
        workflow.contains("- \"v*\""),
        "expected terminal releases to keep using v* tags"
    );
    assert!(
        workflow.contains("GH_TOKEN: ${{ github.token }}"),
        "expected the monorepo download release to use the default github.token"
    );
    assert!(
        workflow.contains("gh release create \"$GITHUB_REF_NAME\""),
        "expected the workflow to keep creating the monorepo release from the pushed tag"
    );
    assert!(
        workflow.contains("\"target/dist/Tide-Terminal-${VERSION}.dmg\""),
        "expected the monorepo release to attach the Tide Terminal DMG"
    );
}

// --- UC-2: PublishTerminalUpdateFeed ---

#[test]
fn terminal_release_workflow_publishes_the_update_feed_to_the_dedicated_repo() {
    // UC-2 BR-3, BR-4, BR-5: The updater path publishes DMG + latest-mac.json to the dedicated Terminal Releases Repo.
    let workflow = include_str!("../../../../../../../.github/workflows/release.yml");

    assert!(
        workflow.contains("scripts/build-update-metadata.sh"),
        "expected the workflow to generate update metadata"
    );
    assert!(
        workflow.contains("TERMINAL_RELEASES_TOKEN"),
        "expected a dedicated PAT for the Terminal Releases Repo"
    );
    assert!(
        workflow.contains("--repo eatnug/tide-terminal-releases"),
        "expected the update feed to publish to the dedicated terminal releases repo"
    );
    assert!(
        workflow.contains("\"target/dist/latest-mac.json\""),
        "expected the update feed release to attach latest-mac.json"
    );
}

#[test]
fn terminal_update_metadata_script_writes_latest_mac_json() {
    // UC-2 BR-6: The metadata must include version, artifact name, size, SHA-256, release URL, and download URL.
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
