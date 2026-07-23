# Troubleshooting

Error messages and behaviors you may encounter when importing Confluence
pages into local Markdown notes, and how to resolve them. All messages below
are produced by the current plugin version.

## Authentication and connection

### "Authentication failed" / HTTP 401 or 403

- Verify your Confluence email and API token in the plugin settings.
- Confirm you can view the page in a browser with the same account.
- Cloud tokens expire (Atlassian sets new tokens to expire within a year by
  default) — create a fresh token if in doubt:
  [Manage API tokens for your Atlassian account](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/).
- Use **Test Connection** (settings button or the
  `Test Confluence connection` command) to isolate credential problems from
  page-specific problems.

### "Page Not Found" / HTTP 404

- Check the `confluence-url` frontmatter value — the page may have been
  moved, renamed, or deleted.
- If you use the page-ID cache and recently moved pages in Confluence,
  disable **Cache page IDs** (or wait up to 1 hour for the cache to expire)
  and retry.

### "Rate limit exceeded" / HTTP 429

Confluence is throttling API requests. Wait a moment and retry; nothing was
changed locally.

### "Network Error"

Check your internet connection and that the Base URL is reachable from your
machine (VPN requirements included).

## Guard messages (imports blocked on purpose)

### "Blocked sync: this note's confluence-url points to …"

The note URL's host or protocol does not match your configured Base URL.
This is the credential guard: the plugin only sends credentials to the exact
protocol + host you configured. Fix the note's URL, or update the Base URL
setting if the host is legitimate. URLs with embedded `user:pass@` or
non-http(s) schemes are always rejected.

### "The note was modified while the sync dialog was open"

Something changed the note while the diff preview was open (another device,
another plugin, or a manual edit). The import aborted to protect the newer
edit — nothing was written. Close the preview and import again.

### "The Confluence page appears empty after conversion"

The page converted to an empty body, so the import aborted instead of
blanking your note. Check the page content in Confluence; if it genuinely
has content, report the page structure as a conversion issue.

### "A sync for this note is already in progress"

Each note allows one import at a time, covering the whole fetch → preview →
apply flow. Finish or cancel the open preview before starting another import
on the same note. Imports on different notes are independent.

## Content and formatting

### The same diff preview keeps appearing on every import

Expected when you chose **Cancel (Keep Local)** or edited the note locally:
your note and the page still differ, and local edits are never uploaded to
Confluence. Either Pull & Replace, or update the page in Confluence itself.

### Some formatting looks different after import

Conversion is best-effort (see the formatting limits entry in the
[FAQ](FAQ.md)). Complex or app-specific Confluence macros may be simplified;
unsafe link schemes are stripped for security.

### Large page notice

Pages over 1 MB show a one-time notice that the import may take longer and
use more memory. The import still runs; the notice is informational.

## Diagnostics

Enable **debug logging** in the plugin settings to write a metadata-only log
(`debug.log` in the plugin folder — lengths, counts, timings; never note or
page content, tokens, or emails). Attach relevant log excerpts when filing
[GitHub Issues](https://github.com/hikosalaidarkcommit/confluence-import/issues).
