# Install, Update, Signing, And Source Build

This page defines the current distribution contract for Tide Terminal. It keeps
human downloads, future updater metadata, signing, notarization, and local source
builds separate so the product does not overclaim.

## User Install

The canonical human-facing install path is the Tide Terminal DMG attached to
this repository's `v*` GitHub Releases.

1. Download the latest `Tide-Terminal-${VERSION}.dmg`.
2. Open the DMG.
3. Drag **Tide Terminal.app** into `/Applications`.
4. Launch Tide Terminal from Applications.

Release DMGs are expected to be signed, notarized, and stapled so macOS
Gatekeeper accepts them without asking the user to bypass security prompts.

## Update Expectations

Tide Terminal has a product-specific update feed, but this does not yet mean the
app claims a complete in-app auto-updater UX.

Current contract:

- The monorepo `v*` GitHub Release remains the canonical human download.
- The release workflow also publishes the final DMG plus `latest-mac.json` to
  the Terminal Releases Repo: `eatnug/tide-terminal-releases`.
- `latest-mac.json` includes product name, version, artifact name, file size,
  SHA-256, release URL, and download URL.
- The Terminal Update Feed exists so a future Tide Terminal updater client does
  not need to filter mixed monorepo release history.
- Runtime updater behavior and UI are not current public claims until a
  dedicated updater client is specified and implemented.

See [Spec: Terminal Update Feed](specs/terminal-update-feed.md).

## Signing And Notarization

The GitHub release workflow for Tide Terminal is `.github/workflows/release.yml`.
On `v*` tags it:

1. Runs from `apps/terminal`.
2. Installs Rust and `cargo-bundle`.
3. Builds the app bundle with:

   ```bash
   cargo bundle --profile dist -p tide-app
   ```

4. Imports the Developer ID Application certificate from GitHub Actions secrets.
5. Codesigns `target/dist/bundle/osx/Tide Terminal.app` with hardened runtime
   and `scripts/entitlements.plist`.
6. Creates `Tide-Terminal-${VERSION}.dmg`.
7. Codesigns the DMG.
8. Notarizes the DMG with `xcrun notarytool`.
9. Staples the notarization ticket.
10. Builds `latest-mac.json`.
11. Publishes DMG + metadata to `eatnug/tide-terminal-releases`.
12. Publishes the DMG to this repository's `v*` GitHub Release.

The app bundle identifier is:

```text
com.eatnug.tide-terminal
```

## Local Source Build

Run source-build commands from `apps/terminal`, not from the monorepo root.

For development:

```bash
cargo run -p tide-app
```

For a local `.app` bundle:

```bash
./scripts/build-app.sh
```

`build-app.sh` runs `cargo bundle --release -p tide-app`, applies the local
Info.plist fixups, and ad-hoc signs the app bundle with `codesign --sign -`.
The output path is:

```text
apps/terminal/target/release/bundle/osx/Tide Terminal.app
```

This local `.app` is for development and local smoke testing. It is not the same
trust claim as the signed and notarized release DMG.

## Local DMG Build

Maintainers with a Developer ID Application certificate and notarization
credentials can build a local distribution-style DMG:

```bash
./scripts/build-dmg.sh
```

Useful variants:

```bash
./scripts/build-dmg.sh --skip-build
./scripts/build-dmg.sh --no-notarize
```

`--no-notarize` is useful for local packaging checks, but the resulting DMG is
not equivalent to a release DMG.

## Release Checklist

Before presenting a release as a public Tide Terminal release:

- The tag is a `v*` tag.
- The GitHub Actions release workflow completed successfully.
- The human-facing monorepo release contains `Tide-Terminal-${VERSION}.dmg`.
- The Terminal Releases Repo contains the same final DMG and `latest-mac.json`.
- The DMG was signed, notarized, and stapled.
- The release notes do not claim unsupported terminal, Browser, remote, or
  updater behavior.

## Non-Claims

Tide Terminal does not currently claim:

- A complete in-app auto-updater UX.
- A package-manager install path such as Homebrew.
- Windows or Linux binaries.
- Unsigned release artifacts as public distribution builds.
- A Tide-specific terminfo install/update path.

See [Known Limitations](known-limitations.md) for the broader product boundary.
