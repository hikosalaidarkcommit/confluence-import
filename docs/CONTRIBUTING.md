# Contributing to Confluence Import

## Development Setup

1. **Prerequisites**:
   - Node.js (v16+)
   - npm
   - Obsidian (for testing)

2. **Clone and Install**:
   ```bash
   git clone https://github.com/hikosalaidarkcommit/obsidian-sync-confluence.git
   cd obsidian-sync-confluence
   npm install
   ```

3. **Build**:
   - Development build (watch mode):
     ```bash
     npm run dev
     ```
   - Production build:
     ```bash
     npm run build
     ```

## Project Structure

- `src/main.ts`: Entry point (plugin lifecycle, commands, menus).
- `src/services/`: Core pull-sync logic.
- `src/api/`: Confluence API interaction (read-only client, page resolver).
- `src/diff/`: Storage-format→Markdown conversion and difference detection.
- `src/ui/`: Obsidian Modal implementations (read-only pull preview).
- `src/utils/`: Logger (metadata-only, rotating) and markdown normalizer.
- `scripts/`: Standalone tooling (memory verification, packaging, release
  verify) — never bundled into `main.js`.

## Testing

```bash
npm test              # full Jest suite (unit + integration)
npm run test:memory   # standalone large-page memory check (cold child process)
```

For manual testing in Obsidian:
1. Enable the plugin in a test Vault.
2. Point the local plugin to your build output (or symlink).
3. Use the "Reload plugins" command in Obsidian to refresh changes.

## Local Packaging

```bash
npm run package          # runs tests + build, stages and zips release files
npm run verify:release   # independent verification of the produced zip
```

The zip is written to `release/confluence-import-<version>.zip` and
contains exactly `main.js`, `manifest.json`, `styles.css` (flat, suitable for
manual installation).

Packaging is **deterministic**: staged file timestamps are normalized and the
zip entry order is fixed, so packaging the same source twice yields an
identical SHA-256. This lets anyone verify a published artifact by rebuilding
from source.

## Continuous Integration

`.github/workflows/ci.yml` runs on every push/PR with a read-only token
(`permissions: contents: read`):

- `npm ci` (locked install), `npm audit --omit=dev` (blocking gate),
  `npm test`, `npm run build`, `npm run package` (includes release
  verification), `npm run sbom`.
- The large-page memory gate (`npm run test:memory`) runs as a separate
  advisory job (`continue-on-error`) because its absolute memory thresholds
  were calibrated on a local macOS workstation and vary across CI runners.

Dependabot (`.github/dependabot.yml`) checks npm and GitHub Actions
dependencies weekly.

## SBOM & Third-Party Licenses

- `npm run sbom` writes a CycloneDX SBOM of the production dependency set to
  `release/sbom.cdx.json` (generated, not committed — `package-lock.json` is
  the source of truth). The script fails if local paths would leak into it.
- `THIRD_PARTY_NOTICES.md` reproduces the license texts of all bundled
  runtime dependencies (required by e.g. the BSD-3-Clause license of `diff`).
  Obsidian's release format allows only `main.js`/`manifest.json`/`styles.css`
  in the zip, so the notices file lives in the repository (and is linked from
  the README) instead of inside the artifact — the license requirement is
  satisfied by distribution alongside the source repository.

## Release Workflow

1. Update version in `package.json`.
2. Run `npm run version` to update manifest and versions files.
3. Run `npm run package` (tests + build + deterministic zip + verification).
4. Run `npm run sbom` to regenerate the SBOM.
5. Commit and Tag.
