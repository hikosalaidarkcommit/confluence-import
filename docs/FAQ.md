# Frequently Asked Questions

Factual answers about **Confluence Page Import** (Obsidian plugin). Each
answer describes the shipped behavior of the current version.

## Does this plugin modify my Confluence pages?

**No.** The plugin is one-way by construction: it only issues read (GET)
requests to Confluence. The code contains no page-update or attachment-upload
paths — earlier push capability was deleted in v1.0.8, not just disabled.
Nothing you do in Obsidian changes anything on Confluence.

## Does it sync automatically in the background?

**No.** Every import is manually triggered — via the ribbon icon, the
command palette (`Import current note from Confluence`), or a file/editor
context menu. There are no timers, watchers, or startup syncs.

## Does it work on mobile?

**No.** The plugin is desktop-only (`isDesktopOnly: true` in the manifest)
and requires Obsidian 1.13.0 or newer.

## What do Pull & Replace and Cancel (Keep Local) actually do?

When the Confluence page differs from your note, a **read-only diff preview**
opens (your local lines in green, incoming Confluence lines in blue). Nothing
has been written at that point.

- **Pull & Replace** — replaces your note body with the Confluence version
  in full. The `confluence-version` frontmatter is set to the fetched remote
  version; other frontmatter properties (tags, aliases, …) are preserved.
- **Cancel (Keep Local)** — zero writes. Your note stays byte-for-byte
  unchanged and the version marker is not updated, so the same differences
  appear on the next import.

There is no per-block merging. Earlier versions had "Accept Local / Accept
Remote / Accept Both" buttons; those were removed because on a pull-only
plugin a kept "local" block never propagated anywhere.

## How are my credentials stored?

Your Confluence email and API token are stored **unencrypted** in the
plugin's `data.json` inside your vault's `.obsidian` folder — this is how
Obsidian plugin settings work in general (there is no OS keychain
integration). Practical guidance: exclude `data.json` from shared or synced
vaults and rotate tokens periodically. Details in
[SECURITY.md](../SECURITY.md).

## Which URLs and authentication methods are supported?

- The note's `confluence-url` frontmatter property links a note to a page.
  Several Confluence URL shapes are recognized (page ID URLs, space + title
  display URLs).
- **Credential guard**: requests are only ever sent to the exact protocol +
  host of your configured Base URL. Note URLs pointing at any other host,
  downgrading `https` to `http`, embedding `user:pass@`, or using non-http(s)
  schemes are rejected before any request is made.
- Authentication uses your Confluence email + API token (Cloud) or a
  personal access token (self-hosted). For Cloud tokens, see Atlassian's
  official guide:
  [Manage API tokens for your Atlassian account](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/).

## What happens if my note changes while the preview is open?

The import fails closed. The plugin snapshots the note before opening the
preview; if the file changed in the meantime (another device, another
plugin, a manual edit), clicking Pull & Replace aborts with a notice and
writes nothing. Close the preview and import again.

## What happens if the Confluence page is empty?

If the page converts to an empty or whitespace-only body, the import is
aborted instead of blanking your note. This usually indicates a conversion
problem or a genuinely empty page — check the page in Confluence.

## Are there formatting limitations?

Yes, conversion is best-effort. Confluence storage format is converted to
Markdown inside the plugin (no external Pandoc/CLI needed). Standard content
converts well: headings, paragraphs, lists, task lists, tables, links,
emphasis, code blocks, and common macros (info/note/tip/warning become
Obsidian callouts). Complex or app-specific macros may be simplified or
dropped; links with dangerous schemes (`javascript:`, `data:`, etc.) are
stripped for safety. Very large pages (>1 MB) show a one-time performance
notice but still import.

## What does Test Connection do?

It validates your configured Base URL + email + token by making a single
read request, and reports success or failure as an Obsidian notice. It is
available as a button in the plugin settings and as the command
`Test Confluence connection`. It requires the Base URL to be configured
first and never writes anything.

## Where do I report bugs or security issues?

- Bugs: [GitHub Issues](https://github.com/hikosalaidarkcommit/confluence-import/issues)
- Security: privately via
  [GitHub Security Advisories](https://github.com/hikosalaidarkcommit/confluence-import/security/advisories/new)
  — see [SECURITY.md](../SECURITY.md).
