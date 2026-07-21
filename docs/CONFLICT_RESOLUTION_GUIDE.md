# Pull Preview Guide (Differences Between Your Note and Confluence)

**Document Version**: 4.0
**Last Updated**: 2026-07-21
**Applies To**: Obsidian Confluence Sync Plugin (pull-only, read-only preview)

---

## Overview

**Sync is one-way: Confluence → Obsidian, and Confluence is the source of
truth.** When you trigger **Sync from Confluence** (always manual — the
plugin never syncs in the background), the plugin fetches the remote page and
compares it with your local note. If they differ, a **read-only Diff
Preview** opens so you can see exactly what would change **before anything is
written**.

There is no merging. You have exactly two choices:

| Button | What happens |
|---|---|
| **Pull & Replace** | Your local note body is replaced with the Confluence version in full |
| **Cancel (Keep Local)** | Nothing is written — your note stays byte-for-byte as it is |

The plugin never writes to Confluence — no page updates, no attachment
uploads.

> **⚠ Historical note**: Earlier versions offered per-difference resolution
> options ("Accept Local", "Accept Remote", "Accept Both") and before that a
> "Push to Confluence" action. Both have been removed. Per-block merging on a
> pull-only plugin was misleading — keeping a "local" block never propagated
> anywhere, so the same difference reappeared on every sync.

---

## When Does the Preview Appear?

Whenever the fetched Confluence content differs from your local note body:

```
1. You edit your note locally: "Project deadline: Friday"
2. The Confluence page says:   "Project deadline: Monday"
3. You trigger Sync from Confluence → Diff Preview opens
```

If the contents are identical, no preview appears — you see "Content is
identical" and only the `confluence-version` frontmatter is refreshed.

---

## How a Sync Works

1. **Fetch**: The plugin downloads the current Confluence page (read-only).
2. **Compare**: It compares the remote content with your local note body.
3. **Identical?** Nothing changes except the `confluence-version`
   frontmatter, which is aligned to the fetched remote version.
4. **Preview**: If there are differences, the read-only preview opens.
   Local lines are shown in green, incoming Confluence lines in blue.
5. **Your choice**:
   - **Pull & Replace** → local note body becomes the Confluence version;
     `confluence-version` is set to the fetched remote version; all other
     frontmatter properties (tags, aliases, …) are preserved.
   - **Cancel (Keep Local)** → zero writes; the version marker is NOT
     updated, so the same differences will appear on your next sync.
6. **Confluence is never modified** at any step.

---

## Reading the Preview

```
┌─────────────────────────────────────────────────────┐
│  Confluence has differences from your local note    │
│                                                     │
│  "Pull & Replace" will overwrite your local note    │
│  body with the Confluence version shown in blue.    │
│  Your local edits will be lost. Confluence is not   │
│  modified.                                          │
│                                                     │
│  (unchanged lines shown as context)                 │
│    your local line(s)      (green)                  │
│    incoming remote line(s) (blue)                   │
│                                                     │
│  ... one block per difference, display only ...     │
│                                                     │
│  [Cancel (Keep Local)]          [Pull & Replace]    │
└─────────────────────────────────────────────────────┘
```

The diff area is keyboard-scrollable and screen-reader labelled. The blocks
are **display only** — there are no buttons on them.

| | **Pull & Replace** | **Cancel (Keep Local)** |
|---|---|---|
| **Local note body** | Replaced with Confluence version | Unchanged |
| **`confluence-version`** | Set to fetched remote version | Unchanged |
| **Other frontmatter** | Preserved | Unchanged |
| **Confluence** | Unchanged (always) | Unchanged (always) |
| **Next sync** | Identical unless the page changes again | Same differences reappear |

---

## Safety Guards

All of these abort the pull with a clear notice and **zero writes**:

- **External change during preview**: if the note is modified while the
  preview is open (another device, another plugin, or a manual edit), the
  pull fails closed to protect the newer edit. Close the preview and re-sync.
- **Empty remote content**: if the Confluence page converts to an empty or
  whitespace-only body (usually a conversion failure), the pull is aborted
  instead of blanking your note.
- **Wrong host / protocol downgrade**: notes whose `confluence-url` points
  to a different host than the configured Base URL — or use `http` when the
  configured URL is `https` — are blocked before any request is sent.
- **One sync per note**: duplicate sync triggers while a preview is open are
  ignored.
- **Plugin unload**: disabling the plugin while a preview is open closes it
  and cancels any pending write.

---

## Best Practices

### ✅ Recommended

- Review the preview before clicking **Pull & Replace** — the replacement is
  whole-body, not selective.
- If you have local wording you want to keep, **Cancel**, copy your edits,
  update the page **in Confluence**, then pull again. Confluence is the
  source of truth.
- Sync regularly — smaller diffs are easier to review.

### ❌ Common Pitfalls

- Expecting local edits to survive **Pull & Replace** — they do not; the
  body is replaced in full (frontmatter properties other than
  `confluence-version` are preserved).
- Expecting **Cancel (Keep Local)** to make the differences go away — it
  keeps your note but does not update the version marker, so the same
  preview will reappear next sync as long as note and page differ.
- Expecting your local edits to reach Confluence — this plugin never
  uploads; edit the page in Confluence directly.

---

## Troubleshooting

### "I clicked Pull & Replace and my local edits are gone"

That is the documented behavior: the local body is replaced with the
Confluence version in full. Use Obsidian's File Recovery core plugin (or
your own backups) to recover previous local content if needed.

### "The same preview keeps appearing on every sync"

You chose **Cancel (Keep Local)** (or made new local edits). Your note and
the page still differ, so the preview will keep appearing. Either pull the
remote version, or update the page in Confluence to match what you want.

### "The note was modified while the sync dialog was open"

Expected protection: something changed the note while the preview was open,
and the pull was aborted to preserve that change. Close the preview and
re-sync to compare against the latest content.

### "The Confluence page appears empty after conversion"

The pull was aborted to protect your note. Check the page in Confluence —
if it genuinely has content, this may be a conversion issue worth reporting.

### "Blocked sync: this note's confluence-url points to …"

For security, credentials are only sent to the exact protocol and host
configured as **Confluence Base URL** in Settings. Fix the note's URL or
update the setting if the host is legitimate.

---

## Related Documentation

- [README](../README.md) — setup and usage
- [PRD_PULL_ONLY_UX_REDESIGN](PRD_PULL_ONLY_UX_REDESIGN.md) — design rationale for the pull-only preview UX (historical sections marked)
