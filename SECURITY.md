# Security Policy

## Supported Versions

Only the latest released version of this plugin receives security fixes.

| Version | Supported |
|---|---|
| latest release | ✅ |
| older versions | ❌ |

## Reporting a Vulnerability

Please report vulnerabilities **privately** via
[GitHub Security Advisories](https://github.com/hikosalaidarkcommit/confluence-import/security/advisories/new)
("Report a vulnerability" on the repository's Security tab).

- Do **not** open a public issue for security reports.
- Do **not** include your Confluence API token, email, or page content in a
  report. If a proof of concept needs sample data, use synthetic values.
- Reports are handled on a best-effort basis by a single maintainer. You
  should normally receive an acknowledgement within **14 days**; fix
  timelines depend on severity and complexity and cannot be guaranteed.

## Security Model & Known Limitations

This plugin is a strict one-way pull client (Confluence → Obsidian). It
performs **no writes to Confluence** (GET requests only). Still, be aware of
the following:

### Credentials are stored in plaintext

Your Confluence email and API token are stored **unencrypted** in the
plugin's `data.json` inside your vault's `.obsidian` folder (this is how
Obsidian plugin settings work; there is no OS keychain integration).

- Anyone with read access to your vault files can read the token.
- If you sync your vault (iCloud/Dropbox/Git/Obsidian Sync), the token
  travels with it. **Exclude `.obsidian/plugins/*/data.json` from shared or
  version-controlled vaults**, or use a token with the minimal scope your
  Confluence instance allows and rotate it regularly.
- File permissions are your OS defaults; consider vault-level disk
  encryption on shared machines.

### Server trust & redirects

Credentialed requests are only sent to the exact protocol + host you
configure as the Base URL; note-supplied URLs pointing elsewhere (host
mismatch, `https`→`http` downgrade, embedded `user:pass@`, non-http(s)
schemes) are rejected before any request. However, if the configured server
itself issues an HTTP redirect, the underlying Obsidian/Electron network
stack follows it — point the Base URL only at a Confluence server you trust.

### Remote content

Confluence page content is converted to Markdown locally. Links with
dangerous schemes (`javascript:`, `data:`, `vbscript:`, `file:`,
`obsidian:`, and other non-http(s)/mailto schemes) are stripped during
conversion, and macro titles are sanitized so remote authors cannot inject
Markdown/callout structure. Debug logging is written through Obsidian's
vault adapter API into the plugin's own folder — never outside the vault —
and logs contain metadata only (never page content, tokens, or emails).

### Image import

When image import is enabled (default), attachment images are downloaded
with these constraints:

- Credentialed downloads go **only** to the configured Confluence origin,
  using download URLs taken from the Confluence attachment API metadata —
  never constructed from page content. Origin is re-checked at the network
  layer as defense in depth.
- External image URLs are never fetched and never receive the Authorization
  header; they remain remote links in the note with a visible notice.
- MIME allowlist (PNG/JPEG/GIF/WebP/BMP — no SVG), 20 MB per image, 50
  images per page, 100 MB total per import, sequential downloads, 30-second
  soft timeout per download. Obsidian's network API cannot abort an
  in-flight request, so a timed-out download may still complete at the
  network layer — but its result is permanently discarded and can never
  create a vault file or receive further processing.
- Attachment filenames are deterministic plugin-generated names
  (`confluence-<pageId>-<hash>.<ext>`) — no untrusted path components ever
  reach the filesystem. Files are written through Obsidian's vault API into
  the configured attachment folder; alt text and URLs are escaped before
  being embedded in Markdown.
- If applying the note fails after attachments were created, those files
  (and only those) are moved to trash.

## Supply Chain & Release Integrity

- **Dependency auditing**: `npm audit --omit=dev` must report 0
  vulnerabilities for every release; it runs as a blocking gate in CI.
  Dev-toolchain advisories are triaged separately (they are not shipped).
- **Automated updates**: Dependabot monitors npm dependencies and GitHub
  Actions weekly.
- **SBOM**: `npm run sbom` generates a CycloneDX SBOM
  (`release/sbom.cdx.json`) of the production dependency set from
  `package-lock.json`. The SBOM is a regenerated artifact and is not
  committed; the lockfile is the source of truth.
- **Reproducible artifact**: `npm run package` produces a deterministic
  zip — staged file timestamps are normalized to a fixed epoch and the
  file order is fixed, so the same source always yields the same SHA-256.
  Anyone can rebuild from source and byte-compare the artifact.
- **Third-party licenses**: bundled runtime dependencies and their license
  texts are listed in `THIRD_PARTY_NOTICES.md`.
- **Repository**: the canonical repository is
  `hikosalaidarkcommit/confluence-import`. (Historical note: the
  project previously lived under `obsidian-sync-confluence` during an earlier
  pre-release phase; that name is no longer active.)
