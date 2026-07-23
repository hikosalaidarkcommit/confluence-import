# Workflow Comparison: Getting Confluence Content into Local Markdown Notes

An objective comparison of **workflow categories** for people who keep notes
in Markdown (e.g., in Obsidian) and need content that lives in Confluence.
This page compares approaches, not named products, and does not claim any
approach is universally better — each fits different needs.

## The four common approaches

### 1. This plugin (manual one-way import with diff preview)

**How it works**: link a note to a page via `confluence-url` frontmatter;
trigger an import; review a read-only diff preview; Pull & Replace or
Cancel.

- Strengths: repeatable per-page refresh; you see exactly what changes
  before it happens; Confluence is never modified; no external tooling.
- Limits: one page per note per trigger — no bulk space import, no
  scheduled/background sync, no local→Confluence publishing; desktop only;
  conversion is best-effort for complex macros.
- Fits: keeping a working set of specific Confluence pages current inside a
  Markdown vault.

### 2. Manual copy/paste

**How it works**: open the page in a browser, copy, paste into a note.

- Strengths: zero setup; works for any page you can view; fine for one-off
  captures.
- Limits: formatting fidelity depends on the editor's HTML→Markdown paste
  handling; no link between note and page, so refreshing means repeating the
  whole process and hand-diffing; error-prone at any volume.
- Fits: occasional single-page captures where staleness doesn't matter.

### 3. Export / conversion pipelines

**How it works**: export from Confluence (HTML/XML/PDF) or call its REST API,
then convert with tools such as Pandoc or custom scripts.

- Strengths: can process whole spaces in bulk; fully scriptable and
  automatable; output format under your control.
- Limits: requires building and maintaining tooling; conversion quality
  needs per-macro tuning; no built-in per-page refresh/diff story; usually a
  one-time migration rather than an ongoing workflow.
- Fits: one-time migrations or bulk archival, especially with dedicated
  engineering time.

### 4. Publishing tools (local → Confluence)

**How it works**: tools in this category push Markdown content *to*
Confluence, treating local files as the source of truth.

- Strengths: right choice when your team authors in Markdown and Confluence
  is the publication target.
- Limits: solves the opposite direction. Write access to Confluence carries
  the risk profile of write access — this plugin deliberately has none.
- Fits: Markdown-first authoring teams publishing into Confluence.

## Direction summary

| Approach | Direction | Refresh story | Bulk | Writes to Confluence |
|---|---|---|---|---|
| This plugin | Confluence → local note | Re-trigger per note, diff preview | No | Never |
| Copy/paste | Confluence → local note | Manual repeat | No | Never |
| Export/conversion | Confluence → files | Re-run pipeline | Yes | Never (read/export) |
| Publishing tools | Local → Confluence | n/a (opposite direction) | Varies | Yes (by design) |

If you need both directions, use separate tools for each and be deliberate
about which side is the source of truth for which pages.
