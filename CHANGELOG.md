# Changelog

This project follows Keep a Changelog and Semantic Versioning.

## [0.5.8] - 2026-08-04

### Added

- Automated tests for tag migration and merge behavior.
- Installer and portable artifacts in Windows CI.
- Tagged GitHub Release publishing with SHA-256 checksums.
- CodeQL scanning and monthly Dependabot updates.

### Changed

- Legacy Russian default tags now migrate to English names without losing image links.
- README navigation, build status, release, and license badges.
- Vulnerable transitive build dependencies updated.

## [0.5.7] - 2026-08-03

### Added

- Six polished sample images for every new empty library.
- English sample tags: Reference, UI, Work, Illustration, Mood, and Inspiration.
- First-run initialization that never restores samples after the user removes them.

### Changed

- GitHub README rebuilt as an English product narrative with full-width visuals.
- Release assets and source archive prepared for GitHub publication.

## [0.5.6] - 2026-08-03

### Added

- MIT License.
- Local security checks and GitHub Actions for Windows builds.
- GitHub documentation, issue templates, and a release checklist.
- UI quality assurance at the 760x560 minimum window size.

### Changed

- Electron renderer moved into the sandbox.
- New windows, renderer navigation, and permissions are denied by default.
- Image imports, backups, settings, tags, and IPC parameters are validated.
- Unused legacy assets are excluded from packaged builds.

### Security

- Maximum image size set to 200 MB.
- SVG and files with mismatched MIME signatures are rejected.
- Backup extraction and settings import limits added.

## [0.5.5] - 2026-08-02

- Added a two-second animated splash screen.
- Unified the title bar and added theme-aware system icons.
- Fixed context menu positioning.
- Added selected-area and window capture modes.
