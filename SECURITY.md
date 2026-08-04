# Security policy

## Supported versions

Security fixes are released for the latest version of Visual Vault.

## Reporting a vulnerability

Do not publish vulnerabilities in regular issues. Use **Security > Advisories > Report a vulnerability** in the GitHub repository. Include the affected version, Windows build, reproduction steps, and expected impact.

## Security model

Visual Vault is a local-first application without a network API. The renderer is isolated through Electron sandboxing and context isolation. File-system access is limited to the IPC bridge. The default library is stored in `%USERPROFILE%\Pictures\Visual Vault`.

Visual Vault 0.5.7 binaries are not code-signed. Verify SHA-256 checksums from the GitHub Release and download binaries only from the official repository.

