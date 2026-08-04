# Contributing

## Before making changes

1. Open an issue describing the problem or proposal.
2. Do not add telemetry, cloud dependencies, or network requests without an explicit project decision.
3. Do not commit user images, databases, backups, or release binaries.

## Validation

```powershell
npm ci
npm run check
npm audit --omit=dev
npm run dist:portable
```

For UI changes, verify light and dark themes, English and Russian interface modes, 760x560 and 1200x820 windows, keyboard focus, reduced motion, and Windows scaling at 125% and 150%.

## Pull requests

Describe the goal, validation performed, visual changes, and any data migration. Keep each pull request focused on one coherent task.

