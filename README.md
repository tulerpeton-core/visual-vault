# Visual Vault

A private, local-first visual library for screenshots and image references.

[![Windows build](https://github.com/tulerpeton-core/visual-vault/actions/workflows/windows-build.yml/badge.svg)](https://github.com/tulerpeton-core/visual-vault/actions/workflows/windows-build.yml)
[![CodeQL](https://github.com/tulerpeton-core/visual-vault/actions/workflows/codeql.yml/badge.svg)](https://github.com/tulerpeton-core/visual-vault/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/tulerpeton-core/visual-vault?display_name=tag)](https://github.com/tulerpeton-core/visual-vault/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-7C5CFC.svg)](LICENSE)

![Visual Vault product preview](docs/screenshots/visual-vault-github-cover.png)

**[Download Visual Vault](https://github.com/tulerpeton-core/visual-vault/releases/latest)** · [Features](#features) · [Privacy](#data-and-privacy) · [Build](#build-from-source) · [Changelog](CHANGELOG.md)

Visual Vault keeps screenshots, design references, and copied images in one searchable library. Your images, tags, and SQLite database stay on your computer.

## Keep every reference in one place

![Visual Vault dark library with tagged sample images](docs/screenshots/github-visuals-v3/generated/02-library-dark.png)

Start with a polished sample library, then replace it with your own material. Search, filter, sort, tag, favorite, rename, pin, or move images to trash without leaving the app.

## Capture exactly what you need

![Selected area, window, full screen, and clipboard capture modes](docs/screenshots/github-visuals-v3/generated/03-capture.png)

Capture a selected area, an open window, the full screen, or an image from the clipboard. The default global shortcut is `Ctrl+Shift+V`.

## Work in light or dark mode

![Visual Vault light and dark themes](docs/screenshots/github-visuals-v3/generated/04-light-dark.png)

Both themes use the same layout and controls. System, tray, and taskbar icons adapt to the active theme.

## Move from capture to reference

![Capture, save, tag, and pin workflow](docs/screenshots/github-visuals-v3/generated/05-workflow.png)

Capture an image, save it to the library, organize it with tags, and pin it above other windows when you need a persistent reference.

## Local by design

![Local storage architecture with no account, telemetry, or cloud requirement](docs/screenshots/github-visuals-v3/generated/06-local-first.png)

Images, tags, settings, and the SQLite database remain on your PC. Visual Vault requires no account, sends no telemetry, and does not depend on cloud storage.

## Features

- Import PNG, JPEG, WebP, GIF, BMP, and AVIF files.
- Capture a selected area, window, full screen, or clipboard image.
- Search, filters, sorting, tags, favorites, trash, and batch actions.
- Pin reference images above other windows.
- Light and dark themes with English and Russian interface languages.
- Global capture shortcut and system tray mode.
- Backups, settings export, and SQLite integrity checks.
- Installer and portable distributions.

## Download

Download the installer or portable build from [GitHub Releases](https://github.com/tulerpeton-core/visual-vault/releases/latest).

Current prebuilt binaries support Windows 10/11 x64. The binaries are not code-signed, so Windows SmartScreen may display a warning. Verify downloads with the published `SHA256SUMS.txt` file.

## Data and privacy

The default library location is `%USERPROFILE%\Pictures\Visual Vault`:

```text
Visual Vault/
|-- vault.db
|-- originals/
`-- backups/
```

Portable mode runs without installation but intentionally uses the same Pictures library. Updating or moving the executable does not hide an existing collection.

## Build from source

Requirements: Node.js 22 or newer and npm.

```powershell
npm ci
npm run check
npm start
```

Build Windows distributions:

```powershell
npm run dist:portable
npm run dist
```

Outputs:

- `release-portable/Visual-Vault-Portable-0.5.8.exe`
- `release-v3-final/Visual-Vault-Setup-0.5.8.exe`

## Project documentation

- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Technical and UI/UX audit](docs/AUDIT_2026-08-03.md)
- [Security policy](SECURITY.md)
- [Contribution guide](CONTRIBUTING.md)

## License

Visual Vault is available under the [MIT License](LICENSE).
