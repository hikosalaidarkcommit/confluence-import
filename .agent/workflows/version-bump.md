---
description: Update release notes, changelog, version, and commit changes
---

This workflow automates the process of preparing a new release.

1. Update `docs/RELEASE_NOTES.md` with the latest changes and version.
2. Update `CHANGELOG.md` (create it if it doesn't exist) with version history.
3. Update version in `package.json`.
// turbo
4. Run version bump script:
```bash
npm run version
```
// turbo
5. Stage changes and commit:
```bash
git add docs/RELEASE_NOTES.md CHANGELOG.md package.json manifest.json versions.json
git commit -m "chore: bump version and update release documentation"
```

> [!TIP]
> Make sure you have reviewed the changes in `docs/RELEASE_NOTES.md` and `CHANGELOG.md` before running the commit step.
