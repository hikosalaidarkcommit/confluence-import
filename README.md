# Confluence Page Import (Obsidian Plugin)

A plugin that pulls Confluence page content into your Obsidian notes, with
difference detection and local conflict resolution.

> **⚠ Breaking behavior change**: Earlier versions (pre-1.0.8) offered a "Push to
> Confluence" action that uploaded your note to Confluence. This has been
> removed. **Sync is now strictly one-way: Confluence → Obsidian.** The plugin
> has no remote-write capability at all — the code that could update pages or
> upload attachments has been deleted from the plugin, not merely disabled.

## Features

- **Manual Import from Confluence**: Right-click any markdown note to pull the
  linked Confluence page into it. Sync is always user-triggered — the plugin
  never syncs automatically in the background.
- **One-way pull (read-only for Confluence)**: A sync fetches the remote page,
  compares it with your note, and applies the result ONLY to your local note.
  Your Confluence pages are never modified.
- **Difference Detection**: Detects when the Confluence page differs from your
  local note before changing anything.
- **Read-only Diff Preview**: Before anything is written, a preview window
  shows exactly what differs — your current local lines (green) versus the
  incoming Confluence lines (blue). The preview is display-only: you either
  take the Confluence version in full (**Pull & Replace**) or keep your note
  as-is (**Cancel (Keep Local)**). There is no per-block merging.
- **Empty-page protection**: If the Confluence page converts to an empty
  body, the pull is aborted instead of blanking your note.
- **Smart URL Parsing**: Automatically detects Page ID, Space, and Title from
  various Confluence URL formats.
- **Version Tracking**: Records the pulled page version in the note's
  `confluence-version` frontmatter.
- **Credential safety**: The configured Base URL is required, and credentials
  are only ever sent to that exact protocol + host. Notes whose
  `confluence-url` points to a different host — or downgrades `https` to
  `http` — are rejected before any request is made.
- **External-change protection**: If the note is modified (by you, another
  device, or another plugin) while the preview window is open, applying is
  aborted with a clear notice and nothing is overwritten; you can close the
  preview and re-sync.
- **One sync per note at a time**: Duplicate triggers while a sync (including
  its preview window) is in progress are safely ignored.

## Requirements

- **Obsidian 1.13.0 or newer** (`minAppVersion` in the plugin manifest —
  required by the declarative settings API that makes this plugin's settings
  searchable).
- **Desktop only** (the plugin uses desktop file APIs for logging).

## Installation

### From Community Plugins
1. Open Obsidian Settings > Community Plugins
2. Turn off "Restricted mode"
3. Click "Browse" and search for "Confluence Page Import"
4. Click Install and then Enable

### Manual Installation
1. Get the release archive `confluence-import-1.0.16.zip` (or the three
   files `main.js`, `manifest.json`, `styles.css`).
2. Create a folder `confluence-import` in your vault's `.obsidian/plugins/` directory.
3. Extract/put the three files flat in that folder.
4. Reload Obsidian and enable the plugin.

## Setup Guide

1. **Get your API Token**:
   - Go to Confluence.
   - Click your Profile picture -> Settings -> Personal Access Tokens.
   - Create a token and copy it.

2. **Configure Plugin**:
   - Open Obsidian Settings -> Confluence Page Import.
   - Enter your **Confluence Base URL** (required — credentials are only sent
     to this exact protocol + host, e.g. `https://mycompany.atlassian.net`;
     `http` downgrades are blocked).
   - Enter your **Confluence User Email**.
   - Paste your **API Token** (Unicode characters in email/token are supported).
   - (Optional) Enter a default Space Key.
   - (Optional) **Cache page IDs** — caches resolved page IDs for 1 hour to
     speed up repeat syncs; the cache persists across syncs while the plugin
     is loaded. Disable it if you frequently move pages in Confluence.
   - (Optional) **Enable debug logging** — writes a metadata-only debug log
     (see [Debug Logging](#debug-logging)).

3. **Test Connection**:
   - Click **Test Connection**. It validates your credentials against the
     configured Base URL and reports the result as an Obsidian notice
     (configure the Base URL first — the button will remind you otherwise).

## Usage

1. **Prepare your Note**:
   Add a `confluence-url` property to your note's frontmatter:

   ```yaml
   ---
   confluence-url: https://confluence.example.com/display/SPACEKEY/My+Page+Title
   ---
   ```

2. **Import from Confluence** (manual, user-triggered):
   - Right-click the note in the File Explorer or Editor.
   - Select **Import from Confluence**.
   - Or use the Command Palette: `Confluence Page Import: Import current note from Confluence`.
   - Or click the sync ribbon icon.

   > Note: syncing only happens when you trigger it. There is no automatic or
   > background sync, and Confluence is never modified.

3. **Review the Diff Preview** (if the contents differ):
   - If the local note and remote page are identical, nothing changes (the
     `confluence-version` frontmatter is refreshed to the current remote
     version).
   - If they differ, a **read-only preview** window opens showing your local
     lines (green) and the incoming Confluence lines (blue). Nothing has been
     written at this point.
   - Click **Pull & Replace** to replace your local note body with the
     Confluence version in full. The `confluence-version` frontmatter is set
     to the fetched remote version; other frontmatter properties (tags,
     aliases, etc.) are preserved. Confluence itself is never changed.
   - Click **Cancel (Keep Local)** to keep your note exactly as it is —
     nothing is written and the version marker is NOT updated, so the same
     differences will be shown again on your next sync.
   - **If the note changed while the preview was open** (another device,
     plugin, or manual edit), the pull is aborted with a clear notice and
     nothing is written. Close the preview and re-sync to continue.
   - **If the Confluence page converts to an empty body**, the pull is
     aborted to protect your note.

   > Local edits are never merged back to Confluence. If you need your local
   > wording on the page, edit the page in Confluence itself, then pull.

## Large Pages

Syncing very large Confluence pages (content over 1 MB) shows a one-time
notice that the sync may take longer and use extra memory. The sync always
continues — the notice is informational only. Difference details are computed
lazily when the preview window opens, keeping normal syncs lean.

## Debug Logging

When **Enable debug logging** is on, the plugin writes `debug.log` in its
plugin folder. Privacy and safety guarantees:

- **Metadata only**: lengths, counts, timings, and statuses. Note bodies,
  page content, tokens, emails, and URL query strings are never written —
  sensitive fields are redacted before hitting disk.
- **Bounded size**: the active log rotates to `debug.log.1` at 1 MB, keeping
  a single rotated generation.
- **Vault-scoped storage**: the log lives in the plugin's own folder inside
  your vault's `.obsidian` directory and is written exclusively through
  Obsidian's vault adapter API — the plugin does not touch files outside
  the vault.
- Writes are asynchronous and flushed when the plugin unloads.

## Security & Privacy

- **Pull-only by construction**: the plugin has no code paths that write to
  Confluence (GET requests only).
- **Credential scope**: credentials are only sent to the exact protocol +
  host of your configured Base URL. Note URLs with a different host, an
  `http` downgrade, embedded `user:pass@`, or non-http(s) schemes are
  rejected before any request.
- **Plaintext token storage**: like all Obsidian plugin settings, your API
  token is stored unencrypted in the plugin's `data.json`. Exclude it from
  shared/synced vaults and rotate tokens periodically — see
  [SECURITY.md](SECURITY.md) for details and the private vulnerability
  reporting process (GitHub Security Advisories).
- **Remote content hardening**: dangerous link schemes (`javascript:`,
  `data:`, etc.) are stripped during conversion, and Confluence macro titles
  are sanitized so remote page authors cannot inject Markdown structure into
  your notes.
- **Supply chain**: CI enforces `npm audit --omit=dev` = 0 on every push;
  Dependabot monitors dependencies weekly; a CycloneDX SBOM can be generated
  with `npm run sbom`. Release zips are built deterministically — the same
  source always produces the same SHA-256, so you can rebuild from source and
  byte-compare any published artifact. Bundled third-party licenses are
  listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Repository**: source code, issues, and security reporting live at
  [github.com/hikosalaidarkcommit/confluence-import](https://github.com/hikosalaidarkcommit/confluence-import).

## Troubleshooting

- **Authentication Failed (401/403)**: Check your email and API token, and
  that you have permission to view the page.
- **Page Not Found (404)**: Ensure the URL is correct and the page exists.
- **Rate limit exceeded (429)**: Confluence is throttling requests — wait a
  moment and retry.
- **"Blocked sync: this note's confluence-url points to …"**: the note's URL
  host or protocol does not match your configured Base URL. Fix the note or
  the setting.
- **"The note was modified while the sync dialog was open"**: expected
  protection against losing concurrent edits; close the preview and re-sync.
- **"The Confluence page appears empty after conversion"**: the pull was
  aborted to protect your note — check the page content on Confluence.
- **Network Error**: Check your internet connection.

## Development

```bash
npm install        # setup
npm run dev        # development build (watch mode)
npm run build      # typecheck + production build
npm test           # full unit/integration test suite (Jest)
npm run test:memory   # standalone large-page memory verification (child process)
npm run package    # local release package: test + build + staged zip under release/
npm run verify:release   # verify the packaged zip (whitelist, hashes, manifest)
```

`npm run package` produces `release/confluence-import-<version>.zip`
containing exactly three files (`main.js`, `manifest.json`, `styles.css`) for
manual installation. See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for details.
