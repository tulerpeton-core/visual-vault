# Release checklist

## Repository setup

- [x] Add the MIT License at the repository root.
- [ ] Enable GitHub private vulnerability reporting.
- [ ] Configure branch protection for `main`.
- [ ] Purchase a Windows code-signing certificate and add signing secrets to GitHub Actions.

## Every release

- [ ] Update `package.json`, `package-lock.json`, and `CHANGELOG.md`.
- [ ] Run `npm ci` and `npm run check`.
- [ ] Run `npm audit --omit=dev`.
- [ ] Verify light and dark themes, English and Russian interface modes, 760x560, and 1200x820.
- [ ] Verify the two-second splash, title bar, and area, window, full-screen, and clipboard capture.
- [ ] Verify import, duplicate detection, tags, rename, favorite, trash, restore, and backup.
- [ ] Run the database integrity check from Settings.
- [ ] Build with `npm run dist:portable` and `npm run dist`.
- [ ] Check `Get-AuthenticodeSignature` for both EXE files.
- [ ] Generate SHA-256 checksums with `Get-FileHash <exe> -Algorithm SHA256`.
- [ ] Install on a clean Windows VM and launch the portable build without installation.
- [ ] Verify Windows scaling at 100%, 125%, and 150%, plus multi-monitor capture.
- [ ] Create tag `vX.Y.Z` and confirm GitHub Actions artifacts.
- [ ] Publish release notes and known limitations.

## Rollback

- Never delete `%USERPROFILE%\Pictures\Visual Vault` during uninstall or rollback.
- Create a `.vvbackup` before schema migration.
- Keep the previous verified EXE and SHA-256 checksums in GitHub Releases.

